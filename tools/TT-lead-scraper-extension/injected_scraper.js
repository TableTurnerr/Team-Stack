// Injected scraper: runs inside the Google Maps page context.
(function() {
  if (window.__GMES_SCRAPER__ && window.__GMES_SCRAPER__.running) return;

  window.__GMES_SCRAPER__ = {
    running: true,
    seen: new Set(),
    totalExtracted: 0,
    intervalId: null
  };

  // Strips non-digits, prepends 1 for 10-digit US numbers.
  // Returns '1XXXXXXXXXX' or null if not a valid US number.
  function normalizePhone(raw) {
    if (!raw) return null;
    var digits = String(raw).replace(/\D/g, '');
    if (digits.length === 10) digits = '1' + digits;
    if (digits.length !== 11 || digits[0] !== '1') return null;
    return digits;
  }

  // Phone is no longer reliably rendered as visible text in feed cards — Google
  // Maps now puts it on aria-labels of "Call" buttons or packs the full place
  // summary (including phone) into the aria-label of the place link. Try each
  // source in order of reliability before falling back to text regex.
  var PHONE_REGEX = /(?:\+?1[\s.\-–]?)?(?:\(\s*[2-9]\d{2}\s*\)|[2-9]\d{2})[\s.\-–]?[2-9]\d{2}[\s.\-–]?\d{4}/;
  function extractPhone(container, containerText) {
    if (!container) return '';
    try {
      var phoneBtn = container.querySelector('button[aria-label^="Phone:"], button[data-value="Phone"], a[aria-label^="Phone:"], [data-tooltip="Copy phone number"]');
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
      var placeLink = container.querySelector('a[href^="https://www.google.com/maps/place"]');
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

  // create popdown UI
  function ensurePopdown() {
    var id = 'gmes-popdown';
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = [
        'position:fixed',
        'right:16px',
        'bottom:16px',
        'z-index:2147483647',
        'background:linear-gradient(135deg,#1557b0 0%,#1a73e8 100%)',
        'color:#fff',
        'padding:9px 15px 9px 12px',
        'border-radius:10px',
        'font-size:12.5px',
        'font-weight:600',
        'box-shadow:0 4px 18px rgba(26,115,232,0.35),0 2px 6px rgba(0,0,0,0.15)',
        'font-family:system-ui,-apple-system,sans-serif',
        'display:flex',
        'align-items:center',
        'gap:8px',
        'letter-spacing:0.1px',
        'border:1px solid rgba(255,255,255,0.18)'
      ].join(';');

      // Animated dot
      var dot = document.createElement('span');
      dot.id = 'gmes-popdown-dot';
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#34ffa0;flex-shrink:0;animation:gmesGlow 1.2s ease-in-out infinite;';
      el.appendChild(dot);

      var text = document.createElement('span');
      text.id = 'gmes-popdown-text';
      text.textContent = 'Scraping \u2014 0 found';
      el.appendChild(text);

      // Inject keyframe animation
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

  function removePopdown() {
    var el = document.getElementById('gmes-popdown');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function getCityFromQuery() {
    var title = document.title || '';
    var match = title.match(/in\s(.*?)\s-\sGoogle\sMaps/);
    if (match && match.length > 1) {
      // To handle cases like "Restaurant in columbus ohio"
      var city = match[1];
      // The regex might capture things after the city if the title is unusual.
      // Let's refine it to be more robust.
      var potentialCity = city.split(' - ')[0];
      return potentialCity;
    }
    
    // Fallback for "Restaurants in city"
    var searchInput = document.querySelector('input[aria-label="Search Google Maps"]');
    if (searchInput) {
      var query = searchInput.value;
      var inIndex = query.toLowerCase().indexOf(' in ');
      if (inIndex !== -1) {
        return query.substring(inIndex + 4);
      }
    }
    
    return '';
  }

  function cleanExpensiveness(raw) {
    if (!raw) return '';
    try { return String(raw).replace(/[^0-9$\-\u2013+]/g, '').trim(); } catch (e) { return ''; }
  }

  function scrapeOnce() {
    try {
      var city = getCityFromQuery();
      var links = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place"]'));
      var newItems = [];
      links.forEach(function(link) {
        try {
          var container = link.closest('[jsaction*="mouseover:pane"]');
          var titleEl = container ? container.querySelector('.fontHeadlineSmall') : null;
          var titleText = titleEl ? titleEl.textContent : '';
          var containerText = container ? (container.textContent || '') : '';
          if (/permanently closed/i.test(containerText)) return;

          var rating = '';
          var reviewCount = '';
          var industry = '';
          var expensiveness = ''; // Declare at proper scope
          var address = '';
          var companyUrl = '';
          var phone = '';
          var closedStatus = '';

          if (/temporarily closed/i.test(containerText)) {
            closedStatus = 'Temporarily Closed';
          }

          if (container) {
            var roleImgContainer = container.querySelector('[role="img"]');
            if (roleImgContainer) {
              var ariaLabel = roleImgContainer.getAttribute('aria-label');
              if (ariaLabel && ariaLabel.includes('stars')) {
                try {
                  var parts = ariaLabel.split(' ');
                  rating = parts[0] || '';
                  reviewCount = '(' + (parts[2] || '') + ')';
                } catch (e) {}
              } else { rating = '0'; reviewCount = '0'; }
            }

            var addressRegex = /\d+ [\w\s]+(?:#\s*\d+|Suite\s*\d+|Apt\s*\d+)?/;
            var addressMatch = containerText.match(addressRegex);
            if (addressMatch) {
              address = addressMatch[0];
              var textBeforeAddress = containerText.substring(0, containerText.indexOf(address)).trim();
              var ratingIndex = textBeforeAddress.lastIndexOf(rating + reviewCount);
              if (ratingIndex !== -1) {
                var rawIndustryText = textBeforeAddress.substring(ratingIndex + (rating + reviewCount).length).trim().split(/\r?\n/)[0] || '';
                var cleanedRawIndustry = rawIndustryText.replace(/[·.,#!?]/g, '').trim();
                industry = cleanedRawIndustry.replace(/[^A-Za-z\s]/g, '').trim();
                expensiveness = cleanedRawIndustry.replace(/[^0-9$\-\u2013+]/g, '').trim();
              }
              // Clean address
              var filterRegex = /\b(Closed|Open 24 hours|24 hours)|Open\b/g;
              address = address.replace(filterRegex, '').trim();
              address = address.replace(/(\d+)(Open)/g, '$1').trim();
              address = address.replace(/(\w)(Open)/g, '$1').trim();
              address = address.replace(/(\w)(Closed)/g, '$1').trim();
            }

            var allLinks = Array.from(container.querySelectorAll('a[href]'));
            var filteredLinks = allLinks.filter(function (a) {
              if (!a.href) return false;
              if (a.href.startsWith('https://www.google.com/maps/')) return false;
              if (a.href.startsWith('https://www.google.com/search')) return false;
              try {
                var host = new URL(a.href).hostname.toLowerCase();
                if (host === 'google.com' || host.endsWith('.google.com')) return false;
              } catch (e) { return false; }
              return true;
            });
            if (filteredLinks.length > 0) companyUrl = filteredLinks[0].href;

            phone = extractPhone(container, containerText);
          }

          // Normalize phone and build phones array
          var normalizedPhone = normalizePhone(phone);
          phone = normalizedPhone || '';
          var phones = normalizedPhone
            ? [{ number: normalizedPhone, label: 'Main', location_name: '', location_address: '' }]
            : [];

          var instaSearch = '';
          try { instaSearch = 'https://www.google.com/search?q=' + encodeURIComponent((titleText || '') + (city ? ' ' + city : '') + ' Instagram'); } catch (e) { instaSearch = ''; }

          var item = {
            title: titleText || '',
            note: '',
            closedStatus: closedStatus,
            rating: rating || '',
            reviewCount: reviewCount || '',
            phone: phone,
            phones: phones,
            industry: industry || '',
            expensiveness: expensiveness,
            city: city || '',
            address: address || '',
            companyUrl: companyUrl || '',
            instaSearch: instaSearch || '',
            href: link.href
          };

          var key = item.href || (item.title + '|' + item.address);
          if (!key) return;
          if (!window.__GMES_SCRAPER__.seen.has(key)) {
            window.__GMES_SCRAPER__.seen.add(key);
            newItems.push(item);
          }
        } catch (e) {
          // per-item error, continue
        }
      });

      if (newItems.length > 0) {
        window.__GMES_SCRAPER__.totalExtracted += newItems.length;
        try { chrome.runtime.sendMessage({ type: 'INJECTED_SCRAPE_ITEMS', items: newItems }); } catch (e) {}
      }

      var el = ensurePopdown();
      var textEl = document.getElementById('gmes-popdown-text');
      if (textEl) textEl.textContent = 'Scraping \u2014 ' + window.__GMES_SCRAPER__.totalExtracted + ' found';

      if (window.__GMES_SCRAPER__.stop) {
        clearInterval(window.__GMES_SCRAPER__.intervalId);
        window.__GMES_SCRAPER__.running = false;
        removePopdown();
        try { delete window.__GMES_SCRAPER__; } catch (e) {}
      }
    } catch (e) {
      // swallow
    }
  }

  // immediate run
  scrapeOnce();
  window.__GMES_SCRAPER__.intervalId = setInterval(scrapeOnce, 500);
})();
