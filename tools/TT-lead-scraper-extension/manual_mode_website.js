// manual_mode_website.js

// ============================================================================
// PocketBase CRM Helpers (inline)
// ============================================================================
function pbGetSettings_website(cb) {
    chrome.storage.local.get(['gmes_pb_url', 'gmes_pb_token'], function (data) {
        cb(data.gmes_pb_url || '', data.gmes_pb_token || '');
    });
}

function pbCheckDuplicate_website(name, phone, cb) {
    pbGetSettings_website(function (pbUrl, pbToken) {
        if (!pbUrl) { cb(false); return; }
        var headers = {};
        if (pbToken) headers['Authorization'] = 'Bearer ' + pbToken;
        var nameFilter = encodeURIComponent('company_name~"' + String(name || '').replace(/"/g, '') + '"');
        fetch(pbUrl + '/api/collections/companies/records?filter=' + nameFilter + '&perPage=1', { headers: headers })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.totalItems > 0) { cb(true); return; }
                if (!phone) { cb(false); return; }
                var phoneFilter = encodeURIComponent('number="' + String(phone).replace(/\D/g, '') + '"');
                fetch(pbUrl + '/api/collections/phone_numbers/records?filter=' + phoneFilter + '&perPage=1', { headers: headers })
                    .then(function (r2) { return r2.json(); })
                    .then(function (d2) { cb(d2.totalItems > 0); })
                    .catch(function () { cb(false); });
            })
            .catch(function () { cb(false); });
    });
}

function pbSendToCrm_website(item, cb) {
    pbGetSettings_website(function (pbUrl, pbToken) {
        if (!pbUrl) { cb({ success: false, error: 'No PocketBase URL configured. Set it in \u2699 CRM Settings in the popup.' }); return; }
        var headers = { 'Content-Type': 'application/json' };
        if (pbToken) headers['Authorization'] = 'Bearer ' + pbToken;
        var phones = Array.isArray(item.phones) && item.phones.length ? item.phones : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
        var companyBody = JSON.stringify({
            company_name: item.title || '',
            company_location: (item.address || '') + (item.city ? ', ' + item.city : ''),
            google_maps_link: item.href || '',
            source: 'Google Maps',
            notes: item.note || ''
        });
        fetch(pbUrl + '/api/collections/companies/records', { method: 'POST', headers: headers, body: companyBody })
            .then(function (r) {
                if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
                return r.json();
            })
            .then(function (compData) {
                var companyId = compData.id;
                if (!phones.length) { cb({ success: true, recordId: companyId }); return; }
                var phonePromises = phones.map(function (pe) {
                    var num = String(pe.number || '').replace(/\D/g, '');
                    if (!num) return Promise.resolve();
                    var phoneBody = JSON.stringify({ number: num, company: companyId, label: pe.label || 'Main', location_name: pe.location_name || '', location_address: pe.location_address || '' });
                    return fetch(pbUrl + '/api/collections/phone_numbers/records', { method: 'POST', headers: headers, body: phoneBody });
                });
                Promise.all(phonePromises).then(function () { cb({ success: true, recordId: companyId }); });
            })
            .catch(function (e) { cb({ success: false, error: e.message || String(e) }); });
    });
}
// ============================================================================
// End of PocketBase CRM Helpers
// ============================================================================

