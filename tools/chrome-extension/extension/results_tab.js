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

// Resolve a business's IANA timezone (e.g. "America/Chicago") from its scraped
// latitude/longitude using the bundled tz_lookup.js (global tzlookup). Returns ''
// when coordinates are missing/unparseable or the lookup is unavailable. This zone
// name is what the Google Sheet uses to render the live local time per location.
function tzFromLatLng(lat, lng) {
    var la = parseFloat(lat), ln = parseFloat(lng);
    if (!isFinite(la) || !isFinite(ln)) return '';
    if (typeof tzlookup !== 'function') return '';
    try { return tzlookup(la, ln) || ''; } catch (e) { return ''; }
}

// Condenses a scraped weekly schedule into a compact, readable form for display.
// The raw value looks like "Monday: 9 AM–5 PM; Tuesday: 9 AM–5 PM; …"; we sort by
// the calendar week, merge runs of adjacent days that share the same hours, and use
// short day names, e.g. "Mon-Wed: 9AM-5PM, Thu: 10AM-4PM, Fri-Sun: Closed".
// Anything that isn't a per-day breakdown ("Open 24 hours", "Temporarily closed",
// a one-line status) is returned lightly normalized, unchanged in meaning.
function formatBusinessTimings(raw) {
    if (!raw) return '';
    var DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    var SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

    // Tidy one hours value: drop the space before AM/PM and normalise the dash so
    // "9 AM – 5 PM" / "9 AM to 5 PM" both become "9AM-5PM". Leaves "Closed",
    // "Open 24 hours" and the like untouched.
    function normHours(h) {
        return String(h)
            .replace(/\s+/g, ' ')
            .replace(/(\d)\s*(?::(\d{2}))?\s*([AP])\.?\s*M\.?/gi, function (_, hh, mm, ap) {
                return hh + (mm ? ':' + mm : '') + ap.toUpperCase() + 'M';
            })
            .replace(/\s*(?:–|—|-|\bto\b)\s*/g, '-')
            .trim();
    }

    // Split into "Day: hours" segments. The hours run from the first colon to the
    // segment end (so "9:30" times survive); the day is the first weekday token in
    // the label, ignoring any holiday note Google appends.
    var segments = String(raw).split(';');
    var schedule = [];
    for (var i = 0; i < segments.length; i++) {
        var seg = segments[i].trim();
        if (!seg) continue;
        var ci = seg.indexOf(':');
        if (ci === -1) continue;
        var dm = seg.slice(0, ci).match(/(mon|tue|wed|thu|fri|sat|sun)/i);
        if (!dm) continue;
        schedule.push({ day: dm[1].slice(0, 3).toLowerCase(), hours: normHours(seg.slice(ci + 1)) });
    }

    if (!schedule.length) return normHours(raw);

    schedule.sort(function (a, b) { return DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day); });

    // Merge calendar-adjacent days with identical hours into ranges. A missing day
    // (e.g. a closed day Google didn't list) breaks the run automatically.
    var groups = [];
    for (var j = 0; j < schedule.length; j++) {
        var cur = schedule[j];
        var last = groups[groups.length - 1];
        if (last && last.hours === cur.hours && DAY_ORDER.indexOf(cur.day) === DAY_ORDER.indexOf(last.end) + 1) {
            last.end = cur.day;
        } else {
            groups.push({ start: cur.day, end: cur.day, hours: cur.hours });
        }
    }

    return groups.map(function (g) {
        var label = g.start === g.end ? SHORT[g.start] : SHORT[g.start] + '-' + SHORT[g.end];
        return label + ': ' + g.hours;
    }).join(', ');
}

