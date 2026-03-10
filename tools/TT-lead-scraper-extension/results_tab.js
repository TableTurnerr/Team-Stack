// ============================================================================
// PocketBase CRM Helpers
// ============================================================================

function pbGetSettings(cb) {
    chrome.storage.local.get(['gmes_pb_url', 'gmes_pb_token'], function (data) {
        cb(data.gmes_pb_url || '', data.gmes_pb_token || '');
    });
}

// Extract user ID from PocketBase JWT token
function pbGetUserIdFromToken(token) {
    if (!token) return null;
    try {
        var parts = token.split('.');
        if (parts.length !== 3) return null;
        var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.id || null;
    } catch (e) { return null; }
}

function pbCheckCompanyStatus(name, phones, cb) {
    pbGetSettings(function (pbUrl, pbToken) {
        if (!pbUrl) { cb({ status: 'new' }); return; }
        var headers = {};
        if (pbToken) headers['Authorization'] = 'Bearer ' + pbToken;
        var nameFilter = encodeURIComponent('company_name~"' + String(name || '').replace(/"/g, '') + '"');
        fetch(pbUrl + '/api/collections/companies/records?filter=' + nameFilter + '&perPage=1', { headers: headers })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.totalItems === 0) {
                    var phoneNums = (Array.isArray(phones) ? phones : []).map(function (p) { return String(p.number || '').replace(/\D/g, ''); }).filter(Boolean);
                    if (!phoneNums.length) { cb({ status: 'new' }); return; }
                    var phoneFilter = encodeURIComponent(phoneNums.map(function (n) { return 'phone_number="' + n + '"'; }).join('||'));
                    fetch(pbUrl + '/api/collections/phone_numbers/records?filter=' + phoneFilter + '&perPage=1', { headers: headers })
                        .then(function (r2) { return r2.json(); })
                        .then(function (d2) { cb({ status: d2.totalItems > 0 ? 'exists_same_phone' : 'new' }); })
                        .catch(function () { cb({ status: 'new' }); });
                    return;
                }
                var companyId = d.items[0].id;
                var phoneNums = (Array.isArray(phones) ? phones : []).map(function (p) { return String(p.number || '').replace(/\D/g, ''); }).filter(Boolean);
                if (!phoneNums.length) { cb({ status: 'exists_same_phone', companyId: companyId }); return; }
                var phoneFilter = encodeURIComponent('company="' + companyId + '"&&(' + phoneNums.map(function (n) { return 'phone_number="' + n + '"'; }).join('||') + ')');
                fetch(pbUrl + '/api/collections/phone_numbers/records?filter=' + phoneFilter + '&perPage=1', { headers: headers })
                    .then(function (r2) { return r2.json(); })
                    .then(function (d2) {
                        cb(d2.totalItems > 0
                            ? { status: 'exists_same_phone', companyId: companyId }
                            : { status: 'exists_new_phone', companyId: companyId });
                    })
                    .catch(function () { cb({ status: 'exists_same_phone', companyId: companyId }); });
            })
            .catch(function () { cb({ status: 'new' }); });
    });
}

function pbAddPhoneToCompany(companyId, phones, cb) {
    pbGetSettings(function (pbUrl, pbToken) {
        if (!pbUrl) { cb({ success: false, error: 'No PocketBase URL configured. Set it in \u2699 CRM Settings in the popup.' }); return; }
        var headers = { 'Content-Type': 'application/json' };
        if (pbToken) headers['Authorization'] = 'Bearer ' + pbToken;
        var phoneList = Array.isArray(phones) ? phones : [];
        if (!phoneList.length) { cb({ success: true }); return; }
        var phonePromises = phoneList.map(function (pe) {
            var num = String(pe.number || '').replace(/\D/g, '');
            if (!num) return Promise.resolve();
            var phoneBody = JSON.stringify({ phone_number: num, company: companyId, label: pe.label || 'Main', location_name: pe.location_name || '', location_address: pe.location_address || '' });
            return fetch(pbUrl + '/api/collections/phone_numbers/records', { method: 'POST', headers: headers, body: phoneBody });
        });
        Promise.all(phonePromises)
            .then(function () { cb({ success: true }); })
            .catch(function (e) { cb({ success: false, error: e.message || String(e) }); });
    });
}

