// zoom_call_detect.js
//
// Isolated-world content script for Zoom web-phone call detection (Workstream E).
//
// Runs on https://*.zoom.us/* (all_frames, document_start). It decides WHEN a
// web-phone call starts and ends, then tells the service worker:
//   start: chrome.runtime.sendMessage({type:'ZOOM_CALL_STARTED', phoneE164, counterpartyName, connectTsMs})
//   end:   chrome.runtime.sendMessage({type:'ZOOM_CALL_ENDED', endTsMs})
// The service worker (background.js) bridges these to the local CRM Agent over
// Chrome Native Messaging (Workstream F).
//
// HYBRID DETECTION (Zoom Smart Embed is NOT allowed, per plan §9 D2):
//   1. MAIN-world WebSocket patch (zoom_call_detect_main.js) → postMessage here
//      with open/close/activity timing of the call signaling socket.
//   2. MutationObserver fallback watching for (a) an updating mm:ss in-call timer
//      and (b) an ARIA-labeled End call / Hang up / Mute control appearing or
//      disappearing. Recurses into open shadow roots.
// Either signal can start/stop a call. We require a short confirmation window and
// a state machine so a single transient blip doesn't fire spurious start/stop.
//
// NUMBER SOURCE:
//   PRIMARY  = the click-to-call flow in ghl_enhancements.js stashes the dialed
//              number (normalized) + ts into chrome.storage.session under
//              gmes_zoom_last_dialed. We read it and attach when it's recent.
//   SECONDARY = scrape the dial-pad / call-header text on the Zoom page.
//   May be null — the worker treats a null number as a manual-review upload.

