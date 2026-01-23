// manual_mode_maps.js
(function () {
    'use strict';

    // Prevent duplicate initialization
    if (window.__GMES_MAPS_OVERLAY_INIT__) return;
    window.__GMES_MAPS_OVERLAY_INIT__ = true;

    // Track last URL and title for change detection
    let lastUrl = window.location.href;
    let lastTitle = '';
    let urlCheckInterval = null;
    let isOverlayActive = false;

    // Check if we should show overlay
    chrome.runtime.sendMessage({ type: 'CHECK_SHOULD_SHOW_OVERLAY' }, (response) => {
        if (response && response.shouldShow) {
            initMapsOverlay();
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'MANUAL_ADD_OVERLAY' || request.type === 'URL_CHANGED') {
            createOverlay();
        } else if (request.type === 'SHOW_OVERLAY') {
            initMapsOverlay();
        } else if (request.type === 'TRIGGER_MANUAL_ADD') {
            // Handle keyboard shortcut to add item
            const btn = document.getElementById('gmes-add-btn');
            const noteInput = document.getElementById('gmes-note-input');
            if (btn && !btn.disabled && noteInput) {
                const noteValue = noteInput.value.trim();
                if (!noteValue) {
                    noteInput.classList.add('error');
                    noteInput.focus();
                } else {
                    btn.click();
                }
            }
        } else if (request.type === 'GET_CURRENT_WEBSITE') {
            try {
                const item = scrapeCurrentPlace();
                let url = '';
                if (item.companyUrl) {
                    url = item.companyUrl;
                } else {
                    const query = `${item.title || ''} ${item.city || ''} website`.trim();
                    if (query) {
                        url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                    }
                }
                sendResponse({ url: url });
            } catch (e) {
                console.error('Error handling GET_CURRENT_WEBSITE:', e);
                sendResponse({ url: '', error: e.toString() });
            }
        } else if (request.type === 'TOGGLE_OVERLAY') {
            // Toggle overlay visibility
            const overlay = document.getElementById('gmes-manual-overlay');
            if (overlay) {
                overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
            } else {
                // If overlay doesn't exist, create it
                createOverlay();
            }
        }
    });

    function initMapsOverlay() {
        if (isOverlayActive) return;
        isOverlayActive = true;

        // Initial run with delay to let page load
        setTimeout(tryCreateOverlay, 500);

        // Method 1: URL polling (most reliable for Google Maps SPA)
        if (urlCheckInterval) clearInterval(urlCheckInterval);
        urlCheckInterval = setInterval(() => {
            const currentUrl = window.location.href;
            const currentTitle = document.querySelector('h1.DUwDvf')?.textContent || '';

            // Check if URL changed OR if the business title changed
            if (currentUrl !== lastUrl || (currentTitle && currentTitle !== lastTitle)) {
                lastUrl = currentUrl;
                lastTitle = currentTitle;

                // Only update if we're on a place page
                if (currentUrl.includes('/maps/place/')) {
                    // Wait for DOM to settle
                    setTimeout(tryCreateOverlay, 800);
                }
            }
        }, 500);

        // Method 2: Listen for popstate (back/forward navigation)
        window.addEventListener('popstate', () => {
            setTimeout(tryCreateOverlay, 800);
        });

        // Method 3: Watch for DOM changes in the main content area
        const mainObserver = new MutationObserver((mutations) => {
            // Check if h1.DUwDvf changed (business title)
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    const titleEl = document.querySelector('h1.DUwDvf');
                    if (titleEl) {
                        const currentTitle = titleEl.textContent || '';
                        if (currentTitle && currentTitle !== lastTitle) {
                            lastTitle = currentTitle;
                            setTimeout(tryCreateOverlay, 300);
                            break;
                        }
                    }
                }
            }
        });

        // Observe the main content container
        const observeMainContent = () => {
            const mainContent = document.querySelector('[role="main"]') || document.body;
            if (mainContent) {
                mainObserver.observe(mainContent, {
                    childList: true,
                    subtree: true
                });
            }
        };

        // Start observing after a short delay
        setTimeout(observeMainContent, 1000);
    }

    function tryCreateOverlay() {
        // Only create overlay if we're on a place page
        if (!window.location.href.includes('/maps/place/')) return;

        const titleEl = document.querySelector('h1.DUwDvf');
        if (titleEl && titleEl.textContent) {
            createOverlay();
        }
    }

    function scrapeCurrentPlace() {
        // Implement scraping logic using selectors mentioned above
        // Return item object
        const item = {
            title: '',
            rating: '0',
            reviewCount: '0',
            phone: '',
            industry: '',
            expensiveness: '',
            city: '',
            address: '',
            companyUrl: '',
            instaSearch: '',
            href: window.location.href,
            closedStatus: ''
        };

        // 1. Title Extraction
        // Try multiple selectors for the main heading
        const titleSelectors = ['h1.DUwDvf', '.fontHeadlineLarge', 'h1', '[role="main"] [aria-label]'];
        let titleEl = null;
        for (const sel of titleSelectors) {
            // Scope to the main pane if possible to avoid finding hidden h1s
            const mainPane = document.querySelector('[role="main"]') || document;
            titleEl = mainPane.querySelector(sel);
            if (titleEl && titleEl.textContent.trim()) break;
        }
        
        if (titleEl) {
            item.title = titleEl.textContent.trim();
        } 
        
        // Fallback: document.title usually is "Place Name - Google Maps"
        if (!item.title) {
            const docTitle = document.title || '';
            const split = docTitle.split(' - Google Maps');
            if (split.length > 0 && split[0].trim()) {
                item.title = split[0].trim();
            }
        }

        // 2. Container Context (Main Pane)
        const container = document.querySelector('[role="main"]') || document.body;

        // 3. Rating and Reviews
        const ratingReviewEl = container.querySelector('div.F7nice');
        if (ratingReviewEl) {
            const text = ratingReviewEl.textContent.trim();
            const ratingMatch = text.match(/^(\d\.\d)/);
            if (ratingMatch) item.rating = ratingMatch[1];
            
            const reviewMatch = text.match(/\(([\d,]+)\)/);
            if (reviewMatch) item.reviewCount = `(${reviewMatch[1]})`;
        }

        // 4. Phone
        const phoneBtn = container.querySelector('button[aria-label^="Phone:"]');
        if (phoneBtn) {
            const phoneLabel = phoneBtn.getAttribute('aria-label');
            const phoneMatch = phoneLabel.match(/Phone: (.*)/);
            if (phoneMatch && phoneMatch[1]) item.phone = phoneMatch[1].trim();
        }

        // 5. Address
        const addressBtn = container.querySelector('[data-item-id="address"]');
        if (addressBtn) item.address = addressBtn.textContent.trim();

        // 6. Website Extraction (Robust)
        // Priority 1: The standard "authority" button
        const websiteLink = container.querySelector('a[data-item-id="authority"]');
        if (websiteLink && websiteLink.href) {
            item.companyUrl = websiteLink.href;
        } 
        
        // Priority 2: Look for links explicitly labeled "Website"
        if (!item.companyUrl) {
            const allLinks = Array.from(container.querySelectorAll('a[href]'));
            const websiteBtn = allLinks.find(a => {
                const ariaLabel = (a.getAttribute('aria-label') || '').toLowerCase();
                const tooltip = (a.getAttribute('data-tooltip') || '').toLowerCase();
                const text = (a.textContent || '').toLowerCase();
                
                return ariaLabel.includes("website") || 
                       tooltip.includes("open website") ||
                       text.includes("website");
            });
            if (websiteBtn) item.companyUrl = websiteBtn.href;
        }

        // Priority 3: Scavenge for any external link in the main pane
        // (excluding Google Maps internal links, login, help, etc.)
        if (!item.companyUrl) {
            const allLinks = Array.from(container.querySelectorAll('a[href^="http"]'));
            const externalLink = allLinks.find(a => {
                const href = a.href;
                // Exclude common Google patterns
                if (href.includes('google.com/maps')) return false;
                if (href.includes('google.com/search')) return false;
                if (href.includes('accounts.google.com')) return false;
                if (href.includes('support.google.com')) return false;
                if (href.includes('policies.google.com')) return false;
                // It's likely the business website
                return true;
            });
            if (externalLink) item.companyUrl = externalLink.href;
        }

        // 7. Industry/Category
        const categoryBtn = container.querySelector('button.DkEaL');
        if (categoryBtn) {
            const raw = categoryBtn.textContent.trim();
            item.industry = raw.replace(/[^a-zA-Z\s]/g, '').trim();
            item.expensiveness = raw.replace(/[a-zA-Z\s]/g, '').trim();
        }

        // 8. City
        const pageTitle = document.title;
        // Try to find city in title "Business Name, City, State - Google Maps"
        // This is heuristic and might not always work, but it's a fallback
        const cityMatch = pageTitle.match(/,\s*([^,]+)(?:,[^,]+)?\s*-\s*Google Maps/);
        if (cityMatch) {
            item.city = cityMatch[1].trim();
        } else if (item.address) {
            // Try to extract from address: "123 Main St, City, ST 12345"
            const parts = item.address.split(',');
            if (parts.length >= 2) {
                // Heuristic: City is usually the second to last part or part before zip
                // Simple assumption: "Street, City, State Zip" -> take second part
                item.city = parts[1].trim(); 
            }
        }

        // 9. Instagram Search URL
        if (item.title) {
            const query = `${item.title} ${item.city || ''} Instagram`.trim();
            item.instaSearch = 'https://www.google.com/search?q=' + encodeURIComponent(query);
        }
        
        console.log('GMES: Scraped item:', item);
        return item;
    }

    function checkIfAlreadyAdded(item, callback) {
        chrome.storage.local.get(['gmes_results'], (data) => {
            const results = Array.isArray(data.gmes_results) ? data.gmes_results : [];
            const currentKey = item.href || (item.title + '|' + item.address);

            const exists = results.some(existingItem => {
                const existingKey = existingItem.href || (existingItem.title + '|' + existingItem.address);
                return existingKey === currentKey;
            });

            callback(exists);
        });
    }

    function createOverlay() {
        // Remove existing overlay if any
        const existing = document.getElementById('gmes-manual-overlay');
        if (existing) existing.remove();

        const item = scrapeCurrentPlace();

        const overlay = document.createElement('div');
        overlay.id = 'gmes-manual-overlay';
        overlay.innerHTML = `
      <style>
        #gmes-manual-overlay {
          position: fixed;
          top: 80px;
          right: 20px;
          width: 320px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          z-index: 10000;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          font-size: 14px;
        }
        #gmes-manual-overlay .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #4285f4;
          color: white;
          border-radius: 12px 12px 0 0;
          font-weight: 600;
        }
        #gmes-manual-overlay .close-btn {
          background: none;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        #gmes-manual-overlay .refresh-btn {
          background: none;
          border: none;
          color: white;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 4px;
          line-height: 1;
          transition: transform 0.3s;
        }
        #gmes-manual-overlay .refresh-btn:hover {
          transform: rotate(180deg);
        }
        #gmes-manual-overlay .content {
          padding: 16px;
        }
        #gmes-manual-overlay .field {
          margin-bottom: 10px;
          position: relative; /* For suggestions positioning */
        }
        #gmes-manual-overlay .field-label {
          font-weight: 600;
          color: #666;
          font-size: 12px;
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        #gmes-manual-overlay .field-value {
          color: #333;
          word-break: break-word;
        }
        #gmes-manual-overlay .field-value a {
          color: #4285f4;
          text-decoration: none;
        }
        #gmes-manual-overlay .add-btn {
          width: 100%;
          padding: 12px;
          background: #34a853;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          margin-top: 8px;
        }
        #gmes-manual-overlay .add-btn:hover {
          background: #2d9249;
        }
        #gmes-manual-overlay .add-btn:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        #gmes-manual-overlay .add-btn.already-added {
          background: #6c757d;
          cursor: default;
        }
        #gmes-manual-overlay .success-msg {
          color: #34a853;
          text-align: center;
          padding: 8px;
          font-weight: 600;
        }
        /* Suggestions Box Styles */
        #gmes-manual-overlay .suggestions-box {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: white;
            border: 1px solid #ddd;
            border-top: none;
            border-radius: 0 0 6px 6px;
            max-height: 150px;
            overflow-y: auto;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            display: none;
            z-index: 10001;
        }
        #gmes-manual-overlay .suggestion-item {
            padding: 8px 10px;
            cursor: pointer;
            border-bottom: 1px solid #eee;
            color: #333;
        }
        #gmes-manual-overlay .suggestion-item:last-child {
            border-bottom: none;
        }
        #gmes-manual-overlay .suggestion-item:hover {
            background-color: #f5f5f5;
            color: #4285f4;
        }
      </style>
      <div class="header">
        <span>📍 Quick Add</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="refresh-btn" id="gmes-refresh-btn" title="Refresh data">🔄</button>
          <button class="close-btn" id="gmes-close-btn">&times;</button>
        </div>
      </div>
      <div class="content">
        <div class="field">
          <div class="field-label">Name</div>
          <div class="field-value">${item.title || 'N/A'}</div>
        </div>
        <div class="field">
          <div class="field-label">Rating</div>
          <div class="field-value">${item.rating} ★ ${item.reviewCount || ''}</div>
        </div>
        <div class="field">
          <div class="field-label">Category</div>
          <div class="field-value">${item.industry || 'N/A'} ${item.expensiveness || ''}</div>
        </div>
        <div class="field">
          <div class="field-label">Phone</div>
          <div class="field-value">${item.phone || 'N/A'}</div>
        </div>
        <div class="field">
          <div class="field-label">Address</div>
          <div class="field-value">${item.address || 'N/A'}</div>
        </div>
        <div class="field">
          <div class="field-label">Website</div>
          <div class="field-value">${item.companyUrl ? `<a id="gmes-website-link" href="${item.companyUrl}" target="_blank">${new URL(item.companyUrl).hostname}</a>` : '<span id="gmes-website-link" data-search="true">N/A</span>'}</div>
        </div>
        <div class="field">
          <div class="field-label">Note <span style="color: red;">*</span></div>
          <textarea id="gmes-note-input" class="note-input" placeholder="Enter a note (required)" autocomplete="off"></textarea>
          <div id="gmes-suggestions-box" class="suggestions-box"></div>
        </div>
        <button class="add-btn" id="gmes-add-btn">Add to List <span class="shortcut">(Alt+Shift+S)</span></button>
        <div class="shortcuts-info">
             <span>Open Website: Alt+Shift+W</span>
             <span id="gmes-settings-btn" class="settings-icon" title="Change shortcuts">⚙️</span>
        </div>
      </div>
    `;

        document.body.appendChild(overlay);

        // Add CSS for note input
        const style = document.createElement('style');
        style.textContent = `
            #gmes-manual-overlay .note-input {
                width: 100%;
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 6px;
                font-family: inherit;
                font-size: 14px;
                resize: vertical;
                min-height: 60px;
                box-sizing: border-box;
                margin-top: 5px;
            }
            #gmes-manual-overlay .note-input.error {
                border-color: #dc3545;
                background-color: #fff8f8;
                outline: none;
            }
            #gmes-manual-overlay .note-input:focus {
                border-color: #4285f4;
                outline: none;
            }
            #gmes-manual-overlay .shortcut {
                font-size: 11px;
                opacity: 0.8;
                margin-left: 4px;
                font-weight: normal;
            }
            #gmes-manual-overlay .shortcuts-info {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 8px;
                font-size: 11px;
                color: #666;
            }
            #gmes-manual-overlay .settings-icon {
                cursor: pointer;
                font-size: 14px;
                transition: transform 0.2s;
            }
            #gmes-manual-overlay .settings-icon:hover {
                transform: rotate(45deg);
                color: #333;
            }
        `;
        document.head.appendChild(style);

        // Setup Auto-complete for Note Input
        const noteInput = document.getElementById('gmes-note-input');
        const suggestionsBox = document.getElementById('gmes-suggestions-box');
        let recentNotes = [];
        
        // Load recent notes
        chrome.storage.local.get(['gmes_recent_notes'], (data) => {
            recentNotes = Array.isArray(data.gmes_recent_notes) ? data.gmes_recent_notes : [];
        });

        function saveNoteToHistory(newNote) {
            if (!newNote) return;
            // Remove if exists to move to top
            recentNotes = recentNotes.filter(n => n !== newNote);
            recentNotes.unshift(newNote);
            if (recentNotes.length > 20) recentNotes.pop(); // Keep last 20
            chrome.storage.local.set({ gmes_recent_notes: recentNotes });
        }

        function showSuggestions(filterText) {
            // If empty, show recent 5. If text, filter.
            let matches = [];
            if (!filterText) {
                matches = recentNotes.slice(0, 5);
            } else {
                const lower = filterText.toLowerCase();
                matches = recentNotes.filter(note => note.toLowerCase().includes(lower)).slice(0, 5);
            }

            if (matches.length === 0) {
                suggestionsBox.style.display = 'none';
                return;
            }

            suggestionsBox.innerHTML = '';
            matches.forEach(note => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.textContent = note;
                div.onmousedown = function(e) { // mousedown happens before blur
                    e.preventDefault(); // keep focus logic simple
                    noteInput.value = note;
                    suggestionsBox.style.display = 'none';
                    noteInput.focus();
                };
                suggestionsBox.appendChild(div);
            });
            suggestionsBox.style.display = 'block';
        }

        noteInput.addEventListener('focus', () => {
             showSuggestions(noteInput.value.trim());
        });
        
        noteInput.addEventListener('input', () => {
             showSuggestions(noteInput.value.trim());
        });
        
        noteInput.addEventListener('blur', () => {
            // Delay hiding to allow click event to process
            setTimeout(() => { suggestionsBox.style.display = 'none'; }, 200);
        });

        // Refresh button handler
        document.getElementById('gmes-refresh-btn').addEventListener('click', () => {
            createOverlay();
        });

        // Close button handler
        document.getElementById('gmes-close-btn').addEventListener('click', () => {
            overlay.remove();
            style.remove();
            chrome.storage.local.set({ gmes_overlay_dismissed: true });
        });

        // Settings button handler
        document.getElementById('gmes-settings-btn').addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'OPEN_SHORTCUTS_SETTINGS' });
        });

        // Add button handler
        const addBtn = document.getElementById('gmes-add-btn');

        addBtn.addEventListener('click', () => {
            const noteInput = document.getElementById('gmes-note-input');
            const noteValue = noteInput.value.trim();

            if (!noteValue) {
                noteInput.classList.add('error');
                noteInput.focus();
                return;
            }

            noteInput.classList.remove('error');
            
            // Save note to history
            saveNoteToHistory(noteValue);

            // Get fresh data at the moment of adding (ensures current URL)
            const freshItem = scrapeCurrentPlace();
            freshItem.note = noteValue;

            chrome.runtime.sendMessage({ type: 'MANUAL_ADD_ITEM', item: freshItem }, (response) => {
                if (response && response.success) {
                    addBtn.textContent = '✓ Already in List';
                    addBtn.disabled = true;
                    addBtn.classList.add('already-added');
                }
            });
        });

        // Check if already added and update button state
        checkIfAlreadyAdded(item, (alreadyExists) => {
            if (alreadyExists) {
                addBtn.textContent = '✓ Already in List';
                addBtn.disabled = true;
                addBtn.classList.add('already-added');
            }
        });

        // Listen for storage changes to update button state
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.gmes_results) {
                const currentItem = scrapeCurrentPlace();
                checkIfAlreadyAdded(currentItem, (alreadyExists) => {
                    const btn = document.getElementById('gmes-add-btn');
                    if (!btn) return;

                    if (alreadyExists) {
                        btn.textContent = '✓ Already in List';
                        btn.disabled = true;
                        btn.classList.add('already-added');
                    } else {
                        btn.innerHTML = 'Add to List <span class="shortcut">(Alt+Shift+S)</span>';
                        btn.disabled = false;
                        btn.classList.remove('already-added');
                    }
                });
            }
        });
    }

})();
