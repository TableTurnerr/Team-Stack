// auto_scraper.js — runs inside the Google Maps results page.
//
// Two scraping strategies, chosen by cfg.turbo:
//
//   Detail mode (default, turbo=false): for every result in the feed, the
//   controller clicks into the place's detail pane (staying inside Google Maps'
//   single-page app), reads the real website, full formal address, phone and
//   category straight from the profile, then steps back to the list and moves on.
//   Complete and accurate, but a few seconds per place.
//
//   Turbo mode (turbo=true): scrapes only the feed cards as they scroll past.
//   Fast, but the cards don't carry a full address/city/phone, so those fields
//   are best-effort (street + the search city).
//
// Either way only businesses within the chosen radius of the search center are
// kept (true Haversine distance). Config arrives via window.__GMES_AUTO_CFG__
// (set by a preceding executeScript) or the gmes_auto_scrape_* storage keys.
// Discovered items are posted to the background via INJECTED_SCRAPE_ITEMS,
// reusing the existing merge/dedup path.
(function () {
  'use strict';

  if (window.__GMES_AUTO_SCRAPER__ && window.__GMES_AUTO_SCRAPER__.running) return;

  window.__GMES_AUTO_SCRAPER__ = {
    running: true,
    stop: false,
    seen: new Set(),
    totalFound: 0,
    totalSeen: 0,
    totalSkippedRadius: 0
  };

  var S = window.__GMES_AUTO_SCRAPER__;

  // ---- User filters (exclude keywords + numeric conditions) ------------------
  // Populated from the config in run(). EXCLUDE drops any business whose name or
  // category contains one of the words (e.g. "Chinese", "Desi"). CONDITIONS are
  // numeric gates on rating / review count (e.g. Rating>4.5, Reviews>200).
  // SKIP_TEMP_CLOSED drops "Temporarily closed" places (on by default).
  // Permanently closed places are always dropped, regardless of settings.
  var EXCLUDE = [];
  var CONDITIONS = [];
  var SKIP_TEMP_CLOSED = true;
  // Only keep leads that carry a phone number (a hard requirement for outreach).
  var REQUIRE_PHONE = true;
  // Card identities (cid/coords/title) of places already expanded & scraped in a
  // previous cell/run. Loaded from gmes_results at run start so we never re-open a
  // business profile we've already captured (saves clicks + avoids re-hammering
  // Google). Populated in run().
  var ALREADY_SCRAPED = new Set();

  function parseExcludeKeywords(text) {
    if (!text) return [];
    return String(text).split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  }

  function parseConditions(text) {
    if (!text) return [];
    var out = [];
    String(text).split(',').forEach(function (part) {
      var m = part.match(/^\s*(rating|reviews?|review\s*count|reviewcount)\s*(>=|<=|=>|=<|>|<|=)\s*([\d.]+)\s*$/i);
      if (!m) return;
      var field = /^rating/i.test(m[1]) ? 'rating' : 'reviews';
      var op = m[2] === '=>' ? '>=' : (m[2] === '=<' ? '<=' : m[2]);
      var value = parseFloat(m[3]);
      if (isNaN(value)) return;
      out.push({ field: field, op: op, value: value });
    });
    return out;
  }

  // Extract a plain integer from a review-count string like "(1,234)".
  function reviewCountToNumber(rc) {
    if (rc == null) return NaN;
    var digits = String(rc).replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : NaN;
  }

  function compare(a, op, b) {
    switch (op) {
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      case '=': return a === b;
    }
    return true;
  }

  // True if the item should be kept. Applies the temporarily-closed gate, the
  // exclude keywords, and every numeric condition (all must pass).
  function passesFilters(item) {
    if (!item) return false;
    if (SKIP_TEMP_CLOSED && item.closedStatus) return false;

    if (EXCLUDE.length) {
      var hay = ((item.title || '') + ' ' + (item.industry || '')).toLowerCase();
      for (var i = 0; i < EXCLUDE.length; i++) {
        if (hay.indexOf(EXCLUDE[i]) !== -1) return false;
      }
    }

    for (var j = 0; j < CONDITIONS.length; j++) {
      var c = CONDITIONS[j];
      var val = c.field === 'rating' ? parseFloat(item.rating) : reviewCountToNumber(item.reviewCount);
      if (isNaN(val)) return false;            // can't verify the metric -> exclude
      if (!compare(val, c.op, c.value)) return false;
    }
    return true;
  }

  // True if the item carries a usable phone number (item.phone or phones[0]).
  function hasPhone(item) {
    if (!item) return false;
    if (item.phone && String(item.phone).trim()) return true;
    if (Array.isArray(item.phones)) {
      for (var i = 0; i < item.phones.length; i++) {
        if (item.phones[i] && String(item.phones[i].number || '').trim()) return true;
      }
    }
    return false;
  }

  // Identity derivable from a feed card BEFORE expanding it (so we can skip places
  // already scraped). Prefers Google's stable feature id (0x..:0x.. in the href
  // data= blob), then the place's !3d/!4d coords, then the place-path slug, then
  // title. This is the phone-independent fallback chain used by placeIdentity()
  // elsewhere; the card has no phone until expanded, so we match on these instead.
  function cardIdentity(href, title) {
    href = String(href || '');
    var m = href.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
    if (m) return 'cid:' + m[1].toLowerCase();
    m = href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return 'geo:' + m[1] + ',' + m[2];
    var pathMatch = href.match(/\/maps\/place\/([^/@?]+)/);
    if (pathMatch) { try { return 'path:' + decodeURIComponent(pathMatch[1]).toLowerCase(); } catch (e) { return 'path:' + pathMatch[1].toLowerCase(); } }
    var t = (title || '').toLowerCase().trim();
    if (t) return 'title:' + t;
    return href;
  }

  // True if a feed-card link points at a place we've already expanded & scraped.
  function alreadyScraped(href, title) {
    if (!ALREADY_SCRAPED.size) return false;
    var k = cardIdentity(href, title);
    return Boolean(k) && ALREADY_SCRAPED.has(k);
  }

  // ---- DOM selectors (centralized — Google changes these periodically) -------
  var FEED_SELECTORS = ['div[role="feed"]', '.m6QErb[aria-label]', '.m6QErb-qJTHM-haAclf'];
  var END_OF_LIST_TEXT = "you've reached the end of the list";
  var PLACE_LINK_SELECTOR = 'a[href^="https://www.google.com/maps/place"]';
  var BACK_BTN_SELECTOR = 'button[jsaction*="back"], button[aria-label="Back"], button[aria-label="Back to results"]';

  // ---- Tunables --------------------------------------------------------------
  var SCROLL_PAUSE_MS = 1200;   // wait for lazy-load after each scroll
  var MAX_IDLE_ROUNDS = 5;      // consecutive zero-new-card rounds before giving up
  var MAX_SCROLLS = 140;        // hard safety cap (Google caps the feed near ~120)
  var DETAIL_TIMEOUT_MS = 5000; // max wait for a place detail pane to render
  var FEED_TIMEOUT_MS = 5000;   // max wait for the list to come back after "Back"
  var MAX_PLACES = 400;         // hard safety cap on detail-mode visits

  // Delay multiplier (set from cfg.speed in run()). >1 slows the pace between
  // clicks/scrolls/back-navigations so Google is hit less aggressively, which
  // cuts the "Server error. Please try again later." rate limiting. paced() wraps
  // every inter-action delay; the fixed *_TIMEOUT_MS caps above stay as-is.
  var SPEED = 1.5;
  function paced(ms) { return Math.max(0, Math.round((Number(ms) || 0) * SPEED)); }

  // ---- Phone helpers ---------------------------------------------------------
  function normalizePhone(raw) {
    if (!raw) return null;
    var digits = String(raw).replace(/\D/g, '');
    if (digits.length === 10) digits = '1' + digits;
    if (digits.length !== 11 || digits[0] !== '1') return null;
    return digits;
  }

  var PHONE_REGEX = /(?:\+?1[\s.\-–]?)?(?:\(\s*[2-9]\d{2}\s*\)|[2-9]\d{2})[\s.\-–]?[2-9]\d{2}[\s.\-–]?\d{4}/;
  function extractPhone(container, containerText) {
    if (!container) return '';
    try {
      var phoneBtn = container.querySelector('button[aria-label^="Phone:"], button[data-value="Phone"], a[aria-label^="Phone:"], [data-tooltip="Copy phone number"], button[data-item-id^="phone"]');
      if (phoneBtn) {
        var label = phoneBtn.getAttribute('aria-label') || phoneBtn.getAttribute('data-tooltip') || '';
        var m = label.match(/Phone:\s*(.+)/i);
        if (m && m[1]) {
          var matched = m[1].match(PHONE_REGEX);
          if (matched) return matched[0];
          return m[1].trim();
        }
        var inner = (phoneBtn.textContent || '').match(PHONE_REGEX);
        if (inner) return inner[0];
      }
    } catch (e) {}
    try {
      var labelSources = [];
      var placeLink = container.querySelector(PLACE_LINK_SELECTOR);
      if (placeLink && placeLink.getAttribute('aria-label')) labelSources.push(placeLink.getAttribute('aria-label'));
      if (container.getAttribute && container.getAttribute('aria-label')) labelSources.push(container.getAttribute('aria-label'));
      container.querySelectorAll('[aria-label]').forEach(function (el) {
        var v = el.getAttribute('aria-label');
        if (v) labelSources.push(v);
      });
      for (var i = 0; i < labelSources.length; i++) {
        var match = labelSources[i].match(PHONE_REGEX);
        if (match) return match[0];
      }
    } catch (e) {}
    try {
      var m2 = (containerText || '').match(PHONE_REGEX);
      if (m2) return m2[0];
    } catch (e) {}
    return '';
  }

  // ---- Website helper --------------------------------------------------------
  // Google labels the real website link with data-value="Website" (feed card) or
  // data-item-id="authority" (detail pane). Fall back to the first external,
  // non-Google link found in the container.
  function isGoogleHost(url) {
    try {
      if (url.indexOf('https://www.google.com/maps/') === 0) return true;
      if (url.indexOf('https://www.google.com/search') === 0) return true;
      var host = new URL(url).hostname.toLowerCase();
      return host === 'google.com' || host.endsWith('.google.com') || host.endsWith('.gstatic.com');
    } catch (e) { return true; }
  }

  function extractWebsite(container) {
    if (!container) return '';
    try {
      var direct = container.querySelector('a[data-item-id="authority"], a[data-value="Website"]');
      if (direct && direct.href && !isGoogleHost(direct.href)) return direct.href;
    } catch (e) {}
    try {
      var labelled = Array.prototype.slice.call(container.querySelectorAll('a[href]')).find(function (a) {
        var aria = (a.getAttribute('aria-label') || '').toLowerCase();
        var tip = (a.getAttribute('data-tooltip') || '').toLowerCase();
        return aria.indexOf('website') !== -1 || tip.indexOf('website') !== -1;
      });
      if (labelled && labelled.href && !isGoogleHost(labelled.href)) return labelled.href;
    } catch (e) {}
    try {
      var ext = Array.prototype.slice.call(container.querySelectorAll('a[href^="http"]')).find(function (a) {
        return a.href && !isGoogleHost(a.href);
      });
      if (ext) return ext.href;
    } catch (e) {}
    return '';
  }

  // ---- Coordinate + distance helpers -----------------------------------------
  function extractLatLngFromUrl(url) {
    if (!url) return { lat: '', lng: '' };
    var m = String(url).match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (!m) m = String(url).match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    return m ? { lat: m[1], lng: m[2] } : { lat: '', lng: '' };
  }

  function haversineMiles(la1, lo1, la2, lo2) {
    var R = 3958.8, d = Math.PI / 180;
    var dLa = (la2 - la1) * d, dLo = (lo2 - lo1) * d;
    var a = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
      Math.cos(la1 * d) * Math.cos(la2 * d) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getCityFromQuery() {
    var title = document.title || '';
    var match = title.match(/in\s(.*?)\s-\sGoogle\sMaps/);
    if (match && match.length > 1) return match[1].split(' - ')[0];
    var searchInput = document.querySelector('input[aria-label="Search Google Maps"]') ||
      document.querySelector('#searchboxinput');
    if (searchInput) {
      var query = searchInput.value || '';
      var inIndex = query.toLowerCase().indexOf(' in ');
      if (inIndex !== -1) return query.substring(inIndex + 4);
    }
    return '';
  }

  // Pull City / State / ZIP out of a full formal address such as
  // "123 Main St, Columbus, OH 43215, United States".
  function parseCityState(address) {
    var out = { city: '', state: '', zip: '' };
    if (!address) return out;
    var parts = String(address).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length && /^(United States|USA|US)$/i.test(parts[parts.length - 1])) parts.pop();
    if (!parts.length) return out;
    var last = parts[parts.length - 1];
    var m = last.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);   // "OH 43215"
    if (m) {
      out.state = m[1].toUpperCase();
      out.zip = m[2];
      if (parts.length >= 2) out.city = parts[parts.length - 2];
    } else {
      var mz = last.match(/(\d{5}(?:-\d{4})?)/);
      if (mz) out.zip = mz[1];
      var mState = last.match(/^([A-Za-z]{2})\b/);
      if (mState) out.state = mState[1].toUpperCase();
      if (parts.length >= 2 && (mz || mState)) out.city = parts[parts.length - 2];
      else out.city = parts.length >= 2 ? parts[parts.length - 2] : last;
    }
    return out;
  }

  // ---- Popdown UI ------------------------------------------------------------
  function ensurePopdown() {
    var id = 'gmes-popdown';
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
        'background:linear-gradient(135deg,#1557b0 0%,#1a73e8 100%)', 'color:#fff',
        'padding:9px 15px 9px 12px', 'border-radius:10px', 'font-size:12.5px',
        'font-weight:600', 'box-shadow:0 4px 18px rgba(26,115,232,0.35),0 2px 6px rgba(0,0,0,0.15)',
        'font-family:system-ui,-apple-system,sans-serif', 'display:flex',
        'align-items:center', 'gap:8px', 'letter-spacing:0.1px',
        'border:1px solid rgba(255,255,255,0.18)'
      ].join(';');
      var dot = document.createElement('span');
      dot.id = 'gmes-popdown-dot';
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#34ffa0;flex-shrink:0;animation:gmesGlow 1.2s ease-in-out infinite;';
      el.appendChild(dot);
      var text = document.createElement('span');
      text.id = 'gmes-popdown-text';
      text.textContent = 'Scraping — 0 found';
      el.appendChild(text);
      if (!document.getElementById('gmes-popdown-style')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'gmes-popdown-style';
        styleEl.textContent = '@keyframes gmesGlow{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.55;transform:scale(0.85)}}';
        document.head.appendChild(styleEl);
      }
      document.body.appendChild(el);
    }
    return el;
  }

  function setStatus(msg, done) {
    ensurePopdown();
    var textEl = document.getElementById('gmes-popdown-text');
    if (textEl) textEl.textContent = msg;
    if (done) {
      var dot = document.getElementById('gmes-popdown-dot');
      if (dot) dot.style.animation = 'none';
    }
  }

  function removePopdown() {
    var el = document.getElementById('gmes-popdown');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ---- Favicon animation (alternating red/blue map pins while scraping) -------
  var _faviconInterval = null;
  var _origFaviconHref = null;

  function makePinSvg(fill) {
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<path d="M16 2C10.48 2 6 6.48 6 12c0 7.5 10 18 10 18S26 19.5 26 12c0-5.52-4.48-10-10-10z" fill="' + fill + '"/>' +
      '<circle cx="16" cy="12" r="4" fill="white"/>' +
      '</svg>'
    );
  }

  function setFavicon(href) {
    // Must remove+recreate the element — Chrome ignores href changes on existing nodes.
    document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]').forEach(function(el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    var link = document.createElement('link');
    link.rel = 'shortcut icon';
    link.href = href;
    document.head.appendChild(link);
  }

  function startFaviconAnimation() {
    var existing = document.querySelector('link[rel~="icon"], link[rel="shortcut icon"]');
    _origFaviconHref = existing ? existing.href : '';
    var icons = [makePinSvg('#EA4335'), makePinSvg('#1A73E8')];
    var idx = 0;
    setFavicon(icons[0]);
    _faviconInterval = setInterval(function () {
      idx ^= 1;
      setFavicon(icons[idx]);
    }, 300);
  }

  function stopFaviconAnimation() {
    if (_faviconInterval) { clearInterval(_faviconInterval); _faviconInterval = null; }
    setFavicon(_origFaviconHref || '');
  }

  // Live progress text: "In progress…" until the first lead lands, then a count.
  // modeLabel is prepended when set (e.g. "Turbo" or "Detail").
  function setProgressStatus(found, radiusLabel, modeLabel) {
    var prefix = modeLabel ? modeLabel + ' — ' : '';
    var skipNote = S.totalSkippedRadius > 0 ? ' (' + S.totalSkippedRadius + ' outside radius)' : '';
    if (found > 0) setStatus(prefix + found + ' found' + (radiusLabel || '') + skipNote);
    else if (S.totalSkippedRadius > 0) setStatus(prefix + S.totalSkippedRadius + ' outside radius — check location');
    else setStatus(prefix + 'In progress…');
  }

  // Final state: show the total and turn the badge into a button that opens the
  // results tab. Stays on screen (no auto-dismiss) so "Click to view" is usable.
  function markDone(found) {
    var el = ensurePopdown();
    var msg;
    if (found === 0 && S.totalSkippedRadius > 0) {
      msg = S.totalSkippedRadius + ' outside radius — wrong location?';
    } else {
      msg = 'Scraped ' + found + ' — Click to view';
    }
    setStatus(msg, true);
    if (el) {
      el.style.cursor = 'pointer';
      el.title = found > 0 ? 'Open results' : 'Check your location and radius settings';
      el.onclick = function () {
        try { chrome.runtime.sendMessage({ type: 'OPEN_RESULTS' }); } catch (e) {}
      };
    }
  }

  // ---- Small async helpers ---------------------------------------------------
  function waitFor(predicate, timeoutMs, cb) {
    var start = Date.now();
    (function poll() {
      var ok = false;
      try { ok = predicate(); } catch (e) { ok = false; }
      if (ok) { cb(true); return; }
      if (Date.now() - start >= timeoutMs) { cb(false); return; }
      setTimeout(poll, 200);
    })();
  }

  function getFeed() {
    var feed = null;
    for (var i = 0; i < FEED_SELECTORS.length && !feed; i++) feed = document.querySelector(FEED_SELECTORS[i]);
    return feed;
  }

  function placeSlug(href) {
    var seg = (String(href).split('/place/')[1] || '').split('/')[0];
    return seg || '';
  }

  // Business hours/timings — from a feed card's text or the open detail pane.
  function extractTimingsFromText(text) {
    if (!text) return '';
    var t = text.replace(/[   ]/g, ' ');
    var m = t.match(/Open 24 hours/i)
      || t.match(/(?:Open|Closed|Closes soon|Opens soon)\s*[⋅·]\s*(?:Closes|Opens)?\s*\d{1,2}(?::\d{2})?\s*[AP]M(?:\s+[A-Z][a-z]{2})?/i)
      || t.match(/Temporarily closed/i);
    return m ? m[0].replace(/\s+/g, ' ').trim() : '';
  }

  function extractTimingsFromPane(panel) {
    try {
      var ohEl = (panel && panel.querySelector('.t39EBf[aria-label]')) ||
        (panel && panel.querySelector('[jsaction*="openhours"] [aria-label]'));
      if (ohEl && ohEl.getAttribute('aria-label')) {
        return ohEl.getAttribute('aria-label').replace(/\s+/g, ' ').trim();
      }
    } catch (e) {}
    return extractTimingsFromText(panel ? (panel.textContent || '') : '');
  }

  // ---- Card scraping (turbo / fallback) --------------------------------------
  function scrapeCard(link, city) {
    var container = link.closest('[jsaction*="mouseover:pane"]');
    var titleEl = container ? container.querySelector('.fontHeadlineSmall') : null;
    var titleText = titleEl ? titleEl.textContent : '';
    var containerText = container ? (container.textContent || '') : '';
    if (/permanently closed/i.test(containerText)) return null;

    var rating = '', reviewCount = '', industry = '',
      address = '', companyUrl = '', phone = '', closedStatus = '';
    if (/temporarily closed/i.test(containerText)) closedStatus = 'Temporarily Closed';
    var businessTimings = extractTimingsFromText(containerText);

    if (container) {
      var roleImgContainer = container.querySelector('[role="img"]');
      if (roleImgContainer) {
        var ariaLabel = roleImgContainer.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.includes('stars')) {
          var parts = ariaLabel.split(' ');
          rating = parts[0] || '';
          reviewCount = '(' + (parts[2] || '') + ')';
        } else { rating = '0'; reviewCount = '0'; }
      }
      // Fallback: if review count wasn't embedded in the aria-label, pull it from
      // the card text. Google sometimes moves the count to a sibling span.
      if (isNaN(reviewCountToNumber(reviewCount))) {
        var rcTextMatch = containerText.match(/\(([\d,]+)\)/);
        if (rcTextMatch) reviewCount = '(' + rcTextMatch[1] + ')';
      }

      var addressMatch = containerText.match(/\d+ [\w\s]+(?:#\s*\d+|Suite\s*\d+|Apt\s*\d+)?/);
      if (addressMatch) {
        address = addressMatch[0];
        var textBeforeAddress = containerText.substring(0, containerText.indexOf(address)).trim();
        var ratingIndex = textBeforeAddress.lastIndexOf(rating + reviewCount);
        if (ratingIndex !== -1) {
          var rawIndustryText = textBeforeAddress.substring(ratingIndex + (rating + reviewCount).length).trim().split(/\r?\n/)[0] || '';
          var cleanedRawIndustry = rawIndustryText.replace(/[·.,#!?]/g, '').trim();
          industry = cleanedRawIndustry.replace(/[^A-Za-z\s]/g, '').trim();
        }
        var filterRegex = /\b(Closed|Open 24 hours|24 hours)|Open\b/g;
        address = address.replace(filterRegex, '').trim();
        address = address.replace(/(\d+)(Open)/g, '$1').trim();
        address = address.replace(/(\w)(Open)/g, '$1').trim();
        address = address.replace(/(\w)(Closed)/g, '$1').trim();
      }

      companyUrl = extractWebsite(container);
      phone = extractPhone(container, containerText);
    }

    return finalizeItem({
      title: titleText, closedStatus: closedStatus, rating: rating, reviewCount: reviewCount,
      phone: phone, industry: industry, businessTimings: businessTimings, city: city,
      address: address, companyUrl: companyUrl, href: link.href
    });
  }

  // ---- Detail-pane scraping (default) ----------------------------------------
  // Reads the open place profile after clicking a result. In the search→place
  // view the results feed and the place panel can BOTH be in the DOM, and a bare
  // document.querySelector('[role="main"]') often returns the results container
  // (whose only h1 reads "Results"). So we anchor on the place's own h1.DUwDvf
  // and scope to the panel that actually contains it, falling back to document.
  function scrapeDetailPane(href, cityFromQuery) {
    var titleEl = document.querySelector('h1.DUwDvf') ||
      document.querySelector('[role="main"] .fontHeadlineLarge');
    var panel = (titleEl && (titleEl.closest('[role="main"]') || titleEl.parentElement)) ||
      document.querySelector('[role="main"]') || document.body;

    // Permanently closed places are dropped silently and never surfaced.
    if (/permanently closed/i.test(panel.textContent || '')) return null;

    // Query the place panel first, then fall back to the whole document — the
    // place-detail selectors below are unique to the open profile.
    function pick(selector) {
      return panel.querySelector(selector) || document.querySelector(selector);
    }

    var title = titleEl ? (titleEl.textContent || '').trim() : '';

    var rating = '0', reviewCount = '0';
    var f7 = pick('div.F7nice');
    if (f7) {
      var t = f7.textContent.trim();
      var rm = t.match(/(\d[.,]?\d?)/);
      if (rm) rating = rm[1].replace(',', '.');
      var rc = t.match(/\(([\d,]+)\)/);
      if (rc) reviewCount = '(' + rc[1] + ')';
    }
    // Fallback: F7nice class changes periodically — try a [role="img"] aria-label
    // which Google marks as "<rating> stars <count> reviews" and is more stable.
    if (rating === '0') {
      var ratingImg = pick('[role="img"][aria-label*=" stars"]') || pick('[role="img"][aria-label*="stars"]');
      if (ratingImg) {
        var al = ratingImg.getAttribute('aria-label') || '';
        var rm2 = al.match(/^([\d.,]+)\s+star/i);
        if (rm2) rating = rm2[1].replace(',', '.');
        if (reviewCount === '0') {
          var rc2 = al.match(/([\d,]+)\s+review/i);
          if (rc2) reviewCount = '(' + rc2[1].replace(/,/g, '') + ')';
        }
      }
    }
    // Last resort: pull "(N)" directly from the panel text
    if (reviewCount === '0') {
      var rcPanel = (panel.textContent || '').match(/\(([\d,]+)\)/);
      if (rcPanel) reviewCount = '(' + rcPanel[1] + ')';
    }

    var phone = '';
    var phoneBtn = pick('button[aria-label^="Phone:"]') || pick('button[data-item-id^="phone"]');
    if (phoneBtn) {
      var pl = phoneBtn.getAttribute('aria-label') || '';
      var pm = pl.match(/Phone:\s*(.+)/i);
      if (pm && pm[1]) {
        var pmm = pm[1].match(PHONE_REGEX);
        phone = pmm ? pmm[0] : pm[1].trim();
      }
    }
    if (!phone) phone = extractPhone(panel, panel.textContent || '');

    var address = '';
    var addrBtn = pick('button[data-item-id="address"]') || pick('[data-item-id="address"]');
    if (addrBtn) {
      var aria = addrBtn.getAttribute('aria-label') || '';
      var am = aria.match(/Address:\s*(.+)/i);
      if (am && am[1]) {
        address = am[1].trim();
      } else {
        var raw = addrBtn.textContent.trim();
        if (raw && raw.charCodeAt(0) > 127 && !/^\d/.test(raw)) raw = raw.substring(1).trim();
        address = raw;
      }
    }

    var companyUrl = extractWebsite(panel) || extractWebsite(document);

    var industry = '';
    var categoryBtn = pick('button.DkEaL');
    if (categoryBtn) {
      var rawCat = categoryBtn.textContent.trim();
      industry = rawCat.replace(/[^a-zA-Z\s]/g, '').trim();
    }

    var businessTimings = extractTimingsFromPane(panel);

    var loc = parseCityState(address);
    var city = loc.city || cityFromQuery || '';

    var closedStatus = '';
    var bodyText = (panel.textContent || '');
    if (/temporarily closed/i.test(bodyText)) closedStatus = 'Temporarily Closed';

    return finalizeItem({
      title: title, closedStatus: closedStatus, rating: rating, reviewCount: reviewCount,
      phone: phone, industry: industry, businessTimings: businessTimings, city: city,
      address: address, companyUrl: companyUrl, href: href,
      state: loc.state, zip: loc.zip
    });
  }

  // Shared tail: normalize phone, build the instagram search + coords, shape item.
  function finalizeItem(d) {
    var normalizedPhone = normalizePhone(d.phone);
    var phone = normalizedPhone || '';
    var phones = normalizedPhone
      ? [{ number: normalizedPhone, label: 'Main', location_name: '', location_address: '' }]
      : [];

    var instaSearch = '';
    try {
      instaSearch = 'https://www.google.com/search?q=' +
        encodeURIComponent((d.title || '') + (d.city ? ' ' + d.city : '') + ' Instagram');
    } catch (e) {}

    var coords = extractLatLngFromUrl(d.href);

    return {
      title: d.title || '',
      note: '',
      closedStatus: d.closedStatus || '',
      rating: d.rating || '',
      reviewCount: d.reviewCount || '',
      phone: phone,
      phones: phones,
      industry: d.industry || '',
      businessTimings: d.businessTimings || '',
      city: d.city || '',
      state: d.state || '',
      zip: d.zip || '',
      address: d.address || '',
      companyUrl: d.companyUrl || '',
      instaSearch: instaSearch || '',
      href: d.href,
      lat: coords.lat,
      lng: coords.lng
    };
  }

  // ---- Radius gate (shared) --------------------------------------------------
  function withinRadius(item, center, radius) {
    if (!center || !item.lat || !item.lng) return true;
    var dist = haversineMiles(center.lat, center.lng, parseFloat(item.lat), parseFloat(item.lng));
    item.distanceMiles = Math.round(dist * 100) / 100;
    if (radius && dist > radius) return false;
    return true;
  }

  function post(items) {
    if (!items || !items.length) return;
    // Only collect leads with a phone number. This is the single choke point every
    // scraped item flows through, so filtering here guarantees no phone-less lead
    // is ever stored regardless of which scrape path produced it.
    if (REQUIRE_PHONE) items = items.filter(hasPhone);
    if (!items.length) return;
    try { chrome.runtime.sendMessage({ type: 'INJECTED_SCRAPE_ITEMS', items: items, source: 'auto' }); } catch (e) {}
  }

  // Liveness signal. Written on every loop iteration so the popup/background can
  // tell the difference between "still scraping" and "the content script died"
  // (a full page reload/navigation tears down this script without ever reaching
  // finish(), which would otherwise leave the run flag — and the popup's "Stop
  // Scraping" button — stuck on). A stale heartbeat means the run is dead.
  function heartbeat() {
    try { chrome.storage.local.set({ gmes_scrape_heartbeat: Date.now() }); } catch (e) {}
  }

  // ===========================================================================
  // Turbo mode: scrape feed cards while auto-scrolling (grid: then enrich).
  // In grid mode (doEnrich=true) Phase 1 fast-scans all cards and buffers
  // qualifying items; Phase 2 visits each item's detail pane to fill in
  // phone, website, and full address that are missing from feed cards.
  // ===========================================================================
  function runTurbo(center, radius, radiusLabel) {
    var scrolls = 0, idleRounds = 0;
    var isGridMode = Boolean((window.__GMES_AUTO_CFG__ || {}).gridMode);
    var doEnrich = isGridMode;
    var enrichQueue = [];

    function finish() {
      S.running = false;
      stopFaviconAnimation();
      var cfg = window.__GMES_AUTO_CFG__ || {};
      if (cfg.gridMode && !S.stop) {
        removePopdown();
        try { chrome.runtime.sendMessage({ type: 'GRID_CELL_DONE' }); } catch (e) {}
      } else {
        if (S.stop) removePopdown(); else markDone(S.totalFound);
        try { chrome.storage.local.set({ gmes_background_scraping: false, gmes_scrape_heartbeat: 0 }); } catch (e) {}
      }
    }

    function goBackToList(cb) {
      var backBtn = document.querySelector(BACK_BTN_SELECTOR);
      try {
        if (backBtn) backBtn.click();
        else window.history.back();
      } catch (e) { try { window.history.back(); } catch (e2) {} }
      waitFor(function () {
        return getFeed() && document.querySelector(PLACE_LINK_SELECTOR);
      }, FEED_TIMEOUT_MS, function () { cb(); });
    }

    // Phase 2: open each buffered item's detail pane to capture phone/website.
    function enrich() {
      if (S.stop || enrichQueue.length === 0) { finish(); return; }
      heartbeat();

      var item = enrichQueue.shift();
      var city = item.city || getCityFromQuery();
      var slug = placeSlug(item.href);

      setProgressStatus(S.totalFound, radiusLabel, 'Enriching');

      // Locate the feed card link in the current DOM. Google Maps virtualises
      // the list, so very early results may have scrolled out of the DOM.
      // If the link is gone, post the card-level data as-is and continue.
      var feedLink = null;
      try {
        var allLinks = Array.from(document.querySelectorAll(PLACE_LINK_SELECTOR));
        for (var fi = 0; fi < allLinks.length; fi++) {
          if (allLinks[fi].href === item.href) { feedLink = allLinks[fi]; break; }
        }
      } catch (e) {}

      if (!feedLink) {
        S.totalFound++;
        post([item]);
        setProgressStatus(S.totalFound, radiusLabel, 'Enriching');
        setTimeout(enrich, paced(60));
        return;
      }

      try { feedLink.scrollIntoView({ block: 'center' }); } catch (e) {}
      try { feedLink.click(); } catch (e) {
        S.totalFound++;
        post([item]);
        setProgressStatus(S.totalFound, radiusLabel, 'Enriching');
        setTimeout(enrich, paced(200));
        return;
      }

      waitFor(function () {
        var onPlace = location.href.indexOf('/place/') !== -1 &&
          (!slug || location.href.indexOf('/place/' + slug) !== -1);
        var h1 = document.querySelector('h1.DUwDvf');
        var hasTitle = h1 && h1.textContent.trim();
        var hasData = document.querySelector('[data-item-id="address"], a[data-item-id="authority"], button[aria-label^="Phone:"], div.F7nice');
        return onPlace && hasTitle && hasData;
      }, DETAIL_TIMEOUT_MS, function () {
        heartbeat();
        try {
          var enriched = scrapeDetailPane(item.href, city);
          if (enriched && enriched.title) {
            if (enriched.phone) item.phone = enriched.phone;
            if (enriched.phones && enriched.phones.length) item.phones = enriched.phones;
            if (enriched.companyUrl) item.companyUrl = enriched.companyUrl;
            if (enriched.address) item.address = enriched.address;
            if (enriched.city) item.city = enriched.city;
            if (enriched.state) item.state = enriched.state;
            if (enriched.zip) item.zip = enriched.zip;
            if (enriched.industry) item.industry = enriched.industry;
            if (enriched.businessTimings) item.businessTimings = enriched.businessTimings;
          }
        } catch (e) {}

        S.totalFound++;
        post([item]);
        setProgressStatus(S.totalFound, radiusLabel, 'Enriching');

        goBackToList(function () { setTimeout(enrich, paced(350)); });
      });
    }

    function tick() {
      if (S.stop) { finish(); return; }
      heartbeat();

      var city = getCityFromQuery();
      var links = Array.from(document.querySelectorAll(PLACE_LINK_SELECTOR));
      var prevSeen = S.totalSeen;
      var newItems = [];

      links.forEach(function (link) {
        try {
          var key = link.href;
          if (!key || S.seen.has(key)) return;
          S.seen.add(key);
          S.totalSeen++;
          // Already expanded & scraped in an earlier cell/run — don't enqueue it
          // again (avoids re-opening the same profile in the enrich pass).
          if (alreadyScraped(key)) return;
          var item = scrapeCard(link, city);
          if (!item) return;
          if (!withinRadius(item, center, radius)) return;
          if (!passesFilters(item)) return;
          newItems.push(item);
        } catch (e) {}
      });

      if (doEnrich) {
        newItems.forEach(function (i) { enrichQueue.push(i); });
        if (S.totalSeen > prevSeen) idleRounds = 0; else idleRounds++;
        setProgressStatus(enrichQueue.length, radiusLabel, 'Scanning');
      } else {
        if (newItems.length > 0) { S.totalFound += newItems.length; idleRounds = 0; post(newItems); }
        else idleRounds++;
        setProgressStatus(S.totalFound, radiusLabel, 'Turbo');
      }

      var bodyText = (document.body.innerText || '').toLowerCase();
      var atEnd = bodyText.indexOf(END_OF_LIST_TEXT) !== -1;
      if (atEnd || idleRounds >= MAX_IDLE_ROUNDS || scrolls >= MAX_SCROLLS) {
        if (doEnrich && enrichQueue.length > 0) enrich();
        else finish();
        return;
      }

      try {
        var feedEl = getFeed();
        if (feedEl) { feedEl.scrollTop = feedEl.scrollHeight; }
        else {
          var last = links[links.length - 1];
          if (last) last.scrollIntoView({ block: 'end' });
          window.scrollTo(0, document.body.scrollHeight);
        }
      } catch (e) {}
      scrolls++;
      setTimeout(tick, paced(SCROLL_PAUSE_MS));
    }

    ensurePopdown();
    setProgressStatus(0, radiusLabel, doEnrich ? 'Scanning' : 'Turbo');
    setTimeout(tick, paced(600));
  }

  // ===========================================================================
  // Detail mode: visit each place profile in turn for complete data.
  // ===========================================================================
  function runDetail(center, radius, radiusLabel) {
    var visited = 0;
    var idleScrolls = 0;

    function finish() {
      S.running = false;
      stopFaviconAnimation();
      var cfg = window.__GMES_AUTO_CFG__ || {};
      if (cfg.gridMode && !S.stop) {
        removePopdown();
        try { chrome.runtime.sendMessage({ type: 'GRID_CELL_DONE' }); } catch (e) {}
      } else {
        if (S.stop) removePopdown(); else markDone(S.totalFound);
        try { chrome.storage.local.set({ gmes_background_scraping: false, gmes_scrape_heartbeat: 0 }); } catch (e) {}
      }
    }

    // First feed card whose place hasn't been processed yet.
    function nextLink() {
      var links = Array.from(document.querySelectorAll(PLACE_LINK_SELECTOR));
      for (var i = 0; i < links.length; i++) {
        if (!S.seen.has(links[i].href)) return links[i];
      }
      return null;
    }

    function atEndOfList() {
      return (document.body.innerText || '').toLowerCase().indexOf(END_OF_LIST_TEXT) !== -1;
    }

    function goBackToList(cb) {
      var backBtn = document.querySelector(BACK_BTN_SELECTOR);
      try {
        if (backBtn) backBtn.click();
        else window.history.back();
      } catch (e) { try { window.history.back(); } catch (e2) {} }
      waitFor(function () {
        return getFeed() && document.querySelector(PLACE_LINK_SELECTOR);
      }, FEED_TIMEOUT_MS, function () { cb(); });
    }

    function loop() {
      if (S.stop) { finish(); return; }
      if (visited >= MAX_PLACES) { finish(); return; }
      heartbeat();

      var link = nextLink();

      if (!link) {
        // Nothing new visible — scroll to load more, unless we're at the end.
        if (atEndOfList() || idleScrolls >= MAX_IDLE_ROUNDS) { finish(); return; }
        var feed = getFeed();
        try {
          if (feed) feed.scrollTop = feed.scrollHeight;
          else window.scrollTo(0, document.body.scrollHeight);
        } catch (e) {}
        idleScrolls++;
        setTimeout(loop, paced(SCROLL_PAUSE_MS));
        return;
      }

      var href = link.href;
      S.seen.add(href);
      S.totalSeen++;

      // Skip places already expanded & scraped in an earlier cell/run — don't open
      // the profile again. idleScrolls is intentionally left untouched (same as the
      // radius pre-filter) so a viewport full of already-seen places still advances
      // toward the end-of-list cutoff instead of looping forever.
      if (alreadyScraped(href)) {
        setProgressStatus(S.totalFound, radiusLabel, 'Detail');
        setTimeout(loop, paced(60));
        return;
      }

      // Quick radius pre-filter from the card URL coordinates (saves a click).
      // Do NOT reset idleScrolls here — only reset it once a link actually passes
      // the radius check. If every visible link is outside the radius, idleScrolls
      // keeps accumulating and the run terminates after MAX_IDLE_ROUNDS scrolls
      // instead of grinding through every result endlessly.
      var coords = extractLatLngFromUrl(href);
      if (center && coords.lat && coords.lng && radius) {
        var dist = haversineMiles(center.lat, center.lng, parseFloat(coords.lat), parseFloat(coords.lng));
        if (dist > radius) {
          S.totalSkippedRadius++;
          setProgressStatus(S.totalFound, radiusLabel, 'Detail');
          setTimeout(loop, paced(60));
          return;
        }
      }
      idleScrolls = 0;

      var city = getCityFromQuery();
      var slug = placeSlug(href);

      // Card-level conditions pre-filter: check rating/reviews from the feed
      // card BEFORE opening the detail pane. Only skip when the value is
      // definitively known to fail (NaN = unknown -> give benefit of doubt).
      if (CONDITIONS.length > 0) {
        try {
          var preCard = scrapeCard(link, city);
          if (preCard) {
            var cardFails = CONDITIONS.some(function(c) {
              var val = c.field === 'rating'
                ? parseFloat(preCard.rating)
                : reviewCountToNumber(preCard.reviewCount);
              return !isNaN(val) && !compare(val, c.op, c.value);
            });
            if (cardFails) {
              setProgressStatus(S.totalFound, radiusLabel, 'Detail');
              setTimeout(loop, paced(60));
              return;
            }
          }
        } catch (e) {}
      }

      setProgressStatus(S.totalFound, radiusLabel, 'Detail');

      try { link.scrollIntoView({ block: 'center' }); } catch (e) {}
      try { link.click(); } catch (e) { setTimeout(loop, paced(200)); return; }

      // Wait for the detail pane to belong to this place and carry its data.
      waitFor(function () {
        var onPlace = location.href.indexOf('/place/') !== -1 &&
          (!slug || location.href.indexOf('/place/' + slug) !== -1);
        var h1 = document.querySelector('h1.DUwDvf');
        var hasTitle = h1 && h1.textContent.trim();
        var hasData = document.querySelector('[data-item-id="address"], a[data-item-id="authority"], button[aria-label^="Phone:"], div.F7nice');
        return onPlace && hasTitle && hasData;
      }, DETAIL_TIMEOUT_MS, function () {
        visited++;
        var item = null;
        try { item = scrapeDetailPane(href, city); } catch (e) {}

        if (item && item.title && withinRadius(item, center, radius) && passesFilters(item)) {
          S.totalFound++;
          post([item]);
          setProgressStatus(S.totalFound, radiusLabel, 'Detail');
        }

        goBackToList(function () { setTimeout(loop, paced(350)); });
      });
    }

    ensurePopdown();
    setProgressStatus(0, radiusLabel, 'Detail');
    setTimeout(loop, paced(800));
  }

  // ---- Entry point -----------------------------------------------------------
  function run(cfg) {
    var center = (cfg.centerLat !== '' && cfg.centerLng !== '' && cfg.centerLat != null && cfg.centerLng != null)
      ? { lat: parseFloat(cfg.centerLat), lng: parseFloat(cfg.centerLng) } : null;
    var radius = parseFloat(cfg.radiusMiles);
    if (!radius || isNaN(radius) || radius <= 0) radius = 0;  // 0 = no distance filter
    var radiusLabel = radius ? (' (within ' + radius + ' mi)') : '';

    EXCLUDE = parseExcludeKeywords(cfg.excludeText);
    CONDITIONS = parseConditions(cfg.conditionsText);
    SKIP_TEMP_CLOSED = cfg.skipTempClosed !== false;  // default on
    var sp = Number(cfg.speed);
    SPEED = (sp && !isNaN(sp) && sp > 0) ? Math.max(0.5, Math.min(5, sp)) : 1.5;

    // Honor the user's Turbo toggle in every mode, including grid scans.
    //   Turbo on  -> runTurbo: fast feed-card scan (grid adds a best-effort
    //                enrich pass), but phone/website/full address can be missing.
    //   Turbo off -> runDetail: open every business profile for complete data
    //                (phone, website, formal address, category). Slower, but the
    //                user explicitly asked for the full profile, so respect it
    //                even across a multi-cell grid. runDetail already reports
    //                GRID_CELL_DONE so the grid advances between cells.
    function begin() {
      if (cfg.turbo) runTurbo(center, radius, radiusLabel);
      else runDetail(center, radius, radiusLabel);
    }

    // Seed the already-scraped set from the stored leads (this run's earlier cells
    // plus any prior session) so we never re-expand a business we already have.
    try {
      chrome.storage.local.get(['gmes_results'], function (d) {
        try {
          ALREADY_SCRAPED = new Set();
          var list = Array.isArray(d.gmes_results) ? d.gmes_results : [];
          for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (!it) continue;
            var k = cardIdentity(it.href, it.title);
            if (k) ALREADY_SCRAPED.add(k);
          }
        } catch (e) {}
        begin();
      });
    } catch (e) {
      begin();
    }
  }

  function start(cfg) {
    cfg = cfg || {};
    // Always keep __GMES_AUTO_CFG__ in sync so finish() can read gridMode
    // even when this is the storage-fallback path (page reloaded between
    // the two executeScript calls in injectAutoScraper).
    window.__GMES_AUTO_CFG__ = cfg;
    startFaviconAnimation();
    run({
      centerLat: cfg.centerLat != null ? cfg.centerLat : '',
      centerLng: cfg.centerLng != null ? cfg.centerLng : '',
      radiusMiles: cfg.radiusMiles != null ? cfg.radiusMiles : 0,
      turbo: Boolean(cfg.turbo),
      speed: cfg.speed != null ? cfg.speed : 1.5,
      excludeText: cfg.excludeText != null ? cfg.excludeText : '',
      conditionsText: cfg.conditionsText != null ? cfg.conditionsText : '',
      skipTempClosed: cfg.skipTempClosed !== false
    });
  }

  if (window.__GMES_AUTO_CFG__) {
    start(window.__GMES_AUTO_CFG__);
  } else {
    try {
      chrome.storage.local.get(['gmes_auto_scrape_center', 'gmes_auto_scrape_radius', 'gmes_auto_scrape_turbo', 'gmes_auto_scrape_exclude', 'gmes_auto_scrape_conditions', 'gmes_auto_scrape_skipclosed', 'gmes_auto_scrape_speed', 'gmes_auto_scrape_gridmode'], function (d) {
        var c = d.gmes_auto_scrape_center || {};
        start({ centerLat: c.lat, centerLng: c.lng, radiusMiles: d.gmes_auto_scrape_radius, turbo: d.gmes_auto_scrape_turbo, excludeText: d.gmes_auto_scrape_exclude, conditionsText: d.gmes_auto_scrape_conditions, skipTempClosed: d.gmes_auto_scrape_skipclosed, speed: d.gmes_auto_scrape_speed, gridMode: Boolean(d.gmes_auto_scrape_gridmode) });
      });
    } catch (e) {
      start({});
    }
  }
})();