(function () {
    'use strict';

    // Prevent duplicate injection
    if (window.__GMES_WEBSITE_SCANNER__) return;
    window.__GMES_WEBSITE_SCANNER__ = true;

    // ========================================================================
    // Phone Normalization Helpers
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

    // ========================================================================
    // Phone Extraction with Labels (up to 10 entries)
    // ========================================================================

    function extractPhonesWithLabels() {
        var entries = [];
        var seenNums = new Set();

        function addEntry(rawPhone, label, location_name, location_address) {
            var normalized = normalizePhone(rawPhone);
            if (!normalized || seenNums.has(normalized)) return;
            seenNums.add(normalized);
            entries.push({
                number: normalized,
                label: label || '',
                location_name: location_name || '',
                location_address: location_address || ''
            });
        }

        // 1. tel: links — infer label from DOM context
        document.querySelectorAll('a[href^="tel:"]').forEach(function (el) {
            if (entries.length >= 10) return;
            var raw = el.href.replace('tel:', '');
            var label = el.getAttribute('aria-label') || '';
            var location_name = '';
            var location_address = '';

            if (!label) {
                var dd = el.closest('dd');
                if (dd) {
                    var dt = dd.previousElementSibling;
                    if (dt && dt.tagName === 'DT') label = dt.textContent.trim();
                }
            }

            var section = el.closest('section, article, [class*="location"], [class*="store"], [class*="branch"]');
            if (section) {
                var heading = section.querySelector('h2, h3, h4');
                if (heading) location_name = heading.textContent.trim();
                var addr = section.querySelector('[class*="address"], address');
                if (addr) {
                    let rawAddr = addr.textContent.trim();
                    // Remove leading Unicode icon if present
                    if (rawAddr && rawAddr.charCodeAt(0) > 127 && !/^\d/.test(rawAddr)) {
                        rawAddr = rawAddr.substring(1).trim();
                    }
                    location_address = rawAddr.substring(0, 100);
                }
            }

            addEntry(raw, label, location_name, location_address);
        });

        // 2. dt/dd pairs
        document.querySelectorAll('dt').forEach(function (dt) {
            if (entries.length >= 10) return;
            var dd = dt.nextElementSibling;
            if (!dd || dd.tagName !== 'DD') return;
            var phoneRe = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
            var matches = dd.textContent.match(phoneRe) || [];
            var labelText = dt.textContent.trim();
            matches.forEach(function (p) {
                if (entries.length < 10) addEntry(p, labelText, '', '');
            });
        });

        // 3. th/td pairs
        document.querySelectorAll('tr').forEach(function (tr) {
            if (entries.length >= 10) return;
            var cells = Array.from(tr.querySelectorAll('th, td'));
            if (cells.length < 2) return;
            var headerText = cells[0].textContent.trim();
            var phoneRe = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
            for (var i = 1; i < cells.length && entries.length < 10; i++) {
                var matches = cells[i].textContent.match(phoneRe) || [];
                matches.forEach(function (p) {
                    if (entries.length < 10) addEntry(p, headerText, '', '');
                });
            }
        });

        // 4. JSON-LD — handles telephone arrays and nested location objects
        function extractTelsFromJsonLd(obj) {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) { obj.forEach(extractTelsFromJsonLd); return; }
            if (obj.telephone) {
                var tels = Array.isArray(obj.telephone) ? obj.telephone : [obj.telephone];
                var locName = (typeof obj.name === 'string') ? obj.name : '';
                var locAddr = '';
                if (obj.address) {
                    if (typeof obj.address === 'string') {
                        locAddr = obj.address;
                    } else if (obj.address.streetAddress) {
                        locAddr = [obj.address.streetAddress, obj.address.addressLocality, obj.address.addressRegion]
                            .filter(Boolean).join(', ');
                    }
                }
                tels.forEach(function (t) {
                    if (entries.length < 10) addEntry(String(t), '', locName, locAddr);
                });
            }
            Object.values(obj).forEach(function (val) {
                if (entries.length < 10 && val && typeof val === 'object') extractTelsFromJsonLd(val);
            });
        }
        document.querySelectorAll('script[type="application/ld+json"]').forEach(function (script) {
            if (entries.length >= 10) return;
            try { extractTelsFromJsonLd(JSON.parse(script.textContent)); } catch (e) { }
        });

        // 5. Text scanning fallback
        if (entries.length < 10) {
            var phoneRe = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
            var textContent = document.body.innerText.substring(0, 100000);
            var matches = textContent.match(phoneRe) || [];
            matches.forEach(function (p) {
                if (entries.length < 10) addEntry(p, '', '', '');
            });
        }

        return entries.slice(0, 10);
    }

    // ========================================================================
    // Page Scan
    // ========================================================================

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const mapsLinkRegex = /https?:\/\/(?:www\.)?google\.com\/maps[^\s"'<>]*/gi;

    function scanPage() {
        const results = {
            emails: new Set(),
            addresses: [],
            mapsLinks: new Set(),
            businessName: document.title.split('|')[0].split('-')[0].trim()
        };

        document.querySelectorAll('a[href^="mailto:"]').forEach(el => {
            const email = el.href.replace('mailto:', '').split('?')[0];
            if (email.includes('@')) results.emails.add(email.toLowerCase());
        });

        document.querySelectorAll('a[href*="google.com/maps"]').forEach(el => {
            results.mapsLinks.add(el.href);
        });

        const textContent = document.body.innerText.substring(0, 100000);

        const textEmails = textContent.match(emailRegex) || [];
        textEmails.forEach(e => {
            if (!e.includes('.png') && !e.includes('.jpg') && !e.includes('.gif')) {
                results.emails.add(e.toLowerCase());
            }
        });

        const html = document.body.innerHTML;
        const mapsMatches = html.match(mapsLinkRegex) || [];
        mapsMatches.forEach(link => results.mapsLinks.add(link));

        document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
            try {
                const data = JSON.parse(script.textContent);
                extractNonPhoneStructuredData(data, results);
            } catch (e) { }
        });

        const phoneEntries = extractPhonesWithLabels();

        return {
            phoneEntries: phoneEntries,
            emails: Array.from(results.emails).slice(0, 5),
            addresses: results.addresses.slice(0, 3),
            mapsLinks: Array.from(results.mapsLinks).slice(0, 3),
            businessName: results.businessName
        };
    }

    function extractNonPhoneStructuredData(data, results) {
        if (Array.isArray(data)) {
            data.forEach(item => extractNonPhoneStructuredData(item, results));
            return;
        }
        if (typeof data !== 'object' || !data) return;

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

        Object.values(data).forEach(val => {
            if (typeof val === 'object') extractNonPhoneStructuredData(val, results);
        });
    }

    function checkIfAlreadyAdded(callback) {
        chrome.storage.local.get(['gmes_results'], (storageData) => {
            const results = Array.isArray(storageData.gmes_results) ? storageData.gmes_results : [];
            const currentUrl = window.location.href;

            const exists = results.some(existingItem => {
                return existingItem.companyUrl === currentUrl ||
                    (existingItem.companyUrl && existingItem.companyUrl.includes(window.location.hostname));
            });

            callback(exists);
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function createOverlay(data) {
        const overlay = document.createElement('div');
        overlay.id = 'gmes-website-overlay';

        // Phone checklist — one entry per discovered number with editable label
        const phonesHtml = data.phoneEntries && data.phoneEntries.length
            ? data.phoneEntries.map((entry, i) => `
                <div class="phone-entry" data-index="${i}">
                  <label style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                    <input type="checkbox" class="phone-check" data-num="${escapeHtml(entry.number)}" checked>
                    <span class="phone-display">${escapeHtml(formatPhoneDisplay(entry.number))}</span>
                  </label>
                  <input type="text" class="phone-label-input" placeholder="Label (e.g. Main, Fax, Takeout)" value="${escapeHtml(entry.label)}">
                  ${entry.location_name ? `<div class="phone-location-hint">${escapeHtml(entry.location_name)}</div>` : ''}
                </div>`).join('')
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
              max-height: 480px;
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
            #gmes-website-overlay .phone-entry {
              margin-bottom: 6px;
              padding: 6px 8px;
              background: #f8f9fa;
              border-radius: 6px;
            }
            #gmes-website-overlay .phone-display {
              font-weight: 500;
              color: #333;
            }
            #gmes-website-overlay .phone-label-input {
              width: 100%;
              padding: 4px 6px;
              border: 1px solid #ddd;
              border-radius: 4px;
              font-size: 12px;
              color: #555;
              box-sizing: border-box;
              margin-top: 2px;
            }
            #gmes-website-overlay .phone-label-input:focus {
              border-color: #4285f4;
              outline: none;
            }
            #gmes-website-overlay .phone-location-hint {
              font-size: 11px;
              color: #888;
              margin-top: 2px;
              font-style: italic;
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
            #gmes-website-overlay .add-btn.already-added {
              background: #6c757d;
              cursor: default;
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
            <div style="display: flex; align-items: center; gap: 8px;">
              <img src="${chrome.runtime.getURL('icon.png')}" style="width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0;" alt="Logo">
              <span>Contact Info Scanner</span>
            </div>
            <button class="close-btn" id="gmes-close-btn">&times;</button>
          </div>
          <div class="content">
            <div class="section">
              <div class="section-label">📞 Phone Numbers</div>
              <div id="gmes-phones-list">${phonesHtml}</div>
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
            <button class="add-btn" id="gmes-add-btn">Add to List <span class="shortcut">(Alt+Shift+S)</span></button>
            <div id="gmes-crm-status" style="display:none; margin-top:6px; padding:5px 10px; border-radius:6px; font-size:13px; font-weight:600; text-align:center;"></div>
            <button id="gmes-crm-btn" style="display:none; width:100%; margin-top:6px; padding:10px; background:#6f42c1; color:white; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;">Send to CRM</button>
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
        const addBtn = document.getElementById('gmes-add-btn');

        addBtn.addEventListener('click', () => {
            const businessName = document.getElementById('gmes-name-input').value.trim();
            const noteInput = document.getElementById('gmes-note-input');
            const noteValue = noteInput.value.trim();

            if (!noteValue) {
                noteInput.classList.add('error');
                noteInput.focus();
                return;
            }
            noteInput.classList.remove('error');

            // Collect checked phone entries with their (possibly edited) labels
            const phonesList = document.getElementById('gmes-phones-list');
            const checkedPhones = [];
            if (phonesList) {
                phonesList.querySelectorAll('.phone-entry').forEach(function (entryEl) {
                    const cb = entryEl.querySelector('.phone-check');
                    if (cb && cb.checked) {
                        const labelInput = entryEl.querySelector('.phone-label-input');
                        checkedPhones.push({
                            number: cb.dataset.num,
                            label: labelInput ? labelInput.value.trim() : '',
                            location_name: '',
                            location_address: ''
                        });
                    }
                });
            }

            // Primary phone for backward-compat phone: string field (always phones[0].number)
            const primaryPhone = checkedPhones.length > 0
                ? checkedPhones[0].number
                : (data.phoneEntries && data.phoneEntries[0] ? data.phoneEntries[0].number : '');

            const item = {
                title: businessName || 'Unknown Business',
                closedStatus: '',
                rating: '0',
                reviewCount: '0',
                phone: primaryPhone,
                phones: checkedPhones,
                industry: '',
                expensiveness: '',
                city: '',
                address: data.addresses[0] || '',
                companyUrl: window.location.href,
                instaSearch: businessName
                    ? `https://www.google.com/search?q=${encodeURIComponent(businessName + ' Instagram')}`
                    : '',
                href: data.mapsLinks[0] || `https://www.google.com/maps/search/${encodeURIComponent(businessName + ' ' + (data.addresses[0] || ''))}`,
                note: noteValue
            };

            chrome.runtime.sendMessage({ type: 'MANUAL_ADD_ITEM', item: item }, (response) => {
                if (response && response.success) {
                    addBtn.textContent = '✓ Already in List';
                    addBtn.disabled = true;
                    addBtn.classList.add('already-added');
                }
            });
        });

        // Check if already added and update button state
        checkIfAlreadyAdded((alreadyExists) => {
            if (alreadyExists) {
                addBtn.textContent = '✓ Already in List';
                addBtn.disabled = true;
                addBtn.classList.add('already-added');
            }
        });

        // Check CRM status and wire Send to CRM button
        const crmStatusDiv = document.getElementById('gmes-crm-status');
        const crmBtn = document.getElementById('gmes-crm-btn');
        if (crmStatusDiv && crmBtn) {
            const primaryPhone = data.phones && data.phones.length ? data.phones[0] : '';
            pbCheckDuplicate_website(data.businessName, primaryPhone, (inCrm) => {
                if (inCrm) {
                    crmStatusDiv.textContent = '✓ Already in CRM';
                    crmStatusDiv.style.background = '#e8f5e9';
                    crmStatusDiv.style.color = '#34a853';
                    crmStatusDiv.style.display = 'block';
                } else {
                    crmBtn.style.display = 'block';
                    crmBtn.addEventListener('click', () => {
                        crmBtn.disabled = true;
                        crmBtn.textContent = 'Sending to CRM…';
                        const businessName = (document.getElementById('gmes-name-input') || {}).value || data.businessName;
                        const noteInput = document.getElementById('gmes-note-input');
                        const crmItem = {
                            title: businessName || 'Unknown Business',
                            phone: primaryPhone,
                            phones: (data.phones || []).map(function (p, i) { return { number: p, label: 'Main', location_name: '', location_address: '' }; }),
                            address: data.addresses && data.addresses[0] ? data.addresses[0] : '',
                            companyUrl: window.location.href,
                            href: data.mapsLinks && data.mapsLinks[0] ? data.mapsLinks[0] : '',
                            note: noteInput ? noteInput.value.trim() : ''
                        };
                        pbSendToCrm_website(crmItem, (result) => {
                            if (result.success) {
                                crmBtn.style.display = 'none';
                                crmStatusDiv.textContent = '✓ Synced to CRM';
                                crmStatusDiv.style.background = '#e8f5e9';
                                crmStatusDiv.style.color = '#34a853';
                                crmStatusDiv.style.display = 'block';
                            } else {
                                crmBtn.disabled = false;
                                crmBtn.textContent = 'Retry CRM Sync';
                                alert('CRM sync failed: ' + (result.error || 'Unknown error'));
                            }
                        });
                    });
                }
            });
        }

        // Listen for storage changes to update button state
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.gmes_results) {
                checkIfAlreadyAdded((alreadyExists) => {
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
        } else if (request.type === 'TOGGLE_OVERLAY') {
            const overlay = document.getElementById('gmes-website-overlay');
            if (overlay) {
                overlay.style.display = overlay.style.display === 'none' ? 'block' : 'none';
            }
        }
    });
})();
