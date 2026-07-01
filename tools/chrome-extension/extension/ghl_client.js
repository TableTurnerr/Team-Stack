// ghl_client.js — GoHighLevel client (shared by popup.js and results_tab.js)
// ---------------------------------------------------------------------------
// The extension never holds a GHL token. It talks to the TableTurnerr backend
// proxy, which holds the GHL OAuth tokens (client_secret + refresh) and forwards
// requests to services.leadconnectorhq.com on the user's behalf.
//
// Auth: every call sends `Authorization: Bearer <gmes_ghl_session>`, where the
// session is a TableTurnerr session token captured during the OAuth connect flow.
//
// Loaded as a classic <script> before popup.js / results_tab.js; attaches `GHL`.
// ---------------------------------------------------------------------------
(function () {
    'use strict';

    // Fallback only — the real base is delivered per-connect via tt_session.apiBase
    // (the dashboard sets it to its own origin + '/api').
    var DEFAULT_API_BASE = 'https://crm.tableturnerr.com/api';
    var CACHE_TTL_MS = 5 * 60 * 1000;

    // ---- Settings / connection ------------------------------------------------
    function getSettings(cb) {
        chrome.storage.local.get(['gmes_ghl_api_base', 'gmes_ghl_session'], function (d) {
            cb((d.gmes_ghl_api_base || DEFAULT_API_BASE).replace(/\/$/, ''), d.gmes_ghl_session || '');
        });
    }

    function isConnected(cb) {
        getSettings(function (base, session) { cb(Boolean(session)); });
    }

    // ---- Core request helper --------------------------------------------------
    // Transient backend failures are retried with exponential backoff:
    //   503 = proxy reported PocketBase momentarily unavailable (pb_unavailable)
    //   502/504 = gateway/upstream hiccup (cold start, brief GHL blip)
    // The backend upserts contacts by phone/email, so a retried POST /leads does
    // not create duplicates. Non-5xx errors (incl. GHL 4xx surfaced as the proxy's
    // mapped status) are returned immediately — retrying them would not help.
    var RETRY_STATUSES = { 502: true, 503: true, 504: true };
    var MAX_ATTEMPTS = 3;

    // cb receives { ok, status, data, error }.
    function request(method, path, body, cb) {
        getSettings(function (base, session) {
            if (!session) {
                cb({ ok: false, error: 'Not connected to GoHighLevel. Click Connect in the popup.' });
                return;
            }
            var headers = { 'Authorization': 'Bearer ' + session };
            var opts = { method: method, headers: headers };
            if (body !== undefined && body !== null) {
                headers['Content-Type'] = 'application/json';
                opts.body = JSON.stringify(body);
            }

            function retry(attempt) {
                // Backoff: 600ms, then 1800ms before the 2nd and 3rd tries.
                setTimeout(function () { attemptRequest(attempt + 1); }, 600 * Math.pow(3, attempt - 1));
            }

            function attemptRequest(attempt) {
                fetch(base + path, opts)
                    .then(function (r) {
                        return r.text().then(function (t) {
                            var json = null;
                            try { json = t ? JSON.parse(t) : null; } catch (e) { /* non-JSON */ }
                            if (!r.ok) {
                                if (RETRY_STATUSES[r.status] && attempt < MAX_ATTEMPTS) { retry(attempt); return; }
                                cb({ ok: false, status: r.status, error: (json && (json.error || json.message)) || ('HTTP ' + r.status), data: json });
                                return;
                            }
                            cb({ ok: true, status: r.status, data: json });
                        });
                    })
                    .catch(function (e) {
                        // Network-level failure (DNS, dropped connection): also transient.
                        if (attempt < MAX_ATTEMPTS) { retry(attempt); return; }
                        cb({ ok: false, error: e.message || String(e) });
                    });
            }

            attemptRequest(1);
        });
    }

    // Generic cached GET. Stores results under `cacheKey` (+ `cacheKey + '_ts'`).
    function cachedGet(cacheKey, path, mapFn, force, cb) {
        var tsKey = cacheKey + '_ts';
        var getKeys = {};
        getKeys[cacheKey] = null;
        getKeys[tsKey] = null;
        chrome.storage.local.get([cacheKey, tsKey], function (d) {
            var cached = Array.isArray(d[cacheKey]) ? d[cacheKey] : [];
            var fresh = d[tsKey] && (Date.now() - d[tsKey] < CACHE_TTL_MS);
            if (cached.length && !force && fresh) { cb(cached); return; }
            request('GET', path, null, function (res) {
                if (!res.ok || res.data == null) { cb(cached); return; }
                var items;
                try { items = mapFn(res.data); } catch (e) { items = cached; }
                var set = {};
                set[cacheKey] = items;
                set[tsKey] = Date.now();
                chrome.storage.local.set(set);
                cb(items);
            });
        });
    }

    // ---- Status ---------------------------------------------------------------
    function status(cb) {
        request('GET', '/ghl/status', null, function (res) {
            cb(res.ok ? (res.data || { connected: false }) : { connected: false, error: res.error });
        });
    }

    // ---- Read endpoints (populate selectors) ----------------------------------
    function fetchLocations(force, cb) {
        cachedGet('gmes_ghl_locations_cache', '/ghl/locations', function (data) {
            var arr = Array.isArray(data) ? data : (data.locations || data.items || []);
            return arr.map(function (l) { return { id: l.id, name: l.name || l.id }; });
        }, force, cb);
    }

    function fetchUsers(locationId, force, cb) {
        if (!locationId) { cb([]); return; }
        cachedGet('gmes_ghl_users_cache_' + locationId, '/ghl/locations/' + locationId + '/users', function (data) {
            var arr = Array.isArray(data) ? data : (data.users || data.items || []);
            return arr.map(function (u) { return { id: u.id, name: u.name || u.email || u.id, email: u.email || '' }; });
        }, force, cb);
    }

    function fetchPipelines(locationId, force, cb) {
        if (!locationId) { cb([]); return; }
        cachedGet('gmes_ghl_pipelines_cache_' + locationId, '/ghl/locations/' + locationId + '/pipelines', function (data) {
            var arr = Array.isArray(data) ? data : (data.pipelines || data.items || []);
            return arr.map(function (p) {
                return {
                    id: p.id,
                    name: p.name || p.id,
                    stages: (p.stages || []).map(function (s) { return { id: s.id, name: s.name || s.id }; })
                };
            });
        }, force, cb);
    }

    function fetchTags(locationId, force, cb) {
        if (!locationId) { cb([]); return; }
        cachedGet('gmes_ghl_tags_cache_' + locationId, '/ghl/locations/' + locationId + '/tags', function (data) {
            var arr = Array.isArray(data) ? data : (data.tags || data.items || []);
            return arr.map(function (t) { return { id: t.id || t.name, name: t.name || t.id }; });
        }, force, cb);
    }

    // ---- Tag creation ---------------------------------------------------------
    // Creates a tag in the sub-account, then drops the cached tag list so the
    // next fetch (force-refreshed by the caller) includes it. cb receives
    // { ok, tag:{ id, name }, error }.
    function createTag(locationId, name, cb) {
        var clean = (name || '').trim();
        if (!locationId) { cb({ ok: false, error: 'No sub-account selected.' }); return; }
        if (!clean) { cb({ ok: false, error: 'Tag name is empty.' }); return; }
        request('POST', '/ghl/locations/' + locationId + '/tags', { name: clean }, function (res) {
            if (!res.ok) { cb({ ok: false, error: res.error || 'Failed to create tag.' }); return; }
            var d = res.data || {};
            var t = d.tag || d;
            var tag = { id: (t && (t.id || t.name)) || clean, name: (t && t.name) || clean };
            chrome.storage.local.remove(
                ['gmes_ghl_tags_cache_' + locationId, 'gmes_ghl_tags_cache_' + locationId + '_ts'],
                function () { cb({ ok: true, tag: tag }); }
            );
        });
    }

    // ---- Tag-select "create new" UI helper ------------------------------------
    // Sentinel option value used to trigger tag creation from a <select>.
    var CREATE_TAG_SENTINEL = '__gmes_create_tag__';

    // Append the "+ Create new tag…" option to a tag <select>. Call after the
    // real tags have been added.
    function appendCreateTagOption(selectEl) {
        if (!selectEl) return;
        var opt = document.createElement('option');
        opt.value = CREATE_TAG_SENTINEL;
        opt.textContent = '+ Create new tag…';
        selectEl.appendChild(opt);
    }

    // Wire a tag <select> so picking the sentinel prompts for a name, creates the
    // tag, and re-fills the select with the new tag selected. `getLocationId`
    // returns the current sub-account id; `refill(name)` re-populates the select
    // (force-refreshed) with `name` selected.
    function wireCreateTag(selectEl, getLocationId, refill) {
        if (!selectEl) return;
        var lastValue = selectEl.value;
        selectEl.addEventListener('change', function () {
            if (selectEl.value !== CREATE_TAG_SENTINEL) { lastValue = selectEl.value; return; }
            var locationId = getLocationId();
            if (!locationId) { alert('Select a sub-account first.'); selectEl.value = lastValue; return; }
            var name = (window.prompt('New tag name:') || '').trim();
            if (!name) { selectEl.value = lastValue; return; }
            selectEl.disabled = true;
            createTag(locationId, name, function (res) {
                selectEl.disabled = false;
                if (!res.ok) { alert('Could not create tag: ' + (res.error || 'unknown error')); selectEl.value = lastValue; return; }
                lastValue = res.tag.name;
                refill(res.tag.name);
            });
        });
    }

    // ---- Phone helper ---------------------------------------------------------
    // GHL expects E.164 (+1XXXXXXXXXX). Returns '' if not usable.
    function toE164(raw) {
        if (!raw) return '';
        var digits = String(raw).replace(/\D/g, '');
        if (!digits) return '';
        if (digits.length === 10) digits = '1' + digits;
        return '+' + digits;
    }

    // ---- Dedup check ----------------------------------------------------------
    // phones: array of { number } (or strings). cb receives { exists, contactId }.
    function checkDuplicate(locationId, phones, email, cb) {
        if (!locationId) { cb({ exists: false }); return; }
        var phoneList = Array.isArray(phones) ? phones : [];
        var firstPhone = '';
        for (var i = 0; i < phoneList.length; i++) {
            var e = toE164(phoneList[i] && phoneList[i].number !== undefined ? phoneList[i].number : phoneList[i]);
            if (e) { firstPhone = e; break; }
        }
        var qs = [];
        if (firstPhone) qs.push('phone=' + encodeURIComponent(firstPhone));
        if (email) qs.push('email=' + encodeURIComponent(email));
        if (!qs.length) { cb({ exists: false }); return; }
        request('GET', '/ghl/locations/' + locationId + '/duplicate?' + qs.join('&'), null, function (res) {
            if (!res.ok || !res.data) { cb({ exists: false }); return; }
            cb({ exists: Boolean(res.data.exists || res.data.contactId), contactId: res.data.contactId || null });
        });
    }

    // ---- Location / derived-field helpers -------------------------------------
    // US state full name -> USPS code. Used to turn a search-query location like
    // "Columbus, OH" or "columbus ohio" into a clean city + a 2-letter state.
    var US_STATE_ABBR = {
        'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
        'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'district of columbia': 'DC',
        'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL',
        'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA',
        'maine': 'ME', 'maryland': 'MD', 'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN',
        'mississippi': 'MS', 'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
        'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
        'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
        'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
        'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
        'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY'
    };
    var US_STATE_CODES = {};
    for (var _k in US_STATE_ABBR) { if (US_STATE_ABBR.hasOwnProperty(_k)) US_STATE_CODES[US_STATE_ABBR[_k]] = true; }

    // Normalize a state token to its USPS code; '' if it isn't a US state.
    function normalizeState(raw) {
        if (!raw) return '';
        var s = String(raw).trim().replace(/\.+$/, '');
        if (!s) return '';
        if (s.length === 2 && US_STATE_CODES[s.toUpperCase()]) return s.toUpperCase();
        return US_STATE_ABBR[s.toLowerCase()] || '';
    }

    // Split a free-form location ("Columbus, OH", "columbus ohio", "New York")
    // into { city, state }. A trailing state token is only peeled off when a real
    // city remains, so a bare "New York" stays a city rather than becoming NY.
    function splitCityState(raw) {
        var s = String(raw || '').trim();
        if (!s) return { city: '', state: '' };
        var comma = s.lastIndexOf(',');
        if (comma !== -1) {
            var st = normalizeState(s.slice(comma + 1));
            if (st) return { city: s.slice(0, comma).trim(), state: st };
            return { city: s, state: '' };
        }
        var tokens = s.split(/\s+/);
        if (tokens.length >= 3) {
            var st2 = normalizeState(tokens.slice(-2).join(' '));  // e.g. "new mexico"
            if (st2) return { city: tokens.slice(0, -2).join(' '), state: st2 };
        }
        if (tokens.length >= 2) {
            var st1 = normalizeState(tokens[tokens.length - 1]);
            if (st1) return { city: tokens.slice(0, -1).join(' '), state: st1 };
        }
        return { city: s, state: '' };
    }

    // Best-effort 5(+4) ZIP from a street address, ignoring a leading house number
    // so "12345 Main St" isn't read as a ZIP. Detail-mode scrapes carry a real zip;
    // this only helps the feed-card paths that don't.
    function zipFromAddress(addr) {
        var rest = String(addr || '').trim().replace(/^\s*\d+\s+/, '');
        var m = rest.match(/\b(\d{5}(?:-\d{4})?)\b/);
        return m ? m[1] : '';
    }

    // Best-effort IANA timezone from a US lat/lng. Continental bands by longitude
    // with Alaska/Hawaii carved out by position; DST-exempt zones (e.g. Arizona)
    // approximate to Mountain. Good enough for a CRM timezone, not a geo service.
    function timezoneFromCoords(lat, lng) {
        var la = parseFloat(lat), lo = parseFloat(lng);
        if (!isFinite(la) || !isFinite(lo)) return '';
        if (la < 25 && lo < -150) return 'Pacific/Honolulu';   // Hawaii
        if (la > 51 && lo < -129) return 'America/Anchorage';  // Alaska
        if (lo <= -114) return 'America/Los_Angeles';          // Pacific
        if (lo <= -103) return 'America/Denver';               // Mountain
        if (lo <= -87) return 'America/Chicago';               // Central
        return 'America/New_York';                             // Eastern
    }

    // Resolve city/state/postalCode/country/timezone for a scraped item. Prefers
    // the scraper's structured fields (detail mode reads the full formal address)
    // and falls back to splitting the search-query location and the coordinates.
    function deriveLocation(item) {
        item = item || {};
        var city = (item.city || '').trim();
        var state = normalizeState(item.state || '');
        if (state) {
            // A real state is already known; strip a stray ", ST" left in the city.
            var c = splitCityState(city);
            if (c.state && c.city) city = c.city;
        } else {
            var split = splitCityState(city);
            state = split.state;
            if (split.state && split.city) city = split.city;
        }
        var postalCode = String(item.zip || item.postalCode || '').trim() || zipFromAddress(item.address);
        var timezone = timezoneFromCoords(item.lat, item.lng);
        var country = (state || postalCode) ? 'US' : '';
        return { city: city, state: state, postalCode: postalCode, country: country, timezone: timezone };
    }

    // Condense a scraped weekly schedule for the note, matching the table display:
    // "Monday: 9 AM–5 PM; …" -> "Mon-Wed: 9AM-5PM, Thu: 10AM-4PM, Fri-Sun: Closed".
    // Non-breakdown values ("Open 24 hours", a one-line status) pass through lightly
    // normalized. Kept in sync with formatBusinessTimings() in popup.js/results_tab.js.
    function formatBusinessTimings(raw) {
        if (!raw) return '';
        var DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        var SHORT = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
        function normHours(h) {
            return String(h)
                .replace(/\s+/g, ' ')
                .replace(/(\d)\s*(?::(\d{2}))?\s*([AP])\.?\s*M\.?/gi, function (_, hh, mm, ap) {
                    return hh + (mm ? ':' + mm : '') + ap.toUpperCase() + 'M';
                })
                .replace(/\s*(?:–|—|-|\bto\b)\s*/g, '-')
                .trim();
        }
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

    // ---- Build lead payload (Google Maps item -> GHL) -------------------------
    // opts: { tag, assignedTo, note, createOpp, pipelineId, stageId }
    function buildLeadPayload(item, opts) {
        opts = opts || {};
        var phones = Array.isArray(item.phones) && item.phones.length
            ? item.phones
            : (item.phone ? [{ number: item.phone, label: 'Main' }] : []);
        var primary = '';
        for (var i = 0; i < phones.length; i++) {
            var e = toE164(phones[i].number);
            if (e) { primary = e; break; }
        }
        var website = item.companyUrl || '';
        if (website && website.indexOf('https://www.google.com/maps') === 0) website = '';
        var extraPhones = phones.slice(1)
            .map(function (p) { var n = toE164(p.number); return n ? (n + (p.label ? ' (' + p.label + ')' : '')) : ''; })
            .filter(Boolean);

        // Fold structured fields into the note (backend may also map to custom fields).
        var noteLines = [];
        if (opts.note) noteLines.push(opts.note);
        var meta = [];
        if (item.rating) meta.push('Rating: ' + item.rating + (item.reviewCount ? ' (' + String(item.reviewCount).replace(/[()]/g, '') + ' reviews)' : ''));
        if (item.industry) meta.push('Industry: ' + item.industry);
        if (item.href) meta.push('Google Maps: ' + item.href);
        if (item.lat && item.lng) {
            meta.push('Coordinates: ' + item.lat + ', ' + item.lng);
            meta.push('Map pin: https://www.google.com/maps?q=' + item.lat + ',' + item.lng);
        }
        if (item.businessTimings) meta.push('Business timings: ' + formatBusinessTimings(item.businessTimings));
        if (extraPhones.length) meta.push('Additional phones: ' + extraPhones.join(', '));
        if (meta.length) noteLines.push(meta.join('\n'));
        var note = noteLines.join('\n\n');

        // Company name only — no person name is scraped, so first/last are left
        // blank and the business goes in companyName (per product requirement).
        var loc = deriveLocation(item);
        var contact = {
            companyName: item.title || '',
            phone: primary,
            address1: item.address || '',
            website: website,
            source: 'Google Maps - Scraper',
            tags: opts.tag ? [opts.tag] : []
        };
        // Attach only the location fields we actually resolved. state/postalCode
        // are sent straight through; country/timezone require the matching
        // backend allow-list entries (CONTACT_STRING_FIELDS) to reach GHL.
        if (loc.city) contact.city = loc.city;
        if (loc.state) contact.state = loc.state;
        if (loc.postalCode) contact.postalCode = loc.postalCode;
        if (loc.country) contact.country = loc.country;
        if (loc.timezone) contact.timezone = loc.timezone;
        // Email is validated server-side (IsEmail). Only include a syntactically
        // valid address; sending '' for a lead with no scraped email is rejected.
        var email = (item.email || '').trim();
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) contact.email = email;
        // Coordinates live in the note (above). They are NOT sent as contact keys:
        // the backend rejects unknown properties (latitude/longitude → 400).
        if (opts.assignedTo) contact.assignedTo = opts.assignedTo;

        var payload = { contact: contact, note: note };
        if (opts.createOpp && opts.pipelineId && opts.stageId) {
            payload.opportunity = {
                create: true,
                pipelineId: opts.pipelineId,
                stageId: opts.stageId,
                name: item.title || 'New Lead',
                status: 'open',
                monetaryValue: 0
            };
            if (opts.assignedTo) payload.opportunity.assignedTo = opts.assignedTo;
        }
        return payload;
    }

    // ---- Delete (undo a send) -------------------------------------------------
    // Removes the contact (and, when an opportunity id is supplied, its
    // opportunity) from the sub-account. Backs the per-lead "Undo" button.
    // Served by DELETE /ghl/locations/:loc/contacts/:id. cb receives
    // { success, error }.
    function deleteLead(locationId, contactId, opportunityId, cb) {
        if (typeof opportunityId === 'function') { cb = opportunityId; opportunityId = ''; }
        if (!locationId) { cb({ success: false, error: 'No sub-account selected.' }); return; }
        if (!contactId) { cb({ success: false, error: 'No contact id to remove.' }); return; }
        var path = '/ghl/locations/' + locationId + '/contacts/' + encodeURIComponent(contactId);
        if (opportunityId) path += '?opportunityId=' + encodeURIComponent(opportunityId);
        request('DELETE', path, null, function (res) {
            if (!res.ok) { cb({ success: false, error: res.error || 'Delete failed' }); return; }
            cb({ success: true });
        });
    }

    // ---- Composite send (contact + note + opportunity) ------------------------
    function sendLead(locationId, item, opts, cb) {
        if (!locationId) { cb({ success: false, error: 'No sub-account selected.' }); return; }
        var payload = buildLeadPayload(item, opts || {});
        request('POST', '/ghl/locations/' + locationId + '/leads', payload, function (res) {
            if (!res.ok) {
                cb({ success: false, error: res.error || 'Send failed', duplicate: Boolean(res.data && res.data.duplicate) });
                return;
            }
            var d = res.data || {};
            cb({
                success: true,
                contactId: d.contactId || null,
                opportunityId: d.opportunityId || null,
                duplicate: Boolean(d.duplicate),
                status: d.status || 'created'
            });
        });
    }

    // ---- Saved scraping sessions (stored in GHL as custom object records) -----
    // A user's saved scraping campaigns live server-side in GoHighLevel, scoped to
    // the logged-in user, so they show up on every machine and in both extension
    // builds. Separate from the leads/contacts the extension pushes.
    //   cb receives { ok, sessions?, session?, error }.
    function listScrapingSessions(locationId, cb) {
        if (!locationId) { cb({ ok: false, error: 'No sub-account selected.' }); return; }
        request('GET', '/ghl/locations/' + locationId + '/scraping-sessions', null, function (res) {
            if (!res.ok) { cb({ ok: false, error: res.error || 'Failed to load sessions', status: res.status }); return; }
            cb({ ok: true, sessions: (res.data && res.data.sessions) || [] });
        });
    }

    function saveScrapingSession(locationId, session, cb) {
        if (!locationId) { cb({ ok: false, error: 'No sub-account selected.' }); return; }
        if (!session || !session.id) { cb({ ok: false, error: 'Session is missing an id.' }); return; }
        request('POST', '/ghl/locations/' + locationId + '/scraping-sessions', { session: session }, function (res) {
            if (!res.ok) { cb({ ok: false, error: res.error || 'Failed to save session', status: res.status }); return; }
            cb({ ok: true, session: (res.data && res.data.session) || null });
        });
    }

    function deleteScrapingSession(locationId, recordId, cb) {
        if (!locationId) { cb({ ok: false, error: 'No sub-account selected.' }); return; }
        if (!recordId) { cb({ ok: false, error: 'No session id to remove.' }); return; }
        var path = '/ghl/locations/' + locationId + '/scraping-sessions/' + encodeURIComponent(recordId);
        request('DELETE', path, null, function (res) {
            if (!res.ok) { cb({ ok: false, error: res.error || 'Failed to delete session', status: res.status }); return; }
            cb({ ok: true });
        });
    }

    // Attach to globalThis so this works in both extension pages (window) and the
    // background service worker (self), where it is loaded via importScripts.
    var root = (typeof self !== 'undefined') ? self : (typeof window !== 'undefined' ? window : this);
    root.GHL = {
        DEFAULT_API_BASE: DEFAULT_API_BASE,
        getSettings: getSettings,
        isConnected: isConnected,
        status: status,
        fetchLocations: fetchLocations,
        fetchUsers: fetchUsers,
        fetchPipelines: fetchPipelines,
        fetchTags: fetchTags,
        createTag: createTag,
        CREATE_TAG_SENTINEL: CREATE_TAG_SENTINEL,
        appendCreateTagOption: appendCreateTagOption,
        wireCreateTag: wireCreateTag,
        checkDuplicate: checkDuplicate,
        sendLead: sendLead,
        deleteLead: deleteLead,
        buildLeadPayload: buildLeadPayload,
        toE164: toE164,
        listScrapingSessions: listScrapingSessions,
        saveScrapingSession: saveScrapingSession,
        deleteScrapingSession: deleteScrapingSession
    };
})();
