// ============================================================================
// PocketBase CRM Helpers
// ============================================================================

function pbGetSettings(cb) {
    chrome.storage.local.get(['gmes_pb_url', 'gmes_pb_token'], function (data) {
        cb(data.gmes_pb_url || '', data.gmes_pb_token || '');
    });
}

function pbCheckCompanyStatus(name, phones, cb) {
    pbGetSettings(function (pbUrl, pbToken) {
        if (!pbUrl) { cb({ status: 'new' }); return; }
        var headers = {};
        if (pbToken) headers['Authorization'] = 'Bearer ' + pbToken;
        var nameFilter = encodeURIComponent('name~"' + String(name || '').replace(/"/g, '') + '"');
        fetch(pbUrl + '/api/collections/companies/records?filter=' + nameFilter + '&perPage=1', { headers: headers })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.totalItems === 0) {
                    var phoneNums = (Array.isArray(phones) ? phones : []).map(function (p) { return String(p.number || '').replace(/\D/g, ''); }).filter(Boolean);
                    if (!phoneNums.length) { cb({ status: 'new' }); return; }
                    var phoneFilter = encodeURIComponent(phoneNums.map(function (n) { return 'number="' + n + '"'; }).join('||'));
                    fetch(pbUrl + '/api/collections/phone_numbers/records?filter=' + phoneFilter + '&perPage=1', { headers: headers })
                        .then(function (r2) { return r2.json(); })
                        .then(function (d2) { cb({ status: d2.totalItems > 0 ? 'exists_same_phone' : 'new' }); })
                        .catch(function () { cb({ status: 'new' }); });
                    return;
                }
                var companyId = d.items[0].id;
                var phoneNums = (Array.isArray(phones) ? phones : []).map(function (p) { return String(p.number || '').replace(/\D/g, ''); }).filter(Boolean);
                if (!phoneNums.length) { cb({ status: 'exists_same_phone', companyId: companyId }); return; }
                var phoneFilter = encodeURIComponent('company="' + companyId + '"&&(' + phoneNums.map(function (n) { return 'number="' + n + '"'; }).join('||') + ')');
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
            var phoneBody = JSON.stringify({ number: num, company: companyId, label: pe.label || 'Main', location_name: pe.location_name || '', location_address: pe.location_address || '' });
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
        var phones = Array.isArray(item.phones) && item.phones.length ? item.phones : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
        var companyBody = JSON.stringify({
            name: item.title || '',
            website: item.companyUrl || '',
            address: item.address || '',
            city: item.city || '',
            industry: item.industry || '',
            rating: item.rating || '',
            maps_url: item.href || '',
            note: item.note || ''
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
    exportBtn.addEventListener('click', () => {
        try {
            const headers = Array.from(table.querySelectorAll('thead th'));
            const rows = Array.from(table.querySelectorAll('tbody tr'));

            let html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>';
            html += '<table border="1" style="border-collapse:collapse;">';

            // Headers
            html += '<thead><tr>';
            headers.forEach(h => { html += '<th>' + (h.innerText || '') + '</th>'; });
            html += '</tr></thead>';

            // Body
            html += '<tbody>';
            rows.forEach(tr => {
                html += '<tr>';
                const cols = Array.from(tr.querySelectorAll('td'));
                cols.forEach(td => {
                    // Use innerText to get the plain text (URLs) and remove anchor tags for the sheet
                    const cellText = td.innerText || '';
                    html += '<td>' + cellText + '</td>';
                });
                html += '</tr>';
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