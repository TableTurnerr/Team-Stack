// manual_mode_maps.js
(function () {
    'use strict';

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
        }
    });

    function initMapsOverlay() {
        const runOverlay = () => {
            const title = document.querySelector('h1.DUwDvf');
            if (title) {
                createOverlay();
            }
        };

        // Initial run
        runOverlay();

        // Watch for title changes (navigation in SPA)
        const titleObserver = new MutationObserver(() => {
            // Short debounce to allow DOM to settle
            setTimeout(runOverlay, 1000);
        });
        
        const titleEl = document.querySelector('title');
        if (titleEl) {
            titleObserver.observe(titleEl, { childList: true });
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

        // Title
        const titleEl = document.querySelector('h1.DUwDvf');
        if (titleEl) item.title = titleEl.textContent.trim();

        // Rating and Review count
        const ratingReviewEl = document.querySelector('div.F7nice');
        if (ratingReviewEl) {
            const text = ratingReviewEl.textContent.trim();
            const ratingMatch = text.match(/^(\d\.\d)/);
            if (ratingMatch) {
                item.rating = ratingMatch[1];
            }
            const reviewMatch = text.match(/\(([\d,]+)\)/);
            if (reviewMatch) {
                item.reviewCount = `(${reviewMatch[1]})`;
            }
        }

        // Phone - look for tel: link or data attribute
        const phoneBtn = document.querySelector('button[aria-label^="Phone:"]');
        if (phoneBtn) {
            const phoneLabel = phoneBtn.getAttribute('aria-label');
            const phoneMatch = phoneLabel.match(/Phone: (.*)/);
            if (phoneMatch && phoneMatch[1]) {
                item.phone = phoneMatch[1].trim();
            }
        }

        // Address
        const addressBtn = document.querySelector('[data-item-id="address"]');
        if (addressBtn) item.address = addressBtn.textContent.trim();

        // Website
        const websiteLink = document.querySelector('a[data-item-id="authority"]');
        if (websiteLink) item.companyUrl = websiteLink.href;

        // Industry/Category
        const categoryBtn = document.querySelector('button.DkEaL');
        if (categoryBtn) {
            const raw = categoryBtn.textContent.trim();
            // Separate letters from currency symbols
            item.industry = raw.replace(/[^a-zA-Z\s]/g, '').trim();
            item.expensiveness = raw.replace(/[a-zA-Z\s]/g, '').trim();
        }

        // City - extract from address or page title
        const pageTitle = document.title;
        const cityMatch = pageTitle.match(/,\s*([^,]+)\s*-\s*Google Maps/);
        if (cityMatch) item.city = cityMatch[1].trim();

        // Instagram search URL
        if (item.title && item.city) {
            item.instaSearch = 'https://www.google.com/search?q=' +
                encodeURIComponent(item.title + ' ' + item.city + ' Instagram');
        }

        return item;
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
        #gmes-manual-overlay .content {
          padding: 16px;
        }
        #gmes-manual-overlay .field {
          margin-bottom: 10px;
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
        #gmes-manual-overlay .success-msg {
          color: #34a853;
          text-align: center;
          padding: 8px;
          font-weight: 600;
        }
      </style>
      <div class="header">
        <span>📍 Quick Add</span>
        <button class="close-btn" id="gmes-close-btn">&times;</button>
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
          <div class="field-value">${item.companyUrl ? `<a href="${item.companyUrl}" target="_blank">${new URL(item.companyUrl).hostname}</a>` : 'N/A'}</div>
        </div>
        <div class="field">
          <div class="field-label">Note <span style="color: red;">*</span></div>
          <textarea id="gmes-note-input" class="note-input" placeholder="Enter a note (required)"></textarea>
        </div>
        <button class="add-btn" id="gmes-add-btn">Add to List <span class="shortcut">(Ctrl+Shift+L)</span></button>
        <div class="shortcuts-info">
             <span>Open Website: Ctrl+Shift+W</span>
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
        document.getElementById('gmes-add-btn').addEventListener('click', () => {
            const noteInput = document.getElementById('gmes-note-input');
            const noteValue = noteInput.value.trim();

            if (!noteValue) {
                noteInput.classList.add('error');
                noteInput.focus();
                return;
            }
            
            noteInput.classList.remove('error');
            item.note = noteValue;

            chrome.runtime.sendMessage({ type: 'MANUAL_ADD_ITEM', item: item }, (response) => {
                if (response && response.success) {
                    const btn = document.getElementById('gmes-add-btn');
                    btn.textContent = '✓ Added!';
                    btn.disabled = true;
                    setTimeout(() => {
                        btn.innerHTML = 'Add to List <span class="shortcut">(Ctrl+Shift+L)</span>';
                        btn.disabled = false;
                    }, 2000);
                }
            });
        });
    }

})();
