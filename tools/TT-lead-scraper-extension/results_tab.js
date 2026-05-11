// ============================================================================
// Chain-Name Blocklist Matcher (mirrors background.js)
// ============================================================================

function normalizeChainName(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/['\u2018\u2019]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function chainPhraseMatches(text, phrase) {
    if (!text || !phrase) return false;
    if (text === phrase) return true;
    if (text.indexOf(phrase + ' ') === 0) return true;
    var tail = ' ' + phrase;
    if (text.length >= tail.length && text.lastIndexOf(tail) === text.length - tail.length) return true;
    if (text.indexOf(' ' + phrase + ' ') !== -1) return true;
    return false;
}

var CHAIN_LOCATION_WORDS = new Set([
    'manhattan', 'brooklyn', 'queens', 'bronx', 'staten',
    'midtown', 'downtown', 'uptown', 'soho', 'noho', 'tribeca',
    'chelsea', 'harlem', 'flatiron', 'gramercy', 'bowery', 'meatpacking',
    'east', 'west', 'north', 'south', 'central', 'side', 'village',
    'square', 'park', 'plaza', 'heights', 'hill', 'hills', 'district',
    'lower', 'upper', 'mid', 'far',
    'nyc', 'ny', 'la', 'sf', 'dc', 'chicago', 'boston', 'austin', 'miami',
    'st', 'street', 'ave', 'avenue', 'blvd'
]);

function hasTrailingLocationWord(words) {
    for (var i = 1; i < words.length; i++) {
        if (CHAIN_LOCATION_WORDS.has(words[i])) return true;
    }
    return false;
}

function chainNameMatchesIgnoreList(name, ignoreSet) {
    if (!name || !ignoreSet || !ignoreSet.size) return false;
    var t = normalizeChainName(name);
    if (!t) return false;
    for (var ig of ignoreSet) {
        if (!ig) continue;
        var b = normalizeChainName(ig);
        if (!b) continue;
        if (chainPhraseMatches(t, b)) return true;
        var words = b.split(' ');
        if (words.length > 1 && hasTrailingLocationWord(words)) {
            var firstWord = words[0];
            if (firstWord.length >= 4 && chainPhraseMatches(t, firstWord)) return true;
        }
    }
    return false;
}

function industryMatchesIgnoreList(industry, ignoreSet) {
    if (!industry || !ignoreSet || !ignoreSet.size) return false;
    var s = String(industry).toLowerCase();
    for (var ig of ignoreSet) {
        if (!ig) continue;
        if (s === ig || s.indexOf(ig) !== -1) return true;
    }
    return false;
}

// ============================================================================
// PocketBase CRM Helpers
// ============================================================================

function pbGetSettings(cb) {
    chrome.storage.local.get(['gmes_pb_url', 'gmes_pb_token'], function (data) {
        cb(data.gmes_pb_url || '', data.gmes_pb_token || '');
    });
}

function pbIsLoggedIn(cb) {
    pbGetSettings(function (pbUrl, pbToken) {
        cb(Boolean(pbUrl && pbToken));
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

// Lead categories cache helper. Reads cached list (refreshed by popup.js) and
// optionally fetches in the background if cache is stale or empty.
var LEAD_CATEGORY_TTL_MS = 5 * 60 * 1000;
function pbFetchLeadCategories(forceRefresh, cb) {
    chrome.storage.local.get(['gmes_lead_categories_cache', 'gmes_lead_categories_ts'], function (data) {
        var cached = Array.isArray(data.gmes_lead_categories_cache) ? data.gmes_lead_categories_cache : [];
        var fresh = data.gmes_lead_categories_ts && (Date.now() - data.gmes_lead_categories_ts < LEAD_CATEGORY_TTL_MS);
        if (cached.length && !forceRefresh && fresh) { cb(cached); return; }
        pbGetSettings(function (pbUrl, pbToken) {
            if (!pbUrl || !pbToken) { cb(cached); return; }
            var headers = { 'Authorization': 'Bearer ' + pbToken };
            fetch(pbUrl + '/api/collections/lead_categories/records?perPage=200&sort=name', { headers: headers })
                .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
                .then(function (d) {
                    var items = Array.isArray(d.items) ? d.items.map(function (i) { return { id: i.id, name: i.name }; }) : cached;
                    chrome.storage.local.set({ gmes_lead_categories_cache: items, gmes_lead_categories_ts: Date.now() });
                    cb(items);
                })
                .catch(function () { cb(cached); });
        });
    });
}

// Teammates cache helper.
var TEAMMATES_TTL_MS = 5 * 60 * 1000;
function pbFetchTeammates(forceRefresh, cb) {
    chrome.storage.local.get(['gmes_teammates_cache', 'gmes_teammates_ts'], function (data) {
        var cached = Array.isArray(data.gmes_teammates_cache) ? data.gmes_teammates_cache : [];
        var fresh = data.gmes_teammates_ts && (Date.now() - data.gmes_teammates_ts < TEAMMATES_TTL_MS);
        if (cached.length && !forceRefresh && fresh) { cb(cached); return; }
        pbGetSettings(function (pbUrl, pbToken) {
            if (!pbUrl || !pbToken) { cb(cached); return; }
            var headers = { 'Authorization': 'Bearer ' + pbToken };
            fetch(pbUrl + '/api/collections/users/records?perPage=200&sort=name&fields=id,name,email', { headers: headers })
                .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
                .then(function (d) {
                    var items = Array.isArray(d.items) ? d.items.map(function (i) { return { id: i.id, name: i.name || i.email || i.id, email: i.email || '' }; }) : cached;
                    chrome.storage.local.set({ gmes_teammates_cache: items, gmes_teammates_ts: Date.now() });
                    cb(items);
                })
                .catch(function () { cb(cached); });
        });
    });
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
        var websiteUrl = item.companyUrl || '';
        if (websiteUrl && websiteUrl.indexOf('https://www.google.com/maps') === 0) websiteUrl = '';
        var companyPayload = {
            company_name: item.title || '',
            company_location: (item.address || '') + (item.city ? ', ' + item.city : ''),
            google_maps_link: item.href || '',
            google_rating: item.rating || '',
            google_reviews_count: (item.reviewCount || '').replace(/[()]/g, ''),
            website: websiteUrl,
            industry: item.industry || '',
            price_range: item.expensiveness || '',
            email: item.email || '',
            source: 'Google Maps',
            contact_source: 'Extension - Scraper',
            notes: item.note || '',
            status: ['Untouched']
        };
        if (item.lead_category) companyPayload.lead_category = item.lead_category;
        if (item.assigned_to) companyPayload.assigned_to = item.assigned_to;
        var companyBody = JSON.stringify(companyPayload);
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
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Lead Category</td><td style="padding:6px 0;color:#202124;">' +
        '<select id="gmes-confirm-category" style="width:100%;padding:6px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
        '<option value="">\u2014 None \u2014</option></select></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Assign To</td><td style="padding:6px 0;color:#202124;">' +
        '<select id="gmes-confirm-assignee" style="width:100%;padding:6px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
        '<option value="">\u2014 Unassigned (new-lead pool) \u2014</option></select>' +
        '<div style="font-size:11px;color:#5f6368;margin-top:4px;">Picking a teammate routes the lead straight to them.</div></td></tr>' +
        '</table></div>' +
        '<div style="padding:12px 18px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid #e2e5eb;">' +
        '<button id="gmes-confirm-cancel" style="padding:8px 18px;border:1.5px solid #e2e5eb;border-radius:8px;background:#fff;color:#3c4043;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
        '<button id="gmes-confirm-send" style="padding:8px 18px;border:none;border-radius:8px;background:#1a73e8;color:white;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Confirm &amp; Send</button>' +
        '</div></div>';

    document.body.appendChild(modal);

    var categorySelect = document.getElementById('gmes-confirm-category');
    pbFetchLeadCategories(false, function (cats) {
        chrome.storage.local.get(['gmes_default_lead_category'], function (data) {
            var preselect = item.lead_category || data.gmes_default_lead_category || '';
            (cats || []).forEach(function (c) {
                var opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name;
                if (c.id === preselect) opt.selected = true;
                categorySelect.appendChild(opt);
            });
        });
    });

    var assigneeSelect = document.getElementById('gmes-confirm-assignee');
    pbFetchTeammates(false, function (mates) {
        chrome.storage.local.get(['gmes_default_assigned_to'], function (data) {
            var preselect = item.assigned_to || data.gmes_default_assigned_to || '';
            (mates || []).forEach(function (m) {
                var opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.name + (m.email ? ' (' + m.email + ')' : '');
                if (m.id === preselect) opt.selected = true;
                assigneeSelect.appendChild(opt);
            });
        });
    });

    document.getElementById('gmes-confirm-cancel').addEventListener('click', function () { modal.remove(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.getElementById('gmes-confirm-send').addEventListener('click', function () {
        item.lead_category = categorySelect.value || '';
        item.assigned_to = assigneeSelect.value || '';
        modal.remove();
        onConfirm();
    });
}

document.addEventListener('DOMContentLoaded', function () {
    const table = document.getElementById('resultsTable');
    const tbody = table.querySelector('tbody');
    const stats = document.getElementById('stats');
    const exportBtn = document.getElementById('exportBtn');
    const sendAllBtn = document.getElementById('sendAllBtn');
    const sendAllCount = document.getElementById('sendAllCount');

    // Ignore lists
    let ignoreNamesSet = new Set();
    let ignoreIndustriesSet = new Set();
    // All items (module-level) so CRM sync can persist back to storage
    let allItems = [];
    // Map href/key -> { row, statusCell, statusBtn } so bulk-send can update rows live
    const rowIndex = new Map();

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
        if (chainNameMatchesIgnoreList(item.title, ignoreNamesSet)) return true;
        if (industryMatchesIgnoreList(item.industry, ignoreIndustriesSet)) return true;
        return false;
    }

    function itemKey(item) {
        return item.href || (item.title + '|' + item.address);
    }

    function isSendable(item) {
        if (!item) return false;
        if (item.crmSynced || item.crmPhoneAdded) return false;
        if (itemIsIgnored(item)) return false;
        return true;
    }

    function refreshSendAllButton() {
        const pending = allItems.filter(isSendable).length;
        if (sendAllCount) sendAllCount.textContent = String(pending);
        if (!sendAllBtn) return;
        pbIsLoggedIn(loggedIn => {
            sendAllBtn.disabled = !loggedIn || pending === 0;
            if (!loggedIn) sendAllBtn.title = 'Login to TableTurnerr CRM first (use the extension popup → Connect)';
            else if (pending === 0) sendAllBtn.title = 'No un-synced leads to send';
            else sendAllBtn.title = `Send ${pending} un-synced lead${pending === 1 ? '' : 's'} to CRM`;
        });
    }

    function markRowSynced(item) {
        const entry = rowIndex.get(itemKey(item));
        if (!entry) return;
        const td = entry.statusCell;
        td.innerHTML = '';
        td.textContent = '✓ Synced';
        td.style.color = '#34a853';
        td.style.fontWeight = '600';
    }

    function markRowPhoneAdded(item) {
        const entry = rowIndex.get(itemKey(item));
        if (!entry) return;
        const td = entry.statusCell;
        td.innerHTML = '';
        td.textContent = '✓ Phone Added';
        td.style.color = '#34a853';
        td.style.fontWeight = '600';
    }

    function markRowSending(item, label) {
        const entry = rowIndex.get(itemKey(item));
        if (!entry) return;
        const td = entry.statusCell;
        td.innerHTML = '';
        td.textContent = label || 'Sending…';
        td.style.color = '#1a73e8';
        td.style.fontWeight = '600';
    }

    function markRowFailed(item, msg) {
        const entry = rowIndex.get(itemKey(item));
        if (!entry) return;
        const td = entry.statusCell;
        td.innerHTML = '';
        const span = document.createElement('span');
        span.textContent = '✗ Failed';
        span.style.color = '#ea4335';
        span.style.fontWeight = '600';
        span.title = msg || 'Send failed';
        td.appendChild(span);
    }

    function renderTable(items) {
        tbody.innerHTML = '';
        rowIndex.clear();
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
                        // Disable Send to CRM and show a Login link when not connected to CRM
                        ((targetBtn, targetCell) => {
                            pbIsLoggedIn((loggedIn) => {
                                if (loggedIn) return;
                                targetBtn.disabled = true;
                                targetBtn.title = 'Login to TableTurnerr CRM to enable';
                                targetBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; background: #e8eaed; color: #80868b; border: none; border-radius: 12px; cursor: not-allowed;';
                                const loginLink = document.createElement('a');
                                loginLink.href = '#';
                                loginLink.textContent = 'Login to CRM';
                                loginLink.style.cssText = 'display:block; margin-top:4px; font-size:11px; color:#1a73e8; text-decoration:underline; font-weight:600;';
                                loginLink.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    chrome.runtime.sendMessage({ type: 'OPEN_CRM_LOGIN' });
                                });
                                targetCell.appendChild(loginLink);
                            });
                        })(btn, td);
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
                if (colKey === 'crmStatus') {
                    rowIndex.set(key, { row: tr, statusCell: td });
                }
            });
            tbody.appendChild(tr);
        });

        stats.textContent = `Total Leads: ${count}`;
        refreshSendAllButton();
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

    // ========================================================================
    // Bulk "Send All to CRM": review every un-synced lead, then send in batches
    // ========================================================================
    function showSendAllModal() {
        const existing = document.getElementById('gmes-send-all-modal');
        if (existing) existing.remove();

        const pending = allItems.filter(isSendable);
        if (!pending.length) {
            alert('No un-synced leads to send.');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'gmes-send-all-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:Poppins,sans-serif;';
        modal.innerHTML =
            '<div style="background:#fff;border-radius:14px;max-width:560px;width:92%;max-height:84vh;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.25);border:1.5px solid #e2e5eb;display:flex;flex-direction:column;">' +
              '<div style="background:linear-gradient(135deg,#1e8e3e 0%,#34a853 60%,#5bc26a 100%);padding:14px 18px;color:white;font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px;">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>' +
                'Send All Leads to CRM' +
              '</div>' +
              '<div id="gmes-send-all-body" style="padding:18px;overflow-y:auto;font-size:13px;color:#3c4043;">' +
                '<div id="gmes-send-all-summary" style="background:#f8f9fa;border:1px solid #e2e5eb;border-radius:10px;padding:14px;margin-bottom:14px;">' +
                  '<div style="font-weight:700;font-size:13.5px;margin-bottom:8px;color:#202124;">Reviewing ' + pending.length + ' lead' + (pending.length === 1 ? '' : 's') + '…</div>' +
                  '<div id="gmes-send-all-counts" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px 14px;font-size:12.5px;">' +
                    '<div><span style="font-weight:600;color:#1a73e8;">Checking CRM…</span></div>' +
                  '</div>' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:auto 1fr;gap:8px 12px;align-items:center;margin-bottom:8px;">' +
                  '<label style="font-weight:700;font-size:12px;color:#5f6368;">Lead Category</label>' +
                  '<select id="gmes-send-all-category" style="padding:7px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
                    '<option value="">— None —</option>' +
                  '</select>' +
                  '<label style="font-weight:700;font-size:12px;color:#5f6368;">Assign To</label>' +
                  '<select id="gmes-send-all-assignee" style="padding:7px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
                    '<option value="">— Unassigned (new-lead pool) —</option>' +
                  '</select>' +
                '</div>' +
                '<div style="font-size:11px;color:#5f6368;line-height:1.5;margin-top:4px;">' +
                  'Applied to <strong>every lead in this batch</strong>. Picking an assignee skips the new-lead pool and routes each lead straight to them. Leads already in CRM with the same phone are skipped automatically.' +
                '</div>' +
                '<div id="gmes-send-all-progress" style="display:none;margin-top:14px;">' +
                  '<div style="display:flex;justify-content:space-between;font-size:12px;color:#5f6368;margin-bottom:6px;">' +
                    '<span id="gmes-send-all-progress-label">Sending…</span>' +
                    '<span id="gmes-send-all-progress-count">0 / 0</span>' +
                  '</div>' +
                  '<div style="height:8px;background:#e8eaed;border-radius:4px;overflow:hidden;">' +
                    '<div id="gmes-send-all-progress-bar" style="height:100%;width:0;background:linear-gradient(90deg,#1e8e3e,#34a853);transition:width 0.25s;"></div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div style="padding:12px 18px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid #e2e5eb;background:#fafafa;">' +
                '<button id="gmes-send-all-cancel" style="padding:8px 18px;border:1.5px solid #e2e5eb;border-radius:8px;background:#fff;color:#3c4043;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
                '<button id="gmes-send-all-confirm" disabled style="padding:8px 20px;border:none;border-radius:8px;background:#34a853;color:white;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;opacity:0.6;">Checking…</button>' +
              '</div>' +
            '</div>';

        document.body.appendChild(modal);

        const cancelBtn = document.getElementById('gmes-send-all-cancel');
        const confirmBtn = document.getElementById('gmes-send-all-confirm');
        const categorySelect = document.getElementById('gmes-send-all-category');
        const assigneeSelect = document.getElementById('gmes-send-all-assignee');
        const countsEl = document.getElementById('gmes-send-all-counts');

        let canceled = false;
        cancelBtn.addEventListener('click', () => { canceled = true; modal.remove(); });
        modal.addEventListener('click', e => { if (e.target === modal) { canceled = true; modal.remove(); } });

        // Populate category + assignee selectors using stored defaults
        pbFetchLeadCategories(false, cats => {
            chrome.storage.local.get(['gmes_default_lead_category'], data => {
                const preselect = data.gmes_default_lead_category || '';
                (cats || []).forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.name;
                    if (c.id === preselect) opt.selected = true;
                    categorySelect.appendChild(opt);
                });
            });
        });
        pbFetchTeammates(false, mates => {
            chrome.storage.local.get(['gmes_default_assigned_to'], data => {
                const preselect = data.gmes_default_assigned_to || '';
                (mates || []).forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name + (m.email ? ' (' + m.email + ')' : '');
                    if (m.id === preselect) opt.selected = true;
                    assigneeSelect.appendChild(opt);
                });
            });
        });

        // Pre-flight: classify every pending lead via pbCheckCompanyStatus.
        // Run with small concurrency so we don't hammer PocketBase.
        const buckets = { new: [], existsNewPhone: [], existsSamePhone: [], noPhone: [] };
        const concurrency = 4;
        let cursor = 0;
        let done = 0;

        function classify(item, cb) {
            const checkPhones = Array.isArray(item.phones) && item.phones.length
                ? item.phones
                : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
            pbCheckCompanyStatus(item.title, checkPhones, statusResult => {
                if (statusResult.status === 'exists_same_phone') {
                    item.crmSynced = true;
                    if (statusResult.companyId) item.crmId = statusResult.companyId;
                    buckets.existsSamePhone.push(item);
                    markRowSynced(item);
                } else if (statusResult.status === 'exists_new_phone') {
                    item.crmExistingId = statusResult.companyId;
                    buckets.existsNewPhone.push(item);
                } else {
                    if (!checkPhones.length) buckets.noPhone.push(item);
                    buckets.new.push(item);
                }
                cb();
            });
        }

        function pump() {
            while (cursor < pending.length && (cursor - done) < concurrency) {
                const item = pending[cursor++];
                classify(item, () => {
                    done++;
                    renderCounts();
                    if (done === pending.length) {
                        chrome.storage.local.set({ gmes_results: allItems });
                        refreshSendAllButton();
                        finalizePreflight();
                    } else if (!canceled) {
                        pump();
                    }
                });
            }
        }

        function renderCounts() {
            const sending = buckets.new.length + buckets.existsNewPhone.length;
            countsEl.innerHTML =
                '<div><span style="color:#5f6368;">New leads:</span> <strong style="color:#1e8e3e;">' + buckets.new.length + '</strong></div>' +
                '<div><span style="color:#5f6368;">Add phone to existing:</span> <strong style="color:#f29900;">' + buckets.existsNewPhone.length + '</strong></div>' +
                '<div><span style="color:#5f6368;">Already in CRM (skip):</span> <strong style="color:#5f6368;">' + buckets.existsSamePhone.length + '</strong></div>' +
                '<div><span style="color:#5f6368;">Missing phone:</span> <strong style="color:#5f6368;">' + buckets.noPhone.length + '</strong></div>' +
                '<div style="grid-column:1/-1;margin-top:4px;padding-top:8px;border-top:1px solid #e2e5eb;"><span style="color:#202124;font-weight:700;">Will send:</span> <strong style="color:#1a73e8;">' + sending + '</strong> · <span style="color:#5f6368;">Checked ' + done + ' / ' + pending.length + '</span></div>';
        }
        renderCounts();

        function finalizePreflight() {
            const sending = buckets.new.length + buckets.existsNewPhone.length;
            if (sending === 0) {
                confirmBtn.textContent = 'Nothing to send';
                confirmBtn.style.opacity = '0.6';
                confirmBtn.disabled = true;
            } else {
                confirmBtn.textContent = 'Send ' + sending + ' to CRM';
                confirmBtn.style.opacity = '1';
                confirmBtn.disabled = false;
            }
        }
        pump();

        confirmBtn.addEventListener('click', () => {
            if (confirmBtn.disabled) return;
            const category = categorySelect.value || '';
            const assignee = assigneeSelect.value || '';
            confirmBtn.disabled = true;
            cancelBtn.textContent = 'Close when done';
            categorySelect.disabled = true;
            assigneeSelect.disabled = true;
            document.getElementById('gmes-send-all-progress').style.display = 'block';
            runBulkSend(buckets, category, assignee, modal);
        });
    }

    function runBulkSend(buckets, category, assignee, modal) {
        const queue = [];
        buckets.new.forEach(item => queue.push({ item, kind: 'new' }));
        buckets.existsNewPhone.forEach(item => queue.push({ item, kind: 'addPhone' }));

        const total = queue.length;
        const label = document.getElementById('gmes-send-all-progress-label');
        const countEl = document.getElementById('gmes-send-all-progress-count');
        const bar = document.getElementById('gmes-send-all-progress-bar');
        let done = 0;
        let succeeded = 0;
        let failed = 0;
        let aborted = false;

        // Serial sending: PocketBase writes touch multiple collections per lead;
        // staying serial keeps the activity timeline ordered and avoids
        // rate-limiting on shared tunnels.
        function next() {
            if (aborted) return;
            if (!queue.length) {
                finish();
                return;
            }
            const { item, kind } = queue.shift();
            markRowSending(item, kind === 'addPhone' ? 'Adding phone…' : 'Sending…');
            const stamped = Object.assign({}, item, {
                lead_category: category || item.lead_category || '',
                assigned_to: assignee || item.assigned_to || ''
            });
            const onDone = (ok, msg) => {
                done++;
                if (ok) succeeded++; else failed++;
                countEl.textContent = done + ' / ' + total;
                bar.style.width = Math.round((done / total) * 100) + '%';
                label.textContent = ok
                    ? 'Sent ' + done + ' of ' + total + (failed ? ' (' + failed + ' failed)' : '')
                    : 'Failed lead — continuing…';
                if (!ok) markRowFailed(item, msg);
                chrome.storage.local.set({ gmes_results: allItems });
                setTimeout(next, 50);
            };

            if (kind === 'addPhone' && item.crmExistingId) {
                const addPhones = Array.isArray(item.phones) && item.phones.length
                    ? item.phones
                    : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
                pbAddPhoneToCompany(item.crmExistingId, addPhones, result => {
                    if (result.success) {
                        item.crmPhoneAdded = true;
                        markRowPhoneAdded(item);
                        onDone(true);
                    } else {
                        onDone(false, result.error || 'addPhone failed');
                    }
                });
            } else {
                pbSendToCrm(stamped, result => {
                    if (result.success) {
                        item.crmSynced = true;
                        if (result.recordId) item.crmId = result.recordId;
                        markRowSynced(item);
                        onDone(true);
                    } else {
                        onDone(false, result.error || 'send failed');
                    }
                });
            }
        }

        function finish() {
            label.textContent = 'Done — ' + succeeded + ' sent' + (failed ? ', ' + failed + ' failed' : '');
            bar.style.width = '100%';
            refreshSendAllButton();
            chrome.storage.local.set({ gmes_results: allItems });
            const cancelBtn = document.getElementById('gmes-send-all-cancel');
            if (cancelBtn) cancelBtn.textContent = 'Close';
        }

        if (total === 0) {
            finish();
            return;
        }
        next();
    }

    if (sendAllBtn) {
        sendAllBtn.addEventListener('click', () => {
            pbIsLoggedIn(loggedIn => {
                if (!loggedIn) {
                    alert('Login to TableTurnerr CRM first. Open the extension popup and click "Connect to TableTurnerr CRM".');
                    return;
                }
                showSendAllModal();
            });
        });
    }
});