// ============================================================================
// GoHighLevel send (results tab)
// ============================================================================
function escapeHtmlModal(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Active target sub-account (Location). Kept in sync with #ghlLocationPicker and
// the stored gmes_ghl_default_location. getActiveLocationId() returns the picker
// value when present, otherwise the cached default.
var gmesActiveLocationId = '';
function getActiveLocationId() {
    var picker = document.getElementById('ghlLocationPicker');
    if (picker && picker.value) return picker.value;
    return gmesActiveLocationId || '';
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
        'Send to GoHighLevel</div>' +
        '<div style="padding:16px 18px;max-height:50vh;overflow-y:auto;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Company</td><td style="padding:6px 0;color:#202124;">' + escapeHtmlModal(item.title || 'Unknown') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Location</td><td style="padding:6px 0;color:#202124;">' + escapeHtmlModal((item.address || '') + (item.city ? ', ' + item.city : '') || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Phone(s)</td><td style="padding:6px 0;color:#202124;">' + phonesDisplay + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Rating</td><td style="padding:6px 0;color:#202124;">' + escapeHtmlModal(item.rating || '0') + ' \u2605 ' + escapeHtmlModal((item.reviewCount || '').replace(/[()]/g, '')) + ' reviews</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Website</td><td style="padding:6px 0;color:#202124;word-break:break-all;">' + escapeHtmlModal(item.companyUrl || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Sub-Account</td><td style="padding:6px 0;color:#202124;">' +
        '<select id="gmes-confirm-location" style="width:100%;padding:6px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
        '<option value="">\u2014 Select sub-account \u2014</option></select></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Tag</td><td style="padding:6px 0;color:#202124;">' +
        '<select id="gmes-confirm-tag" style="width:100%;padding:6px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
        '<option value="">\u2014 None \u2014</option></select></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Assign To</td><td style="padding:6px 0;color:#202124;">' +
        '<select id="gmes-confirm-assignee" style="width:100%;padding:6px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
        '<option value="">\u2014 Unassigned \u2014</option></select>' +
        '<div style="font-size:11px;color:#5f6368;margin-top:4px;">Picking a user routes the lead straight to them.</div></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Opportunity</td><td style="padding:6px 0;color:#202124;">' +
        '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12.5px;"><input type="checkbox" id="gmes-confirm-createopp" style="width:15px;height:15px;cursor:pointer;">Create opportunity</label></td></tr>' +
        '<tr id="gmes-confirm-pipeline-row"><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Pipeline</td><td style="padding:6px 0;color:#202124;">' +
        '<select id="gmes-confirm-pipeline" style="width:100%;padding:6px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
        '<option value="">\u2014 Select pipeline \u2014</option></select></td></tr>' +
        '<tr id="gmes-confirm-stage-row"><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Stage</td><td style="padding:6px 0;color:#202124;">' +
        '<select id="gmes-confirm-stage" style="width:100%;padding:6px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
        '<option value="">\u2014 Select stage \u2014</option></select></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:#5f6368;white-space:nowrap;vertical-align:top;">Note</td><td style="padding:6px 0;color:#202124;">' +
        '<textarea id="gmes-confirm-note" style="width:100%;min-height:60px;padding:6px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;resize:vertical;">' + escapeHtmlModal(item.note || '') + '</textarea></td></tr>' +
        '</table></div>' +
        '<div style="padding:12px 18px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid #e2e5eb;">' +
        '<button id="gmes-confirm-cancel" style="padding:8px 18px;border:1.5px solid #e2e5eb;border-radius:8px;background:#fff;color:#3c4043;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
        '<button id="gmes-confirm-send" style="padding:8px 18px;border:none;border-radius:8px;background:#1a73e8;color:white;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Confirm &amp; Send</button>' +
        '</div></div>';

    document.body.appendChild(modal);

    var locationSelect = document.getElementById('gmes-confirm-location');
    var tagSelect = document.getElementById('gmes-confirm-tag');
    var assigneeSelect = document.getElementById('gmes-confirm-assignee');
    var createOppCheck = document.getElementById('gmes-confirm-createopp');
    var pipelineSelect = document.getElementById('gmes-confirm-pipeline');
    var stageSelect = document.getElementById('gmes-confirm-stage');
    var pipelineRow = document.getElementById('gmes-confirm-pipeline-row');
    var stageRow = document.getElementById('gmes-confirm-stage-row');
    var noteInput = document.getElementById('gmes-confirm-note');

    function toggleOppRows() {
        var show = createOppCheck.checked ? '' : 'none';
        pipelineRow.style.display = show;
        stageRow.style.display = show;
    }

    // Populate the stage select for a given pipeline id from the cached list.
    var pipelineCache = [];
    function populateStages(pipelineId, preselectStage) {
        stageSelect.innerHTML = '<option value="">\u2014 Select stage \u2014</option>';
        var pl = null;
        for (var i = 0; i < pipelineCache.length; i++) {
            if (pipelineCache[i].id === pipelineId) { pl = pipelineCache[i]; break; }
        }
        if (!pl) return;
        (pl.stages || []).forEach(function (s) {
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            if (s.id === preselectStage) opt.selected = true;
            stageSelect.appendChild(opt);
        });
    }

    // Fill the tag select for a location (force re-fetches past the cache).
    function fillTags(locationId, preselect, force) {
        tagSelect.innerHTML = '<option value="">\u2014 None \u2014</option>';
        if (!locationId) return;
        GHL.fetchTags(locationId, Boolean(force), function (tags) {
            (tags || []).forEach(function (t) {
                var opt = document.createElement('option');
                opt.value = t.name;
                opt.textContent = t.name;
                if (t.name === preselect) opt.selected = true;
                tagSelect.appendChild(opt);
            });
            GHL.appendCreateTagOption(tagSelect);
        });
    }

    // (Re)populate tag / assignee / pipeline selects for a location, applying defaults.
    function populateForLocation(locationId, defaults) {
        defaults = defaults || {};
        assigneeSelect.innerHTML = '<option value="">\u2014 Unassigned \u2014</option>';
        pipelineSelect.innerHTML = '<option value="">\u2014 Select pipeline \u2014</option>';
        stageSelect.innerHTML = '<option value="">\u2014 Select stage \u2014</option>';
        pipelineCache = [];
        fillTags(locationId, item.ghlTag || defaults.tag || '');
        if (!locationId) return;

        GHL.fetchUsers(locationId, false, function (users) {
            var preselect = item.ghlAssignee || defaults.assignee || '';
            (users || []).forEach(function (u) {
                var opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.name + (u.email ? ' (' + u.email + ')' : '');
                if (u.id === preselect) opt.selected = true;
                assigneeSelect.appendChild(opt);
            });
        });

        GHL.fetchPipelines(locationId, false, function (pipelines) {
            pipelineCache = pipelines || [];
            var preselectPipeline = defaults.pipeline || '';
            pipelineCache.forEach(function (p) {
                var opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                if (p.id === preselectPipeline) opt.selected = true;
                pipelineSelect.appendChild(opt);
            });
            if (pipelineSelect.value) populateStages(pipelineSelect.value, defaults.stage || '');
        });
    }

    chrome.storage.local.get([
        'gmes_ghl_default_location', 'gmes_ghl_default_tag', 'gmes_ghl_default_assignee',
        'gmes_ghl_create_opp', 'gmes_ghl_default_pipeline', 'gmes_ghl_default_stage'
    ], function (data) {
        var activeLoc = getActiveLocationId() || data.gmes_ghl_default_location || '';
        var defaults = {
            tag: data.gmes_ghl_default_tag || '',
            assignee: data.gmes_ghl_default_assignee || '',
            pipeline: data.gmes_ghl_default_pipeline || '',
            stage: data.gmes_ghl_default_stage || ''
        };
        createOppCheck.checked = data.gmes_ghl_create_opp !== false;
        toggleOppRows();

        GHL.fetchLocations(false, function (locs) {
            (locs || []).forEach(function (l) {
                var opt = document.createElement('option');
                opt.value = l.id;
                opt.textContent = l.name;
                if (l.id === activeLoc) opt.selected = true;
                locationSelect.appendChild(opt);
            });
            if (!locationSelect.value && activeLoc) locationSelect.value = activeLoc;
            populateForLocation(locationSelect.value, defaults);
        });

        locationSelect.addEventListener('change', function () {
            populateForLocation(locationSelect.value, defaults);
        });
    });

    createOppCheck.addEventListener('change', toggleOppRows);
    pipelineSelect.addEventListener('change', function () { populateStages(pipelineSelect.value, ''); });
    GHL.wireCreateTag(tagSelect, function () { return locationSelect.value; }, function (newName) {
        fillTags(locationSelect.value, newName, true);
    });

    document.getElementById('gmes-confirm-cancel').addEventListener('click', function () { modal.remove(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.getElementById('gmes-confirm-send').addEventListener('click', function () {
        if (!locationSelect.value) { alert('Please select a sub-account.'); return; }
        item.ghl = {
            locationId: locationSelect.value,
            tag: tagSelect.value || '',
            assignedTo: assigneeSelect.value || '',
            createOpp: createOppCheck.checked,
            pipelineId: pipelineSelect.value || '',
            stageId: stageSelect.value || '',
            note: noteInput.value || ''
        };
        item.ghlTag = item.ghl.tag;
        item.ghlAssignee = item.ghl.assignedTo;
        modal.remove();
        onConfirm();
    });
}

document.addEventListener('DOMContentLoaded', function () {
    // Show extension version in header (read from manifest so it stays in sync)
    try {
        const verEl = document.getElementById('pageVersionBadge');
        if (verEl && chrome.runtime && chrome.runtime.getManifest) {
            verEl.textContent = 'v' + chrome.runtime.getManifest().version;
        }
    } catch (e) {}

    const table = document.getElementById('resultsTable');
    const tbody = table.querySelector('tbody');
    const stats = document.getElementById('stats');
    const exportBtn = document.getElementById('exportBtn');
    const sendAllBtn = document.getElementById('sendAllBtn');
    const backfillEmailsBtn = document.getElementById('backfillEmailsBtn');
    const rescanNoEmailBtn = document.getElementById('rescanNoEmailBtn');
    const sendAllCount = document.getElementById('sendAllCount');
    const locationPicker = document.getElementById('ghlLocationPicker');
    const connectLink = document.getElementById('ghlConnectLink');

    // ---- Sub-account (Location) picker ------------------------------------
    // Its value is the active target location for per-row + bulk sends.
    function initLocationPicker() {
        if (!locationPicker) return;
        chrome.storage.local.get(['gmes_ghl_default_location'], function (data) {
            const storedDefault = data.gmes_ghl_default_location || '';
            gmesActiveLocationId = storedDefault;
            GHL.fetchLocations(false, function (locs) {
                while (locationPicker.options.length > 1) locationPicker.remove(1);
                (locs || []).forEach(function (l) {
                    const opt = document.createElement('option');
                    opt.value = l.id;
                    opt.textContent = l.name;
                    if (l.id === storedDefault) opt.selected = true;
                    locationPicker.appendChild(opt);
                });
                if (storedDefault) locationPicker.value = storedDefault;
                gmesActiveLocationId = locationPicker.value || storedDefault;
            });
        });
        locationPicker.addEventListener('change', function () {
            gmesActiveLocationId = locationPicker.value || '';
            chrome.storage.local.set({ gmes_ghl_default_location: gmesActiveLocationId });
            // Refresh any open confirm modal selectors for the new location.
            const openLocSelect = document.getElementById('gmes-confirm-location');
            if (openLocSelect && openLocSelect.value !== gmesActiveLocationId) {
                openLocSelect.value = gmesActiveLocationId;
                const ev = new Event('change');
                openLocSelect.dispatchEvent(ev);
            }
        });
    }

    function updateConnectUi() {
        GHL.isConnected(function (connected) {
            if (connectLink) connectLink.style.display = connected ? 'none' : 'inline';
            if (locationPicker) locationPicker.disabled = !connected;
        });
    }
    if (connectLink) {
        connectLink.addEventListener('click', function (e) {
            e.preventDefault();
            chrome.runtime.sendMessage({ type: 'OPEN_CRM_LOGIN' });
        });
    }

    // Ignore lists
    let ignoreNamesSet = new Set();
    let ignoreIndustriesSet = new Set();
    // All items (module-level) so CRM sync can persist back to storage
    let allItems = [];
    // Map href/key -> { row, statusCell, statusBtn } so bulk-send can update rows live
    const rowIndex = new Map();
    // When opened from the popup's "Send All to GHL" button (results_tab.html?sendAll=1),
    // auto-launch the review/confirm modal once the leads have loaded.
    let autoSendAllPending = new URLSearchParams(location.search).get('sendAll') === '1';

    function loadData() {
        chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries'], function (data) {
            // Update ignore sets
            ignoreNamesSet.clear();
            (data.gmes_ignore_names || []).forEach(s => ignoreNamesSet.add(String(s).toLowerCase().trim()));

            ignoreIndustriesSet.clear();
            (data.gmes_ignore_industries || []).forEach(s => ignoreIndustriesSet.add(String(s).toLowerCase().trim()));

            const raw = Array.isArray(data.gmes_results) ? data.gmes_results : [];
            const deduped = [];
            const seenKeys = new Set();
            raw.forEach(item => {
                const key = itemKey(item);
                if (!key || seenKeys.has(key)) return;
                seenKeys.add(key);
                deduped.push(item);
            });
            if (deduped.length !== raw.length) {
                chrome.storage.local.set({ gmes_results: deduped });
            }
            allItems = deduped;
            renderTable(allItems);

            if (autoSendAllPending) {
                autoSendAllPending = false;
                GHL.isConnected(loggedIn => {
                    if (!loggedIn) {
                        alert('Login to GoHighLevel first. Open the extension popup and click "Connect GoHighLevel".');
                        return;
                    }
                    showSendAllModal();
                });
            }
        });
    }

    function itemIsIgnored(item) {
        if (!item) return false;
        if (chainNameMatchesIgnoreList(item.title, ignoreNamesSet)) return true;
        if (industryMatchesIgnoreList(item.industry, ignoreIndustriesSet)) return true;
        return false;
    }

    // Normalized phone digits (primary number) or '' — mirror of background.js.
    function phoneDigits(item) {
        let raw = '';
        if (item) {
            if (item.phone) raw = String(item.phone);
            else if (Array.isArray(item.phones) && item.phones.length && item.phones[0]) raw = String(item.phones[0].number || '');
        }
        let d = raw.replace(/\D/g, '');
        if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
        return d.length >= 7 ? d : '';
    }

    // Stable identity for de-duplication. The phone number is the strongest signal
    // (unique per business, while names/addresses can collide), so it's preferred;
    // otherwise fall back to Google's stable feature id (0x..:0x.. in the data=
    // blob), then the place's !3d/!4d coords, then title+address. Mirror of
    // placeIdentity() in background.js.
    function placeIdentity(item) {
        if (!item) return '';
        const pd = phoneDigits(item);
        if (pd) return 'ph:' + pd;
        const href = String(item.href || '');
        let m = href.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
        if (m) return 'cid:' + m[1].toLowerCase();
        m = href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        if (m) return 'geo:' + m[1] + ',' + m[2];
        const title = (item.title || '').toLowerCase().trim();
        const addr = (item.address || '').toLowerCase().trim();
        if (title && addr) return 'ta:' + title + '|' + addr;
        const pathMatch = href.match(/\/maps\/place\/([^/@?]+)/);
        if (pathMatch) { try { return 'path:' + decodeURIComponent(pathMatch[1]).toLowerCase(); } catch (e) { return 'path:' + pathMatch[1].toLowerCase(); } }
        if (title) return 'title:' + title;
        return href;
    }

    function itemKey(item) {
        return placeIdentity(item);
    }

    function hasContactInfo(item) {
        if (!item) return false;
        const hasPhone = (Array.isArray(item.phones) && item.phones.length) || item.phone;
        return Boolean(hasPhone || item.email);
    }

    // Un-synced lead still waiting to be created in GHL.
    function isSendable(item) {
        if (!item) return false;
        if (item.crmSynced) return false;
        if (itemIsIgnored(item)) return false;
        return true;
    }

    // Eligible for Send All: any lead with contact info that isn't ignored —
    // including leads already in GHL, which are re-sent to backfill their empty
    // fields (the backend never creates a duplicate, it updates the existing one).
    function isBackfillable(item) {
        if (!item) return false;
        if (itemIsIgnored(item)) return false;
        return hasContactInfo(item);
    }

    function refreshSendAllButton() {
        const eligible = allItems.filter(isBackfillable).length;
        const unsynced = allItems.filter(isSendable).length;
        if (sendAllCount) sendAllCount.textContent = String(eligible);
        if (!sendAllBtn) return;
        GHL.isConnected(loggedIn => {
            sendAllBtn.disabled = !loggedIn || eligible === 0;
            if (!loggedIn) sendAllBtn.title = 'Login to GoHighLevel first (use the extension popup → Connect)';
            else if (eligible === 0) sendAllBtn.title = 'No leads with a phone or email to send';
            else sendAllBtn.title = `Send ${eligible} lead${eligible === 1 ? '' : 's'} to GoHighLevel — ${unsynced} new, ${eligible - unsynced} already in GHL (empty fields filled)`;
        });
    }

    function markRowSynced(item) {
        const entry = rowIndex.get(itemKey(item));
        if (!entry) return;
        renderCrmCell(item, entry.statusCell);
    }

    // Render the GHL status cell: a "Send to GHL" button when the lead is
    // un-synced, or a "✓ In GHL" label paired with an Undo button once it's in
    // GoHighLevel. Used everywhere the cell is (re)drawn so the two states and the
    // undo flow stay consistent across initial render, dedup, and bulk send.
    function renderCrmCell(item, td) {
        if (item.crmSynced) renderSyncedState(item, td);
        else renderSendState(item, td);
    }

    function renderSyncedState(item, td, labelText) {
        td.innerHTML = '';
        td.style.color = '';
        td.style.fontWeight = '';
        const wrap = document.createElement('span');
        wrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px;';

        const label = document.createElement('span');
        label.textContent = labelText || '✓ In GHL';
        label.style.cssText = 'color:#34a853;font-weight:600;';
        wrap.appendChild(label);

        // Update: re-send to fill any GHL fields that are still empty (the backend
        // only backfills blanks and never creates a duplicate).
        const updateBtn = document.createElement('button');
        updateBtn.textContent = 'Update';
        updateBtn.style.cssText = 'padding:3px 10px;font-size:11px;background:#fff;color:#1a73e8;border:1.5px solid #1a73e8;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:600;';
        updateBtn.title = 'Fill any empty fields in GoHighLevel from the scraped data';
        updateBtn.addEventListener('click', () => {
            showCrmConfirmation(item, () => {
                updateBtn.disabled = true;
                updateBtn.textContent = 'Updating…';
                GHL.sendLead((item.ghl && item.ghl.locationId) || getActiveLocationId(), item, item.ghl, (result) => {
                    if (result.success) {
                        item.crmSynced = true;
                        if (result.contactId) { item.ghlContactId = result.contactId; item.crmExistingId = result.contactId; }
                        if (result.opportunityId) item.ghlOpportunityId = result.opportunityId;
                        chrome.storage.local.set({ gmes_results: allItems });
                        renderSyncedState(item, td, '✓ In GHL (updated)');
                    } else {
                        updateBtn.disabled = false;
                        updateBtn.textContent = 'Update';
                        alert('GHL update failed: ' + (result.error || 'Unknown error'));
                    }
                });
            });
        });
        wrap.appendChild(updateBtn);

        const undoBtn = document.createElement('button');
        undoBtn.textContent = 'Undo';
        undoBtn.style.cssText = 'padding:3px 10px;font-size:11px;background:#fff;color:#ea4335;border:1.5px solid #ea4335;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:600;';
        undoBtn.title = 'Remove this contact from GoHighLevel';
        undoBtn.addEventListener('click', () => {
            const contactId = item.ghlContactId || item.crmExistingId || '';
            if (!contactId) { alert('Cannot undo: no GoHighLevel contact id is recorded for this lead.'); return; }
            const locationId = (item.ghl && item.ghl.locationId) || getActiveLocationId();
            undoBtn.disabled = true;
            undoBtn.textContent = 'Undoing…';
            GHL.deleteLead(locationId, contactId, item.ghlOpportunityId || '', (res) => {
                if (res && res.success) {
                    item.crmSynced = false;
                    item.crmChecked = true; // don't auto re-flag right after removing
                    delete item.ghlContactId;
                    delete item.crmExistingId;
                    delete item.ghlOpportunityId;
                    chrome.storage.local.set({ gmes_results: allItems });
                    renderCrmCell(item, td);
                    refreshSendAllButton();
                } else {
                    undoBtn.disabled = false;
                    undoBtn.textContent = 'Undo';
                    alert('Undo failed: ' + ((res && res.error) || 'Unknown error'));
                }
            });
        });
        wrap.appendChild(undoBtn);
        td.appendChild(wrap);
    }

    function renderSendState(item, td) {
        td.innerHTML = '';
        td.style.color = '';
        td.style.fontWeight = '';
        const btn = document.createElement('button');
        btn.textContent = 'Send to GHL';
        btn.style.cssText = 'padding: 4px 10px; font-size: 12px; background: #007BFF; color: white; border: none; border-radius: 12px; cursor: pointer;';
        // Disable Send to GHL and show a Login link when not connected to GHL.
        GHL.isConnected((loggedIn) => {
            if (loggedIn) return;
            btn.disabled = true;
            btn.title = 'Login to GoHighLevel to enable';
            btn.style.cssText = 'padding: 4px 10px; font-size: 12px; background: #e8eaed; color: #80868b; border: none; border-radius: 12px; cursor: not-allowed;';
            const loginLink = document.createElement('a');
            loginLink.href = '#';
            loginLink.textContent = 'Login to GoHighLevel';
            loginLink.style.cssText = 'display:block; margin-top:4px; font-size:11px; color:#1a73e8; text-decoration:underline; font-weight:600;';
            loginLink.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.runtime.sendMessage({ type: 'OPEN_CRM_LOGIN' });
            });
            td.appendChild(loginLink);
        });
        // Async pre-check: mark rows already present in the active sub-account.
        if (!item.crmChecked) {
            item.crmChecked = true;
            const checkPhones = Array.isArray(item.phones) && item.phones.length
                ? item.phones
                : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
            GHL.checkDuplicate(getActiveLocationId(), checkPhones, item.email || '', (res) => {
                if (res && res.exists) {
                    item.crmSynced = true;
                    item.crmExistingId = res.contactId || '';
                    if (res.contactId) item.ghlContactId = res.contactId;
                    chrome.storage.local.set({ gmes_results: allItems });
                    renderSyncedState(item, td);
                    refreshSendAllButton();
                }
            });
        }
        btn.addEventListener('click', () => {
            showCrmConfirmation(item, () => {
                btn.disabled = true;
                btn.textContent = 'Sending…';
                GHL.sendLead(item.ghl.locationId, item, item.ghl, (result) => {
                    if (result.success) {
                        item.crmSynced = true;
                        item.ghlContactId = result.contactId || '';
                        item.ghlOpportunityId = result.opportunityId || '';
                        if (result.contactId) item.crmExistingId = result.contactId;
                        chrome.storage.local.set({ gmes_results: allItems });
                        renderSyncedState(item, td, result.duplicate ? '✓ In GHL (existing)' : '✓ In GHL');
                        refreshSendAllButton();
                    } else {
                        btn.disabled = false;
                        btn.textContent = 'Retry';
                        alert('GHL send failed: ' + (result.error || 'Unknown error'));
                    }
                });
            });
        });
        td.appendChild(btn);
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
            const key = itemKey(item);
            if (!key || seen.has(key)) return;
            if (itemIsIgnored(item)) return;

            seen.add(key);
            count++;
            
            const tr = document.createElement('tr');
            
            // Columns matching popup.js order
            const cols = ['title', 'note', 'businessTimings', 'rating', 'reviewCount', 'phone', 'industry', 'city', 'address', 'email', 'companyUrl', 'instaSearch', 'href', 'lat', 'lng', 'timeZone', 'crmStatus'];

            cols.forEach(colKey => {
                const td = document.createElement('td');
                const val = item[colKey] || '';

                if (colKey === 'email') {
                    const emails = Array.isArray(item.emails) && item.emails.length
                        ? item.emails
                        : (item.email ? [item.email] : []);
                    if (emails.length) {
                        td.innerHTML = emails.map(e => `<a href="mailto:${e}">${e}</a>`).join('<br>');
                    }
                } else if (colKey === 'companyUrl') {
                   let finalUrl = val;
                   if (!val || val.startsWith('https://www.google.com/maps')) {
                       finalUrl = `https://www.google.com/search?q=${encodeURIComponent((item.title || '') + ' ' + (item.city || '') + ' Website')}`;
                   }
                   td.innerHTML = `<a href="${finalUrl}" target="_blank">${finalUrl}</a>`;
                } else if (colKey === 'href') {
                    // Show a short hyperlink in the preview; the full URL is kept as
                    // the link target (and exported in full).
                    if (val) td.innerHTML = `<a href="${val}" target="_blank" title="${val}">Maps: ${escapeHtmlModal(item.title || '')}</a>`;
                } else if (colKey === 'instaSearch') {
                    if (val) td.innerHTML = `<a href="${val}" target="_blank" title="${val}">Insta: ${escapeHtmlModal(item.title || '')}</a>`;
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
                    renderCrmCell(item, td);
                } else if (colKey === 'businessTimings') {
                    // Compact "Mon-Wed: 9AM-5PM" view; full per-day schedule on hover.
                    td.textContent = formatBusinessTimings(val);
                    if (val) td.title = val;
                } else if (colKey === 'timeZone') {
                    // Derived from lat/lng (not stored on the item); the Sheet uses it
                    // to render the live local time for each location.
                    td.textContent = tzFromLatLng(item.lat, item.lng);
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

    // Website-enrichment progress indicator (driven by background's gmes_enrich_status).
    const enrichStatusEl = document.getElementById('enrichStatus');
    function renderEnrichStatus(s) {
        if (!enrichStatusEl) return;
        const pending = s && typeof s.pending === 'number' ? s.pending : 0;
        if (pending > 0) {
            enrichStatusEl.textContent = '· Scraping websites for emails… ' + pending + ' left';
            enrichStatusEl.style.display = '';
        } else {
            enrichStatusEl.style.display = 'none';
        }
    }
    chrome.storage.local.get(['gmes_enrich_status'], (d) => renderEnrichStatus(d.gmes_enrich_status));

    // Backfill button: scrape the websites of all leads that haven't been scraped
    // yet, populating empty email fields (and any extra phones). The live Email
    // column + the enrichStatus indicator reflect progress as leads complete.
    if (backfillEmailsBtn) {
        const backfillLabel = backfillEmailsBtn.innerHTML;
        backfillEmailsBtn.addEventListener('click', () => {
            backfillEmailsBtn.disabled = true;
            backfillEmailsBtn.textContent = 'Starting…';
            chrome.runtime.sendMessage({ type: 'BACKFILL_WEBSITE_EMAILS' }, (resp) => {
                const reEnable = () => { backfillEmailsBtn.disabled = false; backfillEmailsBtn.innerHTML = backfillLabel; };
                if (chrome.runtime.lastError || !resp) {
                    alert('Could not start backfill. Reload the extension and try again.');
                    reEnable();
                    return;
                }
                if (resp.disabled) {
                    alert('The extension is turned off. Switch it on from the popup, then try again.');
                    reEnable();
                    return;
                }
                if (!resp.queued) {
                    backfillEmailsBtn.textContent = '✓ All leads already scraped';
                    setTimeout(reEnable, 2500);
                    return;
                }
                backfillEmailsBtn.textContent = 'Scraping ' + resp.queued + ' site' + (resp.queued === 1 ? '' : 's') + '…';
                setTimeout(reEnable, 3000);
            });
        });
    }

    // Rescan button: re-scrape websites of all leads that have a website but no
    // email yet, even if they were previously scraped without finding anything.
    if (rescanNoEmailBtn) {
        const rescanLabel = rescanNoEmailBtn.innerHTML;
        rescanNoEmailBtn.addEventListener('click', () => {
            rescanNoEmailBtn.disabled = true;
            rescanNoEmailBtn.textContent = 'Starting…';
            chrome.runtime.sendMessage({ type: 'RESCAN_NO_EMAIL_LEADS' }, (resp) => {
                const reEnable = () => { rescanNoEmailBtn.disabled = false; rescanNoEmailBtn.innerHTML = rescanLabel; };
                if (chrome.runtime.lastError || !resp) {
                    alert('Could not start rescan. Reload the extension and try again.');
                    reEnable();
                    return;
                }
                if (resp.disabled) {
                    alert('The extension is turned off. Switch it on from the popup, then try again.');
                    reEnable();
                    return;
                }
                if (!resp.queued) {
                    rescanNoEmailBtn.textContent = '✓ All leads have emails';
                    setTimeout(reEnable, 2500);
                    return;
                }
                rescanNoEmailBtn.textContent = 'Rescanning ' + resp.queued + ' site' + (resp.queued === 1 ? '' : 's') + '…';
                setTimeout(reEnable, 3000);
            });
        });
    }

    // Live updates
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.gmes_results || changes.gmes_ignore_names || changes.gmes_ignore_industries)) {
            loadData();
        }
        if (area === 'local' && changes.gmes_enrich_status) {
            renderEnrichStatus(changes.gmes_enrich_status.newValue);
        }
    });

    // Export functionality - HTML-based .xls for link preservation
    // Multi-location: items with multiple phones get expanded into separate rows,
    // repeating the company name so each phone/location has its own row.
    exportBtn.addEventListener('click', () => {
        try {
            const headerLabels = ['Title', 'Note', 'Business Timings', 'Rating', 'Reviews', 'Phone', 'Phone Label', 'Industry', 'City', 'Address', 'Email', 'Website', 'Insta Search', 'Google Maps Link', 'Latitude', 'Longitude', 'TimeZone', 'GHL Status'];

            let html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>';
            html += '<table border="1" style="border-collapse:collapse;">';
            html += '<thead><tr>';
            headerLabels.forEach(h => { html += '<th>' + h + '</th>'; });
            html += '</tr></thead><tbody>';

            const seen = new Set();
            allItems.forEach(item => {
                const key = itemKey(item);
                if (!key || seen.has(key)) return;
                seen.add(key);

                const phones = Array.isArray(item.phones) && item.phones.length
                    ? item.phones
                    : (item.phone ? [{ number: item.phone, label: 'Main', location_name: '', location_address: '' }] : [{ number: '', label: '', location_name: '', location_address: '' }]);

                const crmStatus = item.crmSynced ? 'In GHL' : '';
                const emailDisplay = Array.isArray(item.emails) && item.emails.length
                    ? item.emails.join(', ')
                    : (item.email || '');
                const websiteUrl = item.companyUrl && !item.companyUrl.startsWith('https://www.google.com/maps')
                    ? item.companyUrl
                    : 'https://www.google.com/search?q=' + encodeURIComponent((item.title || '') + ' ' + (item.city || '') + ' Website');

                phones.forEach(p => {
                    html += '<tr>';
                    html += '<td>' + escapeHtmlModal(item.title || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.note || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(formatBusinessTimings(item.businessTimings || '')) + '</td>';
                    html += '<td>' + escapeHtmlModal(item.rating || '') + '</td>';
                    html += '<td>' + escapeHtmlModal((item.reviewCount || '').replace(/[()]/g, '')) + '</td>';
                    html += '<td>' + escapeHtmlModal(p.number ? formatPhoneDisplay(p.number) : '') + '</td>';
                    html += '<td>' + escapeHtmlModal(p.label || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.industry || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.city || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.address || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(emailDisplay) + '</td>';
                    html += '<td>' + escapeHtmlModal(websiteUrl) + '</td>';
                    html += '<td>' + escapeHtmlModal(item.instaSearch || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.href || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.lat || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(item.lng || '') + '</td>';
                    html += '<td>' + escapeHtmlModal(tzFromLatLng(item.lat, item.lng)) + '</td>';
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
    // Bulk "Send All to GoHighLevel": review every un-synced lead, then send.
    // ========================================================================
    function showSendAllModal() {
        const existing = document.getElementById('gmes-send-all-modal');
        if (existing) existing.remove();

        const pending = allItems.filter(isBackfillable);
        if (!pending.length) {
            alert('No leads with a phone or email to send.');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'gmes-send-all-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:Poppins,sans-serif;';
        modal.innerHTML =
            '<div style="background:#fff;border-radius:14px;max-width:560px;width:92%;max-height:84vh;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.25);border:1.5px solid #e2e5eb;display:flex;flex-direction:column;">' +
              '<div style="background:linear-gradient(135deg,#1e8e3e 0%,#34a853 60%,#5bc26a 100%);padding:14px 18px;color:white;font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px;">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>' +
                'Send All to GoHighLevel' +
              '</div>' +
              '<div id="gmes-send-all-body" style="padding:18px;overflow-y:auto;font-size:13px;color:#3c4043;">' +
                '<div id="gmes-send-all-summary" style="background:#f8f9fa;border:1px solid #e2e5eb;border-radius:10px;padding:14px;margin-bottom:14px;">' +
                  '<div style="font-weight:700;font-size:13.5px;margin-bottom:8px;color:#202124;">Reviewing ' + pending.length + ' lead' + (pending.length === 1 ? '' : 's') + '…</div>' +
                  '<div id="gmes-send-all-counts" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px 14px;font-size:12.5px;">' +
                    '<div><span style="font-weight:600;color:#1a73e8;">Checking GHL…</span></div>' +
                  '</div>' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:auto 1fr;gap:8px 12px;align-items:center;margin-bottom:8px;">' +
                  '<label style="font-weight:700;font-size:12px;color:#5f6368;">Sub-Account</label>' +
                  '<select id="gmes-send-all-location" style="padding:7px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
                    '<option value="">— Select sub-account —</option>' +
                  '</select>' +
                  '<label style="font-weight:700;font-size:12px;color:#5f6368;">Tag</label>' +
                  '<select id="gmes-send-all-tag" style="padding:7px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
                    '<option value="">— None —</option>' +
                  '</select>' +
                  '<label style="font-weight:700;font-size:12px;color:#5f6368;">Assign To</label>' +
                  '<select id="gmes-send-all-assignee" style="padding:7px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
                    '<option value="">— Unassigned —</option>' +
                  '</select>' +
                  '<label style="font-weight:700;font-size:12px;color:#5f6368;">Opportunity</label>' +
                  '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12.5px;"><input type="checkbox" id="gmes-send-all-createopp" style="width:15px;height:15px;cursor:pointer;">Create opportunity</label>' +
                  '<label id="gmes-send-all-pipeline-label" style="font-weight:700;font-size:12px;color:#5f6368;">Pipeline</label>' +
                  '<select id="gmes-send-all-pipeline" style="padding:7px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
                    '<option value="">— Select pipeline —</option>' +
                  '</select>' +
                  '<label id="gmes-send-all-stage-label" style="font-weight:700;font-size:12px;color:#5f6368;">Stage</label>' +
                  '<select id="gmes-send-all-stage" style="padding:7px 10px;border:1.5px solid #e2e5eb;border-radius:7px;font-family:inherit;font-size:12.5px;background:#fff;color:#202124;">' +
                    '<option value="">— Select stage —</option>' +
                  '</select>' +
                '</div>' +
                '<div style="font-size:11px;color:#5f6368;line-height:1.5;margin-top:4px;">' +
                  'Applied to <strong>every lead in this batch</strong>. Leads already in GoHighLevel are updated in place: only their empty fields are filled, and no duplicate contact is created.' +
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
        const locationSelect = document.getElementById('gmes-send-all-location');
        const tagSelect = document.getElementById('gmes-send-all-tag');
        const assigneeSelect = document.getElementById('gmes-send-all-assignee');
        const createOppCheck = document.getElementById('gmes-send-all-createopp');
        const pipelineSelect = document.getElementById('gmes-send-all-pipeline');
        const stageSelect = document.getElementById('gmes-send-all-stage');
        const pipelineLabel = document.getElementById('gmes-send-all-pipeline-label');
        const stageLabel = document.getElementById('gmes-send-all-stage-label');
        const countsEl = document.getElementById('gmes-send-all-counts');

        let canceled = false;
        cancelBtn.addEventListener('click', () => { canceled = true; modal.remove(); });
        modal.addEventListener('click', e => { if (e.target === modal) { canceled = true; modal.remove(); } });

        const buckets = { new: [], existsInGhl: [], noContact: [] };
        let pipelineCache = [];

        function toggleOppRows() {
            const show = createOppCheck.checked ? '' : 'none';
            pipelineLabel.style.display = show;
            pipelineSelect.style.display = show;
            stageLabel.style.display = show;
            stageSelect.style.display = show;
        }

        function populateStages(pipelineId, preselectStage) {
            stageSelect.innerHTML = '<option value="">— Select stage —</option>';
            let pl = null;
            for (let i = 0; i < pipelineCache.length; i++) {
                if (pipelineCache[i].id === pipelineId) { pl = pipelineCache[i]; break; }
            }
            if (!pl) return;
            (pl.stages || []).forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                if (s.id === preselectStage) opt.selected = true;
                stageSelect.appendChild(opt);
            });
        }

        // Fill the tag select for a location (force re-fetches past the cache).
        function fillTags(locationId, preselect, force) {
            tagSelect.innerHTML = '<option value="">— None —</option>';
            if (!locationId) return;
            GHL.fetchTags(locationId, Boolean(force), tags => {
                (tags || []).forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.name;
                    opt.textContent = t.name;
                    if (t.name === preselect) opt.selected = true;
                    tagSelect.appendChild(opt);
                });
                GHL.appendCreateTagOption(tagSelect);
            });
        }

        // (Re)populate tag / assignee / pipeline selects for a location.
        function populateForLocation(locationId, defaults) {
            defaults = defaults || {};
            assigneeSelect.innerHTML = '<option value="">— Unassigned —</option>';
            pipelineSelect.innerHTML = '<option value="">— Select pipeline —</option>';
            stageSelect.innerHTML = '<option value="">— Select stage —</option>';
            pipelineCache = [];
            fillTags(locationId, defaults.tag || '');
            if (!locationId) return;

            GHL.fetchUsers(locationId, false, users => {
                const preselect = defaults.assignee || '';
                (users || []).forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u.id;
                    opt.textContent = u.name + (u.email ? ' (' + u.email + ')' : '');
                    if (u.id === preselect) opt.selected = true;
                    assigneeSelect.appendChild(opt);
                });
            });
            GHL.fetchPipelines(locationId, false, pipelines => {
                pipelineCache = pipelines || [];
                const preselectPipeline = defaults.pipeline || '';
                pipelineCache.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    if (p.id === preselectPipeline) opt.selected = true;
                    pipelineSelect.appendChild(opt);
                });
                if (pipelineSelect.value) populateStages(pipelineSelect.value, defaults.stage || '');
            });
        }

        // Populate selectors using stored defaults, defaulting location to picker.
        chrome.storage.local.get([
            'gmes_ghl_default_location', 'gmes_ghl_default_tag', 'gmes_ghl_default_assignee',
            'gmes_ghl_create_opp', 'gmes_ghl_default_pipeline', 'gmes_ghl_default_stage'
        ], data => {
            const activeLoc = getActiveLocationId() || data.gmes_ghl_default_location || '';
            const defaults = {
                tag: data.gmes_ghl_default_tag || '',
                assignee: data.gmes_ghl_default_assignee || '',
                pipeline: data.gmes_ghl_default_pipeline || '',
                stage: data.gmes_ghl_default_stage || ''
            };
            createOppCheck.checked = data.gmes_ghl_create_opp !== false;
            toggleOppRows();

            GHL.fetchLocations(false, locs => {
                (locs || []).forEach(l => {
                    const opt = document.createElement('option');
                    opt.value = l.id;
                    opt.textContent = l.name;
                    if (l.id === activeLoc) opt.selected = true;
                    locationSelect.appendChild(opt);
                });
                if (!locationSelect.value && activeLoc) locationSelect.value = activeLoc;
                populateForLocation(locationSelect.value, defaults);
            });

            locationSelect.addEventListener('change', () => {
                populateForLocation(locationSelect.value, defaults);
            });
        });

        createOppCheck.addEventListener('change', toggleOppRows);
        pipelineSelect.addEventListener('change', () => populateStages(pipelineSelect.value, ''));
        GHL.wireCreateTag(tagSelect, () => locationSelect.value, newName => {
            fillTags(locationSelect.value, newName, true);
        });

        // Pre-flight: classify every pending lead via GHL.checkDuplicate.
        // Run with small concurrency so we don't hammer the backend.
        const concurrency = 4;
        let cursor = 0;
        let done = 0;

        function classify(item, cb) {
            // Already known to be in GHL from a prior check/send — straight to the
            // backfill bucket, no need to re-run the duplicate lookup.
            if (item.crmSynced && (item.crmExistingId || item.ghlContactId)) {
                buckets.existsInGhl.push(item);
                cb();
                return;
            }
            const checkPhones = Array.isArray(item.phones) && item.phones.length
                ? item.phones
                : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
            if (!checkPhones.length && !item.email) { buckets.noContact.push(item); cb(); return; }
            GHL.checkDuplicate(getActiveLocationId(), checkPhones, item.email || '', res => {
                if (res && res.exists) {
                    item.crmSynced = true;
                    item.crmExistingId = res.contactId || '';
                    if (res.contactId) item.ghlContactId = res.contactId;
                    buckets.existsInGhl.push(item);
                    markRowSynced(item);
                } else {
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
            const sending = buckets.new.length + buckets.existsInGhl.length;
            countsEl.innerHTML =
                '<div><span style="color:#5f6368;">New leads:</span> <strong style="color:#1e8e3e;">' + buckets.new.length + '</strong></div>' +
                '<div><span style="color:#5f6368;">Update existing (fill blanks):</span> <strong style="color:#1a73e8;">' + buckets.existsInGhl.length + '</strong></div>' +
                '<div><span style="color:#5f6368;">Missing phone &amp; email:</span> <strong style="color:#5f6368;">' + buckets.noContact.length + '</strong></div>' +
                '<div style="grid-column:1/-1;margin-top:4px;padding-top:8px;border-top:1px solid #e2e5eb;"><span style="color:#202124;font-weight:700;">Will send:</span> <strong style="color:#1a73e8;">' + sending + '</strong> · <span style="color:#5f6368;">Checked ' + done + ' / ' + pending.length + '</span></div>';
        }
        renderCounts();

        function finalizePreflight() {
            const sending = buckets.new.length + buckets.existsInGhl.length;
            if (sending === 0) {
                confirmBtn.textContent = 'Nothing to send';
                confirmBtn.style.opacity = '0.6';
                confirmBtn.disabled = true;
            } else {
                confirmBtn.textContent = 'Send ' + sending + ' to GHL';
                confirmBtn.style.opacity = '1';
                confirmBtn.disabled = false;
            }
        }
        pump();

        confirmBtn.addEventListener('click', () => {
            if (confirmBtn.disabled) return;
            if (!locationSelect.value) { alert('Please select a sub-account.'); return; }
            const opts = {
                tag: tagSelect.value || '',
                assignedTo: assigneeSelect.value || '',
                createOpp: createOppCheck.checked,
                pipelineId: pipelineSelect.value || '',
                stageId: stageSelect.value || ''
            };
            const locationId = locationSelect.value;
            confirmBtn.disabled = true;
            cancelBtn.textContent = 'Close when done';
            locationSelect.disabled = true;
            tagSelect.disabled = true;
            assigneeSelect.disabled = true;
            createOppCheck.disabled = true;
            pipelineSelect.disabled = true;
            stageSelect.disabled = true;
            document.getElementById('gmes-send-all-progress').style.display = 'block';
            runBulkSend(buckets, locationId, opts, modal);
        });
    }

    function runBulkSend(buckets, locationId, opts, modal) {
        // New leads first (created), then existing leads (empty fields backfilled
        // in place — the backend updates by contact id, never a duplicate).
        const queue = buckets.new.concat(buckets.existsInGhl);

        const total = queue.length;
        const label = document.getElementById('gmes-send-all-progress-label');
        const countEl = document.getElementById('gmes-send-all-progress-count');
        const bar = document.getElementById('gmes-send-all-progress-bar');
        let done = 0;
        let succeeded = 0;
        let failed = 0;
        let lastError = '';
        let aborted = false;

        // Serial sending keeps progress ordered and avoids rate-limiting.
        function next() {
            if (aborted) return;
            if (!queue.length) {
                finish();
                return;
            }
            const item = queue.shift();
            markRowSending(item, 'Sending…');
            const sendOpts = {
                tag: opts.tag,
                assignedTo: opts.assignedTo,
                note: item.note || '',
                createOpp: opts.createOpp,
                pipelineId: opts.pipelineId,
                stageId: opts.stageId
            };
            const onDone = (ok, msg) => {
                done++;
                if (ok) succeeded++; else { failed++; if (msg) lastError = msg; }
                countEl.textContent = done + ' / ' + total;
                bar.style.width = Math.round((done / total) * 100) + '%';
                label.textContent = ok
                    ? 'Sent ' + done + ' of ' + total + (failed ? ' (' + failed + ' failed)' : '')
                    : 'Failed lead — continuing…';
                if (!ok) markRowFailed(item, msg);
                chrome.storage.local.set({ gmes_results: allItems });
                setTimeout(next, 50);
            };

            GHL.sendLead(locationId, item, sendOpts, result => {
                if (result.success) {
                    item.crmSynced = true;
                    item.ghlContactId = result.contactId || '';
                    item.ghlOpportunityId = result.opportunityId || '';
                    if (result.contactId) item.crmExistingId = result.contactId;
                    markRowSynced(item);
                    onDone(true);
                } else {
                    onDone(false, result.error || 'send failed');
                }
            });
        }

        function finish() {
            var summary = 'Done — ' + succeeded + ' sent' + (failed ? ', ' + failed + ' failed' : '');
            // Surface a representative reason so a blanket failure isn't a mystery.
            if (failed && lastError) summary += ' — ' + (failed > 1 ? 'e.g. ' : '') + lastError;
            label.textContent = summary;
            label.title = lastError || '';
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
            GHL.isConnected(loggedIn => {
                if (!loggedIn) {
                    alert('Login to GoHighLevel first. Open the extension popup and click "Connect GoHighLevel".');
                    return;
                }
                showSendAllModal();
            });
        });
    }

    // Initialize the sub-account picker + connect UI.
    initLocationPicker();
    updateConnectUi();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.gmes_ghl_session || changes.gmes_ghl_api_base)) {
            updateConnectUi();
            refreshSendAllButton();
        }
    });
});