function pbSendToCrm(item, cb) {
    pbGetSettings(function (pbUrl, pbToken) {
        if (!pbUrl) { cb({ success: false, error: 'No PocketBase URL configured. Set it in \u2699 CRM Settings in the popup.' }); return; }
        var headers = { 'Content-Type': 'application/json' };
        if (pbToken) headers['Authorization'] = 'Bearer ' + pbToken;
        var userId = pbGetUserIdFromToken(pbToken);
        var phones = Array.isArray(item.phones) && item.phones.length ? item.phones : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
        var companyBody = JSON.stringify({
            company_name: item.title || '',
            company_location: (item.address || '') + (item.city ? ', ' + item.city : ''),
            google_maps_link: item.href || '',
            google_rating: item.rating || '',
            google_reviews_count: (item.reviewCount || '').replace(/[()]/g, ''),
            source: 'Google Maps',
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
                var interactionBody = { company: companyId, channel: 'phone', direction: 'outbound', timestamp: new Date().toISOString(), summary: 'Lead added from Google Maps scraper extension' };
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
// End of PocketBase CRM Helpers
// ============================================================================

// ============================================================================
// Phone Normalization Helpers
// ============================================================================

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

// ============================================================================
// End of Phone Normalization Helpers
// ============================================================================

// ============================================================================
// CRM Confirmation Modal (results tab)
// ============================================================================
function escapeHtmlModal(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showCrmConfirmation(item, onConfirm) {
    var existing = document.getElementById('gmes-crm-confirm-modal');
    if (existing) existing.remove();

    var phones = Array.isArray(item.phones) && item.phones.length ? item.phones : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
    var phonesDisplay = phones.map(function (p) {
        return formatPhoneDisplay(p.number || '') + (p.label ? ' (' + p.label + ')' : '') +
            (p.location_name ? ' — ' + p.location_name : '') +
            (p.location_address ? ', ' + p.location_address : '');
    }).join('<br>') || '<em>None</em>';

    var modal = document.createElement('div');
    modal.id = 'gmes-crm-confirm-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:Poppins,sans-serif;';
    modal.innerHTML =
        '<div style="background:#fff;border-radius:14px;padding:0;max-width:520px;width:90%;max-height:80vh;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.25);border:1.5px solid #e2e5eb;">' +
        '<div style="background:linear-gradient(135deg,#1557b0 0%,#1a73e8 60%,#4285f4 100%);padding:14px 18px;color:white;font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px;">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' +
        'Confirm CRM Send</div>' +
        '<div style="padding:16px 18px;max-height:50vh;overflow-y:auto;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Company</td><td style="padding:6px 0;color:#202124;">' + escapeHtmlModal(item.title || 'Unknown') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Location</td><td style="padding:6px 0;color:#202124;">' + escapeHtmlModal((item.address || '') + (item.city ? ', ' + item.city : '') || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Phone(s)</td><td style="padding:6px 0;color:#202124;">' + phonesDisplay + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Rating</td><td style="padding:6px 0;color:#202124;">' + escapeHtmlModal(item.rating || '0') + ' \u2605 ' + escapeHtmlModal((item.reviewCount || '').replace(/[()]/g, '')) + ' reviews</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Website</td><td style="padding:6px 0;color:#202124;word-break:break-all;">' + escapeHtmlModal(item.companyUrl || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Note</td><td style="padding:6px 0;color:#202124;white-space:pre-wrap;">' + escapeHtmlModal(item.note || 'None') + '</td></tr>' +
        '</table></div>' +
        '<div style="padding:12px 18px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid #e2e5eb;">' +
        '<button id="gmes-confirm-cancel" style="padding:8px 18px;border:1.5px solid #e2e5eb;border-radius:8px;background:#fff;color:#3c4043;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
        '<button id="gmes-confirm-send" style="padding:8px 18px;border:none;border-radius:8px;background:#1a73e8;color:white;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Confirm &amp; Send</button>' +
        '</div></div>';

    document.body.appendChild(modal);
    document.getElementById('gmes-confirm-cancel').addEventListener('click', function () { modal.remove(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.getElementById('gmes-confirm-send').addEventListener('click', function () {
        modal.remove();
        onConfirm();
    });
}

document.addEventListener('DOMContentLoaded', function () {
    const table = document.getElementById('resultsTable');
    const tbody = table.querySelector('tbody');
    const stats = document.getElementById('stats');
    const exportBtn = document.getElementById('exportBtn');
    
    // Ignore lists
    let ignoreNamesSet = new Set();
    let ignoreIndustriesSet = new Set();
    // All items (module-level) so CRM sync can persist back to storage
    let allItems = [];

    function loadData() {
        chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries'], function (data) {
            // Update ignore sets
            ignoreNamesSet.clear();
            (data.gmes_ignore_names || []).forEach(s => ignoreNamesSet.add(String(s).toLowerCase().trim()));

            ignoreIndustriesSet.clear();
            (data.gmes_ignore_industries || []).forEach(s => ignoreIndustriesSet.add(String(s).toLowerCase().trim()));

            allItems = Array.isArray(data.gmes_results) ? data.gmes_results : [];
            renderTable(allItems);
        });
    }

    function itemIsIgnored(item) {
        if (!item) return false;
        if (item.title) {
            const title = String(item.title).toLowerCase();
            for (let ig of ignoreNamesSet) {
                if (!ig) continue;
                if (title === ig || title.includes(ig)) return true;
            }
        }
        if (item.industry) {
            const industry = String(item.industry).toLowerCase();
            for (let ig of ignoreIndustriesSet) {
                if (!ig) continue;
                if (industry === ig || industry.includes(ig)) return true;
            }
        }
        return false;
    }

    function renderTable(items) {
        tbody.innerHTML = '';
        let count = 0;
        const seen = new Set();

        items.forEach(item => {
            const key = item.href || (item.title + '|' + item.address);
            if (!key || seen.has(key)) return;
            if (itemIsIgnored(item)) return;
            
            seen.add(key);
            count++;
            
            const tr = document.createElement('tr');
            
            // Columns matching popup.js order
            const cols = ['title', 'note', 'closedStatus', 'rating', 'reviewCount', 'phone', 'industry', 'expensiveness', 'city', 'address', 'companyUrl', 'instaSearch', 'href', 'crmStatus'];
            
            cols.forEach(colKey => {
                const td = document.createElement('td');
                const val = item[colKey] || '';
                
                if (colKey === 'companyUrl') {
                   let finalUrl = val;
                   if (!val || val.startsWith('https://www.google.com/maps')) {
                       finalUrl = `https://www.google.com/search?q=${encodeURIComponent((item.title || '') + ' ' + (item.city || '') + ' Website')}`;
                   }
                   td.innerHTML = `<a href="${finalUrl}" target="_blank">${finalUrl}</a>`;
                } else if (colKey === 'href') {
                    if (val) td.innerHTML = `<a href="${val}" target="_blank">${val}</a>`;
                } else if (colKey === 'instaSearch') {
                    if (val) td.innerHTML = `<a href="${val}" target="_blank">${val}</a>`;
                } else if (colKey === 'reviewCount') {
                    td.textContent = val.replace(/[()]/g, '');
                } else if (colKey === 'phone') {
                    if (item.phones && item.phones.length > 0) {
                        const primary = formatPhoneDisplay(item.phones[0].number);
                        if (item.phones.length > 1) {
                            const extra = item.phones.length - 1;
                            const tooltip = item.phones.slice(1).map(p => formatPhoneDisplay(p.number)).join(', ');
                            td.innerHTML = `${primary} <span style="color:#4285f4;font-size:11px;cursor:help;" title="${tooltip}">(+${extra} more)</span>`;
                        } else {
                            td.textContent = primary;
                        }
                    } else {
                        const norm = normalizePhone(val);
                        td.textContent = norm ? formatPhoneDisplay(norm) : val;
                    }
                } else if (colKey === 'crmStatus') {
                    if (item.crmSynced) {
                        td.textContent = '\u2713 Synced';
                        td.style.color = '#34a853';
                        td.style.fontWeight = '600';
                    } else if (item.crmPhoneAdded) {
                        td.textContent = '\u2713 Phone Added';
                        td.style.color = '#34a853';
                        td.style.fontWeight = '600';
                    } else {
                        const btn = document.createElement('button');
                        if (item.crmExistingId) {
                            btn.textContent = 'Add New Phone +';
                            btn.style.cssText = 'padding: 4px 10px; font-size: 12px; background: #ff9800; color: white; border: none; border-radius: 12px; cursor: pointer;';
                        } else {
                            btn.textContent = 'Send to CRM';
                            btn.style.cssText = 'padding: 4px 10px; font-size: 12px; background: #007BFF; color: white; border: none; border-radius: 12px; cursor: pointer;';
                        }
                        // Async CRM check — update button if company exists with a different phone
                        if (!item.crmExistingId && !item.crmChecked) {
                            item.crmChecked = true;
                            const checkPhones = Array.isArray(item.phones) && item.phones.length
                                ? item.phones
                                : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
                            pbCheckCompanyStatus(item.title, checkPhones, (statusResult) => {
                                if (statusResult.status === 'exists_new_phone') {
                                    item.crmExistingId = statusResult.companyId;
                                    btn.textContent = 'Add New Phone +';
                                    btn.style.cssText = 'padding: 4px 10px; font-size: 12px; background: #ff9800; color: white; border: none; border-radius: 12px; cursor: pointer;';
                                    chrome.storage.local.set({ gmes_results: allItems });
                                } else if (statusResult.status === 'exists_same_phone') {
                                    item.crmSynced = true;
                                    if (statusResult.companyId) item.crmId = statusResult.companyId;
                                    td.innerHTML = '';
                                    td.textContent = '\u2713 In CRM';
                                    td.style.color = '#34a853';
                                    td.style.fontWeight = '600';
                                    chrome.storage.local.set({ gmes_results: allItems });
                                }
                            });
                        }
                        btn.addEventListener('click', () => {
                            showCrmConfirmation(item, () => {
                                if (item.crmExistingId) {
                                    btn.disabled = true;
                                    btn.textContent = 'Adding\u2026';
                                    const addPhones = Array.isArray(item.phones) && item.phones.length
                                        ? item.phones
                                        : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
                                    pbAddPhoneToCompany(item.crmExistingId, addPhones, (result) => {
                                        if (result.success) {
                                            item.crmPhoneAdded = true;
                                            td.innerHTML = '';
                                            td.textContent = '\u2713 Phone Added';
                                            td.style.color = '#34a853';
                                            td.style.fontWeight = '600';
                                            chrome.storage.local.set({ gmes_results: allItems });
                                        } else {
                                            btn.disabled = false;
                                            btn.textContent = 'Add New Phone +';
                                            alert('Failed to add phone: ' + (result.error || 'Unknown error'));
                                        }
                                    });
                                } else {
                                    btn.disabled = true;
                                    btn.textContent = 'Sending\u2026';
                                    pbSendToCrm(item, (result) => {
                                        if (result.success) {
                                            item.crmSynced = true;
                                            if (result.recordId) item.crmId = result.recordId;
                                            td.innerHTML = '';
                                            td.textContent = '\u2713 Synced';
                                            td.style.color = '#34a853';
                                            td.style.fontWeight = '600';
                                            chrome.storage.local.set({ gmes_results: allItems });
                                        } else {
                                            btn.disabled = false;
                                            btn.textContent = 'Retry';
                                            alert('CRM sync failed: ' + (result.error || 'Unknown error'));
                                        }
                                    });
                                }
                            });
                        });
                        td.appendChild(btn);
                    }
                } else {
                    td.textContent = val;
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        
        stats.textContent = `Total Leads: ${count}`;
    }

    // Initial load
    loadData();

    // Live updates
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.gmes_results || changes.gmes_ignore_names || changes.gmes_ignore_industries)) {
            loadData();
        }
    });

    // Export functionality - HTML-based .xls for link preservation
    // Multi-location: items with multiple phones get expanded into separate rows,
    // repeating the company name so each phone/location has its own row.
    exportBtn.addEventListener('click', () => {
        try {
            const headerLabels = ['Title', 'Note', 'Closed Status', 'Rating', 'Reviews', 'Phone', 'Phone Label', 'Location Name', 'Location Address', 'Industry', 'Expensiveness', 'City', 'Address', 'Website', 'Insta Search', 'Google Maps Link', 'CRM Status'];

            let html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>';
            html += '<table border="1" style="border-collapse:collapse;">';
            html += '<thead><tr>';
            headerLabels.forEach(h => { html += '<th>' + h + '</th>'; });
            html += '</tr></thead><tbody>';

            const seen = new Set();
            allItems.forEach(item => {
                const key = item.href || (item.title + '|' + item.address);
                if (!key || seen.has(key)) return;
                seen.add(key);

                const phones = Array.isArray(item.phones) && item.phones.length
                    ? item.phones
                    : (item.phone ? [{ number: item.phone, label: 'Main', location_name: '', location_address: '' }] : [{ number: '', label: '', location_name: '', location_address: '' }]);

                const crmStatus = item.crmSynced ? 'Synced' : (item.crmPhoneAdded ? 'Phone Added' : '');
                const websiteUrl = item.companyUrl && !item.companyUrl.startsWith('https://www.google.com/maps')
                    ? item.companyUrl
                    : 'https://www.google.com/search?q=' + encodeURIComponent((item.title || '') + ' ' + (item.city || '') + ' Website');

                phones.forEach(p => {
                    html += '<tr>';
                    html += '<td>' + escapeHtmlModal(item.title || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.note || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.closedStatus || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.rating || '') + '</td>';
                    html += '<td>' + escapeHtmlModal((item.reviewCount || '').replace(/[()]/g, '')) + '</td>';
                    html += '<td>' + escapeHtmlModal(p.number ? formatPhoneDisplay(p.number) : '') + '</td>';
                    html += '<td>' + escapeHtmlModal(p.label || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(p.location_name || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(p.location_address || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.industry || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.expensiveness || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.city || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.address || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(websiteUrl) + '</td>';
                    html += '<td>' + escapeHtmlModal(item.instaSearch || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.href || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(crmStatus) + '</td>';
                    html += '</tr>';
                });
            });

            html += '</tbody></table></body></html>';

            const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'google-maps-data.xls';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        } catch (e) {
            console.error('Failed to export XLS', e);
            alert('Export failed: ' + (e && e.message ? e.message : e));
        }
    });
});