(function () {
    'use strict';

    if (window.__GMES_ZOOM_DETECT__) return;
    window.__GMES_ZOOM_DETECT__ = true;

    // ========================================================================
    // Settings gate — feature toggle (default ON), read live.
    // ========================================================================

    var RECORD_KEY = 'gmes_zoom_record_calls';
    var recordEnabled = true; // default ON until storage says otherwise

    function safeStorageGet(area, keys, cb) {
        try {
            if (!chrome || !chrome.storage || !chrome.storage[area]) { cb({}); return; }
            chrome.storage[area].get(keys, function (res) {
                if (chrome.runtime && chrome.runtime.lastError) { cb({}); return; }
                cb(res || {});
            });
        } catch (e) { cb({}); }
    }

    // ========================================================================
    // Phone normalization — identical contract to ghl_enhancements.js /
    // normalizePhone(): returns '1XXXXXXXXXX' or null. We emit E.164 ('+1...').
    // ========================================================================

    function normalizePhone(raw) {
        if (!raw) return null;
        var digits = String(raw).replace(/\D/g, '');
        if (digits.length === 10) digits = '1' + digits;
        if (digits.length !== 11 || digits[0] !== '1') return null;
        return digits;
    }

    function toE164(raw) {
        var n = normalizePhone(raw);
        if (n) return '+' + n;
        // International / extension fallback: keep raw digits if plausible.
        var d = String(raw || '').replace(/\D/g, '');
        if (d.length >= 7 && d.length <= 15) return '+' + d;
        return null;
    }

    // ========================================================================
    // Number capture
    // ========================================================================

    // PRIMARY: the click-to-call handler stashed the dialed number in
    // chrome.storage.session. Treat it as the call's number when it's recent
    // (a call usually connects within ~60s of the click).
    var DIALED_FRESH_MS = 90 * 1000;
    function getDialedNumber(cb) {
        safeStorageGet('session', ['gmes_zoom_last_dialed'], function (res) {
            var d = res && res.gmes_zoom_last_dialed;
            if (d && d.e164 && d.ts && (Date.now() - d.ts) < DIALED_FRESH_MS) {
                cb({ phoneE164: d.e164, counterpartyName: d.name || '' });
            } else {
                cb(null);
            }
        });
    }

    // SECONDARY: scrape the dial-pad / call-header for a visible number. Zoom's
    // DOM is obfuscated, so we read broadly: any element that looks like it holds
    // the active call's number/name. Recurses shadow roots.
    // ---- TUNE against a live Zoom web phone ----
    var NUMBER_HINT_SELECTORS = [
        '[aria-label*="phone number" i]',
        '[class*="call-info" i]',
        '[class*="callee" i]',
        '[class*="caller" i]',
        '[class*="dialing" i]',
        '[class*="number" i]',
        '[data-testid*="number" i]'
    ];
    // ---- end tuning block ----

    function scrapePageNumber() {
        try {
            var nodes = queryAllDeep(NUMBER_HINT_SELECTORS.join(','));
            for (var i = 0; i < nodes.length; i++) {
                var txt = (nodes[i].textContent || nodes[i].getAttribute('aria-label') || '').trim();
                if (!txt || txt.length > 40) continue;
                var e164 = toE164(txt);
                if (e164) return e164;
            }
        } catch (e) {}
        return null;
    }

    // ========================================================================
    // Shadow-DOM-aware querying
    // ========================================================================

    // Collects matches for `selector` across the document AND every open shadow
    // root, depth-first. Bounded so a pathological tree can't hang the page.
    function queryAllDeep(selector, root, out, budget) {
        out = out || [];
        budget = budget || { n: 0 };
        root = root || document;
        if (budget.n > 20000) return out;
        try {
            root.querySelectorAll(selector).forEach(function (el) { out.push(el); });
        } catch (e) {}
        try {
            var all = root.querySelectorAll('*');
            for (var i = 0; i < all.length; i++) {
                budget.n++;
                if (budget.n > 20000) break;
                var sr = all[i].shadowRoot;
                if (sr) queryAllDeep(selector, sr, out, budget);
            }
        } catch (e) {}
        return out;
    }

    // ========================================================================
    // DOM signal: in-call timer + End/Hang up control
    // ========================================================================

    // mm:ss or h:mm:ss running timer text.
    var TIMER_RE = /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s*$/;

    // ARIA labels for in-call controls. Presence => a call is up.
    // ---- TUNE against a live Zoom web phone ----
    var INCALL_CONTROL_SELECTORS = [
        '[aria-label*="end call" i]',
        '[aria-label*="hang up" i]',
        '[aria-label*="hangup" i]',
        '[aria-label*="end the call" i]',
        '[title*="end call" i]',
        '[title*="hang up" i]',
        'button[aria-label*="mute" i]',
        '[aria-label*="unmute" i]',
        '[class*="hangup" i]',
        '[class*="end-call" i]',
        '[class*="endcall" i]'
    ];
    // ---- end tuning block ----

    // Returns true if the page currently shows in-call UI (a hangup/mute control
    // OR a running mm:ss timer). Best-effort; either sub-signal is enough.
    function domSaysInCall() {
        try {
            var ctrls = queryAllDeep(INCALL_CONTROL_SELECTORS.join(','));
            for (var i = 0; i < ctrls.length; i++) {
                if (isVisible(ctrls[i])) return true;
            }
        } catch (e) {}
        // Timer scan: look for a small text node that matches mm:ss and is ticking.
        try {
            if (hasRunningTimer()) return true;
        } catch (e) {}
        return false;
    }

    function isVisible(el) {
        try {
            if (!el) return false;
            if (el.offsetParent === null && el.getClientRects().length === 0) return false;
            var st = (el.ownerDocument.defaultView || window).getComputedStyle(el);
            if (!st) return true;
            return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
        } catch (e) { return true; }
    }

    // Track a candidate timer element's last value to confirm it's actually
    // ticking (a static "0:00" placeholder shouldn't count as a live call).
    var lastTimerText = null;
    var lastTimerChangeTs = 0;
    function hasRunningTimer() {
        var candidates = [];
        // Cheap: scan small leaf-ish elements via a TreeWalker on text.
        try {
            var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, null);
            var node, scanned = 0;
            while ((node = walker.nextNode()) && scanned < 4000) {
                scanned++;
                var t = (node.nodeValue || '').trim();
                if (t && TIMER_RE.test(t)) { candidates.push(t); }
            }
        } catch (e) {}
        if (!candidates.length) return false;
        var current = candidates[0];
        var now = Date.now();
        if (current !== lastTimerText) { lastTimerText = current; lastTimerChangeTs = now; }
        // A timer that changed within the last 4s is a live, ticking call timer.
        return (now - lastTimerChangeTs) < 4000 && current !== '0:00' && current !== '00:00';
    }

    // ========================================================================
    // Call state machine
    // ----------------------------------------------------------------------
    // Two independent detectors feed `evidenceInCall`. We debounce: a call is
    // STARTED after evidence persists past START_CONFIRM_MS, and ENDED after the
    // evidence is gone for END_CONFIRM_MS (Zoom briefly tears down UI between
    // states; the grace window prevents a flapping start/stop pair).
    // ========================================================================

    var START_CONFIRM_MS = 1200;
    var END_CONFIRM_MS = 4000;

    var callActive = false;       // have we emitted STARTED and not yet ENDED?
    var connectTsMs = 0;          // when we believe the call connected

    // Latest evidence from each source, with timestamps.
    var wsOpen = false;           // MAIN-world WS reports a call socket open
    var wsLastActivity = 0;
    var startTimer = null;
    var endTimer = null;

    function anyEvidenceInCall() {
        if (wsOpen) return true;
        // WS recently active even if 'open' bookkeeping drifted.
        if (wsLastActivity && (Date.now() - wsLastActivity) < 8000) return true;
        if (domSaysInCall()) return true;
        return false;
    }

    function emitStart() {
        if (callActive) return;
        callActive = true;
        connectTsMs = Date.now();
        getDialedNumber(function (dialed) {
            var phoneE164 = (dialed && dialed.phoneE164) || scrapePageNumber() || null;
            var counterpartyName = (dialed && dialed.counterpartyName) || '';
            sendMsg({
                type: 'ZOOM_CALL_STARTED',
                phoneE164: phoneE164,
                counterpartyName: counterpartyName || undefined,
                connectTsMs: connectTsMs
            });
        });
    }

    function emitEnd() {
        if (!callActive) return;
        callActive = false;
        sendMsg({ type: 'ZOOM_CALL_ENDED', endTsMs: Date.now() });
        // Reset per-call WS bookkeeping so the next call starts clean.
        wsOpen = false;
        wsLastActivity = 0;
    }

    function sendMsg(msg) {
        try {
            if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return;
            chrome.runtime.sendMessage(msg, function () {
                // Touch lastError so Chrome doesn't log "unchecked" warnings.
                void (chrome.runtime && chrome.runtime.lastError);
            });
        } catch (e) { /* extension context torn down — ignore */ }
    }

    // Re-evaluate the state machine whenever evidence might have changed.
    function evaluate() {
        if (!recordEnabled) {
            // Feature off: if a call was somehow active, close it out cleanly.
            if (callActive) { clearTimers(); emitEnd(); }
            return;
        }
        var inCall = false;
        try { inCall = anyEvidenceInCall(); } catch (e) { inCall = false; }

        if (inCall) {
            if (endTimer) { clearTimeout(endTimer); endTimer = null; }
            if (!callActive && !startTimer) {
                startTimer = setTimeout(function () {
                    startTimer = null;
                    if (anyEvidenceInCall()) emitStart();
                }, START_CONFIRM_MS);
            }
        } else {
            if (startTimer) { clearTimeout(startTimer); startTimer = null; }
            if (callActive && !endTimer) {
                endTimer = setTimeout(function () {
                    endTimer = null;
                    if (!anyEvidenceInCall()) emitEnd();
                }, END_CONFIRM_MS);
            }
        }
    }

    function clearTimers() {
        if (startTimer) { clearTimeout(startTimer); startTimer = null; }
        if (endTimer) { clearTimeout(endTimer); endTimer = null; }
    }

    // ========================================================================
    // MAIN-world WebSocket signal intake
    // ========================================================================

    window.addEventListener('message', function (ev) {
        // Only trust messages from this window (the MAIN-world script posts with
        // '*' target but same window/source).
        if (ev.source !== window) return;
        var d = ev.data;
        if (!d || d.__gmesZoom !== '__GMES_ZOOM__' || d.source !== 'ws') return;
        try {
            if (d.kind === 'open') { wsOpen = true; wsLastActivity = Date.now(); evaluate(); }
            else if (d.kind === 'close') { wsOpen = false; evaluate(); }
            else if (d.kind === 'activity') { wsLastActivity = Date.now(); if (!callActive) evaluate(); }
        } catch (e) {}
    }, false);

    // ========================================================================
    // DOM observer (fallback signal)
    // ========================================================================

    var observer = null;
    var debounce = null;
    function onMutations() {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(evaluate, 300);
    }

    function startObserver() {
        if (observer) return;
        try {
            observer = new MutationObserver(onMutations);
            observer.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) {}
    }

    // The timer "is it ticking" check needs periodic sampling that mutations alone
    // won't always trigger (text node value changes inside the same element may
    // not fire childList). A light poll covers it while a call could be up.
    var pollTimer = setInterval(function () {
        if (!recordEnabled) return;
        // Only poll the (relatively expensive) DOM scan when WS isn't already
        // telling us we're in a call, or when we need to confirm an end.
        if (!wsOpen || callActive) evaluate();
    }, 1500);

    // ========================================================================
    // Lifecycle / cleanup
    // ========================================================================

    // If the Zoom tab/frame unloads while a call is active, treat it as an end so
    // the agent doesn't record forever. (background.js also guards via the port.)
    window.addEventListener('pagehide', function () {
        try { if (callActive) emitEnd(); } catch (e) {}
    });
    window.addEventListener('beforeunload', function () {
        try { if (callActive) emitEnd(); } catch (e) {}
    });

    // ========================================================================
    // Bootstrap
    // ========================================================================

    function init() {
        safeStorageGet('local', [RECORD_KEY], function (res) {
            recordEnabled = res[RECORD_KEY] !== false; // default ON
            try {
                if (chrome && chrome.storage && chrome.storage.onChanged) {
                    chrome.storage.onChanged.addListener(function (changes, area) {
                        if (area === 'local' && changes[RECORD_KEY]) {
                            recordEnabled = changes[RECORD_KEY].newValue !== false;
                            evaluate();
                        }
                    });
                }
            } catch (e) {}
            startObserver();
            evaluate();
        });
    }

    // document_start: body may not exist yet. Start observing the documentElement
    // immediately (it always exists) and run the first evaluate once the DOM is
    // interactive so TreeWalker has a body.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
        // Still attach the WS listener + observer on documentElement right away.
        startObserver();
    } else {
        init();
    }

    void pollTimer; // keep reference; cleared implicitly on page unload
})();
