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

// Fetch lead categories from PocketBase. Cache for 5 minutes; returns cached on
// network failure. Categories shape: [{ id, name }].
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

function pbGetDefaultCategoryId(cb) {
    chrome.storage.local.get(['gmes_default_lead_category'], function (data) {
        cb(data.gmes_default_lead_category || '');
    });
}

// Fetch teammates (users) from PocketBase. Cache for 5 minutes.
// Shape: [{ id, name, email }].
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

function pbGetDefaultAssigneeId(cb) {
    chrome.storage.local.get(['gmes_default_assigned_to'], function (data) {
        cb(data.gmes_default_assigned_to || '');
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
                    // Not found by name — check if phone exists anywhere
                    var phoneNums = (Array.isArray(phones) ? phones : []).map(function (p) { return String(p.number || '').replace(/\D/g, ''); }).filter(Boolean);
                    if (!phoneNums.length) { cb({ status: 'new' }); return; }
                    var phoneFilter = encodeURIComponent(phoneNums.map(function (n) { return 'phone_number="' + n + '"'; }).join('||'));
                    fetch(pbUrl + '/api/collections/phone_numbers/records?filter=' + phoneFilter + '&perPage=1', { headers: headers })
                        .then(function (r2) { return r2.json(); })
                        .then(function (d2) { cb({ status: d2.totalItems > 0 ? 'exists_same_phone' : 'new' }); })
                        .catch(function () { cb({ status: 'new' }); });
                    return;
                }
                // Company found by name
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
        if (!pbUrl) { cb({ success: false, error: 'No PocketBase URL configured. Set it in \u2699 CRM Settings.' }); return; }
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
        if (!pbUrl) { cb({ success: false, error: 'No PocketBase URL configured. Set it in \u2699 CRM Settings.' }); return; }
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
                            .catch(function () { /* ignore dedup check failure, create note anyway */
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

// ============================================================================
// CRM Confirmation Modal
// ============================================================================
function showCrmConfirmation(item, onConfirm) {
    // Remove existing modal if any
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
        '<div style="background:var(--surface,#fff);border-radius:14px;padding:0;max-width:480px;width:90%;max-height:80vh;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.25);border:1.5px solid var(--border,#e2e5eb);">' +
        '<div style="background:linear-gradient(135deg,#1557b0 0%,#1a73e8 60%,#4285f4 100%);padding:14px 18px;color:white;font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px;">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' +
        'Confirm CRM Send</div>' +
        '<div style="padding:16px 18px;max-height:50vh;overflow-y:auto;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:12.5px;">' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Company</td><td style="padding:6px 0;color:var(--text,#202124);">' + escapeHtmlModal(item.title || 'Unknown') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Location</td><td style="padding:6px 0;color:var(--text,#202124);">' + escapeHtmlModal((item.address || '') + (item.city ? ', ' + item.city : '') || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Phone(s)</td><td style="padding:6px 0;color:var(--text,#202124);">' + phonesDisplay + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Rating</td><td style="padding:6px 0;color:var(--text,#202124);">' + escapeHtmlModal(item.rating || '0') + ' ★ ' + escapeHtmlModal((item.reviewCount || '').replace(/[()]/g, '')) + ' reviews</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Industry</td><td style="padding:6px 0;color:var(--text,#202124);">' + escapeHtmlModal(item.industry || 'N/A') + (item.expensiveness ? ' · ' + escapeHtmlModal(item.expensiveness) : '') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Website</td><td style="padding:6px 0;color:var(--text,#202124);word-break:break-all;">' + escapeHtmlModal(item.companyUrl || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Maps Link</td><td style="padding:6px 0;color:var(--text,#202124);word-break:break-all;">' + escapeHtmlModal(item.href || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Note</td><td style="padding:6px 0;color:var(--text,#202124);white-space:pre-wrap;">' + escapeHtmlModal(item.note || 'None') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Lead Category</td><td style="padding:6px 0;color:var(--text,#202124);">' +
        '<select id="gmes-confirm-category" style="width:100%;padding:6px 10px;border:1.5px solid var(--border,#e2e5eb);border-radius:7px;font-family:inherit;font-size:12.5px;background:var(--surface,#fff);color:var(--text,#202124);">' +
        '<option value="">— None —</option></select></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Assign To</td><td style="padding:6px 0;color:var(--text,#202124);">' +
        '<select id="gmes-confirm-assignee" style="width:100%;padding:6px 10px;border:1.5px solid var(--border,#e2e5eb);border-radius:7px;font-family:inherit;font-size:12.5px;background:var(--surface,#fff);color:var(--text,#202124);">' +
        '<option value="">— Unassigned (new-lead pool) —</option></select>' +
        '<div style="font-size:11px;color:var(--text-muted,#5f6368);margin-top:4px;">Picking a teammate skips the new-lead phase and routes the lead straight to them.</div></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Source</td><td style="padding:6px 0;color:var(--text,#202124);">Google Maps</td></tr>' +
        '</table></div>' +
        '<div style="padding:12px 18px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid var(--border,#e2e5eb);">' +
        '<button id="gmes-confirm-cancel" style="padding:8px 18px;border:1.5px solid var(--border,#e2e5eb);border-radius:8px;background:var(--surface,#fff);color:var(--text-2,#3c4043);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
        '<button id="gmes-confirm-send" style="padding:8px 18px;border:none;border-radius:8px;background:#1a73e8;color:white;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Confirm &amp; Send</button>' +
        '</div></div>';

    document.body.appendChild(modal);

    var categorySelect = document.getElementById('gmes-confirm-category');
    pbFetchLeadCategories(false, function (cats) {
        pbGetDefaultCategoryId(function (defaultId) {
            var preselect = item.lead_category || defaultId || '';
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
        pbGetDefaultAssigneeId(function (defaultAssignee) {
            var preselect = item.assigned_to || defaultAssignee || '';
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

function escapeHtmlModal(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
                if (url && !url.startsWith('chrome://') && !url.startsWith('edge://') && !url.startsWith('about:') && !url.includes('google.com/maps')) {
                    chrome.scripting.executeScript({
                        target: { tabId: tabs[0].id },
                        files: ['manual_mode_website.js']
                    }, function () {
                        if (chrome.runtime.lastError) { /* ignore — page may block injection */ }
                    });
                }
            });
        }
    }

    document.getElementById('scrapingModeBtn').addEventListener('click', function () { setMode('scraping'); });
    document.getElementById('manualModeBtn').addEventListener('click', function () { setMode('manual'); });

    // Auto-Popup toggle: load persisted state and wire click handler
    function updatePillToggle(toggle, isOn) {
        var textEl = toggle.querySelector('.pill-text');
        if (isOn) {
            toggle.classList.add('on');
            if (textEl) textEl.textContent = 'ON';
        } else {
            toggle.classList.remove('on');
            if (textEl) textEl.textContent = 'OFF';
        }
    }

    chrome.storage.local.get(['gmes_manual_auto_popup'], function (result) {
        var autoPopup = result.gmes_manual_auto_popup !== false; // default true
        var toggle = document.getElementById('autoPopupToggle');
        if (toggle) updatePillToggle(toggle, autoPopup);
    });

    var autoPopupToggle = document.getElementById('autoPopupToggle');
    if (autoPopupToggle) {
        autoPopupToggle.addEventListener('click', function () {
            var newState = !autoPopupToggle.classList.contains('on');
            updatePillToggle(autoPopupToggle, newState);
            chrome.storage.local.set({ gmes_manual_auto_popup: newState });
        });
    }

    document.getElementById('manualAddBtn').addEventListener('click', function () {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                var u = tabs[0].url || '';
                if (u.startsWith('chrome://') || u.startsWith('edge://') || u.startsWith('about:')) return;
                chrome.tabs.sendMessage(tabs[0].id, { type: 'MANUAL_ADD_OVERLAY' }, function () {
                    if (chrome.runtime.lastError) { /* receiver not ready — ignore */ }
                });
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
        var openTabButton = document.getElementById('openTabButton');

        if (openTabButton) {
            openTabButton.addEventListener('click', function() {
                chrome.tabs.create({ url: 'results_tab.html' });
            });
        }

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
            // column order: title, note, closedStatus, rating, reviewCount, phone, industry, expensiveness, city, address, website, instaSearch, maps link, crmStatus
            ['title', 'note', 'closedStatus', 'rating', 'reviewCount', 'phone', 'industry', 'expensiveness', 'city', 'address', 'companyUrl', 'instaSearch', 'href', 'crmStatus'].forEach(function (colKey) {
                var cell = document.createElement('td');

                // Special rendering for links
                if (colKey === 'companyUrl' || colKey === 'href') {
                    var url = item[colKey] || '';
                    if (colKey === 'companyUrl') {
                        // If companyUrl is empty OR it's a Google Maps link, create a search link for the website
                        var isMapsLink = url && url.indexOf('https://www.google.com/maps') === 0;
                        let finalUrl = url;
                        if (!url || isMapsLink) {
                            // build search query: Title + City + Website
                            var qParts = [];
                            if (item.title) qParts.push(item.title);
                            if (item.city) qParts.push(item.city);
                            qParts.push('Website');
                            var query = qParts.join(' ');
                            finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
                        }
                        var a = document.createElement('a');
                        a.href = finalUrl;
                        a.textContent = finalUrl;
                        a.target = '_blank';
                        a.rel = 'noopener noreferrer';
                        cell.appendChild(a);
                    } else {
                        // href (maps link) column
                        var mapsUrl = url || '';
                        if (mapsUrl) {
                            var a = document.createElement('a');
                            a.href = mapsUrl;
                            a.textContent = mapsUrl;
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
                        a.textContent = url;
                        a.target = '_blank';
                        a.rel = 'noopener noreferrer';
                        cell.appendChild(a);
                    }
                } else if (colKey === 'crmStatus') {
                    if (item.crmSynced) {
                        cell.textContent = '\u2713 Synced';
                        cell.style.color = '#34a853';
                        cell.style.fontWeight = '600';
                    } else if (item.crmPhoneAdded) {
                        cell.textContent = '\u2713 Phone Added';
                        cell.style.color = '#34a853';
                        cell.style.fontWeight = '600';
                    } else {
                        var sendBtn = document.createElement('button');
                        if (item.crmExistingId) {
                            sendBtn.textContent = 'Add New Phone +';
                            sendBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; border-radius: 12px; background: #ff9800; color: white; border: none; cursor: pointer;';
                        } else {
                            sendBtn.textContent = 'Send to CRM';
                            sendBtn.className = 'button';
                            sendBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; border-radius: 12px;';
                        }
                        (function (capturedItem, capturedCell, capturedBtn) {
                            // Async CRM check — update button if company exists with a different phone
                            if (!capturedItem.crmExistingId && !capturedItem.crmChecked) {
                                capturedItem.crmChecked = true;
                                var checkPhones = Array.isArray(capturedItem.phones) && capturedItem.phones.length
                                    ? capturedItem.phones
                                    : (capturedItem.phone ? [{ number: capturedItem.phone, label: 'Main' }] : []);
                                pbCheckCompanyStatus(capturedItem.title, checkPhones, function (statusResult) {
                                    if (statusResult.status === 'exists_new_phone') {
                                        capturedItem.crmExistingId = statusResult.companyId;
                                        capturedBtn.textContent = 'Add New Phone +';
                                        capturedBtn.className = '';
                                        capturedBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; border-radius: 12px; background: #ff9800; color: white; border: none; cursor: pointer;';
                                        saveToStorage();
                                    } else if (statusResult.status === 'exists_same_phone') {
                                        capturedItem.crmSynced = true;
                                        if (statusResult.companyId) capturedItem.crmId = statusResult.companyId;
                                        capturedCell.innerHTML = '';
                                        capturedCell.textContent = '\u2713 In CRM';
                                        capturedCell.style.color = '#34a853';
                                        capturedCell.style.fontWeight = '600';
                                        saveToStorage();
                                    }
                                });
                            }
                            capturedBtn.addEventListener('click', function () {
                                showCrmConfirmation(capturedItem, function () {
                                    if (capturedItem.crmExistingId) {
                                        capturedBtn.disabled = true;
                                        capturedBtn.textContent = 'Adding\u2026';
                                        var addPhones = Array.isArray(capturedItem.phones) && capturedItem.phones.length
                                            ? capturedItem.phones
                                            : (capturedItem.phone ? [{ number: capturedItem.phone, label: 'Main' }] : []);
                                        pbAddPhoneToCompany(capturedItem.crmExistingId, addPhones, function (result) {
                                            if (result.success) {
                                                capturedItem.crmPhoneAdded = true;
                                                capturedCell.innerHTML = '';
                                                capturedCell.textContent = '\u2713 Phone Added';
                                                capturedCell.style.color = '#34a853';
                                                capturedCell.style.fontWeight = '600';
                                                saveToStorage();
                                            } else {
                                                capturedBtn.disabled = false;
                                                capturedBtn.textContent = 'Add New Phone +';
                                                alert('Failed to add phone: ' + (result.error || 'Unknown error'));
                                            }
                                        });
                                    } else {
                                        capturedBtn.disabled = true;
                                        capturedBtn.textContent = 'Sending\u2026';
                                        pbSendToCrm(capturedItem, function (result) {
                                            if (result.success) {
                                                capturedItem.crmSynced = true;
                                                if (result.recordId) capturedItem.crmId = result.recordId;
                                                capturedCell.innerHTML = '';
                                                capturedCell.textContent = '\u2713 Synced';
                                                capturedCell.style.color = '#34a853';
                                                capturedCell.style.fontWeight = '600';
                                                saveToStorage();
                                            } else {
                                                capturedBtn.disabled = false;
                                                capturedBtn.textContent = 'Retry';
                                                alert('CRM sync failed: ' + (result.error || 'Unknown error'));
                                            }
                                        });
                                    }
                                });
                            });
                        })(item, cell, sendBtn);
                        cell.appendChild(sendBtn);
                    }
                } else if (colKey === 'phone') {
                    if (item.phones && item.phones.length > 0) {
                        var primaryDisplay = formatPhoneDisplay(item.phones[0].number);
                        if (item.phones.length > 1) {
                            var extraCount = item.phones.length - 1;
                            var tooltipText = item.phones.slice(1).map(function (p) { return formatPhoneDisplay(p.number); }).join(', ');
                            var span = document.createElement('span');
                            span.textContent = primaryDisplay;
                            cell.appendChild(span);
                            var badge = document.createElement('span');
                            badge.textContent = ' (+' + extraCount + ' more)';
                            badge.title = tooltipText;
                            badge.style.cssText = 'cursor:help;color:#4285f4;font-size:11px;';
                            cell.appendChild(badge);
                        } else {
                            cell.textContent = primaryDisplay;
                        }
                    } else {
                        var norm = normalizePhone(item.phone || '');
                        cell.textContent = norm ? formatPhoneDisplay(norm) : (item.phone || '');
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
            const headers = ['Title', 'Note', 'Closed Status', 'Rating', 'Reviews', 'Phone', 'Industry', 'Expensiveness', 'City', 'Address', 'Website', 'Insta Search', 'Google Maps Link', 'CRM Status'];
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

        // CRM Connect panel — one-click auth via crm.tableturnerr.com
        (function initCrmConnect() {
            var CRM_URL    = 'https://crm.tableturnerr.com';
            var CRM_PB_URL = 'https://crmdb.tableturnerr.com';
            var CRM_LOGIN  = 'https://crm.tableturnerr.com/login';

            var connectBtn        = document.getElementById('crmConnectBtn');
            var connectStatus     = document.getElementById('crmConnectStatus');
            var stateDisconnected = document.getElementById('crmStateDisconnected');
            var stateConnected    = document.getElementById('crmStateConnected');
            var userEmailEl       = document.getElementById('crmUserEmail');
            var disconnectBtn     = document.getElementById('crmDisconnectBtn');
            var advancedToggle    = document.getElementById('crmAdvancedToggle');
            var advancedPanel     = document.getElementById('crmAdvancedPanel');
            var pbSaveBtn         = document.getElementById('pbSaveBtn');
            var pbSaveStatus      = document.getElementById('pbSaveStatus');

            // ---- UI state helpers ----
            function setUiConnected(email) {
                stateDisconnected.style.display = 'none';
                stateConnected.style.display = 'block';
                userEmailEl.innerHTML = '<span class="crm-status-dot connected"></span>' + (email || 'Connected');
                refreshDefaultCategoryDropdown();
                refreshDefaultAssigneeDropdown();
            }

            // ---- Default lead category dropdown ----
            function refreshDefaultCategoryDropdown(forceRefresh) {
                var sel = document.getElementById('defaultLeadCategorySelect');
                if (!sel) return;
                pbFetchLeadCategories(Boolean(forceRefresh), function (cats) {
                    pbGetDefaultCategoryId(function (currentId) {
                        sel.innerHTML = '<option value="">\u2014 None \u2014</option>';
                        (cats || []).forEach(function (c) {
                            var opt = document.createElement('option');
                            opt.value = c.id;
                            opt.textContent = c.name;
                            if (c.id === currentId) opt.selected = true;
                            sel.appendChild(opt);
                        });
                    });
                });
            }
            var defaultCategorySelectEl = document.getElementById('defaultLeadCategorySelect');
            if (defaultCategorySelectEl) {
                defaultCategorySelectEl.addEventListener('change', function () {
                    chrome.storage.local.set({ gmes_default_lead_category: defaultCategorySelectEl.value || '' }, function () {
                        var st = document.getElementById('defaultLeadCategoryStatus');
                        if (st) { st.style.display = 'block'; setTimeout(function () { st.style.display = 'none'; }, 1500); }
                    });
                });
            }
            var refreshCategoriesBtn = document.getElementById('refreshLeadCategoriesBtn');
            if (refreshCategoriesBtn) {
                refreshCategoriesBtn.addEventListener('click', function () { refreshDefaultCategoryDropdown(true); });
            }

            // ---- Default assignee dropdown ----
            function refreshDefaultAssigneeDropdown(forceRefresh) {
                var sel = document.getElementById('defaultAssigneeSelect');
                if (!sel) return;
                pbFetchTeammates(Boolean(forceRefresh), function (mates) {
                    pbGetDefaultAssigneeId(function (currentId) {
                        sel.innerHTML = '<option value="">\u2014 Unassigned (new-lead pool) \u2014</option>';
                        (mates || []).forEach(function (m) {
                            var opt = document.createElement('option');
                            opt.value = m.id;
                            opt.textContent = m.name + (m.email ? ' (' + m.email + ')' : '');
                            if (m.id === currentId) opt.selected = true;
                            sel.appendChild(opt);
                        });
                    });
                });
            }
            var defaultAssigneeSelectEl = document.getElementById('defaultAssigneeSelect');
            if (defaultAssigneeSelectEl) {
                defaultAssigneeSelectEl.addEventListener('change', function () {
                    chrome.storage.local.set({ gmes_default_assigned_to: defaultAssigneeSelectEl.value || '' }, function () {
                        var st = document.getElementById('defaultAssigneeStatus');
                        if (st) { st.style.display = 'block'; setTimeout(function () { st.style.display = 'none'; }, 1500); }
                    });
                });
            }
            var refreshAssigneesBtn = document.getElementById('refreshAssigneesBtn');
            if (refreshAssigneesBtn) {
                refreshAssigneesBtn.addEventListener('click', function () { refreshDefaultAssigneeDropdown(true); });
            }

            function setUiDisconnected(msg) {
                stateConnected.style.display = 'none';
                stateDisconnected.style.display = 'block';
                if (connectBtn) { connectBtn.disabled = false; connectBtn.textContent = 'Connect to TableTurnerr CRM'; }
                if (connectStatus) connectStatus.textContent = msg || '';
            }

            function setUiConnecting(msg) {
                if (connectBtn) { connectBtn.disabled = true; connectBtn.textContent = msg || 'Connecting\u2026'; }
                if (connectStatus) connectStatus.innerHTML = '<span class="crm-status-dot connecting"></span>';
            }

            // ---- On popup open: restore state ----
            chrome.storage.local.get(['gmes_pb_url', 'gmes_pb_token', 'gmes_crm_email', 'gmes_crm_waiting'], function (data) {
                if (data.gmes_pb_token) {
                    setUiConnected(data.gmes_crm_email);
                } else if (data.gmes_crm_waiting) {
                    setUiConnecting('Waiting for login\u2026');
                    pollForLogin();
                } else {
                    setUiDisconnected('');
                }
                var urlInput   = document.getElementById('pbUrlInput');
                var tokenInput = document.getElementById('pbTokenInput');
                if (urlInput && data.gmes_pb_url)     urlInput.value   = data.gmes_pb_url;
                if (tokenInput && data.gmes_pb_token) tokenInput.value = data.gmes_pb_token;
            });

            // ---- Connect button ----
            if (connectBtn) {
                connectBtn.addEventListener('click', function () {
                    setUiConnecting('Looking for CRM tab\u2026');
                    attemptConnect();
                });
            }

            // ---- Disconnect button ----
            if (disconnectBtn) {
                disconnectBtn.addEventListener('click', function () {
                    chrome.storage.local.remove([
                        'gmes_pb_url', 'gmes_pb_token', 'gmes_crm_email', 'gmes_crm_waiting',
                        'gmes_lead_categories_cache', 'gmes_lead_categories_ts', 'gmes_default_lead_category',
                        'gmes_teammates_cache', 'gmes_teammates_ts', 'gmes_default_assigned_to'
                    ], function () {
                        setUiDisconnected('Disconnected.');
                    });
                });
            }

            // ---- Advanced toggle ----
            if (advancedToggle && advancedPanel) {
                advancedToggle.addEventListener('click', function () {
                    advancedPanel.style.display = advancedPanel.style.display === 'none' ? 'block' : 'none';
                });
            }

            // ---- Advanced manual save ----
            if (pbSaveBtn) {
                pbSaveBtn.addEventListener('click', function () {
                    var pbUrl   = (document.getElementById('pbUrlInput').value || '').trim().replace(/\/$/, '');
                    var pbToken = (document.getElementById('pbTokenInput').value || '').trim();
                    chrome.storage.local.set({ gmes_pb_url: pbUrl, gmes_pb_token: pbToken, gmes_crm_email: 'Manual', gmes_crm_waiting: false }, function () {
                        if (pbSaveStatus) { pbSaveStatus.style.display = 'inline'; setTimeout(function () { pbSaveStatus.style.display = 'none'; }, 2000); }
                        if (pbToken) setUiConnected('Manual token');
                    });
                });
            }

            // ---- Read PocketBase auth from a CRM tab (injected as serializable function) ----
            function readCrmAuth() {
                try {
                    var raw = localStorage.getItem('pocketbase_auth');
                    if (!raw) return null;
                    var p = JSON.parse(raw);
                    if (!p || !p.token) return null;
                    var email = (p.model && (p.model.email || p.model.username)) || '';
                    return { token: p.token, email: email };
                } catch (e) { return null; }
            }

            function saveAuthAndConnect(token, email) {
                chrome.storage.local.set({ gmes_pb_url: CRM_PB_URL, gmes_pb_token: token, gmes_crm_email: email, gmes_crm_waiting: false }, function () {
                    setUiConnected(email || 'Connected');
                });
            }

            // ---- Try to grab auth from any open CRM tab ----
            function attemptConnect() {
                chrome.tabs.query({ url: CRM_URL + '/*' }, function (tabs) {
                    if (tabs && tabs.length > 0) {
                        chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: readCrmAuth }, function (results) {
                            var auth = results && results[0] && results[0].result;
                            if (auth && auth.token) {
                                saveAuthAndConnect(auth.token, auth.email);
                            } else {
                                // Tab open but not logged in — redirect to login page
                                chrome.tabs.update(tabs[0].id, { url: CRM_LOGIN, active: true });
                                beginWaiting();
                            }
                        });
                    } else {
                        chrome.tabs.create({ url: CRM_LOGIN });
                        beginWaiting();
                    }
                });
            }

            // ---- Poll until user completes login ----
            var _pollInterval = null;

            function beginWaiting() {
                chrome.storage.local.set({ gmes_crm_waiting: true });
                chrome.runtime.sendMessage({ type: 'START_CRM_LOGIN_POLL' });
                setUiConnecting('Waiting for login\u2026');
                pollForLogin();
            }

            function pollForLogin() {
                if (_pollInterval) clearInterval(_pollInterval);
                _pollInterval = setInterval(function () {
                    chrome.tabs.query({ url: CRM_URL + '/*' }, function (tabs) {
                        if (!tabs || !tabs.length) return;
                        var nonLoginTab = null;
                        for (var i = 0; i < tabs.length; i++) {
                            if (tabs[i].url && tabs[i].url.indexOf('/login') === -1) { nonLoginTab = tabs[i]; break; }
                        }
                        if (!nonLoginTab) return;
                        chrome.scripting.executeScript({ target: { tabId: nonLoginTab.id }, func: readCrmAuth }, function (results) {
                            var auth = results && results[0] && results[0].result;
                            if (auth && auth.token) {
                                clearInterval(_pollInterval);
                                _pollInterval = null;
                                saveAuthAndConnect(auth.token, auth.email);
                            }
                        });
                    });
                }, 1500);
            }
        })();

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

        // Export to .xls with multi-location expansion: items with multiple phones
        // get expanded into separate rows, repeating the company name per phone/location.
        downloadCsvButton.addEventListener('click', function () {
            try {
                var filename = filenameInput.value.trim();
                if (!filename) {
                    filename = 'google-maps-data.xls';
                } else {
                    filename = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.xls';
                }

                var headerLabels = ['Title', 'Note', 'Closed Status', 'Rating', 'Reviews', 'Phone', 'Phone Label', 'Location Name', 'Location Address', 'Industry', 'Expensiveness', 'City', 'Address', 'Website', 'Insta Search', 'Google Maps Link', 'CRM Status'];

                var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>';
                html += '<table border="1" style="border-collapse:collapse;">';
                html += '<thead><tr>';
                headerLabels.forEach(function (h) { html += '<th>' + h + '</th>'; });
                html += '</tr></thead><tbody>';

                var exportSeen = new Set();
                storedItems.forEach(function (item) {
                    var key = item.href || (item.title + '|' + item.address);
                    if (!key || exportSeen.has(key)) return;
                    exportSeen.add(key);

                    var phones = Array.isArray(item.phones) && item.phones.length
                        ? item.phones
                        : (item.phone ? [{ number: item.phone, label: 'Main', location_name: '', location_address: '' }] : [{ number: '', label: '', location_name: '', location_address: '' }]);

                    var crmStatus = item.crmSynced ? 'Synced' : (item.crmPhoneAdded ? 'Phone Added' : '');
                    var websiteUrl = item.companyUrl && item.companyUrl.indexOf('https://www.google.com/maps') !== 0
                        ? item.companyUrl
                        : 'https://www.google.com/search?q=' + encodeURIComponent((item.title || '') + ' ' + (item.city || '') + ' Website');

                    phones.forEach(function (p) {
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

        // Normalize phone and build phones array
        var normalizedPhone = (function(raw) {
            if (!raw) return null;
            var d = String(raw).replace(/\D/g, '');
            if (d.length === 10) d = '1' + d;
            if (d.length !== 11 || d[0] !== '1') return null;
            return d;
        })(phone);
        phone = normalizedPhone || '';
        var phones = normalizedPhone ? [{ number: normalizedPhone, label: 'Main', location_name: '', location_address: '' }] : [];

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
            phones: phones,
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
