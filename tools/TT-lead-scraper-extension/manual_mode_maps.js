// manual_mode_maps.js

// ============================================================================
// PocketBase CRM Helpers (inline)
// ============================================================================
function pbGetSettings_maps(cb) {
    chrome.storage.local.get(['gmes_pb_url', 'gmes_pb_token'], function (data) {
        cb(data.gmes_pb_url || '', data.gmes_pb_token || '');
    });
}

function pbIsLoggedIn_maps(cb) {
    pbGetSettings_maps(function (pbUrl, pbToken) {
        cb(Boolean(pbUrl && pbToken));
    });
}

// Extract user ID from PocketBase JWT token
function pbGetUserIdFromToken_maps(token) {
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
var LEAD_CATEGORY_TTL_MS_MAPS = 5 * 60 * 1000;
function pbFetchLeadCategories_maps(forceRefresh, cb) {
    chrome.storage.local.get(['gmes_lead_categories_cache', 'gmes_lead_categories_ts'], function (data) {
        var cached = Array.isArray(data.gmes_lead_categories_cache) ? data.gmes_lead_categories_cache : [];
        var fresh = data.gmes_lead_categories_ts && (Date.now() - data.gmes_lead_categories_ts < LEAD_CATEGORY_TTL_MS_MAPS);
        if (cached.length && !forceRefresh && fresh) { cb(cached); return; }
        pbGetSettings_maps(function (pbUrl, pbToken) {
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
var TEAMMATES_TTL_MS_MAPS = 5 * 60 * 1000;
function pbFetchTeammates_maps(forceRefresh, cb) {
    chrome.storage.local.get(['gmes_teammates_cache', 'gmes_teammates_ts'], function (data) {
        var cached = Array.isArray(data.gmes_teammates_cache) ? data.gmes_teammates_cache : [];
        var fresh = data.gmes_teammates_ts && (Date.now() - data.gmes_teammates_ts < TEAMMATES_TTL_MS_MAPS);
        if (cached.length && !forceRefresh && fresh) { cb(cached); return; }
        pbGetSettings_maps(function (pbUrl, pbToken) {
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

function pbCheckDuplicate_maps(name, phone, cb) {
    pbGetSettings_maps(function (pbUrl, pbToken) {
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

function pbSendToCrm_maps(item, cb) {
    pbGetSettings_maps(function (pbUrl, pbToken) {
        if (!pbUrl) { cb({ success: false, error: 'Not connected to CRM. Click "Connect to TableTurnerr CRM" in the extension popup.' }); return; }
        var headers = { 'Content-Type': 'application/json' };
        if (pbToken) headers['Authorization'] = 'Bearer ' + pbToken;
        var userId = pbGetUserIdFromToken_maps(pbToken);
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
            contact_source: 'Extension - Manual Maps',
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
// CRM Confirmation Modal (maps overlay)
// ============================================================================
function showCrmConfirmation_maps(item, onConfirm) {
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
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Location</td><td style="padding:5px 0;color:#202124;">' + esc((item.address || '') + (item.city ? ', ' + item.city : '') || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Phone(s)</td><td style="padding:5px 0;color:#202124;">' + phonesDisplay + '</td></tr>' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Rating</td><td style="padding:5px 0;color:#202124;">' + esc(item.rating || '0') + ' \u2605 ' + esc((item.reviewCount || '').replace(/[()]/g, '')) + '</td></tr>' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Website</td><td style="padding:5px 0;color:#202124;word-break:break-all;">' + esc(item.companyUrl || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Note</td><td style="padding:5px 0;color:#202124;white-space:pre-wrap;">' + esc(item.note || 'None') + '</td></tr>' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Lead Category</td><td style="padding:5px 0;color:#202124;">' +
        '<select id="gmes-confirm-category" style="width:100%;padding:6px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
        '<option value="">\u2014 None \u2014</option></select></td></tr>' +
        '<tr><td style="padding:5px 8px 5px 0;font-weight:700;color:#80868b;white-space:nowrap;vertical-align:top;">Assign To</td><td style="padding:5px 0;color:#202124;">' +
        '<select id="gmes-confirm-assignee" style="width:100%;padding:6px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
        '<option value="">\u2014 Unassigned (new-lead pool) \u2014</option></select>' +
        '<div style="font-size:11px;color:#80868b;margin-top:4px;">Picking a teammate routes the lead straight to them.</div></td></tr>' +
        '</table></div>' +
        '<div style="padding:10px 16px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid #e8eaed;">' +
        '<button id="gmes-confirm-cancel" style="padding:8px 16px;border:1.5px solid #e2e5eb;border-radius:8px;background:#fff;color:#3c4043;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
        '<button id="gmes-confirm-send" style="padding:8px 16px;border:none;border-radius:8px;background:#1a73e8;color:white;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Confirm &amp; Send</button>' +
        '</div></div>';

    document.body.appendChild(modal);

    var categorySelect = document.getElementById('gmes-confirm-category');
    pbFetchLeadCategories_maps(false, function (cats) {
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
    pbFetchTeammates_maps(false, function (mates) {
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

// ============================================================================
// End of PocketBase CRM Helpers
// ============================================================================

(function () {
    'use strict';

    // Prevent duplicate initialization
    if (window.__GMES_MAPS_OVERLAY_INIT__) return;
    window.__GMES_MAPS_OVERLAY_INIT__ = true;

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

    // Live-respond to Auto-Popup or master-power toggle changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!changes.gmes_manual_auto_popup && !changes.gmes_extension_enabled) return;

        var autoPopupOn = changes.gmes_manual_auto_popup
            ? changes.gmes_manual_auto_popup.newValue !== false
            : null;
        var extOn = changes.gmes_extension_enabled
            ? changes.gmes_extension_enabled.newValue !== false
            : null;

        // Anything toggled OFF: tear down overlay + polling immediately.
        if (autoPopupOn === false || extOn === false) {
            if (urlCheckInterval) {
                clearInterval(urlCheckInterval);
                urlCheckInterval = null;
                isOverlayActive = false;
            }
            var overlay = document.getElementById('gmes-manual-overlay');
            if (overlay) overlay.remove();
            return;
        }

        // A toggle flipped back ON: re-check whether overlay should appear.
        chrome.runtime.sendMessage({ type: 'CHECK_SHOULD_SHOW_OVERLAY' }, (response) => {
            if (response && response.shouldShow) {
                initMapsOverlay();
            }
        });
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'MANUAL_ADD_OVERLAY' || request.type === 'URL_CHANGED') {
            createOverlay();
        } else if (request.type === 'SHOW_OVERLAY') {
            initMapsOverlay();
        } else if (request.type === 'TRIGGER_MANUAL_ADD') {
            // Handle keyboard shortcut to add item — note is optional.
            const btn = document.getElementById('gmes-add-btn');
            if (btn && !btn.disabled) {
                btn.click();
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

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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
        // Normalize phone and build phones array
        const normalizedPhone = normalizePhone(item.phone);
        item.phone = normalizedPhone || '';
        item.phones = normalizedPhone
            ? [{ number: normalizedPhone, label: 'Main', location_name: '', location_address: '' }]
            : [];

        // 5. Address
        const addressBtn = container.querySelector('[data-item-id="address"]');
        if (addressBtn) {
            let addr = addressBtn.textContent.trim();
            // Remove leading Unicode icon if present (common in Google Maps)
            if (addr && addr.charCodeAt(0) > 127 && !/^\d/.test(addr)) {
                addr = addr.substring(1).trim();
            }
            item.address = addr;
        }

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
                // Use URL API for robust hostname checking
                try {
                    const url = new URL(a.href);
                    const hostname = url.hostname.toLowerCase();
                    if (hostname === 'google.com' || hostname.endsWith('.google.com')) return false;
                } catch {
                    return false;
                }
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
          width: 330px;
          background: #ffffff;
          border-radius: 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1);
          z-index: 10000;
          font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
          font-size: 13.5px;
          border: 1px solid rgba(0,0,0,0.08);
          overflow: hidden;
        }
        #gmes-manual-overlay .gmes-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 11px 14px;
          background: linear-gradient(135deg, #1557b0 0%, #1a73e8 60%, #4285f4 100%);
          color: white;
          font-weight: 600;
          font-size: 13.5px;
        }
        #gmes-manual-overlay .gmes-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        #gmes-manual-overlay .gmes-header-logo {
          width: 22px;
          height: 22px;
          border-radius: 6px;
          flex-shrink: 0;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        }
        #gmes-manual-overlay .gmes-header-actions {
          display: flex;
          gap: 4px;
          align-items: center;
        }
        #gmes-manual-overlay .gmes-hbtn {
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
          flex-shrink: 0;
        }
        #gmes-manual-overlay .gmes-hbtn:hover { background: rgba(255,255,255,0.28); }
        #gmes-manual-overlay .gmes-hbtn svg { display: block; }
        #gmes-manual-overlay .gmes-refresh-btn .gmes-refresh-icon { transition: transform 0.35s; }
        #gmes-manual-overlay .gmes-refresh-btn:hover .gmes-refresh-icon { transform: rotate(180deg); }
        #gmes-manual-overlay .gmes-exception-btn { position: relative; }
        #gmes-manual-overlay .gmes-exception-tooltip {
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
          z-index: 10002;
        }
        #gmes-manual-overlay .gmes-exception-btn:hover .gmes-exception-tooltip { display: block; }

        #gmes-manual-overlay .gmes-content {
          padding: 14px 16px 10px;
        }
        #gmes-manual-overlay .gmes-field {
          margin-bottom: 9px;
          position: relative;
        }
        #gmes-manual-overlay .gmes-field-label {
          font-weight: 700;
          color: #80868b;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 2px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        #gmes-manual-overlay .gmes-field-value {
          color: #202124;
          word-break: break-word;
          font-size: 13.5px;
          line-height: 1.4;
        }
        #gmes-manual-overlay .gmes-field-value a {
          color: #1a73e8;
          text-decoration: none;
        }
        #gmes-manual-overlay .gmes-field-value a:hover { text-decoration: underline; }
        #gmes-manual-overlay .gmes-divider {
          height: 1px;
          background: #f1f3f4;
          margin: 10px 0;
        }
        #gmes-manual-overlay .gmes-add-btn {
          width: 100%;
          padding: 11px;
          background: #34a853;
          color: white;
          border: none;
          border-radius: 9px;
          font-size: 13.5px;
          font-weight: 700;
          cursor: pointer;
          margin-top: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          transition: background 0.18s, transform 0.12s, box-shadow 0.18s;
          font-family: inherit;
        }
        #gmes-manual-overlay .gmes-add-btn:hover {
          background: #2b8c46;
          transform: translateY(-1px);
          box-shadow: 0 3px 10px rgba(52,168,83,0.28);
        }
        #gmes-manual-overlay .gmes-add-btn:active { transform: translateY(0); box-shadow: none; }
        #gmes-manual-overlay .gmes-add-btn:disabled {
          background: #e0e0e0;
          color: #9e9e9e;
          cursor: not-allowed;
          transform: none !important;
          box-shadow: none !important;
        }
        #gmes-manual-overlay .gmes-add-btn.already-added {
          background: #5f6368;
          cursor: default;
        }
        #gmes-manual-overlay .gmes-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 9px;
          font-size: 11px;
          color: #9aa0a6;
          padding-bottom: 2px;
        }
        #gmes-manual-overlay .gmes-shortcut-hint {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        #gmes-manual-overlay .gmes-settings-icon {
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          color: #9aa0a6;
          transition: color 0.15s;
          background: none;
          border: none;
          font-family: inherit;
          font-size: 11px;
          padding: 0;
        }
        #gmes-manual-overlay .gmes-settings-icon:hover { color: #5f6368; }
        /* Suggestions */
        #gmes-manual-overlay .suggestions-box {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: white;
          border: 1.5px solid #e2e5eb;
          border-top: none;
          border-radius: 0 0 8px 8px;
          max-height: 150px;
          overflow-y: auto;
          box-shadow: 0 6px 16px rgba(0,0,0,0.1);
          display: none;
          z-index: 10001;
        }
        #gmes-manual-overlay .suggestion-item {
          padding: 8px 12px;
          cursor: pointer;
          border-bottom: 1px solid #f1f3f4;
          color: #3c4043;
          font-size: 13px;
          transition: background 0.12s;
        }
        #gmes-manual-overlay .suggestion-item:last-child { border-bottom: none; }
        #gmes-manual-overlay .suggestion-item:hover { background: #f8f9fa; color: #1a73e8; }
      </style>
      <div class="gmes-header">
        <div class="gmes-header-left">
          <img src="${chrome.runtime.getURL('icon.png')}" class="gmes-header-logo" alt="">
          <span>Quick Add</span>
        </div>
        <div class="gmes-header-actions">
          <button class="gmes-hbtn gmes-refresh-btn" id="gmes-refresh-btn" title="Refresh data">
            <svg class="gmes-refresh-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <div class="gmes-hbtn gmes-exception-btn" id="gmes-exception-btn" title="Don't auto-open on this site">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span class="gmes-exception-tooltip">Add to exceptions<br>(won't auto-open here)</span>
          </div>
          <button class="gmes-hbtn" id="gmes-close-btn" title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="gmes-content">
        <div class="gmes-field">
          <div class="gmes-field-label">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Name
          </div>
          <div class="gmes-field-value">${escapeHtml(item.title) || '<em style="color:#9aa0a6">N/A</em>'}</div>
        </div>
        <div class="gmes-field">
          <div class="gmes-field-label">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Rating
          </div>
          <div class="gmes-field-value">${escapeHtml(item.rating) || '—'} ★ ${escapeHtml(item.reviewCount) || ''}</div>
        </div>
        <div class="gmes-field">
          <div class="gmes-field-label">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Category
          </div>
          <div class="gmes-field-value">${escapeHtml(item.industry) || '<em style="color:#9aa0a6">N/A</em>'} ${item.expensiveness ? '<span style="color:#5f6368;font-size:12px">' + escapeHtml(item.expensiveness) + '</span>' : ''}</div>
        </div>
        <div class="gmes-field">
          <div class="gmes-field-label">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.07 13.93 19.79 19.79 0 0 1 1 5.18C1 4.09 1.81 3 2.92 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 10.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 17.9v3z"/></svg>
            Phone
          </div>
          <div class="gmes-field-value">${(function() {
            if (item.phones && item.phones.length > 0) {
                var primary = formatPhoneDisplay(item.phones[0].number);
                if (item.phones.length > 1) {
                    var extra = item.phones.length - 1;
                    var tooltip = item.phones.slice(1).map(function(p) { return formatPhoneDisplay(p.number); }).join(', ');
                    return escapeHtml(primary) + ' <span style="color:#1a73e8;font-size:11px;cursor:help;" title="' + escapeHtml(tooltip) + '">(+' + extra + ' more)</span>';
                }
                return escapeHtml(primary);
            }
            return item.phone ? escapeHtml(formatPhoneDisplay(item.phone)) : '<em style="color:#9aa0a6">N/A</em>';
          })()}</div>
        </div>
        <div class="gmes-field">
          <div class="gmes-field-label">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            Address
          </div>
          <div class="gmes-field-value">${escapeHtml(item.address) || '<em style="color:#9aa0a6">N/A</em>'}</div>
        </div>
        <div class="gmes-field">
          <div class="gmes-field-label">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            Website
          </div>
          <div class="gmes-field-value">${item.companyUrl ? '<a id="gmes-website-link" href="' + escapeHtml(item.companyUrl) + '" target="_blank">' + escapeHtml((function(u){try{return new URL(u).hostname;}catch(e){return u;};})(item.companyUrl)) + '</a>' : '<span id="gmes-website-link" data-search="true"><em style="color:#9aa0a6">N/A</em></span>'}</div>
        </div>
        <div class="gmes-divider"></div>
        <div class="gmes-field">
          <div class="gmes-field-label">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Note <span style="color:#9aa0a6; margin-left:4px; font-weight:500;">(optional)</span>
          </div>
          <textarea id="gmes-note-input" class="note-input" placeholder="Add a note (optional)" autocomplete="off"></textarea>
          <div id="gmes-suggestions-box" class="suggestions-box"></div>
        </div>
        <button class="gmes-add-btn" id="gmes-add-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add to List <span style="font-size:11px; opacity:0.8; font-weight:400;">(Alt+Shift+S)</span>
        </button>
        <div id="gmes-crm-status" style="display:none; margin-top:8px; padding:7px 12px; border-radius:8px; font-size:13px; font-weight:600; text-align:center;"></div>
        <button id="gmes-crm-btn" style="display:none; width:100%; margin-top:8px; padding:10px; background:#6f42c1; color:white; border:none; border-radius:9px; font-size:13px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; font-family:inherit;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          Send to CRM
        </button>
        <div class="gmes-footer">
          <span class="gmes-shortcut-hint">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            Alt+Shift+W &mdash; Open Website
          </span>
          <button id="gmes-settings-btn" class="gmes-settings-icon" title="Change shortcuts">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Shortcuts
          </button>
        </div>
      </div>
    `;

        document.body.appendChild(overlay);

        // Add CSS for note input
        const style = document.createElement('style');
        style.textContent = `
            #gmes-manual-overlay .note-input {
                width: 100%;
                padding: 9px 11px;
                border: 1.5px solid #e2e5eb;
                border-radius: 8px;
                font-family: inherit;
                font-size: 13.5px;
                resize: vertical;
                min-height: 62px;
                box-sizing: border-box;
                margin-top: 4px;
                transition: border-color 0.18s;
                color: #202124;
                background: #fafafa;
            }
            #gmes-manual-overlay .note-input.error {
                border-color: #ea4335;
                background-color: #fff8f7;
                outline: none;
            }
            #gmes-manual-overlay .note-input:focus {
                border-color: #1a73e8;
                background: #fff;
                outline: none;
            }
            #gmes-manual-overlay .gmes-exception-btn {
                cursor: pointer;
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
        const refreshBtn = document.getElementById('gmes-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                createOverlay();
            });
        }

        // Close button handler
        document.getElementById('gmes-close-btn').addEventListener('click', () => {
            overlay.remove();
            style.remove();
            chrome.storage.local.set({ gmes_overlay_dismissed: true });
        });

        // Exception button handler — add current site to exceptions so overlay won't auto-open
        const exceptionBtn = document.getElementById('gmes-exception-btn');
        if (exceptionBtn) {
            exceptionBtn.addEventListener('click', () => {
                const hostname = window.location.hostname;
                chrome.runtime.sendMessage({ type: 'ADD_EXCEPTION_SITE', hostname: hostname }, () => {
                    overlay.remove();
                    style.remove();
                    // Show brief toast
                    const toast = document.createElement('div');
                    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(30,30,40,0.92);color:white;padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:2147483647;font-family:system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.22);';
                    toast.textContent = hostname + ' added to exceptions';
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 2800);
                });
            });
        }

        // Settings button handler
        document.getElementById('gmes-settings-btn').addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'OPEN_SHORTCUTS_SETTINGS' });
        });

        // Add button handler
        const addBtn = document.getElementById('gmes-add-btn');

        addBtn.addEventListener('click', () => {
            const noteInput = document.getElementById('gmes-note-input');
            const noteValue = noteInput.value.trim();

            noteInput.classList.remove('error');

            // Save note to history (only if user actually entered one)
            if (noteValue) saveNoteToHistory(noteValue);

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

        // Check CRM status and wire Send to CRM button
        const crmStatusDiv = document.getElementById('gmes-crm-status');
        const crmBtn = document.getElementById('gmes-crm-btn');
        if (crmStatusDiv && crmBtn) {
            pbIsLoggedIn_maps((loggedIn) => {
                if (!loggedIn) {
                    crmBtn.style.display = 'flex';
                    crmBtn.disabled = true;
                    crmBtn.style.opacity = '0.55';
                    crmBtn.style.cursor = 'not-allowed';
                    crmBtn.title = 'Login to TableTurnerr CRM to enable';
                    crmStatusDiv.innerHTML = '\uD83D\uDD12 Login to TableTurnerr CRM to send leads. <a href="#" id="gmes-crm-login-link" style="color:#1a73e8;font-weight:700;text-decoration:underline;">Login \u2192</a>';
                    crmStatusDiv.style.background = '#fff8e1';
                    crmStatusDiv.style.color = '#5f4b1c';
                    crmStatusDiv.style.display = 'block';
                    const loginLink = document.getElementById('gmes-crm-login-link');
                    if (loginLink) {
                        loginLink.addEventListener('click', (e) => {
                            e.preventDefault();
                            chrome.runtime.sendMessage({ type: 'OPEN_CRM_LOGIN' });
                        });
                    }
                    return;
                }
                pbCheckDuplicate_maps(item.title, item.phone, (inCrm) => {
                if (inCrm) {
                    crmStatusDiv.textContent = '✓ Already in CRM';
                    crmStatusDiv.style.background = '#e8f5e9';
                    crmStatusDiv.style.color = '#34a853';
                    crmStatusDiv.style.display = 'block';
                } else {
                    crmBtn.style.display = 'flex';
                    crmBtn.addEventListener('click', () => {
                        const freshItem = scrapeCurrentPlace();
                        const noteInput = document.getElementById('gmes-note-input');
                        if (noteInput) freshItem.note = noteInput.value.trim();

                        // Show confirmation modal
                        showCrmConfirmation_maps(freshItem, () => {
                            crmBtn.disabled = true;
                            crmBtn.textContent = 'Sending to CRM…';
                            pbSendToCrm_maps(freshItem, (result) => {
                                if (result.success) {
                                    crmBtn.style.display = 'none';
                                    crmStatusDiv.textContent = '✓ Synced to CRM';
                                    crmStatusDiv.style.background = '#e8f5e9';
                                    crmStatusDiv.style.color = '#34a853';
                                    crmStatusDiv.style.display = 'block';
                                    // Auto-add to local list
                                    freshItem.crmSynced = true;
                                    freshItem.crmId = result.recordId;
                                    chrome.runtime.sendMessage({ type: 'MANUAL_ADD_ITEM', item: freshItem });
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
            });
        }

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
