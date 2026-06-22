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

    var ghl = item.ghl || {};
    var selectStyle = 'width:100%;padding:6px 10px;border:1.5px solid var(--border,#e2e5eb);border-radius:7px;font-family:inherit;font-size:12.5px;background:var(--surface,#fff);color:var(--text,#202124);';

    var modal = document.createElement('div');
    modal.id = 'gmes-crm-confirm-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:Poppins,sans-serif;';
    modal.innerHTML =
        '<div style="background:var(--surface,#fff);border-radius:14px;padding:0;max-width:480px;width:90%;max-height:80vh;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.25);border:1.5px solid var(--border,#e2e5eb);">' +
        '<div style="background:linear-gradient(135deg,#1557b0 0%,#1a73e8 60%,#4285f4 100%);padding:14px 18px;color:white;font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px;">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' +
        'Send to GoHighLevel</div>' +
        '<div style="padding:16px 18px;max-height:50vh;overflow-y:auto;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:12.5px;">' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Company</td><td style="padding:6px 0;color:var(--text,#202124);">' + escapeHtmlModal(item.title || 'Unknown') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Location</td><td style="padding:6px 0;color:var(--text,#202124);">' + escapeHtmlModal((item.address || '') + (item.city ? ', ' + item.city : '') || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Phone(s)</td><td style="padding:6px 0;color:var(--text,#202124);">' + phonesDisplay + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Rating</td><td style="padding:6px 0;color:var(--text,#202124);">' + escapeHtmlModal(item.rating || '0') + ' ★ ' + escapeHtmlModal((item.reviewCount || '').replace(/[()]/g, '')) + ' reviews</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Industry</td><td style="padding:6px 0;color:var(--text,#202124);">' + escapeHtmlModal(item.industry || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Website</td><td style="padding:6px 0;color:var(--text,#202124);word-break:break-all;">' + escapeHtmlModal(item.companyUrl || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Maps Link</td><td style="padding:6px 0;color:var(--text,#202124);word-break:break-all;">' + escapeHtmlModal(item.href || 'N/A') + '</td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Sub-Account</td><td style="padding:6px 0;color:var(--text,#202124);">' +
        '<select id="gmes-confirm-location" style="' + selectStyle + '"><option value="">— Select sub-account —</option></select></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Tag</td><td style="padding:6px 0;color:var(--text,#202124);">' +
        '<select id="gmes-confirm-tag" style="' + selectStyle + '"><option value="">— None —</option></select></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Assign To</td><td style="padding:6px 0;color:var(--text,#202124);">' +
        '<select id="gmes-confirm-assignee" style="' + selectStyle + '"><option value="">— Unassigned —</option></select></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Note</td><td style="padding:6px 0;color:var(--text,#202124);">' +
        '<textarea id="gmes-confirm-note" rows="3" style="' + selectStyle + 'resize:vertical;white-space:pre-wrap;">' + escapeHtmlModal(item.note || '') + '</textarea></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Opportunity</td><td style="padding:6px 0;color:var(--text,#202124);">' +
        '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;"><input type="checkbox" id="gmes-confirm-createopp" style="width:15px;height:15px;cursor:pointer;" />Also create an Opportunity</label>' +
        '<div id="gmes-confirm-pipestage" style="display:none;margin-top:8px;">' +
        '<select id="gmes-confirm-pipeline" style="' + selectStyle + 'margin-bottom:6px;"><option value="">— Select pipeline —</option></select>' +
        '<select id="gmes-confirm-stage" style="' + selectStyle + '"><option value="">— Select stage —</option></select>' +
        '</div></td></tr>' +
        '<tr><td style="padding:6px 10px 6px 0;font-weight:700;color:var(--text-muted,#5f6368);white-space:nowrap;vertical-align:top;">Source</td><td style="padding:6px 0;color:var(--text,#202124);">Google Maps - Scraper</td></tr>' +
        '</table></div>' +
        '<div style="padding:12px 18px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid var(--border,#e2e5eb);">' +
        '<button id="gmes-confirm-cancel" style="padding:8px 18px;border:1.5px solid var(--border,#e2e5eb);border-radius:8px;background:var(--surface,#fff);color:var(--text-2,#3c4043);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
        '<button id="gmes-confirm-send" style="padding:8px 18px;border:none;border-radius:8px;background:#1a73e8;color:white;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Confirm &amp; Send</button>' +
        '</div></div>';

    document.body.appendChild(modal);

    var locationSelect = document.getElementById('gmes-confirm-location');
    var tagSelect = document.getElementById('gmes-confirm-tag');
    var assigneeSelect = document.getElementById('gmes-confirm-assignee');
    var noteInput = document.getElementById('gmes-confirm-note');
    var createOppCheck = document.getElementById('gmes-confirm-createopp');
    var pipeStageWrap = document.getElementById('gmes-confirm-pipestage');
    var pipelineSelect = document.getElementById('gmes-confirm-pipeline');
    var stageSelect = document.getElementById('gmes-confirm-stage');

    var pipelinesCache = [];

    function fillTagSelect(locationId, preselect, force) {
        tagSelect.innerHTML = '<option value="">— None —</option>';
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
    GHL.wireCreateTag(tagSelect, function () { return locationSelect.value; }, function (newName) {
        fillTagSelect(locationSelect.value, newName, true);
    });

    function fillAssigneeSelect(locationId, preselect) {
        assigneeSelect.innerHTML = '<option value="">— Unassigned —</option>';
        GHL.fetchUsers(locationId, false, function (users) {
            (users || []).forEach(function (u) {
                var opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.name + (u.email ? ' (' + u.email + ')' : '');
                if (u.id === preselect) opt.selected = true;
                assigneeSelect.appendChild(opt);
            });
        });
    }

    function fillStageSelect(pipelineId, preselect) {
        stageSelect.innerHTML = '<option value="">— Select stage —</option>';
        var pipe = null;
        for (var i = 0; i < pipelinesCache.length; i++) {
            if (pipelinesCache[i].id === pipelineId) { pipe = pipelinesCache[i]; break; }
        }
        if (!pipe) return;
        (pipe.stages || []).forEach(function (s) {
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            if (s.id === preselect) opt.selected = true;
            stageSelect.appendChild(opt);
        });
    }

    function fillPipelineSelect(locationId, preselectPipe, preselectStage) {
        pipelineSelect.innerHTML = '<option value="">— Select pipeline —</option>';
        GHL.fetchPipelines(locationId, false, function (pipes) {
            pipelinesCache = pipes || [];
            pipelinesCache.forEach(function (p) {
                var opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                if (p.id === preselectPipe) opt.selected = true;
                pipelineSelect.appendChild(opt);
            });
            fillStageSelect(pipelineSelect.value, preselectStage);
        });
    }

    function repopulateForLocation(locationId) {
        fillTagSelect(locationId, ghl.tag || '');
        fillAssigneeSelect(locationId, ghl.assignedTo || '');
        fillPipelineSelect(locationId, ghl.pipelineId || '', ghl.stageId || '');
    }

    // Populate sub-account list, default to the item's location or the saved default.
    chrome.storage.local.get(['gmes_ghl_default_location', 'gmes_ghl_create_opp', 'gmes_ghl_default_tag', 'gmes_ghl_default_assignee', 'gmes_ghl_default_pipeline', 'gmes_ghl_default_stage'], function (defs) {
        if (!ghl.tag && defs.gmes_ghl_default_tag) ghl.tag = defs.gmes_ghl_default_tag;
        if (!ghl.assignedTo && defs.gmes_ghl_default_assignee) ghl.assignedTo = defs.gmes_ghl_default_assignee;
        if (!ghl.pipelineId && defs.gmes_ghl_default_pipeline) ghl.pipelineId = defs.gmes_ghl_default_pipeline;
        if (!ghl.stageId && defs.gmes_ghl_default_stage) ghl.stageId = defs.gmes_ghl_default_stage;
        var wantOpp = (ghl.createOpp !== undefined) ? ghl.createOpp : (defs.gmes_ghl_create_opp !== false);
        createOppCheck.checked = Boolean(wantOpp);
        pipeStageWrap.style.display = createOppCheck.checked ? 'block' : 'none';

        GHL.fetchLocations(false, function (locs) {
            var selectedLoc = ghl.locationId || defs.gmes_ghl_default_location || '';
            (locs || []).forEach(function (l) {
                var opt = document.createElement('option');
                opt.value = l.id;
                opt.textContent = l.name;
                if (l.id === selectedLoc) opt.selected = true;
                locationSelect.appendChild(opt);
            });
            if (!locationSelect.value && locs && locs.length) locationSelect.value = locs[0].id;
            repopulateForLocation(locationSelect.value);
        });
    });

    locationSelect.addEventListener('change', function () {
        repopulateForLocation(locationSelect.value);
    });
    pipelineSelect.addEventListener('change', function () {
        fillStageSelect(pipelineSelect.value, '');
    });
    createOppCheck.addEventListener('change', function () {
        pipeStageWrap.style.display = createOppCheck.checked ? 'block' : 'none';
    });

    document.getElementById('gmes-confirm-cancel').addEventListener('click', function () { modal.remove(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.getElementById('gmes-confirm-send').addEventListener('click', function () {
        item.note = noteInput.value || '';
        item.ghl = {
            locationId: locationSelect.value || '',
            tag: tagSelect.value || '',
            assignedTo: assigneeSelect.value || '',
            createOpp: createOppCheck.checked,
            pipelineId: createOppCheck.checked ? (pipelineSelect.value || '') : '',
            stageId: createOppCheck.checked ? (stageSelect.value || '') : '',
            note: item.note
        };
        if (!item.ghl.locationId) { alert('Please select a sub-account.'); return; }
        modal.remove();
        onConfirm();
    });
}

function escapeHtmlModal(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================================
// Turbo Mode Warning Modal
// ============================================================================
// Shown when the user switches Turbo on. Turbo scrapes only the feed cards as
// they scroll past (fast) and never opens each place's profile, so the fields
// that come from the full profile (formal address, real city/state/ZIP,
// website, phone, category) are best-effort or missing. onConfirm() enables
// Turbo; onCancel() leaves the recommended Detail mode in place.
function showTurboWarning(onConfirm, onCancel) {
    var existing = document.getElementById('gmes-turbo-warning-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'gmes-turbo-warning-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;font-family:Poppins,sans-serif;';
    modal.innerHTML =
        '<div style="background:var(--surface,#fff);border-radius:14px;padding:0;max-width:460px;width:90%;max-height:85vh;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.25);border:1.5px solid var(--border,#e2e5eb);">' +
        '<div style="background:linear-gradient(135deg,#b8860b 0%,#e8a317 55%,#f4b740 100%);padding:14px 18px;color:white;font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px;">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
        'Turbo Mode — not recommended</div>' +
        '<div style="padding:16px 18px;max-height:60vh;overflow-y:auto;font-size:12.8px;line-height:1.55;color:var(--text,#202124);">' +
        '<p style="margin:0 0 10px;">Turbo scrapes only the result cards as they scroll past. It is much faster, but because it never opens each place’s profile, several fields are <strong>incomplete or approximate</strong>:</p>' +
        '<ul style="margin:0 0 12px;padding-left:18px;">' +
        '<li><strong>City, state &amp; ZIP</strong> are inferred from your <em>search location</em>, not the business’s real address — so the state and ZIP can be wrong for nearby towns.</li>' +
        '<li><strong>Street address</strong> is only a partial fragment off the card (no full formal address).</li>' +
        '<li><strong>Website, phone &amp; category</strong> are best-effort and may be missing or wrong.</li>' +
        '<li><strong>Postal code</strong> is usually empty.</li>' +
        '</ul>' +
        '<p style="margin:0;padding:9px 11px;background:rgba(232,163,23,0.12);border-left:3px solid #e8a317;border-radius:6px;color:var(--text-2,#3c4043);">The default <strong>Detail mode</strong> opens each place for a complete, accurate address, city, state, ZIP, website and phone. Use Turbo only when speed matters more than data quality.</p>' +
        '</div>' +
        '<div style="padding:12px 18px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid var(--border,#e2e5eb);">' +
        '<button id="gmes-turbo-cancel" style="padding:8px 16px;border:1.5px solid var(--border,#e2e5eb);border-radius:8px;background:var(--surface,#fff);color:var(--text-2,#3c4043);font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;">Keep Detail mode</button>' +
        '<button id="gmes-turbo-confirm" style="padding:8px 16px;border:none;border-radius:8px;background:#e8a317;color:white;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;">Enable Turbo anyway</button>' +
        '</div></div>';

    document.body.appendChild(modal);

    function close() { modal.remove(); }
    document.getElementById('gmes-turbo-confirm').addEventListener('click', function () { close(); if (onConfirm) onConfirm(); });
    document.getElementById('gmes-turbo-cancel').addEventListener('click', function () { close(); if (onCancel) onCancel(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) { close(); if (onCancel) onCancel(); } });
}

document.addEventListener('DOMContentLoaded', function () {
    // Show extension version in header (read from manifest so it always stays in sync)
    try {
        var verEl = document.getElementById('appVersionBadge');
        if (verEl && chrome.runtime && chrome.runtime.getManifest) {
            verEl.textContent = 'v' + chrome.runtime.getManifest().version;
        }
    } catch (e) {}

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

    // Turbo Mode toggle for auto-scrape (off = open each place for full detail).
    var turboToggle = document.getElementById('turboToggle');
    if (turboToggle) {
        chrome.storage.local.get(['gmes_turbo_mode'], function (result) {
            updatePillToggle(turboToggle, result.gmes_turbo_mode === true); // default off
        });
        turboToggle.addEventListener('click', function () {
            var turningOn = !turboToggle.classList.contains('on');
            if (turningOn) {
                // Warn before enabling Turbo; only commit "on" if the user accepts.
                showTurboWarning(function () {
                    updatePillToggle(turboToggle, true);
                    chrome.storage.local.set({ gmes_turbo_mode: true });
                }, function () {
                    updatePillToggle(turboToggle, false);
                    chrome.storage.local.set({ gmes_turbo_mode: false });
                });
                return;
            }
            updatePillToggle(turboToggle, false);
            chrome.storage.local.set({ gmes_turbo_mode: false });
        });
    }

    // Skip Temporarily Closed toggle for auto-scrape (on by default — when on,
    // businesses marked "Temporarily closed" are not added to the results).
    var skipClosedToggle = document.getElementById('skipClosedToggle');
    if (skipClosedToggle) {
        chrome.storage.local.get(['gmes_skip_temp_closed'], function (result) {
            updatePillToggle(skipClosedToggle, result.gmes_skip_temp_closed !== false); // default on
        });
        skipClosedToggle.addEventListener('click', function () {
            var newState = !skipClosedToggle.classList.contains('on');
            updatePillToggle(skipClosedToggle, newState);
            chrome.storage.local.set({ gmes_skip_temp_closed: newState });
        });
    }

    // Scrape Websites toggle (on by default — when on, each lead's website is
    // opened/fetched to pull contact emails and any additional phone numbers).
    var websiteScrapeToggle = document.getElementById('websiteScrapeToggle');
    if (websiteScrapeToggle) {
        chrome.storage.local.get(['gmes_scrape_websites'], function (result) {
            updatePillToggle(websiteScrapeToggle, result.gmes_scrape_websites !== false); // default on
        });
        websiteScrapeToggle.addEventListener('click', function () {
            var newState = !websiteScrapeToggle.classList.contains('on');
            updatePillToggle(websiteScrapeToggle, newState);
            chrome.storage.local.set({ gmes_scrape_websites: newState });
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

        // "Send All to GHL" — opens the results tab and auto-launches the review/
        // confirm modal there (?sendAll=1), so the user vets every lead before any
        // send happens.
        var sendAllGhlButton = document.getElementById('sendAllGhlButton');
        if (sendAllGhlButton) {
            sendAllGhlButton.addEventListener('click', function () {
                chrome.tabs.create({ url: 'results_tab.html?sendAll=1' });
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
            if (chainNameMatchesIgnoreList(item.title, ignoreNamesSet)) return true;
            if (industryMatchesIgnoreList(item.industry, ignoreIndustriesSet)) return true;
            return false;
        }
        // Stored items persisted to localStorage so the popup can be reopened
        // without losing the list
        var storedItems = [];

        // Normalized phone digits (primary number) or '' — mirror of background.js.
        function phoneDigits(item) {
            var raw = '';
            if (item) {
                if (item.phone) raw = String(item.phone);
                else if (Array.isArray(item.phones) && item.phones.length && item.phones[0]) raw = String(item.phones[0].number || '');
            }
            var d = raw.replace(/\D/g, '');
            if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
            return d.length >= 7 ? d : '';
        }

        // Stable identity for de-duplication. The phone number is the strongest
        // signal (unique per business, while names/addresses can collide), so it's
        // preferred; otherwise fall back to Google's stable feature id (0x..:0x.. in
        // the data= blob), then !3d/!4d coords, then title+address. Mirror of
        // placeIdentity() in background.js / results_tab.js.
        function placeIdentity(item) {
            if (!item) return '';
            var pd = phoneDigits(item);
            if (pd) return 'ph:' + pd;
            var href = String(item.href || '');
            var m = href.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
            if (m) return 'cid:' + m[1].toLowerCase();
            m = href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
            if (m) return 'geo:' + m[1] + ',' + m[2];
            var title = (item.title || '').toLowerCase().trim();
            var addr = (item.address || '').toLowerCase().trim();
            if (title && addr) return 'ta:' + title + '|' + addr;
            var pathMatch = href.match(/\/maps\/place\/([^/@?]+)/);
            if (pathMatch) { try { return 'path:' + decodeURIComponent(pathMatch[1]).toLowerCase(); } catch (e) { return 'path:' + pathMatch[1].toLowerCase(); } }
            if (title) return 'title:' + title;
            return href;
        }

        // GHL status cell: "Send to GHL" when un-synced, or "✓ In GHL" + an Undo
        // button once the lead is in GoHighLevel. Undo removes the contact via the
        // backend so the row can be re-sent.
        function renderCrmCellPopup(item, cell) {
            if (item.crmSynced) renderSyncedStatePopup(item, cell);
            else renderSendStatePopup(item, cell);
        }

        function renderSyncedStatePopup(item, cell, labelText) {
            cell.innerHTML = '';
            cell.style.color = '';
            cell.style.fontWeight = '';
            var wrap = document.createElement('span');
            wrap.style.cssText = 'display:inline-flex;align-items:center;gap:8px;';

            var label = document.createElement('span');
            label.textContent = labelText || '✓ In GHL';
            label.style.cssText = 'color:#34a853;font-weight:600;';
            wrap.appendChild(label);

            // Update: re-send to fill any GHL fields that are still empty. The
            // backend backfills blanks only and updates the existing contact in
            // place, so this never creates a duplicate.
            var updateBtn = document.createElement('button');
            updateBtn.textContent = 'Update';
            updateBtn.style.cssText = 'padding:3px 9px;font-size:11px;background:#fff;color:#1a73e8;border:1.5px solid #1a73e8;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:600;';
            updateBtn.title = 'Fill any empty fields in GoHighLevel from the scraped data';
            updateBtn.addEventListener('click', function () {
                showCrmConfirmation(item, function () {
                    var ghl = item.ghl || {};
                    updateBtn.disabled = true;
                    updateBtn.textContent = 'Updating…';
                    GHL.sendLead(ghl.locationId, item, {
                        tag: ghl.tag,
                        assignedTo: ghl.assignedTo,
                        note: ghl.note || item.note,
                        createOpp: ghl.createOpp,
                        pipelineId: ghl.pipelineId,
                        stageId: ghl.stageId
                    }, function (result) {
                        if (result.success) {
                            item.crmSynced = true;
                            if (result.contactId) { item.ghlContactId = result.contactId; item.crmExistingId = result.contactId; }
                            if (result.opportunityId) item.ghlOpportunityId = result.opportunityId;
                            renderSyncedStatePopup(item, cell, '✓ In GHL (updated)');
                            saveToStorage();
                        } else {
                            updateBtn.disabled = false;
                            updateBtn.textContent = 'Update';
                            alert('GHL update failed: ' + (result.error || 'Unknown error'));
                        }
                    });
                });
            });
            wrap.appendChild(updateBtn);

            var undoBtn = document.createElement('button');
            undoBtn.textContent = 'Undo';
            undoBtn.style.cssText = 'padding:3px 9px;font-size:11px;background:#fff;color:#ea4335;border:1.5px solid #ea4335;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:600;';
            undoBtn.title = 'Remove this contact from GoHighLevel';
            undoBtn.addEventListener('click', function () {
                var contactId = item.ghlContactId || item.crmExistingId || '';
                if (!contactId) { alert('Cannot undo: no GoHighLevel contact id is recorded for this lead.'); return; }
                undoBtn.disabled = true;
                undoBtn.textContent = 'Undoing…';
                chrome.storage.local.get(['gmes_ghl_default_location'], function (defs) {
                    var locationId = (item.ghl && item.ghl.locationId) || defs.gmes_ghl_default_location || '';
                    GHL.deleteLead(locationId, contactId, item.ghlOpportunityId || '', function (res) {
                        if (res && res.success) {
                            item.crmSynced = false;
                            item.crmChecked = true; // don't auto re-flag right after removing
                            delete item.ghlContactId;
                            delete item.crmExistingId;
                            delete item.ghlOpportunityId;
                            saveToStorage();
                            renderCrmCellPopup(item, cell);
                        } else {
                            undoBtn.disabled = false;
                            undoBtn.textContent = 'Undo';
                            alert('Undo failed: ' + ((res && res.error) || 'Unknown error'));
                        }
                    });
                });
            });
            wrap.appendChild(undoBtn);
            cell.appendChild(wrap);
        }

        function renderSendStatePopup(item, cell) {
            cell.innerHTML = '';
            cell.style.color = '';
            cell.style.fontWeight = '';
            var sendBtn = document.createElement('button');
            sendBtn.textContent = 'Send to GHL';
            sendBtn.className = 'button';
            sendBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; border-radius: 12px;';
            // Disable Send to GHL when not connected; the Connect panel above the
            // leads table prompts the user to connect GoHighLevel.
            GHL.isConnected(function (connected) {
                if (connected) return;
                sendBtn.disabled = true;
                sendBtn.title = 'Connect GoHighLevel (use the Connect panel above) to enable';
                sendBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; border-radius: 12px; background: #e8eaed; color: #80868b; border: none; cursor: not-allowed;';
                var hint = document.createElement('a');
                hint.href = '#';
                hint.textContent = 'Connect';
                hint.style.cssText = 'display:block; margin-top:4px; font-size:11px; color:#1a73e8; text-decoration:underline; font-weight:600;';
                hint.addEventListener('click', function (e) {
                    e.preventDefault();
                    var connect = document.getElementById('crmConnectBtn');
                    if (connect) {
                        connect.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        connect.style.boxShadow = '0 0 0 3px rgba(26,115,232,0.45)';
                        setTimeout(function () { connect.style.boxShadow = ''; }, 1600);
                    }
                });
                cell.appendChild(hint);
            });
            // Async dedup check - mark "In GHL" if the contact already exists.
            if (!item.crmChecked) {
                item.crmChecked = true;
                chrome.storage.local.get(['gmes_ghl_default_location'], function (defs) {
                    var loc = (item.ghl && item.ghl.locationId) || defs.gmes_ghl_default_location || '';
                    if (!loc) return;
                    var checkPhones = Array.isArray(item.phones) && item.phones.length
                        ? item.phones
                        : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
                    GHL.checkDuplicate(loc, checkPhones, item.email || '', function (statusResult) {
                        if (statusResult && statusResult.exists) {
                            item.crmSynced = true;
                            if (statusResult.contactId) { item.ghlContactId = statusResult.contactId; item.crmExistingId = statusResult.contactId; }
                            renderSyncedStatePopup(item, cell);
                            saveToStorage();
                        }
                    });
                });
            }
            sendBtn.addEventListener('click', function () {
                showCrmConfirmation(item, function () {
                    var ghl = item.ghl || {};
                    sendBtn.disabled = true;
                    sendBtn.textContent = 'Sending…';
                    GHL.sendLead(ghl.locationId, item, {
                        tag: ghl.tag,
                        assignedTo: ghl.assignedTo,
                        note: ghl.note || item.note,
                        createOpp: ghl.createOpp,
                        pipelineId: ghl.pipelineId,
                        stageId: ghl.stageId
                    }, function (result) {
                        if (result.success) {
                            item.crmSynced = true;
                            if (result.contactId) { item.ghlContactId = result.contactId; item.crmExistingId = result.contactId; }
                            if (result.opportunityId) item.ghlOpportunityId = result.opportunityId;
                            renderSyncedStatePopup(item, cell, result.duplicate ? '✓ In GHL' : '✓ Synced');
                            saveToStorage();
                        } else {
                            sendBtn.disabled = false;
                            sendBtn.textContent = 'Retry';
                            alert('GHL send failed: ' + (result.error || 'Unknown error'));
                        }
                    });
                });
            });
            cell.appendChild(sendBtn);
        }

        // Helper: create a table row element from an item object
        function createRowFromItem(item) {
            var row = document.createElement('tr');
            // column order: title, note, businessTimings, rating, reviewCount, phone, industry, city, address, website, instaSearch, maps link, lat, lng, crmStatus
            ['title', 'note', 'businessTimings', 'rating', 'reviewCount', 'phone', 'industry', 'city', 'address', 'email', 'companyUrl', 'instaSearch', 'href', 'lat', 'lng', 'crmStatus'].forEach(function (colKey) {
                var cell = document.createElement('td');

                // Special rendering for links
                if (colKey === 'email') {
                    var emails = Array.isArray(item.emails) && item.emails.length
                        ? item.emails
                        : (item.email ? [item.email] : []);
                    emails.forEach(function (e, i) {
                        if (i) cell.appendChild(document.createElement('br'));
                        var a = document.createElement('a');
                        a.href = 'mailto:' + e;
                        a.textContent = e;
                        cell.appendChild(a);
                    });
                } else if (colKey === 'companyUrl' || colKey === 'href') {
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
                        // Display a cleaned, shortened URL: drop the http(s):// and
                        // www. prefix and truncate long URLs with an ellipsis. The
                        // link target (and export) keep the full URL.
                        var display = finalUrl.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
                        if (display.length > 40) display = display.slice(0, 40) + '...';
                        a.textContent = display;
                        a.title = finalUrl;
                        a.target = '_blank';
                        a.rel = 'noopener noreferrer';
                        cell.appendChild(a);
                    } else {
                        // href (maps link) column — show short hypertext; full URL
                        // stays the link target and is exported in full.
                        var mapsUrl = url || '';
                        if (mapsUrl) {
                            var a = document.createElement('a');
                            a.href = mapsUrl;
                            a.textContent = 'Maps: ' + (item.title || '');
                            a.title = mapsUrl;
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
                        a.textContent = 'Insta: ' + (item.title || '');
                        a.title = url;
                        a.target = '_blank';
                        a.rel = 'noopener noreferrer';
                        cell.appendChild(a);
                    }
                } else if (colKey === 'crmStatus') {
                    renderCrmCellPopup(item, cell);
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
                } else if (colKey === 'businessTimings') {
                    // Compact "Mon-Wed: 9AM-5PM" view; full per-day schedule on hover.
                    var rawTimings = item[colKey] || '';
                    cell.textContent = formatBusinessTimings(rawTimings);
                    if (rawTimings) cell.title = rawTimings;
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
                var uniqueKey = placeIdentity(item);
                if (!uniqueKey) return;
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

        // Auto-Scrape drives Maps itself (navigates/opens a tab as needed), so the
        // Start button is always available regardless of the current tab.
        actionButton.disabled = false;
        actionButton.classList.add('enabled');

        // Render table header once (so it isn't re-rendered/cleared on each scrape)
        (function renderHeader() {
            const headers = ['Title', 'Note', 'Business Timings', 'Rating', 'Reviews', 'Phone', 'Industry', 'City', 'Address', 'Email', 'Website', 'Insta Search', 'Google Maps Link', 'Latitude', 'Longitude', 'CRM Status'];
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

        // GoHighLevel Connect panel — one-click auth via the TableTurnerr connect page
        (function initCrmConnect() {
            var TT_APP_URL          = 'https://crm.tableturnerr.com';
            var TT_CONNECT_URL      = 'https://crm.tableturnerr.com/connect';
            var GHL_API_BASE_DEFAULT = 'https://api.tableturnerr.com';

            var connectBtn        = document.getElementById('crmConnectBtn');
            var connectStatus     = document.getElementById('crmConnectStatus');
            var stateDisconnected = document.getElementById('crmStateDisconnected');
            var stateConnected    = document.getElementById('crmStateConnected');
            var userEmailEl       = document.getElementById('crmUserEmail');
            var disconnectBtn     = document.getElementById('crmDisconnectBtn');

            // ---- UI state helpers ----
            function flashSaved(id) {
                var st = document.getElementById(id);
                if (st) { st.style.display = 'block'; setTimeout(function () { st.style.display = 'none'; }, 1500); }
            }

            function setUiConnected(email) {
                _waiting = false;
                stateDisconnected.style.display = 'none';
                stateConnected.style.display = 'block';
                userEmailEl.innerHTML = '<span class="crm-status-dot connected"></span>' + (email || 'Connected');
                refreshLocationDropdown();
            }

            // ---- Default sub-account (location) dropdown ----
            // Changing the location re-populates the location-scoped selectors below.
            function refreshLocationDropdown(forceRefresh) {
                var sel = document.getElementById('defaultLocationSelect');
                if (!sel) return;
                GHL.fetchLocations(Boolean(forceRefresh), function (locs) {
                    chrome.storage.local.get(['gmes_ghl_default_location'], function (data) {
                        var currentId = data.gmes_ghl_default_location || '';
                        sel.innerHTML = '<option value="">— Select sub-account —</option>';
                        (locs || []).forEach(function (l) {
                            var opt = document.createElement('option');
                            opt.value = l.id;
                            opt.textContent = l.name;
                            if (l.id === currentId) opt.selected = true;
                            sel.appendChild(opt);
                        });
                        refreshLocationScopedDropdowns(sel.value, forceRefresh);
                    });
                });
            }

            function refreshLocationScopedDropdowns(locationId, forceRefresh) {
                refreshTagDropdown(locationId, forceRefresh);
                refreshAssigneeDropdown(locationId, forceRefresh);
                refreshPipelineDropdown(locationId, forceRefresh);
            }

            var locationSelectEl = document.getElementById('defaultLocationSelect');
            if (locationSelectEl) {
                locationSelectEl.addEventListener('change', function () {
                    chrome.storage.local.set({ gmes_ghl_default_location: locationSelectEl.value || '' }, function () {
                        flashSaved('defaultLocationStatus');
                    });
                    refreshLocationScopedDropdowns(locationSelectEl.value, false);
                });
            }
            var refreshLocationsBtn = document.getElementById('refreshLocationsBtn');
            if (refreshLocationsBtn) {
                refreshLocationsBtn.addEventListener('click', function () { refreshLocationDropdown(true); });
            }
            // Connect another sub-account: the session is already captured, so just
            // reopen the connect page to run the GHL install for a new location.
            // Drop the cached list so the new sub-account appears on the next refresh.
            var addSubAccountBtn = document.getElementById('addSubAccountBtn');
            if (addSubAccountBtn) {
                addSubAccountBtn.addEventListener('click', function () {
                    chrome.storage.local.remove(['gmes_ghl_locations_cache', 'gmes_ghl_locations_cache_ts'], function () {
                        chrome.tabs.create({ url: TT_CONNECT_URL });
                    });
                });
            }

            // ---- Create Opportunity toggle ----
            var createOppToggle = document.getElementById('createOppToggle');
            var pipelineStageWrap = document.getElementById('pipelineStageWrap');
            if (createOppToggle) {
                createOppToggle.addEventListener('change', function () {
                    if (pipelineStageWrap) pipelineStageWrap.style.display = createOppToggle.checked ? 'block' : 'none';
                    chrome.storage.local.set({ gmes_ghl_create_opp: Boolean(createOppToggle.checked) }, function () {
                        flashSaved('createOppStatus');
                    });
                });
            }

            // ---- Default pipeline + stage dropdowns ----
            var _pipelinesCache = [];

            function refreshPipelineDropdown(locationId, forceRefresh) {
                var sel = document.getElementById('defaultPipelineSelect');
                if (!sel) return;
                GHL.fetchPipelines(locationId, Boolean(forceRefresh), function (pipes) {
                    _pipelinesCache = pipes || [];
                    chrome.storage.local.get(['gmes_ghl_default_pipeline'], function (data) {
                        var currentId = data.gmes_ghl_default_pipeline || '';
                        sel.innerHTML = '<option value="">— Select pipeline —</option>';
                        _pipelinesCache.forEach(function (p) {
                            var opt = document.createElement('option');
                            opt.value = p.id;
                            opt.textContent = p.name;
                            if (p.id === currentId) opt.selected = true;
                            sel.appendChild(opt);
                        });
                        refreshStageDropdown(sel.value);
                    });
                });
            }

            function refreshStageDropdown(pipelineId) {
                var sel = document.getElementById('defaultStageSelect');
                if (!sel) return;
                var pipe = null;
                for (var i = 0; i < _pipelinesCache.length; i++) {
                    if (_pipelinesCache[i].id === pipelineId) { pipe = _pipelinesCache[i]; break; }
                }
                chrome.storage.local.get(['gmes_ghl_default_stage'], function (data) {
                    var currentId = data.gmes_ghl_default_stage || '';
                    sel.innerHTML = '<option value="">— Select stage —</option>';
                    if (!pipe) return;
                    (pipe.stages || []).forEach(function (s) {
                        var opt = document.createElement('option');
                        opt.value = s.id;
                        opt.textContent = s.name;
                        if (s.id === currentId) opt.selected = true;
                        sel.appendChild(opt);
                    });
                });
            }

            var defaultPipelineSelectEl = document.getElementById('defaultPipelineSelect');
            if (defaultPipelineSelectEl) {
                defaultPipelineSelectEl.addEventListener('change', function () {
                    chrome.storage.local.set({ gmes_ghl_default_pipeline: defaultPipelineSelectEl.value || '', gmes_ghl_default_stage: '' }, function () {
                        flashSaved('defaultPipelineStatus');
                    });
                    refreshStageDropdown(defaultPipelineSelectEl.value);
                });
            }
            var defaultStageSelectEl = document.getElementById('defaultStageSelect');
            if (defaultStageSelectEl) {
                defaultStageSelectEl.addEventListener('change', function () {
                    chrome.storage.local.set({ gmes_ghl_default_stage: defaultStageSelectEl.value || '' }, function () {
                        flashSaved('defaultStageStatus');
                    });
                });
            }

            // ---- Default tag dropdown ----
            function refreshTagDropdown(locationId, forceRefresh) {
                var sel = document.getElementById('defaultTagSelect');
                if (!sel) return;
                GHL.fetchTags(locationId, Boolean(forceRefresh), function (tags) {
                    chrome.storage.local.get(['gmes_ghl_default_tag'], function (data) {
                        var current = data.gmes_ghl_default_tag || '';
                        sel.innerHTML = '<option value="">— None —</option>';
                        (tags || []).forEach(function (t) {
                            var opt = document.createElement('option');
                            opt.value = t.name;
                            opt.textContent = t.name;
                            if (t.name === current) opt.selected = true;
                            sel.appendChild(opt);
                        });
                        GHL.appendCreateTagOption(sel);
                    });
                });
            }
            var defaultTagSelectEl = document.getElementById('defaultTagSelect');
            if (defaultTagSelectEl) {
                defaultTagSelectEl.addEventListener('change', function () {
                    if (defaultTagSelectEl.value === GHL.CREATE_TAG_SENTINEL) return;
                    chrome.storage.local.set({ gmes_ghl_default_tag: defaultTagSelectEl.value || '' }, function () {
                        flashSaved('defaultTagStatus');
                    });
                });
                GHL.wireCreateTag(defaultTagSelectEl,
                    function () { return locationSelectEl ? locationSelectEl.value : ''; },
                    function (newName) {
                        chrome.storage.local.set({ gmes_ghl_default_tag: newName }, function () {
                            flashSaved('defaultTagStatus');
                            refreshTagDropdown(locationSelectEl ? locationSelectEl.value : '', true);
                        });
                    });
            }
            var refreshTagsBtn = document.getElementById('refreshTagsBtn');
            if (refreshTagsBtn) {
                refreshTagsBtn.addEventListener('click', function () { refreshTagDropdown(locationSelectEl ? locationSelectEl.value : '', true); });
            }

            // ---- Default assignee dropdown ----
            function refreshAssigneeDropdown(locationId, forceRefresh) {
                var sel = document.getElementById('defaultAssigneeSelect');
                if (!sel) return;
                GHL.fetchUsers(locationId, Boolean(forceRefresh), function (users) {
                    chrome.storage.local.get(['gmes_ghl_default_assignee'], function (data) {
                        var currentId = data.gmes_ghl_default_assignee || '';
                        sel.innerHTML = '<option value="">— Unassigned (default) —</option>';
                        (users || []).forEach(function (u) {
                            var opt = document.createElement('option');
                            opt.value = u.id;
                            opt.textContent = u.name + (u.email ? ' (' + u.email + ')' : '');
                            if (u.id === currentId) opt.selected = true;
                            sel.appendChild(opt);
                        });
                    });
                });
            }
            var defaultAssigneeSelectEl = document.getElementById('defaultAssigneeSelect');
            if (defaultAssigneeSelectEl) {
                defaultAssigneeSelectEl.addEventListener('change', function () {
                    chrome.storage.local.set({ gmes_ghl_default_assignee: defaultAssigneeSelectEl.value || '' }, function () {
                        flashSaved('defaultAssigneeStatus');
                    });
                });
            }
            var refreshAssigneesBtn = document.getElementById('refreshAssigneesBtn');
            if (refreshAssigneesBtn) {
                refreshAssigneesBtn.addEventListener('click', function () { refreshAssigneeDropdown(locationSelectEl ? locationSelectEl.value : '', true); });
            }

            function setUiDisconnected(msg) {
                _waiting = false;
                stateConnected.style.display = 'none';
                stateDisconnected.style.display = 'block';
                if (connectBtn) { connectBtn.disabled = false; connectBtn.textContent = 'Connect GoHighLevel'; }
                if (connectStatus) connectStatus.textContent = msg || '';
            }

            function setUiConnecting(msg) {
                if (connectBtn) { connectBtn.disabled = true; connectBtn.textContent = msg || 'Connecting…'; }
                if (connectStatus) connectStatus.innerHTML = '<span class="crm-status-dot connecting"></span>';
            }

            function setUiFailed(msg) {
                _waiting = false;
                stateConnected.style.display = 'none';
                stateDisconnected.style.display = 'block';
                if (connectBtn) { connectBtn.disabled = false; connectBtn.textContent = 'Retry connection'; }
                if (connectStatus) connectStatus.textContent = msg || 'Login failed. Please try again.';
            }

            // While waiting for the user to finish the login flow, keep the button
            // live as a Cancel so they aren't stuck if they abandon the connect tab.
            function setUiWaiting(msg) {
                _waiting = true;
                stateConnected.style.display = 'none';
                stateDisconnected.style.display = 'block';
                if (connectBtn) { connectBtn.disabled = false; connectBtn.textContent = 'Cancel'; }
                if (connectStatus) connectStatus.textContent = msg || 'Waiting for login…';
            }

            // ---- On popup open: restore connection + create-opp toggle ----
            chrome.storage.local.get(['gmes_ghl_session', 'gmes_ghl_email', 'gmes_ghl_waiting', 'gmes_ghl_create_opp'], function (data) {
                var wantOpp = data.gmes_ghl_create_opp !== false; // default on
                if (createOppToggle) createOppToggle.checked = wantOpp;
                if (pipelineStageWrap) pipelineStageWrap.style.display = wantOpp ? 'block' : 'none';

                if (data.gmes_ghl_session) {
                    setUiConnected(data.gmes_ghl_email);
                } else if (data.gmes_ghl_waiting) {
                    setUiWaiting('Waiting for login…');
                    pollForLogin();
                } else {
                    setUiDisconnected('');
                }
            });

            // ---- Connect button (doubles as Cancel while waiting) ----
            if (connectBtn) {
                connectBtn.addEventListener('click', function () {
                    if (_waiting) { cancelWaiting('Connection canceled.'); return; }
                    setUiConnecting('Looking for GoHighLevel tab…');
                    attemptConnect();
                });
            }

            // ---- Disconnect button ----
            if (disconnectBtn) {
                disconnectBtn.addEventListener('click', function () {
                    chrome.storage.local.remove([
                        'gmes_ghl_session', 'gmes_ghl_api_base', 'gmes_ghl_email', 'gmes_ghl_waiting',
                        'gmes_ghl_connect_tab',
                        'gmes_ghl_default_location', 'gmes_ghl_create_opp', 'gmes_ghl_default_pipeline',
                        'gmes_ghl_default_stage', 'gmes_ghl_default_tag', 'gmes_ghl_default_assignee',
                        'gmes_ghl_locations_cache', 'gmes_ghl_locations_cache_ts'
                    ], function () {
                        setUiDisconnected('Disconnected.');
                    });
                });
            }

            // ---- Read the TableTurnerr session from a connect tab (injected, serializable) ----
            function readTtSession() {
                try {
                    var raw = localStorage.getItem('tt_session');
                    if (!raw) return null;
                    var p = JSON.parse(raw);
                    if (!p || !p.token) return null;
                    return { token: p.token, email: p.email || '', agency: p.agency || '', apiBase: p.apiBase || '' };
                } catch (e) { return null; }
            }

            function saveAuthAndConnect(auth) {
                chrome.storage.local.set({
                    gmes_ghl_session: auth.token,
                    gmes_ghl_email: auth.email || auth.agency || 'Connected',
                    gmes_ghl_api_base: auth.apiBase || GHL_API_BASE_DEFAULT,
                    gmes_ghl_waiting: false
                }, function () {
                    setUiConnected(auth.email || auth.agency || 'Connected');
                });
            }

            // Close the funnel tab we opened, once a sub-account is actually linked.
            // The id is recorded when we open/redirect the connect tab; if the user
            // already had a CRM tab open for other work, it isn't tracked and stays.
            function closeConnectTab() {
                chrome.storage.local.get(['gmes_ghl_connect_tab'], function (d) {
                    var id = d.gmes_ghl_connect_tab;
                    chrome.storage.local.remove('gmes_ghl_connect_tab');
                    if (id != null) chrome.tabs.remove(id, function () { void chrome.runtime.lastError; });
                });
            }

            // ---- Try to grab the session from any open TableTurnerr tab ----
            function attemptConnect() {
                chrome.tabs.query({ url: TT_APP_URL + '/*' }, function (tabs) {
                    if (tabs && tabs.length > 0) {
                        chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: readTtSession }, function (results) {
                            var auth = results && results[0] && results[0].result;
                            if (auth && auth.token) {
                                saveAuthAndConnect(auth);
                            } else {
                                // Tab open but not connected — send it to the connect page
                                chrome.tabs.update(tabs[0].id, { url: TT_CONNECT_URL, active: true });
                                chrome.storage.local.set({ gmes_ghl_connect_tab: tabs[0].id });
                                beginWaiting();
                            }
                        });
                    } else {
                        chrome.tabs.create({ url: TT_CONNECT_URL }, function (tab) {
                            if (tab && tab.id != null) chrome.storage.local.set({ gmes_ghl_connect_tab: tab.id });
                            beginWaiting();
                        });
                    }
                });
            }

            // ---- Poll until the user completes the connect flow ----
            var _pollInterval = null;
            var _sessionSaved = false;
            var _waiting = false;

            function beginWaiting() {
                _sessionSaved = false;
                chrome.storage.local.set({ gmes_ghl_waiting: true });
                chrome.runtime.sendMessage({ type: 'START_CRM_LOGIN_POLL' });
                setUiWaiting('Waiting for login…');
                pollForLogin();
            }

            // User-triggered abort (Cancel button) or auto-stop when the connect tab is gone.
            function cancelWaiting(msg) {
                if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
                chrome.storage.local.set({ gmes_ghl_waiting: false });
                chrome.runtime.sendMessage({ type: 'STOP_CRM_LOGIN_POLL' });
                setUiDisconnected(msg || '');
            }

            // Abort the wait if the extension is switched off, or if the wait flag is
            // cleared elsewhere (e.g. the background poll timed out) while this popup is open.
            chrome.storage.onChanged.addListener(function (changes, area) {
                if (area !== 'local' || !_waiting) return;
                if (changes.gmes_extension_enabled && changes.gmes_extension_enabled.newValue !== true) {
                    cancelWaiting('Extension turned off.');
                } else if (changes.gmes_ghl_waiting && changes.gmes_ghl_waiting.newValue !== true && !_sessionSaved) {
                    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
                    setUiDisconnected('');
                }
            });

            function pollForLogin() {
                if (_pollInterval) clearInterval(_pollInterval);
                var ticks = 0;
                _pollInterval = setInterval(function () {
                    // Safety stop after ~5 min so an abandoned connect doesn't poll forever.
                    if (++ticks > 200) {
                        clearInterval(_pollInterval);
                        _pollInterval = null;
                        if (!_sessionSaved) {
                            chrome.storage.local.set({ gmes_ghl_waiting: false });
                            chrome.runtime.sendMessage({ type: 'STOP_CRM_LOGIN_POLL' });
                            setUiFailed('Timed out waiting for login. Please try again.');
                        }
                        return;
                    }
                    // If the user closed the connect tab before logging in, fail fast
                    // instead of spinning for the full timeout with no way to retry.
                    if (!_sessionSaved) {
                        chrome.storage.local.get(['gmes_ghl_connect_tab'], function (d) {
                            if (d.gmes_ghl_connect_tab == null) return;
                            chrome.tabs.get(d.gmes_ghl_connect_tab, function (tab) {
                                if ((chrome.runtime.lastError || !tab) && !_sessionSaved && _pollInterval) {
                                    clearInterval(_pollInterval);
                                    _pollInterval = null;
                                    chrome.storage.local.set({ gmes_ghl_waiting: false });
                                    chrome.runtime.sendMessage({ type: 'STOP_CRM_LOGIN_POLL' });
                                    setUiFailed('Login window was closed. Please try again.');
                                }
                            });
                        });
                    }
                    chrome.tabs.query({ url: TT_APP_URL + '/*' }, function (tabs) {
                        if (!tabs || !tabs.length) return;
                        var nonLoginTab = null;
                        for (var i = 0; i < tabs.length; i++) {
                            if (tabs[i].url && tabs[i].url.indexOf('/login') === -1) { nonLoginTab = tabs[i]; break; }
                        }
                        if (!nonLoginTab) return;
                        chrome.scripting.executeScript({ target: { tabId: nonLoginTab.id }, func: readTtSession }, function (results) {
                            var auth = results && results[0] && results[0].result;
                            if (!auth || !auth.token) return;
                            // tt_session appears right after CRM login, before any sub-account
                            // is authorized. Save it so /ghl/* calls work, but keep the funnel
                            // tab open until a sub-account is actually linked, then close it.
                            if (!_sessionSaved) { _sessionSaved = true; saveAuthAndConnect(auth); }
                            GHL.status(function (st) {
                                if (st && st.connected) {
                                    clearInterval(_pollInterval);
                                    _pollInterval = null;
                                    chrome.storage.local.set({ gmes_ghl_waiting: false });
                                    closeConnectTab();
                                }
                            });
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
        // A grid scan that stopped before finishing (tab closed, page died, etc.)
        // leaves its cursor in storage. resumeInfo mirrors it so the action button
        // can offer "Resume" instead of restarting from area 1. Editing any scrape
        // field flips userEditedForm true, which means the next click starts fresh.
        var resumeInfo = null;
        var userEditedForm = false;

        function runScrapeOnce() {
            if (!currentTab || !currentTab.id) return;
            chrome.scripting.executeScript({
                target: { tabId: currentTab.id },
                function: scrapeData
            }, function (results) {
                try {
                    if (!results || !results[0] || !results[0].result) return;
                    (results[0].result || []).filter(Boolean).forEach(function (item) {
                        var uniqueKey = placeIdentity(item);
                        if (!uniqueKey) return;

                        // Apply food industry filter
                        if (foodFilterEnabled && !isFoodRelatedIndustry(item.industry)) {
                            return;
                        }

                        if (itemIsIgnored(item)) return;
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

        // ---- Auto-Scrape form (category + location + radius) -------------------
        var categoryInput = document.getElementById('scrapeCategory');
        var locationInput = document.getElementById('scrapeLocation');
        var radiusInput = document.getElementById('scrapeRadius');
        var speedInput = document.getElementById('scrapeSpeed');
        var excludeInput = document.getElementById('scrapeExclude');
        // Delay multiplier per speed label. 1.0 == the original (fastest) pacing;
        // the default is "balanced" (a bit slower) to dodge Google's "Server error"
        // rate limiting. Slower => longer pauses between clicks/searches.
        var SPEED_MULTIPLIERS = { fast: 1.0, balanced: 1.5, slow: 2.5 };
        function speedMultiplier(label) {
            return SPEED_MULTIPLIERS[label] || SPEED_MULTIPLIERS.balanced;
        }
        var condRatingOp = document.getElementById('condRatingOp');
        var condRatingVal = document.getElementById('condRatingVal');
        var condReviewsOp = document.getElementById('condReviewsOp');
        var condReviewsVal = document.getElementById('condReviewsVal');
        var scrapeStatus = document.getElementById('scrapeStatus');
        // Pause/Stop split + saved-session UI.
        var scrapeRunControls = document.getElementById('scrapeRunControls');
        var pauseButton = document.getElementById('pauseButton');
        var stopButton = document.getElementById('stopButton');
        var savedSessionsPanel = document.getElementById('savedSessionsPanel');
        var savedSessionsList = document.getElementById('savedSessionsList');
        var stopSessionModal = document.getElementById('stopSessionModal');
        var stopModalStats = document.getElementById('stopModalStats');
        var stopSaveBtn = document.getElementById('stopSaveBtn');
        var stopDeleteBtn = document.getElementById('stopDeleteBtn');
        var stopCancelBtn = document.getElementById('stopCancelBtn');

        // The value box only matters once an operator is chosen — grey it out and
        // clear it while the metric is set to "Any".
        function syncCondRow(opEl, valEl) {
            if (!opEl || !valEl) return;
            var active = Boolean(opEl.value);
            valEl.disabled = !active;
            if (!active) valEl.value = '';
        }
        function wireCondRow(opEl, valEl) {
            if (!opEl) return;
            opEl.addEventListener('change', function () {
                syncCondRow(opEl, valEl);
                if (opEl.value && valEl) valEl.focus();
            });
        }
        wireCondRow(condRatingOp, condRatingVal);
        wireCondRow(condReviewsOp, condReviewsVal);

        // Assemble the conditions string (e.g. "Rating>=4.5, Reviews>200") that the
        // scraper parses. Only rows with both an operator and a value contribute.
        function buildConditionsString() {
            var parts = [];
            if (condRatingOp && condRatingOp.value && condRatingVal && condRatingVal.value !== '') {
                parts.push('Rating' + condRatingOp.value + condRatingVal.value);
            }
            if (condReviewsOp && condReviewsOp.value && condReviewsVal && condReviewsVal.value !== '') {
                parts.push('Reviews' + condReviewsOp.value + condReviewsVal.value);
            }
            return parts.join(', ');
        }

        // Re-populate the operator/value controls from a saved conditions string.
        function restoreConditions(str) {
            if (!str) return;
            String(str).split(',').forEach(function (part) {
                var m = part.match(/^\s*(rating|reviews?)\s*(>=|<=|>|<|=)\s*([\d.]+)\s*$/i);
                if (!m) return;
                var isRating = /^rating/i.test(m[1]);
                var opEl = isRating ? condRatingOp : condReviewsOp;
                var valEl = isRating ? condRatingVal : condReviewsVal;
                if (opEl) opEl.value = m[2];
                if (valEl) valEl.value = m[3];
                syncCondRow(opEl, valEl);
            });
        }

        // Live-persist scrape form fields on every change so closing without
        // clicking Start doesn't lose what the user typed.
        function saveScrapeFormFields() {
            // Editing any scrape parameter means the next click should begin a fresh
            // scan, not resume the saved (now-stale) one — flip the button back.
            if (!userEditedForm) {
                userEditedForm = true;
                applyActionButtonLabel();
                refreshScrapeStatus();
            }
            chrome.storage.local.set({
                gmes_last_category: categoryInput ? categoryInput.value : '',
                gmes_last_location: locationInput ? locationInput.value : '',
                gmes_last_radius: radiusInput ? radiusInput.value : '',
                gmes_scrape_speed: speedInput ? speedInput.value : 'balanced',
                gmes_last_exclude: excludeInput ? excludeInput.value : '',
                gmes_last_conditions: buildConditionsString()
            });
        }
        if (categoryInput) categoryInput.addEventListener('input', saveScrapeFormFields);
        if (locationInput) locationInput.addEventListener('input', saveScrapeFormFields);
        if (radiusInput) radiusInput.addEventListener('change', saveScrapeFormFields);
        if (speedInput) speedInput.addEventListener('change', saveScrapeFormFields);
        if (excludeInput) excludeInput.addEventListener('input', saveScrapeFormFields);
        if (condRatingOp) condRatingOp.addEventListener('change', saveScrapeFormFields);
        if (condRatingVal) condRatingVal.addEventListener('input', saveScrapeFormFields);
        if (condReviewsOp) condReviewsOp.addEventListener('change', saveScrapeFormFields);
        if (condReviewsVal) condReviewsVal.addEventListener('input', saveScrapeFormFields);

        // Start disabled until an operator is picked.
        syncCondRow(condRatingOp, condRatingVal);
        syncCondRow(condReviewsOp, condReviewsVal);

        function setScrapeStatus(text, active) {
            if (!scrapeStatus) return;
            scrapeStatus.textContent = text || '';
            scrapeStatus.classList.toggle('active', Boolean(active));
        }

        // Reflect the current state in the controls: while running, hide the
        // Start/Resume button and show the Pause | Stop pair; while idle, do the
        // reverse and label the single button Resume (parked scan, form untouched)
        // or Start.
        function applyActionButtonLabel() {
            if (scraping) {
                if (actionButton) actionButton.style.display = 'none';
                if (scrapeRunControls) scrapeRunControls.style.display = 'flex';
            } else {
                if (scrapeRunControls) scrapeRunControls.style.display = 'none';
                if (actionButton) {
                    actionButton.style.display = '';
                    actionButton.textContent = (resumeInfo && !userEditedForm) ? 'Resume Scraping' : 'Start Scraping';
                }
            }
        }

        // Reflect the current count + running/paused state in the button + status line.
        function refreshScrapeStatus() {
            chrome.storage.local.get(['gmes_background_scraping', 'gmes_results', 'gmes_grid_total', 'gmes_grid_current', 'gmes_grid_state'], function (data) {
                var running = Boolean(data.gmes_background_scraping);
                scraping = running;
                var count = Array.isArray(data.gmes_results) ? data.gmes_results.length : 0;
                var gridTotal = Number(data.gmes_grid_total) || 0;
                var gridCurrent = Number(data.gmes_grid_current) || 0;
                // A parked grid scan (saved cursor, not running, not finished) can be resumed.
                var st = data.gmes_grid_state;
                if (!running && st && Array.isArray(st.points) && st.current > 0 && st.current < st.points.length) {
                    resumeInfo = { current: st.current, total: st.points.length };
                } else {
                    resumeInfo = null;
                }
                applyActionButtonLabel();
                if (running) {
                    var savedRadius = radiusInput ? parseFloat(radiusInput.value) : 5;
                    var isAny = (savedRadius === 0);
                    var msg = (gridTotal > 1)
                        ? 'Scanning area ' + gridCurrent + ' of ' + gridTotal + (isAny ? ' (full location)' : '') + ' — ' + count + ' leads collected.'
                        : 'Scraping… ' + count + ' leads collected. You can close this popup.';
                    setScrapeStatus(msg, true);
                } else if (resumeInfo && !userEditedForm) {
                    setScrapeStatus('Paused at area ' + resumeInfo.current + ' of ' + resumeInfo.total +
                        ' — click Resume to continue (' + count + ' leads so far).', false);
                } else if (count > 0) {
                    setScrapeStatus(count + ' leads in the list.', false);
                } else {
                    setScrapeStatus('', false);
                }
            });
        }

        // Restore last-used inputs.
        chrome.storage.local.get(['gmes_last_category', 'gmes_last_location', 'gmes_last_radius', 'gmes_scrape_speed', 'gmes_last_exclude', 'gmes_last_conditions', 'gmes_last_filename', 'gmes_background_scraping'], function (data) {
            if (categoryInput && data.gmes_last_category) categoryInput.value = data.gmes_last_category;
            if (locationInput && data.gmes_last_location) locationInput.value = data.gmes_last_location;
            if (radiusInput && data.gmes_last_radius) radiusInput.value = data.gmes_last_radius;
            if (speedInput) speedInput.value = data.gmes_scrape_speed || 'balanced';
            if (excludeInput && data.gmes_last_exclude) excludeInput.value = data.gmes_last_exclude;
            restoreConditions(data.gmes_last_conditions);
            if (filenameInput && data.gmes_last_filename) filenameInput.value = data.gmes_last_filename;
            scraping = Boolean(data.gmes_background_scraping);
            // refreshScrapeStatus sets the button label (Stop / Resume / Start) and
            // detects any parked grid scan to resume.
            refreshScrapeStatus();
        });
        if (filenameInput) filenameInput.addEventListener('input', function () {
            chrome.storage.local.set({ gmes_last_filename: filenameInput.value });
        });

        // Keep button + status in sync if scraping starts/stops elsewhere.
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area !== 'local') return;
            if (changes.gmes_background_scraping) scraping = changes.gmes_background_scraping.newValue === true;
            if (changes.gmes_background_scraping || changes.gmes_results || changes.gmes_grid_current || changes.gmes_grid_state) refreshScrapeStatus();
            if (changes.gmes_sessions) renderSavedSessions();
        });

        // Self-heal a stuck run. The flag is normally reset by the injected
        // controller's finish(), but if the Maps tab reloads/navigates/closes the
        // controller dies silently and the flag (and this button) get stuck on.
        // The controller writes gmes_scrape_heartbeat every loop tick; if it goes
        // stale while the flag is still set, the run is dead — clear it.
        var SCRAPE_STALE_MS = 25000;
        function checkScrapeAlive() {
            chrome.storage.local.get(['gmes_background_scraping', 'gmes_scrape_heartbeat'], function (data) {
                if (!data.gmes_background_scraping) return;
                var hb = Number(data.gmes_scrape_heartbeat) || 0;
                if (hb && (Date.now() - hb) > SCRAPE_STALE_MS) {
                    chrome.storage.local.set({ gmes_background_scraping: false, gmes_scrape_heartbeat: 0 });
                }
            });
        }
        setInterval(checkScrapeAlive, 5000);
        checkScrapeAlive();

        if (actionButton) {
            actionButton.addEventListener('click', function () {
                if (!scraping) {
                    // Resume a parked grid scan from its saved cursor (unless the user
                    // edited the form, in which case fall through to a fresh start).
                    if (resumeInfo && !userEditedForm) {
                        var resumeFrom = resumeInfo;
                        scraping = true;
                        applyActionButtonLabel();
                        setScrapeStatus('Resuming from area ' + resumeFrom.current + ' of ' + resumeFrom.total + '…', true);
                        chrome.runtime.sendMessage({ type: 'RESUME_AUTO_SCRAPE' }, function (resp) {
                            if (chrome.runtime.lastError || !resp || resp.resumed === false) {
                                scraping = false;
                                resumeInfo = null;
                                userEditedForm = true; // force a clean Start next click
                                applyActionButtonLabel();
                                setScrapeStatus((resp && resp.error) || 'Could not resume — press Start to begin a new scrape.', false);
                            }
                        });
                        return;
                    }
                    var category = (categoryInput && categoryInput.value || '').trim();
                    var location = (locationInput && locationInput.value || '').trim();
                    var radius = radiusInput ? parseFloat(radiusInput.value) : 5;
                    if (!category) { setScrapeStatus('Enter a business category.', false); if (categoryInput) categoryInput.focus(); return; }
                    if (!location) { setScrapeStatus('Enter a location.', false); if (locationInput) locationInput.focus(); return; }
                    if (isNaN(radius) || radius < 0) { radius = 5; if (radiusInput) radiusInput.value = '5'; }
                    // radius === 0 means "Any — full location"; background derives the effective radius from Maps zoom

                    var turboOn = turboToggle ? turboToggle.classList.contains('on') : false;
                    var excludeKeywords = (excludeInput && excludeInput.value || '').trim();
                    var conditions = buildConditionsString();
                    var skipTempClosed = skipClosedToggle ? skipClosedToggle.classList.contains('on') : true;
                    var scrapeWebsites = websiteScrapeToggle ? websiteScrapeToggle.classList.contains('on') : true;
                    var speedLabel = speedInput ? speedInput.value : 'balanced';

                    chrome.storage.local.set({
                        gmes_last_category: category,
                        gmes_last_location: location,
                        gmes_last_radius: radius,
                        gmes_scrape_speed: speedLabel,
                        gmes_last_exclude: excludeKeywords,
                        gmes_last_conditions: conditions,
                        gmes_turbo_mode: turboOn,
                        gmes_skip_temp_closed: skipTempClosed,
                        gmes_scrape_websites: scrapeWebsites
                    });

                    // Fresh start: discard any parked resume cursor and reset the edit flag.
                    resumeInfo = null;
                    userEditedForm = false;
                    scraping = true;
                    applyActionButtonLabel();
                    setScrapeStatus(turboOn
                        ? 'Starting Turbo… opening Google Maps and locating "' + location + '".'
                        : 'Starting… opening Google Maps and locating "' + location + '".', true);

                    chrome.runtime.sendMessage({
                        type: 'START_AUTO_SCRAPE',
                        category: category,
                        location: location,
                        radiusMiles: radius,
                        turbo: turboOn,
                        speed: speedMultiplier(speedLabel),
                        excludeKeywords: excludeKeywords,
                        conditions: conditions,
                        skipTempClosed: skipTempClosed
                    }, function (resp) {
                        if (chrome.runtime.lastError || !resp || resp.started === false) {
                            scraping = false;
                            applyActionButtonLabel();
                            setScrapeStatus((resp && resp.error) || 'Could not start scraping.', false);
                        }
                    });
                } else {
                    // The action button is hidden while scraping (Pause/Stop take over),
                    // so this branch is normally unreachable; kept as a safe fallback.
                    scraping = false;
                    resumeInfo = null;
                    userEditedForm = false;
                    applyActionButtonLabel();
                    chrome.runtime.sendMessage({ type: 'STOP_AUTO_SCRAPE' }, function () { void chrome.runtime.lastError; });
                    setScrapeStatus('Stopped.', false);
                }
            });
        }

        // ---- Pause / Stop + scraping sessions ----------------------------------
        // Pause: halt the run but keep the saved cursor so the existing Resume path
        // (refreshScrapeStatus -> resumeInfo) can continue it from where it stopped.
        if (pauseButton) {
            pauseButton.addEventListener('click', function () {
                scraping = false;
                applyActionButtonLabel();
                setScrapeStatus('Pausing…', false);
                chrome.runtime.sendMessage({ type: 'PAUSE_AUTO_SCRAPE' }, function () {
                    void chrome.runtime.lastError;
                    refreshScrapeStatus();
                });
            });
        }

        // Stop: ask whether to save the session for later or delete it permanently.
        if (stopButton) {
            stopButton.addEventListener('click', function () { openStopModal(); });
        }

        function closeStopModal() { if (stopSessionModal) stopSessionModal.style.display = 'none'; }

        // Gather this session's lead/block stats for the stop dialog.
        function computeSessionStats(cb) {
            chrome.storage.local.get(['gmes_results', 'gmes_active_session_id', 'gmes_grid_state', 'gmes_grid_total', 'gmes_grid_current'], function (d) {
                var results = Array.isArray(d.gmes_results) ? d.gmes_results : [];
                var activeId = d.gmes_active_session_id || '';
                var sessionLeads = activeId ? results.filter(function (it) { return it && it.sessionId === activeId; }) : results;
                var st = d.gmes_grid_state;
                var total = (st && Array.isArray(st.points)) ? st.points.length : (Number(d.gmes_grid_total) || 0);
                var processed = (st && typeof st.current === 'number') ? st.current : (Number(d.gmes_grid_current) || 0);
                if (processed > total) processed = total;
                cb({
                    sessionCount: sessionLeads.length,
                    unsentCount: sessionLeads.filter(function (it) { return it && !it.crmSynced; }).length,
                    total: total,
                    processed: processed,
                    remaining: Math.max(0, total - processed)
                });
            });
        }

        function openStopModal() {
            if (!stopSessionModal || !stopModalStats) return;
            computeSessionStats(function (s) {
                var blocksLine = s.total > 0
                    ? '<div>Location blocks processed: <strong>' + s.processed + ' of ' + s.total + '</strong> (' + s.remaining + ' remaining)</div>'
                    : '<div>Location blocks processed: <strong>' + s.processed + '</strong></div>';
                stopModalStats.innerHTML =
                    '<div>Leads collected this session: <strong>' + s.sessionCount + '</strong></div>' +
                    '<div>Not yet sent to GoHighLevel (local only): <strong>' + s.unsentCount + '</strong></div>' +
                    blocksLine;
                stopSessionModal.style.display = 'flex';
            });
        }

        // Build a self-contained session record (meta + grid cursor + a snapshot of
        // this run's leads) so it can be resumed later even if the table is cleared.
        function buildSessionRecord(cb) {
            chrome.storage.local.get(['gmes_grid_state', 'gmes_results', 'gmes_active_session_id', 'gmes_active_session_started', 'gmes_scrape_speed'], function (d) {
                var st = d.gmes_grid_state || null;
                var results = Array.isArray(d.gmes_results) ? d.gmes_results : [];
                var activeId = d.gmes_active_session_id || ('s_' + Date.now().toString(36));
                var leads = d.gmes_active_session_id ? results.filter(function (it) { return it && it.sessionId === activeId; }) : results.slice();
                var total = (st && Array.isArray(st.points)) ? st.points.length : 0;
                var processed = (st && typeof st.current === 'number') ? Math.min(st.current, total) : 0;
                var category = (st && st.category) || (categoryInput ? categoryInput.value : '') || '';
                var location = (st && st.location) || (locationInput ? locationInput.value : '') || '';
                cb({
                    id: activeId,
                    name: (category || 'Scrape') + (location ? (' in ' + location) : ''),
                    category: category,
                    location: location,
                    radius: (st && st.radiusMiles != null) ? st.radiusMiles : (radiusInput ? parseFloat(radiusInput.value) : 0) || 0,
                    speed: d.gmes_scrape_speed || (speedInput ? speedInput.value : 'balanced'),
                    turbo: Boolean(st && st.turbo),
                    gridState: st,
                    totalBlocks: total,
                    processedBlocks: processed,
                    leadCount: leads.length,
                    unsentCount: leads.filter(function (it) { return it && !it.crmSynced; }).length,
                    leads: leads,
                    createdAt: Number(d.gmes_active_session_started) || Date.now(),
                    updatedAt: Date.now()
                });
            });
        }

        function saveCurrentSession(cb) {
            buildSessionRecord(function (rec) {
                chrome.storage.local.get(['gmes_sessions'], function (d) {
                    var sessions = Array.isArray(d.gmes_sessions) ? d.gmes_sessions : [];
                    var idx = -1;
                    for (var i = 0; i < sessions.length; i++) { if (sessions[i] && sessions[i].id === rec.id) { idx = i; break; } }
                    if (idx >= 0) sessions[idx] = rec; else sessions.unshift(rec);
                    chrome.storage.local.set({ gmes_sessions: sessions }, function () { if (cb) cb(rec); });
                });
            });
        }

        // Delete-permanently path: drop this run's leads from the table by session tag.
        function discardActiveSessionLeads(cb) {
            chrome.storage.local.get(['gmes_results', 'gmes_active_session_id'], function (d) {
                var activeId = d.gmes_active_session_id || '';
                var results = Array.isArray(d.gmes_results) ? d.gmes_results : [];
                if (!activeId) { if (cb) cb(); return; }
                var kept = results.filter(function (it) { return !(it && it.sessionId === activeId); });
                if (kept.length !== results.length) chrome.storage.local.set({ gmes_results: kept }, function () { if (cb) cb(); });
                else if (cb) cb();
            });
        }

        // Common tail for both stop choices: clear the run and refresh the UI.
        function finalizeStop(statusMsg) {
            scraping = false;
            resumeInfo = null;
            userEditedForm = false;
            closeStopModal();
            chrome.runtime.sendMessage({ type: 'STOP_AUTO_SCRAPE' }, function () { void chrome.runtime.lastError; });
            applyActionButtonLabel();
            setScrapeStatus(statusMsg || 'Stopped.', false);
            renderSavedSessions();
        }

        if (stopCancelBtn) stopCancelBtn.addEventListener('click', closeStopModal);
        if (stopSessionModal) stopSessionModal.addEventListener('click', function (e) { if (e.target === stopSessionModal) closeStopModal(); });
        if (stopSaveBtn) stopSaveBtn.addEventListener('click', function () {
            saveCurrentSession(function () { finalizeStop('Session saved. Resume it anytime from Saved Sessions.'); });
        });
        if (stopDeleteBtn) stopDeleteBtn.addEventListener('click', function () {
            if (!confirm('Delete this session permanently? The leads collected in this run will be removed from the list.')) return;
            discardActiveSessionLeads(function () { finalizeStop('Session deleted.'); });
        });

        function formatSessionDate(ts) {
            if (!ts) return '';
            try {
                var d = new Date(Number(ts));
                return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
                    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            } catch (e) { return ''; }
        }

        // Render the list of saved sessions (hidden when there are none).
        function renderSavedSessions() {
            if (!savedSessionsList || !savedSessionsPanel) return;
            chrome.storage.local.get(['gmes_sessions'], function (d) {
                var sessions = Array.isArray(d.gmes_sessions) ? d.gmes_sessions : [];
                savedSessionsList.innerHTML = '';
                if (!sessions.length) { savedSessionsPanel.style.display = 'none'; return; }
                savedSessionsPanel.style.display = '';
                sessions.forEach(function (s) {
                    if (!s) return;
                    var total = Number(s.totalBlocks) || 0;
                    var processed = Number(s.processedBlocks) || 0;
                    var remaining = Math.max(0, total - processed);
                    var blocks = total ? (processed + ' / ' + total + ' blocks') : (processed + ' blocks');

                    var card = document.createElement('div');
                    card.className = 'session-card';

                    var name = document.createElement('div');
                    name.className = 'session-name';
                    name.textContent = s.name || 'Saved session';

                    var meta = document.createElement('div');
                    meta.className = 'session-meta';
                    meta.textContent = (Number(s.leadCount) || 0) + ' leads (' + (Number(s.unsentCount) || 0) + ' not in GHL) · ' +
                        blocks + (remaining ? (' · ' + remaining + ' left') : ' · done') +
                        (s.createdAt ? (' · ' + formatSessionDate(s.createdAt)) : '');

                    var actions = document.createElement('div');
                    actions.className = 'session-actions';

                    var resumeBtn = document.createElement('button');
                    resumeBtn.className = 'button';
                    resumeBtn.textContent = 'Resume';
                    resumeBtn.addEventListener('click', function () { resumeSavedSession(s.id); });

                    var delBtn = document.createElement('button');
                    delBtn.className = 'button red-btn';
                    delBtn.textContent = 'Delete';
                    delBtn.addEventListener('click', function () {
                        if (!confirm('Delete saved session "' + (s.name || '') + '"? You won\'t be able to resume it.')) return;
                        deleteSavedSession(s.id);
                    });

                    actions.appendChild(resumeBtn);
                    actions.appendChild(delBtn);
                    card.appendChild(name);
                    card.appendChild(meta);
                    card.appendChild(actions);
                    savedSessionsList.appendChild(card);
                });
            });
        }

        function deleteSavedSession(id) {
            chrome.storage.local.get(['gmes_sessions'], function (d) {
                var sessions = Array.isArray(d.gmes_sessions) ? d.gmes_sessions : [];
                var rest = sessions.filter(function (s) { return !(s && s.id === id); });
                chrome.storage.local.set({ gmes_sessions: rest }, function () { renderSavedSessions(); });
            });
        }

        // Load a saved session back into the working state and continue scraping.
        function resumeSavedSession(id) {
            if (scraping) { setScrapeStatus('Pause or stop the current scrape first.', false); return; }
            chrome.storage.local.get(['gmes_sessions', 'gmes_results'], function (d) {
                var sessions = Array.isArray(d.gmes_sessions) ? d.gmes_sessions : [];
                var sess = null, rest = [];
                sessions.forEach(function (s) { if (s && s.id === id) sess = s; else rest.push(s); });
                if (!sess) { setScrapeStatus('Saved session not found.', false); return; }
                if (!sess.gridState || !Array.isArray(sess.gridState.points)) {
                    setScrapeStatus('This session has no resumable progress.', false);
                    return;
                }

                // Merge the snapshot leads back into the table (deduped by identity).
                var existing = Array.isArray(d.gmes_results) ? d.gmes_results : [];
                var seen = {};
                var merged = [];
                function addItem(it) {
                    if (!it) return;
                    var k = placeIdentity(it);
                    if (k) { if (seen[k]) return; seen[k] = true; }
                    merged.push(it);
                }
                existing.forEach(addItem);
                (sess.leads || []).forEach(addItem);

                if (categoryInput && sess.category) categoryInput.value = sess.category;
                if (locationInput && sess.location) locationInput.value = sess.location;
                if (radiusInput && sess.radius != null) radiusInput.value = sess.radius;
                if (speedInput && sess.speed) speedInput.value = sess.speed;

                chrome.storage.local.set({
                    gmes_results: merged,
                    gmes_sessions: rest,
                    gmes_grid_state: sess.gridState,
                    gmes_grid_total: sess.gridState.points.length,
                    gmes_grid_current: sess.gridState.current || 0,
                    gmes_active_session_id: sess.id,
                    gmes_active_session_started: sess.createdAt || Date.now()
                }, function () {
                    resumeInfo = null;
                    userEditedForm = false;
                    scraping = true;
                    applyActionButtonLabel();
                    setScrapeStatus('Resuming "' + (sess.name || 'session') + '"…', true);
                    chrome.runtime.sendMessage({ type: 'RESUME_AUTO_SCRAPE' }, function (resp) {
                        if (chrome.runtime.lastError || !resp || resp.resumed === false) {
                            scraping = false;
                            applyActionButtonLabel();
                            setScrapeStatus((resp && resp.error) || 'Could not resume the session.', false);
                        }
                    });
                    renderSavedSessions();
                });
            });
        }

        renderSavedSessions();

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

                var headerLabels = ['Title', 'Note', 'Business Timings', 'Rating', 'Reviews', 'Phone', 'Phone Label', 'Industry', 'City', 'Address', 'Email', 'Website', 'Insta Search', 'Google Maps Link', 'Latitude', 'Longitude', 'CRM Status'];

                var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>';
                html += '<table border="1" style="border-collapse:collapse;">';
                html += '<thead><tr>';
                headerLabels.forEach(function (h) { html += '<th>' + h + '</th>'; });
                html += '</tr></thead><tbody>';

                var exportSeen = new Set();
                storedItems.forEach(function (item) {
                    var key = placeIdentity(item);
                    if (!key || exportSeen.has(key)) return;
                    exportSeen.add(key);

                    var phones = Array.isArray(item.phones) && item.phones.length
                        ? item.phones
                        : (item.phone ? [{ number: item.phone, label: 'Main', location_name: '', location_address: '' }] : [{ number: '', label: '', location_name: '', location_address: '' }]);

                    var crmStatus = item.crmSynced ? 'In GHL' : '';
                    var emailDisplay = Array.isArray(item.emails) && item.emails.length
                        ? item.emails.join(', ')
                        : (item.email || '');
                    var websiteUrl = item.companyUrl && item.companyUrl.indexOf('https://www.google.com/maps') !== 0
                        ? item.companyUrl
                        : 'https://www.google.com/search?q=' + encodeURIComponent((item.title || '') + ' ' + (item.city || '') + ' Website');

                    phones.forEach(function (p) {
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

        if (/permanently closed/i.test(containerText)) {
            return null;
        }
        var businessTimings = (function (text) {
            if (!text) return '';
            var t = text.replace(/[  ]/g, ' ');
            var m = t.match(/Open 24 hours/i)
                || t.match(/(?:Open|Closed|Closes soon|Opens soon)\s*[⋅·]\s*(?:Closes|Opens)?\s*\d{1,2}(?::\d{2})?\s*[AP]M(?:\s+[A-Z][a-z]{2})?/i)
                || t.match(/Temporarily closed/i);
            return m ? m[0].replace(/\s+/g, ' ').trim() : '';
        })(containerText);

        var rating = '';
        var reviewCount = '';
        var phone = '';
        var industry = '';
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

        // Company URL — prefer the link Google explicitly tags as the website
        // (data-value="Website" on cards, data-item-id="authority" on detail
        // panes), else fall back to the first external, non-Google link.
        if (container) {
            var isGoogleHost = function (url) {
                try {
                    if (url.indexOf('https://www.google.com/maps/') === 0) return true;
                    if (url.indexOf('https://www.google.com/search') === 0) return true;
                    var host = new URL(url).hostname.toLowerCase();
                    return host === 'google.com' || host.endsWith('.google.com') || host.endsWith('.gstatic.com');
                } catch (e) { return true; }
            };
            var direct = container.querySelector('a[data-item-id="authority"], a[data-value="Website"]');
            if (direct && direct.href && !isGoogleHost(direct.href)) {
                companyUrl = direct.href;
            } else {
                var ext = Array.prototype.slice.call(container.querySelectorAll('a[href^="http"]')).find(function (a) {
                    return a.href && !isGoogleHost(a.href);
                });
                if (ext) companyUrl = ext.href;
            }
        }

        // Phone Numbers — try multiple sources in order: explicit phone button,
        // aria-labels (Maps packs full summary into the place-link aria-label),
        // then visible text as a last resort.
        var PHONE_REGEX = /(?:\+?1[\s.\-–]?)?(?:\(\s*[2-9]\d{2}\s*\)|[2-9]\d{2})[\s.\-–]?[2-9]\d{2}[\s.\-–]?\d{4}/;
        if (container) {
            try {
                var phoneBtn = container.querySelector('button[aria-label^="Phone:"], button[data-value="Phone"], a[aria-label^="Phone:"], [data-tooltip="Copy phone number"]');
                if (phoneBtn) {
                    var pLabel = phoneBtn.getAttribute('aria-label') || phoneBtn.getAttribute('data-tooltip') || '';
                    var pm = pLabel.match(/Phone:\s*(.+)/i);
                    if (pm && pm[1]) {
                        var pmm = pm[1].match(PHONE_REGEX);
                        phone = pmm ? pmm[0] : pm[1].trim();
                    } else {
                        var inner = (phoneBtn.textContent || '').match(PHONE_REGEX);
                        if (inner) phone = inner[0];
                    }
                }
            } catch (e) {}
            if (!phone) {
                try {
                    var labelSources = [];
                    var placeLink = container.querySelector('a[href^="https://www.google.com/maps/place"]');
                    if (placeLink && placeLink.getAttribute('aria-label')) labelSources.push(placeLink.getAttribute('aria-label'));
                    if (container.getAttribute && container.getAttribute('aria-label')) labelSources.push(container.getAttribute('aria-label'));
                    container.querySelectorAll('[aria-label]').forEach(function (el) {
                        var v = el.getAttribute('aria-label');
                        if (v) labelSources.push(v);
                    });
                    for (var i = 0; i < labelSources.length; i++) {
                        var lm = labelSources[i].match(PHONE_REGEX);
                        if (lm) { phone = lm[0]; break; }
                    }
                } catch (e) {}
            }
            if (!phone) {
                var phoneMatch = containerText.match(PHONE_REGEX);
                phone = phoneMatch ? phoneMatch[0] : '';
            }
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

        // Coordinates: place URL carries the precise pin as !3d<lat>!4d<lng>,
        // with the @<lat>,<lng> map center as a fallback.
        var lat = '', lng = '';
        var coordMatch = (link.href || '').match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
            (link.href || '').match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (coordMatch) { lat = coordMatch[1]; lng = coordMatch[2]; }

        return {
            title: titleText,
            note: '',
            businessTimings: businessTimings,
            rating: rating,
            reviewCount: reviewCount,
            phone: phone,
            phones: phones,
            industry: industry,
            city: city,
            address: address,
            companyUrl: companyUrl,
            instaSearch: instaSearch,
            href: link.href,
            lat: lat,
            lng: lng,
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
