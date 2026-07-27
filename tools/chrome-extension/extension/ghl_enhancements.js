// ghl_enhancements.js
//
// Content script that runs on GoHighLevel (LeadConnector) CRM pages.
// Its job: replace GHL's native "LC Phone" dialer with Zoom Phone click-to-call.
//
// GHL is a white-labeled SaaS, so the same app code runs on many domains:
// app.gohighlevel.com, *.gohighlevel.com, *.leadconnectorhq.com, custom
// white-label hosts (e.g. ghl.tableturnerr.com) and arbitrary user domains.
// We detect GHL by hostname, by a user-supplied domain list, and by DOM
// fingerprints. On non-GHL pages the script bails immediately and attaches
// nothing.

(function () {
    'use strict';

    // Prevent duplicate injection (e.g. SPA re-injection or repeated loads).
    if (window.__GMES_GHL_ENH__) return;
    window.__GMES_GHL_ENH__ = true;

    // ========================================================================
    // Phone Normalization Helpers (kept identical to manual_mode_website.js)
    // ========================================================================

    // Strips non-digits, prepends 1 for 10-digit US numbers.
    // Returns '1XXXXXXXXXX' or null if not a valid US number.
    function normalizePhone(raw) {
        if (!raw) return null;
        var digits = String(raw).replace(/\D/g, '');
        if (digits.length === 10) digits = '1' + digits;
        if (digits.length !== 11 || digits[0] !== '1') return null;
        return digits;
    }

    // Converts '1XXXXXXXXXX' to display format '(XXX) XXX-XXXX'
    function formatPhoneDisplay(normalized) {
        if (!normalized) return '';
        var digits = String(normalized).replace(/\D/g, '');
        if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
        if (digits.length === 10) {
            return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
        }
        return normalized;
    }

    // Matches a standalone phone number in free text. Permissive enough for
    // US/international shapes, strict enough to avoid grabbing random digits.
    var PHONE_RE = /^[+]?[\d][\d\s().\-]{8,18}\d$/;

    // ========================================================================
    // Toast palette — dark tokens for the click-to-call toast, matching the
    // popup's [data-theme="dark"] surface/text/border.
    // ========================================================================

    var PALETTE = {
        surface: '#1e1e2a',
        border: '#35354a',
        text: '#e8eaed'
    };

    // ========================================================================
    // Default settings (mirrors the storage contract)
    // ========================================================================

    var SETTING_KEYS = [
        'gmes_zoom_enabled',
        'gmes_zoom_click_to_call',
        'gmes_zoom_hide_lc',
        'gmes_zoom_caller_id',
        'gmes_ghl_domains',
        'gmes_zoom_prewarm'
    ];

    // Cached settings object, populated on load and kept current via
    // chrome.storage.onChanged.
    var settings = {
        zoomEnabled: false,     // default OFF
        clickToCall: false,     // default OFF
        hideLc: false,          // default OFF
        callerId: '',           // default ''
        domains: [],            // default []
        prewarm: false          // default OFF (truthy only)
    };

    // Normalizes a raw chrome.storage payload into the cached settings object.
    // Booleans are opt-in via "=== true"; prewarm is also truthy-only.
    function readSettings(raw) {
        raw = raw || {};
        settings.zoomEnabled = raw.gmes_zoom_enabled === true;
        settings.clickToCall = raw.gmes_zoom_click_to_call === true;
        settings.hideLc = raw.gmes_zoom_hide_lc === true;
        settings.callerId = typeof raw.gmes_zoom_caller_id === 'string' ? raw.gmes_zoom_caller_id : '';
        settings.domains = Array.isArray(raw.gmes_ghl_domains) ? raw.gmes_ghl_domains : [];
        settings.prewarm = raw.gmes_zoom_prewarm === true;
    }

    // ========================================================================
    // Safe chrome.* wrappers — never throw on a torn-down extension context.
    // ========================================================================

    function safeStorageGet(keys, cb) {
        try {
            if (!chrome || !chrome.storage || !chrome.storage.local) {
                cb({});
                return;
            }
            chrome.storage.local.get(keys, function (res) {
                // Touch lastError so Chrome doesn't log "unchecked" warnings.
                if (chrome.runtime && chrome.runtime.lastError) {
                    cb({});
                    return;
                }
                cb(res || {});
            });
        } catch (e) {
            cb({});
        }
    }

    function safeOnChanged(handler) {
        try {
            if (chrome && chrome.storage && chrome.storage.onChanged) {
                chrome.storage.onChanged.addListener(handler);
            }
        } catch (e) { /* no-op */ }
    }

    // Stash the just-dialed number into chrome.storage.session so the Zoom
    // web-phone call detector (zoom_call_detect.js, running on *.zoom.us) can
    // attach it to the call it detects. session storage is process-scoped and
    // cleared when the browser closes — the right lifetime for a transient
    // "last dialed number" hint. The background worker grants content scripts
    // access to session storage (setAccessLevel). Best-effort: a failure here
    // just means the detector falls back to scraping the Zoom page number.
    function stashDialedNumber(e164) {
        try {
            if (!chrome || !chrome.storage || !chrome.storage.session) return;
            chrome.storage.session.set({
                gmes_zoom_last_dialed: { e164: e164, ts: Date.now(), name: '' }
            }, function () {
                void (chrome.runtime && chrome.runtime.lastError);
            });
        } catch (e) { /* no-op */ }
    }

    // ========================================================================
    // GHL DETECTION
    // ========================================================================

    // Returns true if hostname is one GHL always serves from.
    function isKnownGhlHost(hostname) {
        if (!hostname) return false;
        hostname = hostname.toLowerCase();
        if (hostname === 'app.gohighlevel.com') return true;
        if (hostname.slice(-16) === '.gohighlevel.com') return true; // *.gohighlevel.com
        if (hostname.slice(-22) === '.leadconnectorhq.com') return true; // *.leadconnectorhq.com
        if (hostname === 'ghl.tableturnerr.com') return true;
        return false;
    }

    // Returns true if hostname matches a user-supplied white-label host.
    function isUserGhlDomain(hostname) {
        if (!hostname || !settings.domains || !settings.domains.length) return false;
        hostname = hostname.toLowerCase();
        for (var i = 0; i < settings.domains.length; i++) {
            var d = String(settings.domains[i] || '').trim().toLowerCase();
            if (!d) continue;
            // Allow exact host or subdomain match.
            if (hostname === d || hostname.slice(-(d.length + 1)) === '.' + d) return true;
        }
        return false;
    }

    // DOM fingerprints that betray a HighLevel/LeadConnector app even on an
    // unknown custom domain.
    // ---- TUNE/EXTEND against a live GHL instance ----
    // These selectors are best-effort; HighLevel ships assets from
    // leadconnectorhq.com and msgsndr.com, and sets various app markers.
    function hasGhlFingerprint() {
        try {
            var assetHit = document.querySelector(
                'script[src*="leadconnectorhq.com"], ' +
                'link[href*="leadconnectorhq"], ' +
                'script[src*="msgsndr.com"], ' +
                'img[src*="leadconnectorhq"]'
            );
            if (assetHit) return true;

            // HighLevel meta / app-shell markers (extend as needed).
            var metaHit = document.querySelector(
                'meta[name="HighLevel"], ' +
                'meta[name="highlevel"], ' +
                'meta[name="lc-app"], ' +
                'meta[property*="leadconnector"]'
            );
            if (metaHit) return true;
        } catch (e) { /* no-op */ }
        return false;
    }
    // ---- end fingerprint block ----

    function isGhlPage() {
        var hostname = '';
        try { hostname = location.hostname || ''; } catch (e) { hostname = ''; }
        if (isKnownGhlHost(hostname)) return true;
        if (isUserGhlDomain(hostname)) return true;
        if (hasGhlFingerprint()) return true;
        return false;
    }

    // ========================================================================
    // ZOOM PHONE DIALING
    // ========================================================================

    // Fires a zoomphonecall:// URL without navigating the page by dropping a
    // transient hidden iframe. The Zoom desktop client picks up the scheme and
    // auto-dials. Using zoomphonecall:// (not tel:/callto:) keeps the OS tel
    // handler from hijacking the call.
    function fireZoomUrl(url) {
        try {
            var iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = '0';
            iframe.setAttribute('aria-hidden', 'true');
            iframe.src = url;
            (document.body || document.documentElement).appendChild(iframe);
            setTimeout(function () {
                try { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); } catch (e) { /* no-op */ }
            }, 200);
        } catch (e) { /* no-op */ }
    }

    // Normalizes, builds an E.164 zoomphonecall URL (with optional caller id),
    // fires it, and shows a toast.
    function dialZoom(rawNumber) {
        var normalized = normalizePhone(rawNumber);
        var e164;
        if (normalized) {
            e164 = '+' + normalized;
        } else {
            // Invalid US shape: fall back to the raw digits prefixed with '+'
            // so international / extension numbers still attempt to dial.
            var digits = String(rawNumber || '').replace(/\D/g, '');
            if (!digits) return;
            e164 = '+' + digits;
        }

        var url = 'zoomphonecall://' + e164;
        var callerId = settings.callerId;
        if (callerId) {
            url += '?callerid=' + encodeURIComponent(callerId);
        }

        fireZoomUrl(url);

        // Hand the dialed number to the Zoom web-phone call detector so a recorded
        // call can be tagged with the lead's number. e164 already carries the
        // leading '+'. No-op if the recording feature / session storage isn't set up.
        stashDialedNumber(e164);

        var display = normalized ? formatPhoneDisplay(normalized) : e164;
        showToast('📞 Calling ' + display + ' via Zoom…');
    }

    // ========================================================================
    // TOAST
    // ========================================================================

    var toastEl = null;
    var toastTimer = null;

    function showToast(message) {
        try {
            if (!toastEl) {
                toastEl = document.createElement('div');
                toastEl.id = 'gmes-zoom-toast';
                toastEl.style.cssText = [
                    'position:fixed',
                    'bottom:24px',
                    'right:24px',
                    'z-index:2147483647',
                    'background:' + PALETTE.surface,
                    'color:' + PALETTE.text,
                    'border:1px solid ' + PALETTE.border,
                    'border-radius:999px',
                    'padding:10px 18px',
                    'font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
                    'box-shadow:0 6px 24px rgba(0,0,0,0.4)',
                    'pointer-events:none',
                    'opacity:0',
                    'transition:opacity 0.25s ease',
                    'max-width:320px',
                    'white-space:nowrap',
                    'overflow:hidden',
                    'text-overflow:ellipsis'
                ].join(';');
                (document.body || document.documentElement).appendChild(toastEl);
            }
            toastEl.textContent = message;
            // Force reflow so the opacity transition runs on re-show.
            void toastEl.offsetWidth;
            toastEl.style.opacity = '1';

            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(function () {
                if (toastEl) toastEl.style.opacity = '0';
            }, 3500);
        } catch (e) { /* no-op */ }
    }

    // ========================================================================
    // FEATURE: HIDE LC DIALER  (apply / remove pair)
    // ========================================================================

    var HIDE_LC_STYLE_ID = 'gmes-zoom-hide-lc';

    // ---- TUNE against live ghl.tableturnerr.com ----
    // Best-effort selectors for the LeadConnector floating dial-pad widget and
    // the in-call popup. We cannot see the live DOM, so these target likely
    // containers / iframes whose id/class/src reference the dialer. Extend or
    // trim once verified against a real GHL instance.
    var HIDE_LC_CSS = [
        '[id*="lc-phone" i]',
        '[class*="lc-phone" i]',
        '[id*="lc_phone" i]',
        '[class*="lc_phone" i]',
        '[id*="dialer" i]',
        '[class*="dialer" i]',
        '[id*="dial-pad" i]',
        '[class*="dial-pad" i]',
        '[id*="dialpad" i]',
        '[class*="dialpad" i]',
        '[class*="leadconnector-phone" i]',
        '[class*="floating-call" i]',
        '[class*="call-widget" i]',
        '[id*="call-widget" i]',
        'iframe[src*="leadconnectorhq.com/widget" i]',
        'iframe[src*="dialer" i]',
        'iframe[src*="lc-phone" i]'
    ].join(',\n') + ' { display:none !important; }';
    // ---- end hide-LC selector block ----

    function applyHideLc() {
        try {
            if (document.getElementById(HIDE_LC_STYLE_ID)) return;
            var style = document.createElement('style');
            style.id = HIDE_LC_STYLE_ID;
            style.textContent = HIDE_LC_CSS;
            (document.head || document.documentElement).appendChild(style);
        } catch (e) { /* no-op */ }
    }

    function removeHideLc() {
        try {
            var el = document.getElementById(HIDE_LC_STYLE_ID);
            if (el && el.parentNode) el.parentNode.removeChild(el);
        } catch (e) { /* no-op */ }
    }

    // ========================================================================
    // FEATURE: CALL INTERCEPTION  (apply / remove pair)
    // ========================================================================

    var interceptionActive = false;

    // Pulls a phone number out of a tel:/callto: href.
    function numberFromTelHref(href) {
        if (!href) return null;
        var m = String(href).replace(/^tel:/i, '').replace(/^callto:/i, '');
        // Strip URL params/fragments and decode.
        try { m = decodeURIComponent(m); } catch (e) { /* keep raw */ }
        m = m.split('?')[0].split('#')[0].trim();
        return m || null;
    }

    // Returns true if the node sits inside an editable field, where intercepting
    // a "click on a number" would be wrong.
    function isInEditable(node) {
        var el = node;
        while (el && el.nodeType === 1) {
            var tag = (el.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return true;
            if (el.isContentEditable) return true;
            el = el.parentElement;
        }
        return false;
    }

    // Examines a click and returns the phone number to dial, or null if this
    // click isn't a call attempt. Ordered most-reliable first.
    function detectCallNumber(startNode) {
        if (!startNode || startNode.nodeType !== 1) {
            startNode = startNode && startNode.parentElement;
        }
        if (!startNode) return null;

        // (a) Anchor with a tel:/callto: href anywhere up the tree.
        var anchor = startNode.closest ? startNode.closest('a[href^="tel:"], a[href^="callto:"]') : null;
        if (anchor) {
            var num = numberFromTelHref(anchor.getAttribute('href'));
            if (num) return num;
        }

        // (b) Click-to-call on a displayed number: an element whose trimmed
        //     textContent is a SINGLE phone number. Skip editable fields.
        if (settings.clickToCall && !isInEditable(startNode)) {
            var txt = (startNode.textContent || '').trim();
            if (txt && txt.length <= 24 && PHONE_RE.test(txt)) {
                // Guard against grabbing a number that's only part of a larger
                // sentence: textContent must BE the number, nothing else.
                var digits = txt.replace(/\D/g, '');
                if (digits.length >= 7 && digits.length <= 15) return txt;
            }
        }

        // (c) Identifiable GHL "Call" button. Best-effort: an element (or
        //     ancestor) labelled "call" or carrying a phone icon.
        //     ---- TUNE against live instance ----
        if (settings.clickToCall) {
            var el = startNode;
            var hops = 0;
            while (el && el.nodeType === 1 && hops < 6) {
                var aria = (el.getAttribute && (el.getAttribute('aria-label') || '')) || '';
                var title = (el.getAttribute && (el.getAttribute('title') || '')) || '';
                var label = (aria + ' ' + title).toLowerCase();
                var hasPhoneIcon = !!(el.querySelector && el.querySelector(
                    '[class*="phone" i], [class*="icon-call" i], [data-icon*="phone" i], svg[class*="phone" i]'
                ));
                if (label.indexOf('call') !== -1 || hasPhoneIcon) {
                    // Try to find an associated number near this control.
                    var found = findNearbyNumber(el);
                    if (found) return found;
                }
                el = el.parentElement;
                hops++;
            }
        }
        // ---- end call-button detection block ----

        return null;
    }

    // Looks for a phone number associated with a call control: first a tel:
    // link inside it, then a data attribute, then a number in its text.
    function findNearbyNumber(el) {
        try {
            var tel = el.querySelector ? el.querySelector('a[href^="tel:"], a[href^="callto:"]') : null;
            if (tel) {
                var n = numberFromTelHref(tel.getAttribute('href'));
                if (n) return n;
            }
            var dataAttrs = ['data-phone', 'data-number', 'data-tel', 'data-contact-phone'];
            for (var i = 0; i < dataAttrs.length; i++) {
                if (el.getAttribute) {
                    var dv = el.getAttribute(dataAttrs[i]);
                    if (dv && dv.replace(/\D/g, '').length >= 7) return dv;
                }
            }
        } catch (e) { /* no-op */ }
        return null;
    }

    function clickHandler(e) {
        // Only act when dialer features are active.
        if (!settings.zoomEnabled) return;
        try {
            var start = null;
            if (e.composedPath) {
                var path = e.composedPath();
                start = (path && path[0]) || e.target;
            } else {
                start = e.target;
            }
            var number = detectCallNumber(start);
            if (!number) return; // Not a call attempt: let GHL behave normally.

            e.preventDefault();
            e.stopImmediatePropagation();
            dialZoom(number);
        } catch (err) { /* never break the page */ }
    }

    function applyInterception() {
        if (interceptionActive) return;
        try {
            document.addEventListener('click', clickHandler, true);
            interceptionActive = true;
        } catch (e) { /* no-op */ }
    }

    function removeInterception() {
        if (!interceptionActive) return;
        try {
            document.removeEventListener('click', clickHandler, true);
        } catch (e) { /* no-op */ }
        interceptionActive = false;
    }

    // ========================================================================
    // FEATURE: PRE-WARM ZOOM  (apply / remove pair)
    // ------------------------------------------------------------------------
    // Cold-start mitigation. Firing zoomphonecall:// already launches Zoom when
    // it's installed but closed; however the very first call after a cold launch
    // can arrive before Zoom Phone is ready and fail to auto-dial. When enabled,
    // we open the Zoom client on the user's FIRST interaction with the GHL page
    // (a genuine user gesture is required, otherwise Chrome blocks the external
    // protocol launch), so Zoom is already warm by the time a number is clicked.
    // Fires at most once per page load. Best-effort: if zoomus:// isn't
    // registered the launch quietly no-ops, and real dialing via
    // zoomphonecall:// is unaffected. Requires the user to be logged in to Zoom.
    // ========================================================================

    var ZOOM_OPEN_URL = 'zoomus://zoom.us/';
    var prewarmArmed = false;
    var prewarmFired = false;

    function prewarmHandler() {
        if (prewarmFired) return;
        prewarmFired = true;
        disarmPrewarm();
        fireZoomUrl(ZOOM_OPEN_URL);
    }

    function armPrewarm() {
        if (prewarmArmed || prewarmFired) return;
        try {
            // Capture-phase pointerdown: the earliest reliable user gesture.
            document.addEventListener('pointerdown', prewarmHandler, true);
            prewarmArmed = true;
        } catch (e) { /* no-op */ }
    }

    function disarmPrewarm() {
        if (!prewarmArmed) return;
        try {
            document.removeEventListener('pointerdown', prewarmHandler, true);
        } catch (e) { /* no-op */ }
        prewarmArmed = false;
    }

    // ========================================================================
    // FEATURE ORCHESTRATION
    // ========================================================================

    // Applies the full feature set from the cached settings. Idempotent: each
    // apply()/remove() checks current state before touching the DOM.
    function applyAll() {
        // Dialer features gate on the master switch.
        if (settings.zoomEnabled) {
            if (settings.hideLc) {
                applyHideLc();
            } else {
                removeHideLc();
            }
            applyInterception();
            if (settings.prewarm) {
                armPrewarm();
            } else {
                disarmPrewarm();
            }
        } else {
            removeHideLc();
            removeInterception();
            disarmPrewarm();
        }
    }

    // ========================================================================
    // SPA AWARENESS — debounced MutationObserver re-asserts active styles.
    // GHL re-renders heavily on route changes and can strip our injected
    // nodes; we re-add them when needed. Kept cheap and guarded against loops:
    // we only re-insert when our own elements are missing, so the observer's
    // own mutations don't trigger meaningful work.
    // ========================================================================

    var observer = null;
    var debounceTimer = null;

    function reassert() {
        // Re-add only what's currently supposed to be active and gone missing.
        if (settings.zoomEnabled && settings.hideLc && !document.getElementById(HIDE_LC_STYLE_ID)) {
            applyHideLc();
        }
    }

    function onMutations() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(reassert, 300);
    }

    function startObserver() {
        if (observer) return;
        try {
            observer = new MutationObserver(onMutations);
            observer.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) { /* no-op */ }
    }

    // ========================================================================
    // LIVE SETTINGS — react to storage changes without a page reload.
    // ========================================================================

    function onStorageChanged(changes, area) {
        if (area !== 'local') return;
        var touched = false;
        for (var i = 0; i < SETTING_KEYS.length; i++) {
            if (Object.prototype.hasOwnProperty.call(changes, SETTING_KEYS[i])) {
                touched = true;
                break;
            }
        }
        if (!touched) return;

        // Rebuild the cached settings from the new values, falling back to the
        // previous cached value when a key wasn't part of this change set.
        var merged = {
            gmes_zoom_enabled: settings.zoomEnabled,
            gmes_zoom_click_to_call: settings.clickToCall,
            gmes_zoom_hide_lc: settings.hideLc,
            gmes_zoom_caller_id: settings.callerId,
            gmes_ghl_domains: settings.domains,
            gmes_zoom_prewarm: settings.prewarm
        };
        if (changes.gmes_zoom_enabled) merged.gmes_zoom_enabled = changes.gmes_zoom_enabled.newValue;
        if (changes.gmes_zoom_click_to_call) merged.gmes_zoom_click_to_call = changes.gmes_zoom_click_to_call.newValue;
        if (changes.gmes_zoom_hide_lc) merged.gmes_zoom_hide_lc = changes.gmes_zoom_hide_lc.newValue;
        if (changes.gmes_zoom_caller_id) merged.gmes_zoom_caller_id = changes.gmes_zoom_caller_id.newValue;
        if (changes.gmes_ghl_domains) merged.gmes_ghl_domains = changes.gmes_ghl_domains.newValue;
        if (changes.gmes_zoom_prewarm) merged.gmes_zoom_prewarm = changes.gmes_zoom_prewarm.newValue;

        readSettings(merged);

        // Re-apply everything from the refreshed cache. applyAll() handles
        // toggling hide-LC, interception and caller id live.
        applyAll();
    }

    // ========================================================================
    // BOOTSTRAP
    // ========================================================================

    function init() {
        // First settings read also brings in the user's custom GHL domains,
        // which feed isGhlPage(). Detect, then bail cleanly if not GHL.
        if (!isGhlPage()) {
            // Not a GHL page: attach nothing. Release the guard so a later
            // SPA navigation onto a GHL host (rare for top-level docs) could
            // re-run if the script is re-injected, but generally a no-op.
            return;
        }

        console.debug('[GMES][GHL] enhancements active on ' + location.hostname);

        applyAll();
        startObserver();
        safeOnChanged(onStorageChanged);
    }

    // Load settings once, then run. We need the domain list before final
    // detection, so re-check isGhlPage() inside init() with settings in hand.
    safeStorageGet(SETTING_KEYS, function (raw) {
        readSettings(raw);
        init();
    });

})();
