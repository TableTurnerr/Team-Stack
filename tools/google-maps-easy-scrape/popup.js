document.addEventListener('DOMContentLoaded', function () {
    // Mode handling
    chrome.storage.local.get(['gmes_mode'], function (result) {
        var mode = result.gmes_mode || 'scraping';
        setMode(mode);
    });

    function setMode(mode) {
        // Update storage
        chrome.storage.local.set({ gmes_mode: mode, gmes_overlay_dismissed: false });

        // Update UI
        var scrapingBtn = document.getElementById('scrapingModeBtn');
        var manualBtn = document.getElementById('manualModeBtn');
        var scrapingSection = document.getElementById('scrapingModeSection');
        var manualSection = document.getElementById('manualModeSection');
        var shortcutsDiv = document.getElementById('scraping-shortcuts');

        if (mode === 'scraping') {
            scrapingBtn.classList.add('active');
            manualBtn.classList.remove('active');
            scrapingSection.style.display = 'block';
            manualSection.style.display = 'none';
            if (shortcutsDiv) shortcutsDiv.style.display = 'block';
        } else {
            scrapingBtn.classList.remove('active');
            manualBtn.classList.add('active');
            scrapingSection.style.display = 'none';
            manualSection.style.display = 'block';
            if (shortcutsDiv) shortcutsDiv.style.display = 'none';

            // Inject website scanner if on non-Maps page
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                var url = tabs[0] ? tabs[0].url : '';
                if (url && !url.includes('google.com/maps')) {
                    chrome.scripting.executeScript({
                        target: { tabId: tabs[0].id },
                        files: ['manual_mode_website.js']
                    });
                }
            });
        }
    }

    document.getElementById('scrapingModeBtn').addEventListener('click', function () { setMode('scraping'); });
    document.getElementById('manualModeBtn').addEventListener('click', function () { setMode('manual'); });

    document.getElementById('manualAddBtn').addEventListener('click', function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'MANUAL_ADD_OVERLAY' });
            }
        });
    });

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var currentTab = tabs[0];
        var actionButton = document.getElementById('actionButton');
        var clearButton = document.getElementById('clearListButton');
        var downloadCsvButton = document.getElementById('downloadCsvButton');
        var resultsTable = document.getElementById('resultsTable');

        // Defensive checks: ensure the table and its parts exist. If not, create them
        if (!resultsTable) {
            console.error('Results table element `#resultsTable` not found in popup DOM.');
            return; // nothing to render into
        }

        var resultsTbody = resultsTable.querySelector('tbody');
        if (!resultsTbody) {
            resultsTbody = document.createElement('tbody');
            resultsTable.appendChild(resultsTbody);
        }

        var filenameInput = document.getElementById('filenameInput');
        var removeChainsButton = document.getElementById('removeChainsButton');
        var openTabButton = document.getElementById('openTabButton');

        if (openTabButton) {
            openTabButton.addEventListener('click', function() {
                chrome.tabs.create({ url: 'results_tab.html' });
            });
        }

        // Hard-coded ignore list URL (kept out of the UI)
        var HARDCODED_IGNORE_URL = 'https://script.google.com/macros/s/AKfycbzCEBk2vosvbmnV9KyO84CRtX9F5PaOyThSmTKJF5HDxsM8JYrsw2I5d8OFfIyxIsMq/exec';
        var resultsTheadRow = resultsTable.querySelector('thead tr');
        if (!resultsTheadRow) {
            var thead = resultsTable.querySelector('thead') || document.createElement('thead');
            if (!resultsTable.querySelector('thead')) resultsTable.insertBefore(thead, resultsTbody);
            resultsTheadRow = thead.querySelector('tr') || document.createElement('tr');
            if (!thead.querySelector('tr')) thead.appendChild(resultsTheadRow);
        }
        // Keep track of seen entries to avoid duplicates across scrapes
        var seenEntries = new Set();
        // Ignore lists: names and industries. Lowercased tokens persisted under 'gmes_ignore_names' and 'gmes_ignore_industries'
        var ignoreNamesSet = new Set();
        var ignoreIndustriesSet = new Set();
        // Food filter enabled by default
        var foodFilterEnabled = true;

        // Food/Restaurant Industries Lists
        var FOOD_INDUSTRIES = [
            'restaurant', 'restaurants', 'cafe', 'cafes', 'coffee', 'coffee shop',
            'bakery', 'bakeries', 'pizza', 'pizzeria', 'burger', 'burgers', 'sushi', 'thai',
            'chinese', 'mexican', 'italian', 'indian', 'japanese', 'korean', 'vietnamese',
            'mediterranean', 'greek', 'french', 'american', 'seafood', 'steakhouse',
            'bbq', 'barbecue', 'grill', 'diner', 'bistro', 'brasserie', 'trattoria',
            'taqueria', 'cantina', 'pub', 'gastropub', 'tavern', 'bar', 'wine bar',
            'brewery', 'brewpub', 'taproom', 'food truck', 'food stand', 'food court',
            'fast food', 'fast casual', 'takeout', 'deli', 'delicatessen', 'sandwich',
            'salad', 'soup', 'noodle', 'ramen', 'pho', 'dim sum', 'dumpling', 'hotpot',
            'ice cream', 'gelato', 'frozen yogurt', 'dessert', 'pastry', 'donut', 'cupcake',
            'tea', 'bubble tea', 'boba', 'juice', 'smoothie', 'brunch', 'breakfast',
            'buffet', 'fine dining', 'casual dining', 'family restaurant',
            'vegetarian', 'vegan', 'organic', 'wings', 'chicken', 'fried chicken',
            'lobster', 'crab', 'oyster', 'cajun', 'soul food', 'southern', 'comfort food',
            'tapas', 'street food', 'eatery', 'dining', 'kitchen', 'pancake', 'waffle',
            'crepe', 'bagel', 'poke', 'bowl', 'burrito', 'taco', 'curry', 'kebab', 'shawarma',
            'falafel', 'gyro', 'pad thai', 'food', 'meal', 'cuisine', 'culinary'
        ];

        var NON_FOOD_INDUSTRIES = [
            'grocery', 'supermarket', 'market', 'convenience store', 'bodega',
            'gas station', 'gas', 'fuel', 'petrol', 'liquor store', 'liquor',
            'pharmacy', 'drug store', 'dollar store', 'discount store',
            'department store', 'retail', 'shop', 'store', 'warehouse', 'wholesale',
            'hotel', 'motel', 'inn', 'resort', 'hostel', 'laundry', 'laundromat',
            'bank', 'atm', 'gym', 'fitness', 'spa', 'salon', 'barber', 'auto', 'car',
            'hardware', 'office', 'school', 'college', 'hospital', 'clinic', 'medical',
            'church', 'mosque', 'temple', 'parking', 'storage', 'real estate',
            'clothing', 'apparel', 'electronics', 'computer', 'phone', 'pet store',
            'florist', 'furniture', 'travel', 'insurance', 'lawyer', 'accounting'
        ];

        function isFoodRelatedIndustry(industry) {
            if (!industry) return true;
            var industryLower = String(industry).toLowerCase().trim();
            if (!industryLower) return true;

            for (var i = 0; i < NON_FOOD_INDUSTRIES.length; i++) {
                if (industryLower === NON_FOOD_INDUSTRIES[i] || industryLower.indexOf(NON_FOOD_INDUSTRIES[i]) !== -1) {
                    return false;
                }
            }

            for (var i = 0; i < FOOD_INDUSTRIES.length; i++) {
                if (industryLower === FOOD_INDUSTRIES[i] || industryLower.indexOf(FOOD_INDUSTRIES[i]) !== -1) {
                    return true;
                }
            }

            return true;
        }

        // helper to test if an item (title or industry) matches any ignore token
        function itemIsIgnored(item) {
            if (!item) return false;

            // Check title/name
            if (item.title) {
                var title = String(item.title).toLowerCase();
                for (var ig of ignoreNamesSet) {
                    if (!ig) continue;
                    if (title === ig || title.indexOf(ig) !== -1) return true;
                }
            }

            // Check industry
            if (item.industry) {
                var industry = String(item.industry).toLowerCase();
                for (var ig of ignoreIndustriesSet) {
                    if (!ig) continue;
                    if (industry === ig || industry.indexOf(ig) !== -1) return true;
                }
            }

            return false;
        }
        // Stored items persisted to localStorage so the popup can be reopened
        // without losing the list
        var storedItems = [];

        // Clean expensiveness: keep only digits, dollar sign, hyphen, en-dash, plus
        function cleanExpensiveness(raw) {
            if (!raw) return '';
            try {
                return String(raw).replace(/[^0-9$\-\u2013+]/g, '').trim();
            } catch (e) {
                return '';
            }
        }

        // Helper: create a table row element from an item object
        function createRowFromItem(item) {
            var row = document.createElement('tr');
            // column order: title, note, closedStatus, rating, reviewCount, phone, industry, expensiveness, city, address, website, instaSearch, maps link
            ['title', 'note', 'closedStatus', 'rating', 'reviewCount', 'phone', 'industry', 'expensiveness', 'city', 'address', 'companyUrl', 'instaSearch', 'href'].forEach(function (colKey) {
                var cell = document.createElement('td');

                // Special rendering for links
                if (colKey === 'companyUrl' || colKey === 'href') {
                    var url = item[colKey] || '';
                    if (colKey === 'companyUrl') {
                        // If companyUrl is empty OR it's a Google Maps link, create a search link for the website
                        var isMapsLink = url && url.indexOf('https://www.google.com/maps') === 0;
                        if (!url || isMapsLink) {
                            // build search query: Title + City + Website
                            var qParts = [];
                            if (item.title) qParts.push(item.title);
                            if (item.city) qParts.push(item.city);
                            qParts.push('Website');
                            var query = qParts.join(' ');
                            var searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
                            var a = document.createElement('a');
                            a.href = searchUrl;
                            a.textContent = 'Search For Website';
                            a.target = '_blank';
                            a.rel = 'noopener noreferrer';
                            cell.appendChild(a);
                        } else {
                            var a = document.createElement('a');
                            a.href = url;
                            a.textContent = 'Goto Website';
                            a.target = '_blank';
                            a.rel = 'noopener noreferrer';
                            cell.appendChild(a);
                        }
                    } else {
                        // href (maps link) column
                        var mapsUrl = url || '';
                        if (mapsUrl) {
                            var a = document.createElement('a');
                            a.href = mapsUrl;
                            a.textContent = 'Open In Google maps';
                            a.target = '_blank';
                            a.rel = 'noopener noreferrer';
                            cell.appendChild(a);
                        }
                    }
                } else if (colKey === 'instaSearch') {
                    var url = item[colKey] || '';
                    if (url) {
                        var a = document.createElement('a');
                        a.href = url;
                        try {
                            // try to display the search query (decoded)
                            var q = '';
                            var parts = url.split('?');
                            if (parts.length > 1) {
                                var params = parts[1].split('&');
                                for (var pi = 0; pi < params.length; pi++) {
                                    var kv = params[pi].split('=');
                                    if (kv[0] === 'q') { q = decodeURIComponent(kv[1].replace(/\+/g, ' ')); break; }
                                }
                            }
                            a.textContent = q || url;
                        } catch (e) {
                            a.textContent = url;
                        }
                        a.target = '_blank';
                        a.rel = 'noopener noreferrer';
                        cell.appendChild(a);
                    }
                } else {
                    var text = item[colKey] || '';
                    if (colKey === 'reviewCount' && text) {
                        text = text.replace(/\(|\)/g, '');
                    }
                    cell.textContent = text;
                }

                row.appendChild(cell);
            });
            return row;
        }

        // Render all items (clear and re-render) from an array
        function renderAllFromStoredItems(items) {
            storedItems = Array.isArray(items) ? items : [];
            // filter out ignored items before rendering
            try {
                storedItems = storedItems.filter(function (it) {
                    try { return !itemIsIgnored(it); } catch (e) { return true; }
                });
            } catch (e) {
                // if anything goes wrong, fall back to original list
            }
            // clear tbody
            while (resultsTbody.firstChild) {
                resultsTbody.removeChild(resultsTbody.firstChild);
            }
            seenEntries.clear();

            storedItems.forEach(function (item) {
                var uniqueKey = item.href || (item.title + '|' + item.address);
                if (!uniqueKey) return;
                // normalize expensiveness for older stored items
                item.expensiveness = cleanExpensiveness(item.expensiveness || '');
                if (seenEntries.has(uniqueKey)) return;
                seenEntries.add(uniqueKey);
                var row = createRowFromItem(item);
                resultsTbody.appendChild(row);
            });

            // enable/disable buttons based on presence of items
            if (storedItems.length > 0) {
                downloadCsvButton.disabled = false;
                if (clearButton) clearButton.disabled = false;
            } else {
                downloadCsvButton.disabled = true;
                if (clearButton) clearButton.disabled = true;
            }
            // Update the message to show total extracted when on Maps page
            try {
                if (currentTab && currentTab.url.includes('://www.google.com/maps/')) {
                    var msgEl = document.getElementById('message');
                    if (msgEl) msgEl.textContent = 'Total Extracted: ' + (storedItems.length || 0);
                }
            } catch (e) {
                console.error('Failed to update total extracted message', e);
            }
        }

        // Load persisted items from chrome.storage.local and render them
        function loadFromStorage() {
            try {
                chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries', 'gmes_food_filter_enabled'], function (data) {
                    // Load ignore names
                    var ignoreNamesArr = Array.isArray(data.gmes_ignore_names) ? data.gmes_ignore_names : [];
                    ignoreNamesSet.clear();
                    ignoreNamesArr.forEach(function (s) { if (s) ignoreNamesSet.add(String(s).toLowerCase().trim()); });

                    // Load ignore industries
                    var ignoreIndustriesArr = Array.isArray(data.gmes_ignore_industries) ? data.gmes_ignore_industries : [];
                    ignoreIndustriesSet.clear();
                    ignoreIndustriesArr.forEach(function (s) { if (s) ignoreIndustriesSet.add(String(s).toLowerCase().trim()); });

                    // Load food filter setting (enabled by default)
                    foodFilterEnabled = data.gmes_food_filter_enabled !== false;

                    renderAllFromStoredItems(Array.isArray(data.gmes_results) ? data.gmes_results : []);
                    // ensure Remove Chains button is enabled (URL is hard-coded)
                    if (removeChainsButton) removeChainsButton.disabled = false;
                });
            } catch (e) {
                console.error('Failed to load stored results', e);
            }
        }

        // Save current storedItems array to chrome.storage.local
        function saveToStorage() {
            try {
                chrome.storage.local.set({ gmes_results: storedItems });
            } catch (e) {
                console.error('Failed to save results', e);
            }
        }

        // Listen for storage changes (e.g., background command added items)
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area !== 'local') return;
            if (changes.gmes_results) {
                renderAllFromStoredItems(Array.isArray(changes.gmes_results.newValue) ? changes.gmes_results.newValue : []);
            }
        });

        if (currentTab && currentTab.url.includes("://www.google.com/maps/")) {
            document.getElementById('message').textContent = 'Total Extracted: 0';
            actionButton.disabled = false;
            actionButton.classList.add('enabled');
        } else {
            var messageElement = document.getElementById('message');
            messageElement.innerHTML = '';
            var linkElement = document.createElement('a');
            linkElement.href = 'https://www.google.com/maps/search/';
            linkElement.textContent = "Go to Google Maps Search.";
            linkElement.target = '_blank';
            messageElement.appendChild(linkElement);

            actionButton.style.display = 'none';
            downloadCsvButton.style.display = 'none';
            filenameInput.style.display = 'none';
        }

        // Render table header once (so it isn't re-rendered/cleared on each scrape)
        (function renderHeader() {
            const headers = ['Title', 'Note', 'Closed Status', 'Rating', 'Reviews', 'Phone', 'Industry', 'Expensiveness', 'City', 'Address', 'Website', 'Insta Search', 'Google Maps Link'];
            // clear existing header row contents
            resultsTheadRow.innerHTML = '';
            headers.forEach(function (headerText) {
                var header = document.createElement('th');
                header.textContent = headerText;
                resultsTheadRow.appendChild(header);
            });
        })();

        // Initially disable Clear List button (no items yet)
        if (clearButton) clearButton.disabled = true;

        // Load persisted items (if any) and enable buttons accordingly
        loadFromStorage();

        // Remove Chains button: fetch the hard-coded ignore list, persist it, and remove matches
        if (removeChainsButton) {
            removeChainsButton.addEventListener('click', function () {
                var baseUrl = HARDCODED_IGNORE_URL;
                // show spinner inside button
                var spinner = removeChainsButton.querySelector('.spinner');
                if (spinner) spinner.style.display = 'inline-block';
                removeChainsButton.disabled = true;

                // Try variants of the URL if the base fails (append format=text/json if missing)
                function buildVariants(url) {
                    var variants = [url];
                    try {
                        if (url.indexOf('format=') === -1) {
                            var sep = url.indexOf('?') === -1 ? '?' : '&';
                            variants.push(url + sep + 'format=text');
                            variants.push(url + sep + 'format=json');
                        }
                    } catch (e) {
                        // ignore
                    }
                    return variants;
                }

                var variants = buildVariants(baseUrl);

                // Attempt fetch sequentially until one succeeds
                (function tryNext(i) {
                    if (i >= variants.length) {
                        if (spinner) spinner.style.display = 'none';
                        removeChainsButton.disabled = false;
                        alert('Failed to fetch ignore list from all attempted URLs. Check deployment and access (Anyone, even anonymous).');
                        return;
                    }
                    var url = variants[i];
                    fetch(url, { method: 'GET' })
                        .then(function (resp) {
                            // if HTTP error status (4xx/5xx) treat as failure and try next
                            if (!resp.ok) {
                                return resp.text().then(function (text) {
                                    console.warn('Fetch returned non-ok status', resp.status, url, text.slice(0, 200));
                                    tryNext(i + 1);
                                });
                            }
                            return resp.text().then(function (txt) {
                                // parse response (support new format {names:[], industries:[]} or legacy array/text)
                                var namesArr = [];
                                var industriesArr = [];
                                try {
                                    var parsed = JSON.parse(txt);
                                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                                        if (Array.isArray(parsed.names)) namesArr = parsed.names.map(function (s) { return String(s).trim(); }).filter(Boolean);
                                        if (Array.isArray(parsed.industries)) industriesArr = parsed.industries.map(function (s) { return String(s).trim(); }).filter(Boolean);
                                    } else if (Array.isArray(parsed)) {
                                        namesArr = parsed.map(function (s) { return String(s).trim(); }).filter(Boolean);
                                    }
                                } catch (e) {
                                    // fallback to newline-splitting
                                    var lines = txt.split(/\r?\n/).map(function (s) { return String(s).trim(); }).filter(Boolean);
                                    namesArr = lines;
                                }

                                var normalizedNames = namesArr.map(function (s) { return String(s).toLowerCase().trim(); }).filter(Boolean);
                                var normalizedIndustries = industriesArr.map(function (s) { return String(s).toLowerCase().trim(); }).filter(Boolean);

                                chrome.storage.local.set({
                                    gmes_ignore_names: normalizedNames,
                                    gmes_ignore_industries: normalizedIndustries
                                }, function () {
                                    ignoreNamesSet.clear();
                                    normalizedNames.forEach(function (s) { ignoreNamesSet.add(s); });
                                    ignoreIndustriesSet.clear();
                                    normalizedIndustries.forEach(function (s) { ignoreIndustriesSet.add(s); });

                                    var before = storedItems.length;
                                    storedItems = storedItems.filter(function (it) { try { return !itemIsIgnored(it); } catch (e) { return true; } });
                                    var removed = before - storedItems.length;
                                    saveToStorage();
                                    renderAllFromStoredItems(storedItems);

                                    var msg = 'Removed ' + removed + ' matching lead(s).';
                                    if (normalizedNames.length > 0) msg += ' Names: ' + normalizedNames.length;
                                    if (normalizedIndustries.length > 0) msg += ' Industries: ' + normalizedIndustries.length;
                                    msg += ' Ignore list saved.';
                                    alert(msg);

                                    if (spinner) spinner.style.display = 'none';
                                    removeChainsButton.disabled = false;
                                });
                            });
                        })
                        .catch(function (err) {
                            console.warn('Fetch failed for', url, err && err.message ? err.message : err);
                            // try next variant
                            tryNext(i + 1);
                        });
                })(0);
            });
        }

        // Provide a start/stop recording scraping behavior. Clicking the button toggles
        // continuous scraping which runs `scrapeData` repeatedly and appends only new items.
        // Default label set to 'Start Scraping'.
        if (actionButton) {
            actionButton.textContent = 'Start Scraping';
        }

        var scraping = false;

        function runScrapeOnce() {
            if (!currentTab || !currentTab.id) return;
            chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                function: scrapeData
            }, function (results) {
                try {
                    if (!results || !results[0] || !results[0].result) return;
                    (results[0].result || []).filter(Boolean).forEach(function (item) {
                        var uniqueKey = item.href || (item.title + '|' + item.address);
                        if (!uniqueKey) return;

                        // Apply food industry filter
                        if (foodFilterEnabled && !isFoodRelatedIndustry(item.industry)) {
                            return;
                        }

                        if (itemIsIgnored(item)) return;
                        item.expensiveness = cleanExpensiveness(item.expensiveness || '');
                        if (seenEntries.has(uniqueKey)) return;
                        seenEntries.add(uniqueKey);

                        var row = createRowFromItem(item);
                        resultsTbody.appendChild(row);

                        storedItems.push(item);
                        saveToStorage();
                    });

                    if (seenEntries.size > 0) {
                        downloadCsvButton.disabled = false;
                        if (clearButton) clearButton.disabled = false;
                    }
                } catch (e) {
                    console.error('runScrapeOnce error', e);
                }
            });
        }

        // Helpers to start/stop background scraping via the background service worker
        // Start the injected 500ms scraper in the active Maps tab. This injects a
        // content script that runs inside the page, shows a popdown even when popup
        // is closed, and posts discovered items via chrome.runtime.sendMessage.
        function startInjectedScraper(tabId) {
            try {
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['injected_scraper.js']
                }, function () {
                    chrome.storage.local.set({ gmes_background_scraping: true });
                });
            } catch (e) {
                console.error('Failed to inject scraper', e);
            }
        }

        function stopInjectedScraper(tabId) {
            try {
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: function () {
                        try {
                            if (window.__GMES_SCRAPER__) {
                                window.__GMES_SCRAPER__.stop = true;
                                if (window.__GMES_SCRAPER__.intervalId) clearInterval(window.__GMES_SCRAPER__.intervalId);
                                var el = document.getElementById('gmes-popdown'); if (el && el.parentNode) el.parentNode.removeChild(el);
                                try { delete window.__GMES_SCRAPER__; } catch (e) { }
                            }
                        } catch (e) { }
                    }
                }, function () {
                    chrome.storage.local.set({ gmes_background_scraping: false });
                });
            } catch (e) {
                console.error('Failed to stop injected scraper', e);
            }
        }

        // Initialize scraping button state from storage and wire start/stop to the
        // injected content script so scraping continues while popup is closed.
        chrome.storage.local.get(['gmes_background_scraping'], function (data) {
            scraping = Boolean(data.gmes_background_scraping);
            if (actionButton) actionButton.textContent = scraping ? 'Stop Scraping' : 'Start Scraping';
        });

        if (actionButton) {
            actionButton.addEventListener('click', function () {
                if (!scraping) {
                    scraping = true;
                    actionButton.textContent = 'Stop Scraping';
                    // inject scraper into current maps tab
                    if (currentTab && currentTab.id) startInjectedScraper(currentTab.id);
                    // also run an immediate scrape locally so popup shows results immediately
                    runScrapeOnce();
                } else {
                    scraping = false;
                    actionButton.textContent = 'Start Scraping';
                    if (currentTab && currentTab.id) {
                        stopInjectedScraper(currentTab.id);
                        // After stopping the scraper, trigger Remove Chains to run
                        // Give a short delay so the injected script can clean up before fetch
                        setTimeout(function () {
                            try {
                                if (removeChainsButton && typeof removeChainsButton.click === 'function') {
                                    // Ensure button is enabled before clicking
                                    removeChainsButton.disabled = false;
                                    removeChainsButton.click();
                                }
                            } catch (e) {
                                console.error('Failed to trigger Remove Chains automatically', e);
                            }
                        }, 250);
                    }
                }
            });
        }

        // Clear List button clears the tbody and the seen set
        if (clearButton) {
            clearButton.addEventListener('click', function () {
                var confirmed = confirm('Are you sure you want to clear the list? This will remove all saved entries.');
                if (!confirmed) return;

                while (resultsTbody.firstChild) {
                    resultsTbody.removeChild(resultsTbody.firstChild);
                }
                seenEntries.clear();
                storedItems = [];
                saveToStorage();
                downloadCsvButton.disabled = true;
                clearButton.disabled = true;
            });
        }

        // Export visible table preview to an HTML-based .xls file which preserves hyperlinks
        // (works with Excel and many spreadsheet apps and avoids loading remote libs subject to CSP)
        downloadCsvButton.addEventListener('click', function () {
            try {
                var filename = filenameInput.value.trim();
                if (!filename) {
                    filename = 'google-maps-data.xls';
                } else {
                    filename = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.xls';
                }

                // Build HTML table using the visible cell HTML to preserve anchors and labels
                var headers = Array.from(resultsTable.querySelectorAll('thead th'));
                var rows = Array.from(resultsTable.querySelectorAll('tbody tr'));

                var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>';
                html += '<table border="1" style="border-collapse:collapse;">';
                // headers
                html += '<thead><tr>';
                headers.forEach(function (h) { html += '<th>' + (h.innerText || '') + '</th>'; });
                html += '</tr></thead>';
                // body
                html += '<tbody>';
                rows.forEach(function (tr) {
                    html += '<tr>';
                    var cols = Array.from(tr.querySelectorAll('td'));
                    cols.forEach(function (td) {
                        // Use innerHTML so anchor tags are preserved
                        var cellHtml = td.innerHTML || '';
                        html += '<td>' + cellHtml + '</td>';
                    });
                    html += '</tr>';
                });
                html += '</tbody></table></body></html>';

                var blob = new Blob([html], { type: 'application/vnd.ms-excel' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
            } catch (e) {
                console.error('Failed to export XLS', e);
                alert('Export failed: ' + (e && e.message ? e.message : e));
            }
        });

    });
});


