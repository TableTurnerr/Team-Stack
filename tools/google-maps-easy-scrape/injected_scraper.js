// Injected scraper: runs inside the Google Maps page context.
(function() {
  if (window.__GMES_SCRAPER__ && window.__GMES_SCRAPER__.running) return;

  window.__GMES_SCRAPER__ = {
    running: true,
    seen: new Set(),
    totalExtracted: 0,
    intervalId: null
  };

  // create popdown UI
  function ensurePopdown() {
    var id = 'gmes-popdown';
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.position = 'fixed';
      el.style.right = '12px';
      el.style.bottom = '12px';
      el.style.zIndex = 2147483647;
      el.style.background = 'rgba(0,0,0,0.8)';
      el.style.color = '#fff';
      el.style.padding = '6px 10px';
      el.style.borderRadius = '6px';
      el.style.fontSize = '12px';
      el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
      el.style.fontFamily = 'Arial, sans-serif';
      el.textContent = 'Scraping active...  Total scraped (0)';
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
          var titleText = container ? (container.querySelector('.fontHeadlineSmall') ? container.querySelector('.fontHeadlineSmall').textContent : '') : '';
          var containerText = container ? (container.textContent || '') : '';
          if (/permanently closed/i.test(containerText)) return; // skip

          var rating = '';
          var reviewCount = '';
          var industry = '';
          var address = '';
          var companyUrl = '';

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
                            var industryAlpha = cleanedRawIndustry.replace(/[^A-Za-z\s]/g, '').trim();
                            industry = industryAlpha;
                            // derive expensiveness from the cleaned raw industry text (symbols, $, digits)
                            var expensivenessMatch = cleanedRawIndustry.replace(/[A-Za-z\s]/g, '').trim();
                            expensiveness = expensivenessMatch;
              }
            }

            var allLinks = Array.from(container.querySelectorAll('a[href]'));
            var filteredLinks = allLinks.filter(a => !a.href.startsWith('https://www.google.com/maps/place/'));
            if (filteredLinks.length > 0) companyUrl = filteredLinks[0].href;

            var phoneRegex = /(\+\d{1,2}\s)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
            var phoneMatch = containerText.match(phoneRegex);
            var phone = phoneMatch ? phoneMatch[0] : '';
          }

          // build object
          var instaSearch = '';
          try { instaSearch = 'https://www.google.com/search?q=' + encodeURIComponent((titleText || '') + (city ? ' ' + city : '') + ' Instagram'); } catch (e) { instaSearch = ''; }

          var item = {
            title: titleText || '',
            note: '',
            rating: rating || '',
            reviewCount: reviewCount || '',
            phone: (typeof phone !== 'undefined') ? phone : '',
            industry: industry || '',
            expensiveness: expensiveness || '',
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

      // update popdown with total extracted
      var el = ensurePopdown();
      el.textContent = 'Scraping active.. Total extracted (' + (window.__GMES_SCRAPER__.totalExtracted) + ')';

      // check stop flag
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
