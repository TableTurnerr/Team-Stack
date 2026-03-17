// manual_mode_website.js

// ============================================================================
// PocketBase CRM Helpers (inline)
// ============================================================================
function pbGetSettings_website(cb) {
    chrome.storage.local.get(['gmes_pb_url', 'gmes_pb_token'], function (data) {
        cb(data.gmes_pb_url || '', data.gmes_pb_token || '');
    });
}

// Extract user ID from PocketBase JWT token
function pbGetUserIdFromToken_website(token) {
    if (!token) return null;
    try {
        var parts = token.split('.');
        if (parts.length !== 3) return null;
        var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.id || null;
    } catch (e) { return null; }
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
                var phoneFilter = encodeURIComponent('phone_number="' + String(phone).replace(/\D/g, '') + '"');
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
        var userId = pbGetUserIdFromToken_website(pbToken);
        var phones = Array.isArray(item.phones) && item.phones.length ? item.phones : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
        var companyBody = JSON.stringify({
            company_name: item.title || '',
            company_location: (item.address || '') + (item.city ? ', ' + item.city : ''),
            google_maps_link: item.href || '',
            google_rating: item.rating || '',
            google_reviews_count: (item.reviewCount || '').replace(/[()]/g, ''),
            website: item.companyUrl || '',
            industry: item.industry || '',
            price_range: item.expensiveness || '',
            email: item.email || '',
            source: item.source || 'Website',
            contact_source: 'Extension - Manual Website',
            notes: item.note || '',
            status: ['Untouched']
        });
        fetch(pbUrl + '/api/collections/companies/records', { method: 'POST', headers: headers, body: companyBody })
            .then(function (r) {
                if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
                return r.json();
            })
            .then(function (compData) {
                var companyId = compData.id;
                var followUp = [];

                // Create company_notes record if note exists (with dedup check)
                if (item.note && userId) {
                    var noteCheckFilter = encodeURIComponent('company="' + companyId + '"&&note_type="pre_call"&&content="' + String(item.note).replace(/"/g, '') + '"');
                    followUp.push(
                        fetch(pbUrl + '/api/collections/company_notes/records?filter=' + noteCheckFilter + '&perPage=1', { headers: headers })
                            .then(function (r) { return r.json(); })
                            .then(function (d) {
                                if (d.totalItems === 0) {
                                    return fetch(pbUrl + '/api/collections/company_notes/records', {
                                        method: 'POST', headers: headers,
                                        body: JSON.stringify({ company: companyId, note_type: 'pre_call', content: item.note, created_by: userId })
                                    });
                                }
                            })
                            .catch(function () {
                                return fetch(pbUrl + '/api/collections/company_notes/records', {
                                    method: 'POST', headers: headers,
                                    body: JSON.stringify({ company: companyId, note_type: 'pre_call', content: item.note, created_by: userId })
                                });
                            })
                    );
                }

                // Create interaction for activity timeline
                var interactionBody = { company: companyId, channel: 'phone', direction: 'outbound', timestamp: new Date().toISOString(), summary: 'Lead added from website scraper extension' };
                if (userId) interactionBody.user = userId;
                followUp.push(fetch(pbUrl + '/api/collections/interactions/records', {
                    method: 'POST', headers: headers,
                    body: JSON.stringify(interactionBody)
                }));

                // Create phone number records
                phones.forEach(function (pe) {
                    var num = String(pe.number || '').replace(/\D/g, '');
                    if (!num) return;
                    followUp.push(fetch(pbUrl + '/api/collections/phone_numbers/records', {
                        method: 'POST', headers: headers,
                        body: JSON.stringify({ phone_number: num, company: companyId, label: pe.label || 'Main', location_name: pe.location_name || '', location_address: pe.location_address || '' })
                    }));
                });

                Promise.all(followUp).then(function () { cb({ success: true, recordId: companyId }); });
            })
            .catch(function (e) { cb({ success: false, error: e.message || String(e) }); });
    });
}
// ============================================================================
// CRM Confirmation Modal (website overlay)
// ============================================================================
function showCrmConfirmation_website(item, onConfirm) {
    var existing = document.getElementById('gmes-crm-confirm-modal');
    if (existing) existing.remove();

    function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    var phones = Array.isArray(item.phones) && item.phones.length ? item.phones : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
    var phonesDisplay = phones.map(function (p) {
        var d = String(p.number || '').replace(/\D/g, '');
        if (d.length === 11 && d[0] === '1') d = d.slice(1);
        var fmt = d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : (p.number || '');
        return esc(fmt) + (p.label ? ' (' + esc(p.label) + ')' : '') +
            (p.location_name ? ' — ' + esc(p.location_name) : '');
    }).join('<br>') || '<em>None</em>';

    var modal = document.createElement('div');
    modal.id = 'gmes-crm-confirm-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:Segoe UI,system-ui,sans-serif;';
    modal.innerHTML =
        '<div style="background:#fff;border-radius:14px;padding:0;max-width:440px;width:90%;max-height:80vh;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.25);">' +
        '<div style="background:linear-gradient(135deg,#1557b0 0%,#1a73e8 60%,#4285f4 100%);padding:13px 16px;color:white;font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px;">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' +
        'Confirm CRM Send</div>' +
        '<div style="padding:14px 16px;max-height:50vh;overflow-y:auto;font-size:13px;">' +
        '<table style="width:100%;border-collapse:collapse;">' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Company</td><td style="padding:5px 0;color:#202124;">' + esc(item.title || 'Unknown') + '</td></tr>' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Location</td><td style="padding:5px 0;color:#202124;">' + esc(item.address || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Phone(s)</td><td style="padding:5px 0;color:#202124;">' + phonesDisplay + '</td></tr>' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Email</td><td style="padding:5px 0;color:#202124;">' + esc(item.email || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Website</td><td style="padding:5px 0;color:#202124;word-break:break-all;">' + esc(item.companyUrl || window.location.href) + '</td></tr>' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Note</td><td style="padding:5px 0;color:#202124;white-space:pre-wrap;">' + esc(item.note || 'None') + '</td></tr>' +
        '</table></div>' +
        '<div style="padding:10px 16px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid #e8eaed;">' +
        '<button id="gmes-confirm-cancel" style="padding:8px 16px;border:1.5px solid #e2e5eb;border-radius:8px;background:#fff;color:#3c4043;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
        '<button id="gmes-confirm-send" style="padding:8px 16px;border:none;border-radius:8px;background:#1a73e8;color:white;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Confirm &amp; Send</button>' +
        '</div></div>';

    document.body.appendChild(modal);
    document.getElementById('gmes-confirm-cancel').addEventListener('click', function () { modal.remove(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.getElementById('gmes-confirm-send').addEventListener('click', function () {
        modal.remove();
        onConfirm();
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
              background: #ffffff;
              border-radius: 14px;
              box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1);
              z-index: 2147483647;
              font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
              font-size: 13.5px;
              border: 1px solid rgba(0,0,0,0.08);
              overflow: hidden;
            }
            #gmes-website-overlay .gmes-w-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 11px 14px;
              background: linear-gradient(135deg, #1557b0 0%, #1a73e8 60%, #4285f4 100%);
              color: white;
              font-weight: 600;
              font-size: 13.5px;
            }
            #gmes-website-overlay .gmes-w-header-left {
              display: flex;
              align-items: center;
              gap: 8px;
            }
            #gmes-website-overlay .gmes-w-header-logo {
              width: 22px;
              height: 22px;
              border-radius: 6px;
              flex-shrink: 0;
              box-shadow: 0 1px 4px rgba(0,0,0,0.2);
            }
            #gmes-website-overlay .gmes-w-header-actions {
              display: flex;
              gap: 4px;
              align-items: center;
            }
            #gmes-website-overlay .gmes-w-hbtn {
              background: rgba(255,255,255,0.15);
              border: 1px solid rgba(255,255,255,0.22);
              color: white;
              width: 28px;
              height: 28px;
              border-radius: 7px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              transition: background 0.15s;
              padding: 0;
              position: relative;
              flex-shrink: 0;
            }
            #gmes-website-overlay .gmes-w-hbtn:hover { background: rgba(255,255,255,0.28); }
            #gmes-website-overlay .gmes-w-hbtn svg { display: block; }
            #gmes-website-overlay .gmes-w-exception-tooltip {
              display: none;
              position: absolute;
              top: 34px;
              right: 0;
              background: rgba(30,30,40,0.92);
              color: white;
              font-size: 11px;
              padding: 5px 9px;
              border-radius: 6px;
              white-space: nowrap;
              pointer-events: none;
              z-index: 2147483648;
            }
            #gmes-website-overlay .gmes-w-hbtn:hover .gmes-w-exception-tooltip { display: block; }

            #gmes-website-overlay .gmes-w-content {
              padding: 14px 16px;
              max-height: 480px;
              overflow-y: auto;
            }
            #gmes-website-overlay .gmes-w-section { margin-bottom: 13px; }
            #gmes-website-overlay .gmes-w-section-label {
              font-weight: 700;
              color: #80868b;
              font-size: 10.5px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-bottom: 6px;
              display: flex;
              align-items: center;
              gap: 5px;
            }
            #gmes-website-overlay .info-item {
              color: #3c4043;
              padding: 3px 0;
              word-break: break-word;
              font-size: 13px;
            }
            #gmes-website-overlay .info-item.empty {
              color: #9aa0a6;
              font-style: italic;
              font-size: 12.5px;
            }
            #gmes-website-overlay .info-item a {
              color: #1a73e8;
              text-decoration: none;
            }
            #gmes-website-overlay .info-item a:hover { text-decoration: underline; }
            #gmes-website-overlay .phone-entry {
              margin-bottom: 6px;
              padding: 8px 10px;
              background: #f8f9fa;
              border-radius: 8px;
              border: 1px solid #e8eaed;
            }
            #gmes-website-overlay .phone-display {
              font-weight: 600;
              color: #202124;
            }
            #gmes-website-overlay .phone-label-input {
              width: 100%;
              padding: 5px 8px;
              border: 1.5px solid #e2e5eb;
              border-radius: 6px;
              font-size: 12px;
              color: #5f6368;
              box-sizing: border-box;
              margin-top: 4px;
              transition: border-color 0.15s;
            }
            #gmes-website-overlay .phone-label-input:focus {
              border-color: #1a73e8;
              outline: none;
            }
            #gmes-website-overlay .phone-location-hint {
              font-size: 11px;
              color: #9aa0a6;
              margin-top: 3px;
              font-style: italic;
            }
            #gmes-website-overlay .gmes-w-divider {
              height: 1px;
              background: #f1f3f4;
              margin: 10px 0;
            }
            #gmes-website-overlay .name-input {
              width: 100%;
              padding: 9px 12px;
              border: 1.5px solid #e2e5eb;
              border-radius: 8px;
              font-size: 13.5px;
              box-sizing: border-box;
              transition: border-color 0.15s;
              background: #fafafa;
              color: #202124;
              font-family: inherit;
            }
            #gmes-website-overlay .name-input:focus {
              border-color: #1a73e8;
              background: #fff;
              outline: none;
            }
            #gmes-website-overlay .gmes-w-add-btn {
              width: 100%;
              padding: 11px;
              background: #34a853;
              color: white;
              border: none;
              border-radius: 9px;
              font-size: 13.5px;
              font-weight: 700;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 7px;
              transition: background 0.18s, transform 0.12s, box-shadow 0.18s;
              font-family: inherit;
            }
            #gmes-website-overlay .gmes-w-add-btn:hover {
              background: #2b8c46;
              transform: translateY(-1px);
              box-shadow: 0 3px 10px rgba(52,168,83,0.28);
            }
            #gmes-website-overlay .gmes-w-add-btn:active { transform: translateY(0); box-shadow: none; }
            #gmes-website-overlay .gmes-w-add-btn:disabled {
              background: #e0e0e0;
              color: #9e9e9e;
              cursor: not-allowed;
              transform: none !important;
              box-shadow: none !important;
            }
            #gmes-website-overlay .gmes-w-add-btn.already-added {
              background: #5f6368;
              cursor: default;
            }
            #gmes-website-overlay .gmes-w-footer {
              display: flex;
              justify-content: flex-end;
              margin-top: 9px;
              font-size: 11px;
              color: #9aa0a6;
            }
            #gmes-website-overlay .gmes-w-settings-btn {
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 4px;
              color: #9aa0a6;
              background: none;
              border: none;
              font-family: inherit;
              font-size: 11px;
              padding: 0;
              transition: color 0.15s;
            }
            #gmes-website-overlay .gmes-w-settings-btn:hover { color: #5f6368; }
          </style>
          <div class="gmes-w-header">
            <div class="gmes-w-header-left">
              <img src="${chrome.runtime.getURL('icon.png')}" class="gmes-w-header-logo" alt="">
              <span>Contact Scanner</span>
            </div>
            <div class="gmes-w-header-actions">
              <div class="gmes-w-hbtn" id="gmes-exception-btn" title="Don't auto-open on this site">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span class="gmes-w-exception-tooltip">Add to exceptions<br>(won't auto-open here)</span>
              </div>
              <button class="gmes-w-hbtn" id="gmes-close-btn" title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          <div class="gmes-w-content">
            <div class="gmes-w-section">
              <div class="gmes-w-section-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.07 13.93 19.79 19.79 0 0 1 1 5.18C1 4.09 1.81 3 2.92 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 10.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 17.9v3z"/></svg>
                Phone Numbers
              </div>
              <div id="gmes-phones-list">${phonesHtml}</div>
            </div>
            <div class="gmes-w-section">
              <div class="gmes-w-section-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                Email Addresses
              </div>
              ${emailsHtml}
            </div>
            <div class="gmes-w-section">
              <div class="gmes-w-section-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                Address
              </div>
              ${addressHtml}
            </div>
            <div class="gmes-w-section">
              <div class="gmes-w-section-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                Google Maps
              </div>
              ${mapsHtml}
            </div>
            <div class="gmes-w-divider"></div>
            <div class="gmes-w-section">
              <div class="gmes-w-section-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                Business Name
              </div>
              <input type="text" class="name-input" id="gmes-name-input" value="${escapeHtml(data.businessName)}" placeholder="Enter business name">
            </div>
            <div class="gmes-w-section">
              <div class="gmes-w-section-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Note <span style="color:#ea4335;margin-left:2px;">*</span>
              </div>
              <textarea id="gmes-note-input" class="note-input" placeholder="Enter a note (required)"></textarea>
            </div>
            <button class="gmes-w-add-btn" id="gmes-add-btn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add to List <span style="font-size:11px;opacity:0.8;font-weight:400;">(Alt+Shift+S)</span>
            </button>
            <div id="gmes-crm-status" style="display:none; margin-top:8px; padding:7px 12px; border-radius:8px; font-size:13px; font-weight:600; text-align:center;"></div>
            <button id="gmes-crm-btn" style="display:none; width:100%; margin-top:8px; padding:10px; background:#6f42c1; color:white; border:none; border-radius:9px; font-size:13px; font-weight:700; cursor:pointer; font-family:inherit;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-right:6px;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              Send to CRM
            </button>
            <div class="gmes-w-footer">
              <button id="gmes-settings-btn" class="gmes-w-settings-btn" title="Change shortcuts">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                Configure Shortcuts
              </button>
            </div>
          </div>
        `;

        document.body.appendChild(overlay);

        const style = document.createElement('style');
        style.textContent = `
            #gmes-website-overlay .note-input {
                width: 100%;
                padding: 9px 11px;
                border: 1.5px solid #e2e5eb;
                border-radius: 8px;
                font-family: inherit;
                font-size: 13.5px;
                resize: vertical;
                min-height: 60px;
                box-sizing: border-box;
                margin-top: 4px;
                transition: border-color 0.18s;
                background: #fafafa;
                color: #202124;
            }
            #gmes-website-overlay .note-input.error {
                border-color: #ea4335;
                background-color: #fff8f7;
                outline: none;
            }
            #gmes-website-overlay .note-input:focus {
                border-color: #1a73e8;
                background: #fff;
                outline: none;
            }
        `;
        document.head.appendChild(style);

        // Close handler
        document.getElementById('gmes-close-btn').addEventListener('click', () => {
            overlay.remove();
            style.remove();
        });

        // Exception button handler — add current site to exceptions
        const exceptionBtn = document.getElementById('gmes-exception-btn');
        if (exceptionBtn) {
            exceptionBtn.addEventListener('click', () => {
                const hostname = window.location.hostname;
                chrome.runtime.sendMessage({ type: 'ADD_EXCEPTION_SITE', hostname: hostname }, () => {
                    overlay.remove();
                    style.remove();
                    const toast = document.createElement('div');
                    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(30,30,40,0.92);color:white;padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:2147483647;font-family:system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.22);';
                    toast.textContent = hostname + ' added to exceptions';
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 2800);
                });
            });
        }

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
                email: data.emails && data.emails.length > 0 ? data.emails[0] : '',
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
            const primaryPhone = data.phoneEntries && data.phoneEntries.length ? data.phoneEntries[0].number : '';
            pbCheckDuplicate_website(data.businessName, primaryPhone, (inCrm) => {
                if (inCrm) {
                    crmStatusDiv.textContent = '✓ Already in CRM';
                    crmStatusDiv.style.background = '#e8f5e9';
                    crmStatusDiv.style.color = '#34a853';
                    crmStatusDiv.style.display = 'block';
                } else {
                    crmBtn.style.display = 'flex';
                    crmBtn.addEventListener('click', () => {
                        const businessName = (document.getElementById('gmes-name-input') || {}).value || data.businessName;
                        const noteInput = document.getElementById('gmes-note-input');

                        // Collect checked phones from the overlay (respecting user's checkbox selections)
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
                        // Fallback to phoneEntries if no checkboxes found
                        const phonesToSend = checkedPhones.length > 0 ? checkedPhones : (data.phoneEntries || []);

                        const crmItem = {
                            title: businessName || 'Unknown Business',
                            phone: phonesToSend.length > 0 ? phonesToSend[0].number : '',
                            phones: phonesToSend,
                            address: data.addresses && data.addresses[0] ? data.addresses[0] : '',
                            companyUrl: window.location.href,
                            href: data.mapsLinks && data.mapsLinks[0] ? data.mapsLinks[0] : '',
                            email: data.emails && data.emails.length > 0 ? data.emails[0] : '',
                            source: 'Website',
                            note: noteInput ? noteInput.value.trim() : ''
                        };

                        // Show confirmation modal
                        showCrmConfirmation_website(crmItem, () => {
                            crmBtn.disabled = true;
                            crmBtn.textContent = 'Sending to CRM…';
                            pbSendToCrm_website(crmItem, (result) => {
                                if (result.success) {
                                    crmBtn.style.display = 'none';
                                    crmStatusDiv.textContent = '✓ Synced to CRM';
                                    crmStatusDiv.style.background = '#e8f5e9';
                                    crmStatusDiv.style.color = '#34a853';
                                    crmStatusDiv.style.display = 'block';
                                    // Auto-add to local list
                                    crmItem.crmSynced = true;
                                    crmItem.crmId = result.recordId;
                                    chrome.runtime.sendMessage({ type: 'MANUAL_ADD_ITEM', item: crmItem });
                                } else {
                                    crmBtn.disabled = false;
                                    crmBtn.textContent = 'Retry CRM Sync';
                                    alert('CRM sync failed: ' + (result.error || 'Unknown error'));
                                }
                            });
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