function scrapeData() {
    var links = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place"]'));
    return links.map(link => {
        var container = link.closest('[jsaction*="mouseover:pane"]');
        var titleEl = container ? container.querySelector('.fontHeadlineSmall') : null;
        var titleText = titleEl ? titleEl.textContent : '';
        var containerText = container ? (container.textContent || '') : '';

        var closedStatus = '';
        if (/permanently closed/i.test(containerText)) {
            return null;
        } else if (/temporarily closed/i.test(containerText)) {
            closedStatus = 'Temporarily Closed';
        }

        var rating = '';
        var reviewCount = '';
        var phone = '';
        var industry = '';
        var expensiveness = ''; // Declare at function scope to fix scope bug
        var address = '';
        var companyUrl = '';

        // Rating and Reviews
        if (container) {
            var roleImgContainer = container.querySelector('[role="img"]');
            if (roleImgContainer) {
                var ariaLabel = roleImgContainer.getAttribute('aria-label');
                if (ariaLabel && ariaLabel.includes("stars")) {
                    var parts = ariaLabel.split(' ');
                    rating = parts[0] || '';
                    reviewCount = '(' + (parts[2] || '') + ')';
                } else {
                    rating = '0';
                    reviewCount = '0';
                }
            }
        }

        // Address and Industry
        if (container) {
            var addressRegex = /\d+ [\w\s]+(?:#\s*\d+|Suite\s*\d+|Apt\s*\d+)?/;
            var addressMatch = containerText.match(addressRegex);

            if (addressMatch) {
                address = addressMatch[0];
                var textBeforeAddress = containerText.substring(0, containerText.indexOf(address)).trim();
                var ratingIndex = textBeforeAddress.lastIndexOf(rating + reviewCount);
                if (ratingIndex !== -1) {
                    var rawIndustryText = textBeforeAddress.substring(ratingIndex + (rating + reviewCount).length).trim().split(/[\r\n]+/)[0];
                    var cleanedRawIndustry = rawIndustryText.replace(/[·.,#!?]/g, '').trim();
                    industry = cleanedRawIndustry.replace(/[^A-Za-z\s]/g, '').trim();
                    expensiveness = cleanedRawIndustry.replace(/[^0-9$\-\u2013+]/g, '').trim();
                }
                var filterRegex = /\b(Closed|Open 24 hours|24 hours)|Open\b/g;
                address = address.replace(filterRegex, '').trim();
                address = address.replace(/(\d+)(Open)/g, '$1').trim();
                address = address.replace(/(\w)(Open)/g, '$1').trim();
                address = address.replace(/(\w)(Closed)/g, '$1').trim();
            } else {
                address = '';
            }
        }

        // Company URL
        if (container) {
            var allLinks = Array.from(container.querySelectorAll('a[href]'));
            var filteredLinks = allLinks.filter(a => !a.href.startsWith("https://www.google.com/maps/place/"));
            if (filteredLinks.length > 0) {
                companyUrl = filteredLinks[0].href;
            }
        }

        // Phone Numbers - Better regex requiring area code and proper format
        if (container) {
            var phoneRegex = /(?:\+1\s?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[-.\s]?[2-9]\d{2}[-.\s]?\d{4}/;
            var phoneMatch = containerText.match(phoneRegex);
            phone = phoneMatch ? phoneMatch[0] : '';
        }

        function getCityFromQuery() {
            var title = document.title || '';
            var match = title.match(/in\s(.*?)\s-\sGoogle\sMaps/);
            if (match && match.length > 1) {
                var city = match[1];
                var potentialCity = city.split(' - ')[0];
                return potentialCity;
            }

            var searchInput = document.querySelector('input[aria-label="Search Google Maps"]') || document.querySelector('#searchboxinput') || document.querySelector('input[aria-label*="Search"]');
            if (searchInput) {
                var query = searchInput.value;
                var inIndex = query.toLowerCase().indexOf(' in ');
                if (inIndex !== -1) {
                    return query.substring(inIndex + 4);
                }
            }

            return '';
        }

        var city = getCityFromQuery();
        var query = titleText + (city ? ' ' + city : '') + ' Instagram';
        var instaSearch = 'https://www.google.com/search?q=' + encodeURIComponent(query);

        return {
            title: titleText,
            note: '',
            closedStatus: closedStatus,
            rating: rating,
            reviewCount: reviewCount,
            phone: phone,
            industry: industry,
            expensiveness: expensiveness,
            city: city,
            address: address,
            companyUrl: companyUrl,
            instaSearch: instaSearch,
            href: link.href,
        };
    });
}

// Convert the table to a CSV string
function tableToCsv(table) {
    var csv = [];
    var rows = table.querySelectorAll('tr');

    for (var i = 0; i < rows.length; i++) {
        var row = [], cols = rows[i].querySelectorAll('td, th');

        for (var j = 0; j < cols.length; j++) {
            // Export the visible text exactly as shown in the popup (including link labels)
            var text = cols[j].innerText || '';
            // Escape double quotes inside cell text
            text = text.replace(/"/g, '""');
            row.push('"' + text + '"');
        }
        csv.push(row.join(','));
    }
    return csv.join('\n');
}

// Download the CSV file
function downloadCsv(csv, filename) {
    var csvFile;
    var downloadLink;

    csvFile = new Blob([csv], { type: 'text/csv' });
    downloadLink = document.createElement('a');
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
}
