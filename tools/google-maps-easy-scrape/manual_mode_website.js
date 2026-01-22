// manual_mode_website.js
(function () {
    'use strict';

    // Prevent duplicate injection
    if (window.__GMES_WEBSITE_SCANNER__) return;
    window.__GMES_WEBSITE_SCANNER__ = true;

    // Patterns
    const phoneRegex = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const mapsLinkRegex = /https?:\/\/(?:www\.)?google\.com\/maps[^\s"'<>]*/gi;

    function scanPage() {
        const results = {
            phones: new Set(),
            emails: new Set(),
            addresses: [],
            mapsLinks: new Set(),
            businessName: document.title.split('|')[0].split('-')[0].trim()
        };

        // Scan tel: links
        document.querySelectorAll('a[href^="tel:"]').forEach(el => {
            const phone = el.href.replace('tel:', '').replace(/\D/g, '');
            if (phone.length >= 10) results.phones.add(formatPhone(phone));
        });

        // Scan mailto: links
        document.querySelectorAll('a[href^="mailto:"]').forEach(el => {
            const email = el.href.replace('mailto:', '').split('?')[0];
            if (email.includes('@')) results.emails.add(email.toLowerCase());
        });

        // Scan Google Maps links
        document.querySelectorAll('a[href*="google.com/maps"]').forEach(el => {
            results.mapsLinks.add(el.href);
        });

        // Scan page text (limit to body text, skip scripts/styles)
        const textContent = document.body.innerText.substring(0, 100000);

        // Find phones in text
        const textPhones = textContent.match(phoneRegex) || [];
        textPhones.forEach(p => {
            const cleaned = p.replace(/\D/g, '');
            if (cleaned.length >= 10 && cleaned.length <= 11) {
                results.phones.add(formatPhone(cleaned));
            }
        });

        // Find emails in text
        const textEmails = textContent.match(emailRegex) || [];
        textEmails.forEach(e => {
            if (!e.includes('.png') && !e.includes('.jpg') && !e.includes('.gif')) {
                results.emails.add(e.toLowerCase());
            }
        });

        // Find maps links in text/html
        const html = document.body.innerHTML;
        const mapsMatches = html.match(mapsLinkRegex) || [];
        mapsMatches.forEach(link => results.mapsLinks.add(link));

        // Check structured data
        document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
            try {
                const data = JSON.parse(script.textContent);
                extractFromStructuredData(data, results);
            } catch (e) { }
        });

        return {
            phones: Array.from(results.phones).slice(0, 5),
            emails: Array.from(results.emails).slice(0, 5),
            addresses: results.addresses.slice(0, 3),
            mapsLinks: Array.from(results.mapsLinks).slice(0, 3),
            businessName: results.businessName
        };
    }

    function formatPhone(digits) {
        if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
        if (digits.length === 10) {
            return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
        }
        return digits;
    }

    function extractFromStructuredData(data, results) {
        if (Array.isArray(data)) {
            data.forEach(item => extractFromStructuredData(item, results));
            return;
        }

        if (typeof data !== 'object' || !data) return;

        if (data.telephone) results.phones.add(data.telephone);
        if (data.email) results.emails.add(data.email.toLowerCase());
        if (data.name && !results.businessName) results.businessName = data.name;

        if (data.address) {
            if (typeof data.address === 'string') {
                results.addresses.push(data.address);
            } else if (data.address.streetAddress) {
                const addr = [
                    data.address.streetAddress,
                    data.address.addressLocality,
                    data.address.addressRegion,
                    data.address.postalCode
                ].filter(Boolean).join(', ');
                results.addresses.push(addr);
            }
        }

        // Recursively check nested objects
        Object.values(data).forEach(val => {
            if (typeof val === 'object') extractFromStructuredData(val, results);
        });
    }

        function createOverlay(data) {
            const overlay = document.createElement('div');
            overlay.id = 'gmes-website-overlay';
    
            const phonesHtml = data.phones.length
                ? data.phones.map(p => `<div class="info-item">${p}</div>`).join('')
                : '<div class="info-item empty">No phone numbers found</div>';
    
            const emailsHtml = data.emails.length
                ? data.emails.map(e => `<div class="info-item"><a href="mailto:${e}">${e}</a></div>`).join('')
                : '<div class="info-item empty">No emails found</div>';
    
            const addressHtml = data.addresses.length
                ? data.addresses.map(a => `<div class="info-item">${a}</div>`).join('')
                : '<div class="info-item empty">No address found</div>';
    
            const mapsHtml = data.mapsLinks.length
                ? data.mapsLinks.map(link => `<div class="info-item"><a href="${link}" target="_blank">View on Maps</a></div>`).join('')
                : `<div class="info-item"><a href="https://www.google.com/maps/search/${encodeURIComponent(data.businessName)}" target="_blank">Search on Maps</a></div>`;
    
            overlay.innerHTML = `
          <style>
            #gmes-website-overlay {
              position: fixed;
              top: 20px;
              right: 20px;
              width: 340px;
              background: white;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.15);
              z-index: 2147483647;
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              font-size: 14px;
            }
            #gmes-website-overlay .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 12px 16px;
              background: #4285f4;
              color: white;
              border-radius: 12px 12px 0 0;
              font-weight: 600;
            }
            #gmes-website-overlay .close-btn {
              background: none;
              border: none;
              color: white;
              font-size: 20px;
              cursor: pointer;
              padding: 0;
              line-height: 1;
            }
            #gmes-website-overlay .content {
              padding: 16px;
              max-height: 400px;
              overflow-y: auto;
            }
            #gmes-website-overlay .section {
              margin-bottom: 16px;
            }
            #gmes-website-overlay .section-label {
              font-weight: 600;
              color: #666;
              font-size: 12px;
              text-transform: uppercase;
              margin-bottom: 6px;
              display: flex;
              align-items: center;
              gap: 6px;
            }
            #gmes-website-overlay .info-item {
              color: #333;
              padding: 4px 0;
              word-break: break-word;
            }
            #gmes-website-overlay .info-item.empty {
              color: #999;
              font-style: italic;
            }
            #gmes-website-overlay .info-item a {
              color: #4285f4;
              text-decoration: none;
            }
            #gmes-website-overlay .name-input {
              width: 100%;
              padding: 10px;
              border: 1px solid #ddd;
              border-radius: 6px;
              font-size: 14px;
              margin-bottom: 12px;
              box-sizing: border-box;
            }
            #gmes-website-overlay .add-btn {
              width: 100%;
              padding: 12px;
              background: #34a853;
              color: white;
              border: none;
              border-radius: 8px;
              font-size: 14px;
              font-weight: 600;
              cursor: pointer;
            }
            #gmes-website-overlay .add-btn:hover {
              background: #2d9249;
            }
            #gmes-website-overlay .add-btn:disabled {
              background: #ccc;
              cursor: not-allowed;
            }
            #gmes-website-overlay .shortcut {
                font-size: 11px;
                opacity: 0.8;
                margin-left: 4px;
                font-weight: normal;
            }
            #gmes-website-overlay .shortcuts-info {
                display: flex;
                justify-content: flex-end;
                margin-top: 8px;
                font-size: 11px;
                color: #666;
            }
            #gmes-website-overlay .settings-icon {
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 4px;
            }
            #gmes-website-overlay .settings-icon:hover {
                text-decoration: underline;
                color: #333;
            }
          </style>
          <div class="header">
            <span>📍 Contact Info Scanner</span>
            <button class="close-btn" id="gmes-close-btn">&times;</button>
          </div>
          <div class="content">
            <div class="section">
              <div class="section-label">📞 Phone Numbers</div>
              ${phonesHtml}
            </div>
            <div class="section">
              <div class="section-label">📧 Email Addresses</div>
              ${emailsHtml}
            </div>
            <div class="section">
              <div class="section-label">📍 Address</div>
              ${addressHtml}
            </div>
            <div class="section">
              <div class="section-label">🗺️ Google Maps</div>
              ${mapsHtml}
            </div>
            <div class="section">
              <div class="section-label">Business Name</div>
              <input type="text" class="name-input" id="gmes-name-input" value="${escapeHtml(data.businessName)}" placeholder="Enter business name">
            </div>
            <div class="section">
              <div class="section-label">Note <span style="color: red;">*</span></div>
              <textarea id="gmes-note-input" class="note-input" placeholder="Enter a note (required)"></textarea>
            </div>
            <button class="add-btn" id="gmes-add-btn">Add to List <span class="shortcut">(Ctrl+Shift+L)</span></button>
            <div class="shortcuts-info">
                 <span id="gmes-settings-btn" class="settings-icon" title="Change shortcuts">⚙️ Configure Shortcuts</span>
            </div>
          </div>
        `;
    
            document.body.appendChild(overlay);
    
            const style = document.createElement('style');
            style.textContent = `
                #gmes-website-overlay .note-input {
                    width: 100%;
                    padding: 10px;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                    font-family: inherit;
                    font-size: 14px;
                    resize: vertical;
                    min-height: 60px;
                    box-sizing: border-box;
                    margin-bottom: 12px;
                }
                #gmes-website-overlay .note-input.error {
                    border-color: #dc3545;
                    background-color: #fff8f8;
                    outline: none;
                }
                #gmes-website-overlay .note-input:focus {
                    border-color: #4285f4;
                    outline: none;
                }
            `;
            document.head.appendChild(style);
    
            // Close handler
            document.getElementById('gmes-close-btn').addEventListener('click', () => {
                overlay.remove();
                style.remove();
            });
    
            // Settings handler
            document.getElementById('gmes-settings-btn').addEventListener('click', () => {
                chrome.runtime.sendMessage({ type: 'OPEN_SHORTCUTS_SETTINGS' });
            });
    
            // Add handler
            document.getElementById('gmes-add-btn').addEventListener('click', () => {
                const businessName = document.getElementById('gmes-name-input').value.trim();
                const noteInput = document.getElementById('gmes-note-input');
                const noteValue = noteInput.value.trim();
    
                if (!noteValue) {
                    noteInput.classList.add('error');
                    noteInput.focus();
                    return;
                }
                noteInput.classList.remove('error');
    
                const item = {
                    title: businessName || 'Unknown Business',
                    closedStatus: '',
                    rating: '0',
                    reviewCount: '0',
                    phone: data.phones[0] || '',
                    industry: '',
                    expensiveness: '',
                    city: '',
                    address: data.addresses[0] || '',
                    companyUrl: window.location.href,
                    instaSearch: businessName ?
                        `https://www.google.com/search?q=${encodeURIComponent(businessName + ' Instagram')}` : '',
                    href: data.mapsLinks[0] || `https://www.google.com/maps/search/${encodeURIComponent(businessName + ' ' + (data.addresses[0] || ''))}`,
                    note: noteValue
                };
    
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
    
        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
    
        // Initialize
        const data = scanPage();
        createOverlay(data);
    
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'TRIGGER_MANUAL_ADD') {
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
            }
        });
    })();
