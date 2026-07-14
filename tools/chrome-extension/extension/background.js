// Background service worker: listens for the "scrape" command and runs the scraping
// function in the active tab, then merges results into chrome.storage.local

// Shared GoHighLevel client (attaches `self.GHL`). Loaded here so content scripts
// (manual-mode overlays) can proxy GHL calls through the worker, which can fetch
// the TableTurnerr backend without the CORS limits that apply to content scripts.
importScripts('ghl_client.js');

// Allow content scripts (e.g. the GHL click-to-call handler and the Zoom call
// detector) to read/write chrome.storage.session. By default session storage is
// only exposed to trusted (extension) contexts; the click-to-call → Zoom-detect
// number handoff stashes the dialed number there. Best-effort: older Chrome
// without setAccessLevel simply keeps the default (extension-only) and the
// detector falls back to scraping the page number.
try {
    if (chrome.storage && chrome.storage.session && chrome.storage.session.setAccessLevel) {
        chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
            .catch(function () { /* no-op */ });
    }
} catch (e) { /* no-op */ }

// ============================================================================
// Master Power State (global on/off)
// ============================================================================

// Module-level cache so handlers can gate sync without an extra storage round-trip.
// Service-worker memory is reset between wakeups; the storage listener and the
// initial fetch keep this in sync after each cold start.
// Default OFF: the extension only runs when the user explicitly turns it on, and
// it resets to OFF on every browser launch (see onStartup below).
var EXTENSION_ENABLED = false;

function refreshExtensionEnabled(cb) {
    chrome.storage.local.get(['gmes_extension_enabled'], function (data) {
        EXTENSION_ENABLED = data.gmes_extension_enabled === true;
        if (cb) cb(EXTENSION_ENABLED);
    });
}

// Force the extension OFF and persist it. Called on every browser launch and on
// install so the extension always starts disabled.
function disableExtension(cb) {
    EXTENSION_ENABLED = false;
    chrome.storage.local.set({ gmes_extension_enabled: false }, function () {
        updateToolbarBadge();
        if (cb) cb();
    });
}

function updateToolbarBadge() {
    if (!chrome.action || !chrome.action.setBadgeText) return;
    // An available update is the highest-priority signal: a stale install is the most
    // common "not scraping" cause, so it wins the (single) toolbar badge over the
    // OFF / lead-count states. The popup still shows OFF unmistakably (red power bar),
    // so nothing is lost by letting the orange "UPD" badge take precedence here.
    chrome.storage.local.get(['updateAvailable', 'gmes_results'], function (data) {
        if (data.updateAvailable === true) {
            chrome.action.setBadgeText({ text: 'UPD' });
            chrome.action.setBadgeBackgroundColor({ color: '#f29900' });
            return;
        }
        if (!EXTENSION_ENABLED) {
            chrome.action.setBadgeText({ text: 'OFF' });
            chrome.action.setBadgeBackgroundColor({ color: '#5f6368' });
            return;
        }
        var n = Array.isArray(data.gmes_results) ? data.gmes_results.length : 0;
        if (n > 0) {
            chrome.action.setBadgeText({ text: n > 999 ? '999+' : String(n) });
            chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    });
}

// Initial sync on service-worker startup
refreshExtensionEnabled(updateToolbarBadge);

// ============================================================================
// Debug Mode
// ============================================================================

var DEBUG_LOG_KEY = 'gmes_debug_logs';
var DEBUG_LOG_MAX = 500;

function isDevBuild() {
    try {
        var mf = chrome.runtime.getManifest();
        return Boolean(mf && /\(dev\)/i.test(String(mf.name || '')));
    } catch (e) {
        return false;
    }
}

function debugLog(event, details) {
    try {
        if (!isDevBuild()) return;
        chrome.storage.local.get(['gmes_debug_enabled', DEBUG_LOG_KEY, 'gmes_active_session_id'], function (data) {
            if (data.gmes_debug_enabled !== true) return;
            var logs = Array.isArray(data[DEBUG_LOG_KEY]) ? data[DEBUG_LOG_KEY] : [];
            var cleanDetails = Object.assign({}, details || {});
            var eventName = String(event || 'event');
            var activeSessionId = data.gmes_active_session_id || '';
            if (!cleanDetails.sessionId && /^session\./.test(eventName) && cleanDetails.id) {
                cleanDetails.sessionId = cleanDetails.id;
            }
            if (!cleanDetails.sessionId && !cleanDetails.session_id && activeSessionId) {
                cleanDetails.sessionId = activeSessionId;
            }
            logs.push({
                ts: Date.now(),
                event: eventName,
                details: cleanDetails
            });
            if (logs.length > DEBUG_LOG_MAX) logs = logs.slice(logs.length - DEBUG_LOG_MAX);
            var set = {};
            set[DEBUG_LOG_KEY] = logs;
            chrome.storage.local.set(set);
        });
    } catch (e) { /* debug logging must never affect scraping */ }
}

// Reset to OFF on every browser launch. onStartup fires once per profile launch
// (when Chrome opens) and NOT on service-worker wake, so closing Chrome reliably
// turns the extension back off without disrupting an active session.
chrome.runtime.onStartup.addListener(function () {
    disableExtension();
});

chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.gmes_extension_enabled) {
        EXTENSION_ENABLED = changes.gmes_extension_enabled.newValue === true;
        updateToolbarBadge();
        // Abort any in-flight GHL login wait when the extension is switched off.
        if (!EXTENSION_ENABLED) {
            chrome.alarms.clear(GHL_POLL_ALARM);
            chrome.storage.local.set({ gmes_ghl_waiting: false });
        }
    }
    if (changes.gmes_results) {
        updateToolbarBadge();
    }
    // Reflect the update flag on the toolbar badge the moment a check flips it, so
    // the persistent "UPD" badge appears/clears without waiting for the next event.
    if (changes.updateAvailable) {
        updateToolbarBadge();
    }
});

// ============================================================================
// Update Checker - Checks for new versions from GitHub
// ============================================================================

// Releases are published into the Team-Stack monorepo, tagged lead-scraper-v<version>.
var GITHUB_RELEASES_URL = 'https://api.github.com/repos/TableTurnerr/Team-Stack/releases';
var RELEASE_TAG_PREFIX = 'lead-scraper-v';
var UPDATE_CHECK_ALARM_NAME = 'checkForUpdates';
var CHECK_INTERVAL_MINUTES = 60;

// ============================================================================
// CRM Auto-Connect — Background login polling (GoHighLevel via TableTurnerr)
// ============================================================================
// Keep the alarm-name string value so existing scheduled alarms aren't orphaned.
var GHL_POLL_ALARM        = 'gmes_crm_login_poll';
var TT_APP_URL            = 'https://crm.tableturnerr.com';          // web app domain to query for open tabs
var TT_CONNECT_URL        = 'https://crm.tableturnerr.com/connect';  // runs GHL OAuth then stores the session
var GHL_API_BASE_DEFAULT  = 'https://crm.tableturnerr.com/api';  // fallback; real base comes from tt_session.apiBase

// Injected into the connect page to read the TableTurnerr session token the
// connect flow stores in localStorage after a successful GHL OAuth login.
// Must stay a serializable plain function (no closures) for executeScript.
function readTtSession() {
    try {
        var raw = localStorage.getItem('tt_session');
        if (!raw) return null;
        var p = JSON.parse(raw);
        if (!p || !p.token) return null;
        return { token: p.token, email: p.email || '', agency: p.agency || '', apiBase: p.apiBase || '' };
    } catch (e) { return null; }
}

// Close the funnel tab we opened, once a sub-account is actually linked.
function closeConnectTab() {
    chrome.storage.local.get(['gmes_ghl_connect_tab'], function (d) {
        var id = d.gmes_ghl_connect_tab;
        chrome.storage.local.remove('gmes_ghl_connect_tab');
        if (id != null) chrome.tabs.remove(id, function () { void chrome.runtime.lastError; });
    });
}

// Get current extension version from manifest
function getCurrentVersion() {
    return chrome.runtime.getManifest().version;
}

// Compare semantic versions (returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal)
function compareVersions(v1, v2) {
    var parts1 = v1.split('.').map(function (n) { return parseInt(n, 10) || 0; });
    var parts2 = v2.split('.').map(function (n) { return parseInt(n, 10) || 0; });

    // Pad arrays to same length
    var maxLength = Math.max(parts1.length, parts2.length);
    while (parts1.length < maxLength) parts1.push(0);
    while (parts2.length < maxLength) parts2.push(0);

    for (var i = 0; i < maxLength; i++) {
        if (parts1[i] > parts2[i]) return 1;
        if (parts1[i] < parts2[i]) return -1;
    }
    return 0;
}

// Check for updates via GitHub Releases API
function checkForUpdates() {
    var currentVersion = getCurrentVersion();

    fetch(GITHUB_RELEASES_URL, {
        headers: { 'Accept': 'application/vnd.github+json' }
    })
    .then(function (response) {
        if (!response.ok) throw new Error('GitHub API returned ' + response.status);
        return response.json();
    })
    .then(function (releases) {
        for (var i = 0; i < releases.length; i++) {
            var release = releases[i];
            var tag = release.tag_name;
            if (!tag || tag.indexOf(RELEASE_TAG_PREFIX) !== 0) continue;
            if (release.draft) continue;

            var remoteVersion = tag.substring(RELEASE_TAG_PREFIX.length);
            var comparison = compareVersions(remoteVersion, currentVersion);

            if (comparison > 0) {
                // Find zip asset download URL, fallback to release page
                var downloadUrl = release.html_url;
                var assets = release.assets || [];
                for (var j = 0; j < assets.length; j++) {
                    if (assets[j].name && assets[j].name.match(/\.zip$/i)) {
                        downloadUrl = assets[j].browser_download_url;
                        break;
                    }
                }

                var releaseNotes = release.body || 'Bug fixes and improvements';
                console.log('New version available: ' + remoteVersion + ' (current: ' + currentVersion + ')');

                chrome.storage.local.set({
                    updateAvailable: true,
                    updateVersion: remoteVersion,
                    updateUrl: downloadUrl,
                    updateReleaseNotes: releaseNotes
                });

                // Check if user permanently dismissed this specific version or saw it within the last hour
                chrome.storage.local.get(['updateDismissedVersions', 'updateNotificationShownAt'], function (data) {
                    var dismissed = Array.isArray(data.updateDismissedVersions) ? data.updateDismissedVersions : [];
                    if (dismissed.indexOf(remoteVersion) !== -1) {
                        console.log('Update notification suppressed (dismissed by user): ' + remoteVersion);
                        return;
                    }

                    var shownAt = (typeof data.updateNotificationShownAt === 'object' && data.updateNotificationShownAt) ? data.updateNotificationShownAt : {};
                    var lastShown = shownAt[remoteVersion] || 0;
                    var ONE_HOUR_MS = 60 * 60 * 1000;
                    if (Date.now() - lastShown < ONE_HOUR_MS) {
                        console.log('Update notification suppressed (shown within last hour): ' + remoteVersion);
                        return;
                    }

                    shownAt[remoteVersion] = Date.now();
                    chrome.storage.local.set({ updateNotificationShownAt: shownAt }, function () {
                        showUpdateNotification(remoteVersion, downloadUrl, releaseNotes);
                    });
                });
                return;
            }

            // First matching release with our tag prefix is the latest
            break;
        }

        console.log('Extension is up to date: ' + currentVersion);
        chrome.storage.local.set({ updateAvailable: false });
    })
    .catch(function (error) {
        console.error('Update check failed:', error);
    });
}

// Show Chrome notification for new version.
//
// NOTE on "update" vs "notify": an unpacked / Tool-Manager-loaded MV3 extension
// CANNOT self-install a new CRX — Chrome disallows programmatic install for dev /
// unpacked loads. So the most this extension can do is make the stale state
// impossible to miss: this notification (with installed-vs-available versions), the
// persistent toolbar badge (see updateToolbarBadge), the stored `updateAvailable`
// flag, and the popup's update banner. Actually swapping the files in place is the
// Tool Manager's job — see build-chrome-extension.yml / the install.bat flow.
function showUpdateNotification(version, downloadUrl, releaseNotes) {
    var notificationId = 'update-available-' + Date.now();
    var installed = getCurrentVersion();
    var message = 'You are on v' + installed + '. Version ' + version + ' is available — please update.';
    if (releaseNotes) {
        message += '\n' + releaseNotes;
    }

    chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon.png'),
        title: 'TableTurner Lead Scraper - Update Required',
        message: message,
        buttons: [
            { title: 'Update now' },
            { title: "Don't remind me" }
        ],
        priority: 2
    }, function (createdId) {
        if (chrome.runtime.lastError) {
            console.error('Error showing notification:', chrome.runtime.lastError);
        } else {
            // Store download URL and version for this notification
            chrome.storage.local.set({
                ['notification_' + createdId + '_url']: downloadUrl,
                ['notification_' + createdId + '_version']: version
            });
        }
    });
}

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener(function (notificationId, buttonIndex) {
    if (buttonIndex === 0) {
        // Download Update button clicked
        chrome.storage.local.get(['notification_' + notificationId + '_url', 'updateUrl'], function (data) {
            var url = data['notification_' + notificationId + '_url'] || data.updateUrl || 'https://github.com/TableTurnerr/Team-Stack/releases';
            chrome.tabs.create({ url: url });
            chrome.storage.local.remove(['notification_' + notificationId + '_url', 'notification_' + notificationId + '_version']);
        });
        chrome.notifications.clear(notificationId);
    } else if (buttonIndex === 1) {
        // "Don't remind me" — permanently dismiss notifications for this version
        chrome.storage.local.get(['notification_' + notificationId + '_version', 'updateDismissedVersions'], function (data) {
            var ver = data['notification_' + notificationId + '_version'];
            if (ver) {
                var dismissed = Array.isArray(data.updateDismissedVersions) ? data.updateDismissedVersions : [];
                if (dismissed.indexOf(ver) === -1) dismissed.push(ver);
                chrome.storage.local.set({ updateDismissedVersions: dismissed });
            }
            chrome.storage.local.remove(['notification_' + notificationId + '_url', 'notification_' + notificationId + '_version']);
        });
        chrome.notifications.clear(notificationId);
    }
});

// Handle notification clicks (clicking the notification itself)
chrome.notifications.onClicked.addListener(function (notificationId) {
    chrome.storage.local.get(['notification_' + notificationId + '_url', 'updateUrl'], function (data) {
        var url = data['notification_' + notificationId + '_url'] || data.updateUrl || 'https://github.com/TableTurnerr/Team-Stack/releases';
        chrome.tabs.create({ url: url });
        chrome.storage.local.remove(['notification_' + notificationId + '_url', 'notification_' + notificationId + '_version']);
    });
    chrome.notifications.clear(notificationId);
});

// Set up periodic update checks using chrome.alarms
function setupUpdateAlarm() {
    chrome.alarms.create(UPDATE_CHECK_ALARM_NAME, {
        periodInMinutes: CHECK_INTERVAL_MINUTES
    });
}

// Listen for alarm events
chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === UPDATE_CHECK_ALARM_NAME) {
        checkForUpdates();
        return;
    }

    // CRM login poll: fires every 30s while waiting for the user to log in to GHL
    if (alarm.name === GHL_POLL_ALARM) {
        chrome.storage.local.get(['gmes_ghl_waiting', 'gmes_ghl_connect_tab', 'gmes_ghl_session', 'gmes_ghl_wait_started'], function (data) {
            if (!data.gmes_ghl_waiting || !EXTENSION_ENABLED) { stopGhlLoginPoll(); return; }
            // Give up after ~5 min so an abandoned login doesn't poll forever.
            if (data.gmes_ghl_wait_started && (Date.now() - data.gmes_ghl_wait_started) > 5 * 60 * 1000) {
                stopGhlLoginPoll();
                return;
            }
            // If the user closed the connect tab before logging in, stop waiting.
            if (data.gmes_ghl_connect_tab != null && !data.gmes_ghl_session) {
                chrome.tabs.get(data.gmes_ghl_connect_tab, function (tab) {
                    if (chrome.runtime.lastError || !tab) { stopGhlLoginPoll(); return; }
                    pollGhlLoginOnce();
                });
                return;
            }
            pollGhlLoginOnce();
        });
        return;
    }

    function stopGhlLoginPoll() {
        chrome.alarms.clear(GHL_POLL_ALARM);
        chrome.storage.local.set({ gmes_ghl_waiting: false });
    }

    function pollGhlLoginOnce() {
        chrome.tabs.query({ url: TT_APP_URL + '/*' }, function (tabs) {
            if (!tabs || !tabs.length) return;
            var sessionTab = null;
            for (var i = 0; i < tabs.length; i++) {
                // Skip the login page; we only read the session off a logged-in tab.
                if (tabs[i].url && tabs[i].url.indexOf('/login') === -1) { sessionTab = tabs[i]; break; }
            }
            if (!sessionTab) return;
            chrome.scripting.executeScript({
                target: { tabId: sessionTab.id },
                func: readTtSession
            }, function (results) {
                var auth = results && results[0] && results[0].result;
                if (!auth || !auth.token) return;
                // tt_session appears right after CRM login, before any sub-account is
                // authorized. Save it so /ghl/* calls work, but keep polling (and keep
                // the funnel tab open) until a sub-account is actually linked.
                chrome.storage.local.set({
                    gmes_ghl_session: auth.token,
                    gmes_ghl_email: auth.email || auth.agency || 'Connected',
                    gmes_ghl_api_base: auth.apiBase || GHL_API_BASE_DEFAULT
                });
                GHL.status(function (st) {
                    if (st && st.connected) {
                        chrome.alarms.clear(GHL_POLL_ALARM);
                        chrome.storage.local.set({ gmes_ghl_waiting: false });
                        closeConnectTab();
                        // Capture the rep's GHL user id and push it to the local
                        // agent so recorded calls are attributed to this rep.
                        if (st.ghlUserId) {
                            chrome.storage.local.set({ gmes_ghl_user_id: st.ghlUserId });
                            pushIdentityToAgent(st.ghlUserId);
                        }
                    }
                });
            });
        });
    }

    // Background continuous scraping alarm
    var BG_SCRAPE_ALARM = 'gmes_continuous_scrape';
    if (alarm.name === BG_SCRAPE_ALARM) {
        if (!EXTENSION_ENABLED) return;
        // Find any open Google Maps tabs and run the scraper on each
        chrome.tabs.query({ url: ['*://www.google.com/maps/*'] }, function (tabs) {
            if (!tabs || tabs.length === 0) return;
            tabs.forEach(function (tab) {
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: scrapeData
                }, function (results) {
                    if (!results || !results[0] || !results[0].result) return;
                    var newItems = results[0].result;

                    mergeScrapedItems(newItems, 'alarm');
                });
            });
        });
    }
});

// Message API to start/stop background scraping via chrome.alarms
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    var BG_SCRAPE_ALARM = 'gmes_continuous_scrape';
    if (!msg || !msg.type) return;

    if (msg.type === 'START_BACKGROUND_SCRAPE') {
        // periodInMinutes must be >= 1 for chrome.alarms
        var period = Math.max(1, Number(msg.periodMinutes) || 1);
        chrome.alarms.create(BG_SCRAPE_ALARM, { periodInMinutes: period });
        chrome.storage.local.set({ gmes_background_scraping: true });
        sendResponse({ started: true, periodMinutes: period });
    } else if (msg.type === 'STOP_BACKGROUND_SCRAPE') {
        chrome.alarms.clear(BG_SCRAPE_ALARM, function (wasCleared) {
            chrome.storage.local.set({ gmes_background_scraping: false });
            sendResponse({ stopped: wasCleared });
        });
        // return true to indicate we'll call sendResponse asynchronously
        return true;
    }
});

// ============================================================================
// Auto-Scrape: category + location + radius, fully automatic
// ----------------------------------------------------------------------------
// The orchestrator drives a Google Maps tab end-to-end: navigate to geocode the
// location (read the @lat,lng the map settles on), frame the area at a zoom that
// fits the radius, then inject auto_scraper.js with the center + radius. The
// injected controller auto-scrolls the feed, scrapes, and posts items back
// through the existing INJECTED_SCRAPE_ITEMS merge path.
// ============================================================================

// Build a Maps search URL. `center` (optional) frames the result at @lat,lng,z.
function buildMapsSearchUrl(query, center, zoom) {
    var base = 'https://www.google.com/maps/search/' + encodeURIComponent(query || '').replace(/%20/g, '+');
    if (center && center.lat != null && center.lng != null) {
        base += '/@' + center.lat + ',' + center.lng + ',' + (zoom || 13) + 'z';
    }
    return base;
}

// Compose a per-cell search query that anchors the category to the location text
// (e.g. "Plumbers in Texas"). The bare category + viewport hint alone doesn't
// reliably keep Google's results inside the target area — Maps drifts to the
// user's own IP/location. Spelling the location out in the query text pins the
// results to it; the per-business Haversine filter + dedup still trim outliers.
function buildCellQuery(category, location) {
    category = (category || '').trim();
    location = (location || '').trim();
    if (!location) return category;
    // Don't double up if the user already typed "... in <place>".
    if (/\sin\s/i.test(category)) return category;
    return category + ' in ' + location;
}

// Clamp a scrape-speed delay multiplier to a sane range. >1 = slower (gentler on
// Google, fewer "Server error" rate limits). Defaults to 1.5 ("balanced", a bit
// slower than the original pacing) when unset.
function speedFactor(v) {
    var n = Number(v);
    if (!n || isNaN(n) || n <= 0) return 1.5;
    return Math.max(0.5, Math.min(5, n));
}

// Approximate the zoom that frames a given radius (miles). The real radius
// guarantee is the per-business Haversine filter in auto_scraper.js; this just
// controls how much of the area Maps pre-loads.
function zoomForRadiusMiles(radiusMiles) {
    var r = Number(radiusMiles) || 5;
    var z = Math.round(14.5 - Math.log2(r));
    return Math.max(3, Math.min(16, z));
}

// Haversine distance in miles between two lat/lng points.
function haversineMilesBg(lat1, lng1, lat2, lng2) {
    var R = 3958.8;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Generate a grid of sub-area centers that tile the circle of radiusMiles.
// Step comes from calcGridStep to guarantee no uncovered gaps between cells.
function generateGridPoints(center, radiusMiles) {
    var R = Number(radiusMiles) || 5;
    var step = calcGridStep(R);
    var cLat = Number(center.lat);
    var cLng = Number(center.lng);
    var latDeg = step / 69.0;
    var lngDeg = step / (69.0 * Math.cos(cLat * Math.PI / 180));
    var nSteps = Math.ceil(R / step) + 1;
    var points = [];
    for (var i = -nSteps; i <= nSteps; i++) {
        for (var j = -nSteps; j <= nSteps; j++) {
            var pLat = cLat + i * latDeg;
            var pLng = cLng + j * lngDeg;
            if (haversineMilesBg(cLat, cLng, pLat, pLng) <= R) {
                points.push({ lat: pLat.toFixed(6), lng: pLng.toFixed(6) });
            }
        }
    }
    return points;
}

// Pick Maps zoom based on the grid cell step size so each cell shows ~city-level detail.
// zoom 10 (~50 mi coverage) is the floor — zoom 9 covers too wide an area and makes
// detail mode extremely slow (100+ results per cell at 5s each).
function zoomForCellStep(stepMiles) {
    if (stepMiles < 5) return 14;
    if (stepMiles < 10) return 13;
    if (stepMiles < 20) return 12;
    if (stepMiles < 30) return 11;
    return 10;
}

// Compute the grid step whose assigned zoom viewport covers the step with no large gaps.
// The original sqrt(PI/50) formula produced 60-125 mile steps with only zoom-11 (~20 mi)
// coverage, leaving 40+ mile dead zones across large states like Texas.
// This caps the step to what zoom 10 (~50 mi) can cover, so cells stay practical in
// both turbo and detail mode while dramatically improving statewide coverage.
function calcGridStep(radiusMiles) {
    var R = Number(radiusMiles) || 5;
    var raw = Math.max(4, R * Math.sqrt(Math.PI / 50));
    var zoom = zoomForCellStep(raw);
    // zoom 14->4mi, 13->8mi, 12->15mi, 11->20mi, 10->80mi cap
    // zoom 10 cap is 80 mi (coverage radius ~50 mi; step/2=40 < 50 -> slight overlap -> no gaps)
    var maxStep = zoom >= 14 ? 4 : zoom >= 13 ? 8 : zoom >= 12 ? 15 : zoom >= 11 ? 20 : 80;
    return Math.min(raw, maxStep);
}

// Derive a coverage radius from the zoom Maps chose when geocoding a place name.
// Maps picks a zoom that fits the location's bounding box, so zoom 7 ≈ Texas,
// zoom 9 ≈ a county, zoom 12 ≈ a city neighbourhood.
// Formula: 250mi at zoom 7, halves with each zoom step up.
function zoomToRadius(zoom) {
    var r = Math.round(250 * Math.pow(2, 7 - (parseFloat(zoom) || 7)));
    return Math.max(5, Math.min(500, r));
}

// Grid scan state lives in chrome.storage.local (key below) so it survives
// service-worker restarts between cells. Module-level var is a fast-path cache.
var GRID_STATE_KEY = 'gmes_grid_state';
var GRID_WATCHDOG_ALARM = 'gmes_grid_watchdog';
// A healthy cell writes gmes_scrape_heartbeat every loop tick (worst gap ~10s in
// detail mode, ~4s between cells). If the heartbeat is older than this, the
// cell's content script has died (page nav, an error, or a service-worker
// restart that dropped the in-flight setTimeout chain) and the grid would
// otherwise stall forever — the watchdog re-drives from the saved cursor.
var GRID_STALL_MS = 35000;
var gridScan = null;  // cache; always mirrors GRID_STATE_KEY

// (Re)arm the periodic watchdog. chrome.alarms wakes the service worker even
// after MV3 idles it out, so a stalled scan auto-resumes without user action.
function ensureGridWatchdog() {
    try { chrome.alarms.create(GRID_WATCHDOG_ALARM, { periodInMinutes: 0.5 }); } catch (e) {}
}
function clearGridWatchdog() {
    try { chrome.alarms.clear(GRID_WATCHDOG_ALARM); } catch (e) {}
}

// Prefer the scan's original tab if it's still open on Maps; only fall back to
// resolveScrapeTab (which may open a new tab) when that tab is gone. Keeps the
// watchdog/resume from spawning duplicate Maps tabs.
function resolveResumeTab(state, cb) {
    var savedId = state && state.tabId;
    if (!savedId) { resolveScrapeTab(cb); return; }
    chrome.tabs.get(savedId, function (tab) {
        if (!chrome.runtime.lastError && tab && /https:\/\/www\.google\.com\/maps/.test(tab.url || '')) {
            cb(savedId);
        } else {
            resolveScrapeTab(cb);
        }
    });
}

// Watchdog tick: if a grid scan is still pending (cursor < total) but its
// heartbeat has gone stale, the current cell died — re-drive from the cursor.
// `gmes_grid_autoresume` gates the auto-reopen: it's set while the scan is meant
// to be running and cleared on explicit stop or when the user closes the tab, so
// the watchdog never silently reopens a Maps tab the user deliberately closed.
function maybeResumeStalledGrid() {
    chrome.storage.local.get([GRID_STATE_KEY, 'gmes_scrape_heartbeat', 'gmes_grid_autoresume'], function (d) {
        var state = d[GRID_STATE_KEY];
        if (!state) { clearGridWatchdog(); return; }            // nothing pending
        if (state.current >= state.points.length) { finishGridScan(); return; }
        if (!d.gmes_grid_autoresume) return;                    // paused — wait for manual resume
        var hb = Number(d.gmes_scrape_heartbeat) || 0;
        if (hb && (Date.now() - hb) < GRID_STALL_MS) return;    // still actively ticking
        // Stale: re-drive the saved cursor in a reused/fresh tab.
        resolveResumeTab(state, function (tabId) {
            if (!tabId) return;
            state.tabId = tabId;
            gridScan = state;
            chrome.storage.local.set({
                gmes_grid_state: state,
                gmes_scrape_tab: tabId,
                gmes_background_scraping: true,
                gmes_scrape_heartbeat: Date.now()
            }, function () { _doAdvanceGrid(state); });
        });
    });
}

chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm && alarm.name === GRID_WATCHDOG_ALARM) maybeResumeStalledGrid();
});

// On browser startup, leave any interrupted grid scan PAUSED (resumable from the
// popup) rather than auto-resuming, so Chrome never pops open a Maps tab on launch.
// Within a running session the watchdog still auto-recovers stalls.
chrome.runtime.onStartup.addListener(function () {
    chrome.storage.local.get([GRID_STATE_KEY], function (d) {
        if (d[GRID_STATE_KEY]) {
            chrome.storage.local.set({ gmes_background_scraping: false, gmes_grid_autoresume: false, gmes_scrape_heartbeat: 0 });
        }
    });
});

// Unique id for a scraping session (one grid run). Tags the leads it collects so
// the run can be saved/resumed and its local-only lead count reported.
function newSessionId() {
    return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Parse the category list from a START_AUTO_SCRAPE message. Prefers msg.categories
// (array, sent by newer popups) and falls back to splitting msg.category on
// newlines/commas for backward compatibility. Trims, drops blanks, and de-dupes
// case-insensitively while preserving order.
function parseCategoriesMsg(msg) {
    var raw = [];
    if (msg && Array.isArray(msg.categories)) raw = msg.categories.slice();
    else if (msg && msg.category != null) raw = String(msg.category).split(/[\n,]+/);
    var out = [], seen = {};
    raw.forEach(function (c) {
        var v = String(c || '').trim();
        if (!v) return;
        var k = v.toLowerCase();
        if (seen[k]) return;
        seen[k] = 1; out.push(v);
    });
    return out;
}

// Persist the multi-category queue plus the shared (category-independent) scrape
// params so finishGridScan can run each remaining category on the SAME geocoded
// center without re-geocoding. gmes_cat_queue holds the categories still to run
// AFTER the current one; gmes_cat_total/gmes_cat_index drive the popup's "X/Y".
function setCategoryQueue(categories, location, center, radiusMiles, turbo, filters) {
    chrome.storage.local.set({
        gmes_cat_queue: categories.slice(1),
        gmes_cat_shared: { location: location, center: center, radius: radiusMiles, turbo: turbo, filters: filters },
        gmes_cat_total: categories.length,
        gmes_cat_index: 1
    });
}

// keepSession=true chains a subsequent category onto an in-progress multi-category
// run: it keeps the existing session id (so all categories snapshot together)
// instead of minting a fresh one.
function startGridScan(tabId, category, location, center, radiusMiles, turbo, filters, keepSession) {
    var points = generateGridPoints(center, radiusMiles);
    var step = calcGridStep(radiusMiles);
    var state = {
        tabId: tabId,
        category: category,
        location: location,
        center: center,
        radiusMiles: radiusMiles,
        turbo: turbo,
        filters: filters,
        points: points,
        current: 0,
        zoom: zoomForCellStep(step)
    };
    gridScan = state;
    ensureGridWatchdog();
    var store = {
        gmes_grid_state: state,
        gmes_grid_total: points.length,
        gmes_grid_current: 0,
        gmes_grid_autoresume: true
    };
    if (!keepSession) {
        // Fresh run => fresh session. Leads merged from now on get tagged with this
        // id (see mergeScrapedItems) so Pause/Stop can report and snapshot them.
        store.gmes_active_session_id = newSessionId();
        store.gmes_active_session_started = Date.now();
    }
    chrome.storage.local.set(store, function () {
        _doAdvanceGrid(state);
    });
}

// Continue a previously-interrupted grid scan from its saved cursor without
// re-geocoding. Used by the popup's "Resume" path (and indirectly by the
// watchdog). cb(true) if a resumable scan was found and re-driven.
function resumeGridScan(cb) {
    chrome.storage.local.get([GRID_STATE_KEY], function (data) {
        var state = data[GRID_STATE_KEY];
        if (!state || !Array.isArray(state.points) || state.current >= state.points.length) {
            if (cb) cb(false);
            return;
        }
        // The cursor is incremented before each cell navigates, so on an interrupted
        // run it points one past the cell that was in flight. Step back one so the
        // manual resume re-does that interrupted area instead of skipping it (a
        // re-scrape is deduped, so re-doing a cell that did finish is harmless).
        state.current = Math.max(0, state.current - 1);
        resolveResumeTab(state, function (tabId) {
            if (!tabId) { if (cb) cb(false); return; }
            state.tabId = tabId;
            gridScan = state;
            ensureGridWatchdog();
            chrome.storage.local.set({
                gmes_grid_state: state,
                gmes_scrape_tab: tabId,
                gmes_background_scraping: true,
                gmes_scrape_heartbeat: Date.now(),
                gmes_grid_autoresume: true
            }, function () {
                _doAdvanceGrid(state);
                if (cb) cb(true);
            });
        });
    });
}

// Entry point for GRID_CELL_DONE: re-reads state from storage so the call is
// safe even if the service worker was restarted since the previous cell.
function advanceGridScan() {
    if (gridScan && gridScan.current < gridScan.points.length) {
        _doAdvanceGrid(gridScan);
        return;
    }
    chrome.storage.local.get([GRID_STATE_KEY], function (data) {
        var state = data[GRID_STATE_KEY];
        if (!state) { finishGridScan(); return; }
        gridScan = state;
        _doAdvanceGrid(state);
    });
}

function _doAdvanceGrid(state) {
    if (!state || state.current >= state.points.length) {
        finishGridScan();
        return;
    }
    var idx = state.current;
    // Write incremented cursor back to storage before navigating.
    var next = { tabId: state.tabId, category: state.category, location: state.location, center: state.center, radiusMiles: state.radiusMiles, turbo: state.turbo, filters: state.filters, points: state.points, zoom: state.zoom, current: idx + 1 };
    gridScan = next;
    chrome.storage.local.set({
        gmes_grid_state: next,
        gmes_grid_current: idx + 1,
        gmes_background_scraping: true,
        gmes_scrape_heartbeat: Date.now()  // keep popup stale-check at bay during transition
    }, function () {
        var pt = state.points[idx];
        // Settle time between navigating to a cell and injecting the scraper. Scaled
        // by the chosen speed so slower settings also pause longer between searches
        // (each cell navigation is a fresh Google request — pacing these reduces the
        // "Server error" rate limiting).
        var cellSettleMs = Math.round(3500 * speedFactor(state.filters && state.filters.speed));
        chrome.tabs.update(state.tabId, { url: buildMapsSearchUrl(buildCellQuery(state.category, state.location), pt, state.zoom) }, function () {
            if (chrome.runtime.lastError) { finishGridScan(); return; }
            setTimeout(function () {
                // Re-read from storage: service worker may have restarted during the wait.
                chrome.storage.local.get([GRID_STATE_KEY], function (data) {
                    var s = data[GRID_STATE_KEY];
                    if (!s) return; // was cancelled
                    gridScan = s;
                    injectAutoScraper(s.tabId, s.center, s.radiusMiles, s.turbo, s.filters, true);
                });
            }, cellSettleMs);
        });
    });
}

function finishGridScan() {
    // Multi-category chaining: if more categories are queued, start the next one on
    // the same geocoded center + session instead of ending the run. The tab id is
    // taken from the just-finished grid state (in memory, falling back to storage).
    var finishingTabId = (gridScan && gridScan.tabId != null) ? gridScan.tabId : null;
    chrome.storage.local.get([GRID_STATE_KEY, 'gmes_cat_queue', 'gmes_cat_shared', 'gmes_cat_total'], function (d) {
        var queue = Array.isArray(d.gmes_cat_queue) ? d.gmes_cat_queue.slice() : [];
        var shared = d.gmes_cat_shared;
        var tabId = (finishingTabId != null) ? finishingTabId : (d[GRID_STATE_KEY] && d[GRID_STATE_KEY].tabId);
        if (queue.length && shared && shared.center && tabId != null) {
            var nextCat = queue.shift();
            var total = Number(d.gmes_cat_total) || (queue.length + 1);
            // 1-based index of the category we're about to start (for the popup's "X/Y").
            chrome.storage.local.set({ gmes_cat_queue: queue, gmes_cat_index: total - queue.length }, function () {
                startGridScan(tabId, nextCat, shared.location, shared.center, shared.radius, shared.turbo, shared.filters, true);
            });
            return;
        }
        // Real finish: no more categories queued.
        gridScan = null;
        clearGridWatchdog();
        chrome.storage.local.remove([GRID_STATE_KEY, 'gmes_cat_queue', 'gmes_cat_shared']);
        chrome.storage.local.set({
            gmes_background_scraping: false,
            gmes_scrape_heartbeat: 0,
            gmes_grid_total: 0,
            gmes_grid_current: 0,
            gmes_grid_autoresume: false,
            gmes_cat_total: 0,
            gmes_cat_index: 0
        });
    });
}

// Poll a tab's URL until the location search settles to a geocoded result
// (a /maps/search/ or /maps/place/ page carrying @<lat>,<lng>), then hand the
// center to cb({lat, lng}). cb(null) on timeout.
//
// Why the extra guards: opening a fresh tab on https://www.google.com/maps makes
// Google redirect to https://www.google.com/maps/@<your-IP-location>,z — a bare
// viewport centered on the *user's* location. The previous version matched the
// first @lat,lng it saw, so it grabbed that default (or, on a reused tab, the
// stale previous center) before our search navigation committed. The category
// search then framed at the wrong center and the per-business radius filter
// dropped everything (zero leads). We now require the URL to be an actual
// geocoded result page that differs from where the tab started.
function waitForMapsCenter(tabId, cb) {
    var tries = 0;
    var MAX_TRIES = 30;       // ~30 * 700ms ≈ 21s
    var initialUrl = null;
    function isGeocodedResult(url) {
        // The bare default viewport is /maps/@... (no /search/ or /place/ segment).
        return /\/maps\/(search|place)\//.test(url) && /@(-?\d+\.\d+),(-?\d+\.\d+)/.test(url);
    }
    function poll() {
        if (tries++ >= MAX_TRIES) { cb(null); return; }
        chrome.tabs.get(tabId, function (tab) {
            if (chrome.runtime.lastError || !tab) { cb(null); return; }
            var url = tab.url || '';
            if (initialUrl === null) initialUrl = url;
            // Only trust the center once navigation has committed to a geocoded
            // result page (not the starting URL) and the tab has finished loading.
            if (url !== initialUrl && tab.status === 'complete' && isGeocodedResult(url)) {
                var m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?)z/);
                if (!m) m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
                if (m) { cb({ lat: m[1], lng: m[2], zoom: m[3] ? parseFloat(m[3]) : null }); return; }
            }
            setTimeout(poll, 700);
        });
    }
    poll();
}

// Inject auto_scraper.js into the tab with the resolved config.
// gridMode=true when this is one cell of a multi-point grid scan.
function injectAutoScraper(tabId, center, radiusMiles, turbo, filters, gridMode) {
    filters = filters || {};
    var excludeText = filters.excludeText || '';
    var conditionsText = filters.conditionsText || '';
    var skipTempClosed = filters.skipTempClosed !== false; // default on
    var speed = speedFactor(filters.speed);
    chrome.storage.local.set({
        gmes_auto_scrape_center: { lat: center.lat, lng: center.lng },
        gmes_auto_scrape_radius: radiusMiles,
        gmes_auto_scrape_turbo: Boolean(turbo),
        gmes_auto_scrape_exclude: excludeText,
        gmes_auto_scrape_conditions: conditionsText,
        gmes_auto_scrape_skipclosed: skipTempClosed,
        gmes_auto_scrape_speed: speed,
        gmes_auto_scrape_gridmode: Boolean(gridMode),
        gmes_background_scraping: true,
        // Remember which tab the controller lives in, and seed a fresh heartbeat
        // so the popup's stale-run check doesn't fire before the first loop tick.
        gmes_scrape_tab: tabId,
        gmes_scrape_heartbeat: Date.now()
    });
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function (cfg) { window.__GMES_AUTO_CFG__ = cfg; },
        args: [{ centerLat: center.lat, centerLng: center.lng, radiusMiles: radiusMiles, turbo: Boolean(turbo), excludeText: excludeText, conditionsText: conditionsText, skipTempClosed: skipTempClosed, speed: speed, gridMode: Boolean(gridMode) }]
    }, function () {
        if (chrome.runtime.lastError) return;
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['auto_scraper.js']
        }, function () { void chrome.runtime.lastError; });
    });
}

// Resolve the tab to drive: reuse the active tab if it's already on Maps,
// otherwise open a fresh Maps tab. cb(tabId).
function resolveScrapeTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs && tabs[0];
        if (tab && tab.id && /https:\/\/www\.google\.com\/maps/.test(tab.url || '')) {
            cb(tab.id);
        } else {
            chrome.tabs.create({ url: 'https://www.google.com/maps' }, function (t) {
                cb(t && t.id);
            });
        }
    });
}

// Tell the injected controller in every open Maps tab to stop, and remove its
// on-page popdown. Shared by Pause and Stop. cb() once all tabs were signalled.
function stopMapsContentScripts(cb, opts) {
    opts = opts || {};
    var gracefulPause = opts.gracefulPause === true;
    chrome.tabs.query({ url: ['*://www.google.com/maps/*'] }, function (tabs) {
        (tabs || []).forEach(function (tab) {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: function (pauseOnly) {
                    try {
                        if (window.__GMES_AUTO_SCRAPER__) {
                            if (pauseOnly) window.__GMES_AUTO_SCRAPER__.pauseAfterCurrent = true;
                            else window.__GMES_AUTO_SCRAPER__.stop = true;
                        }
                        if (!pauseOnly) {
                            var el = document.getElementById('gmes-popdown');
                            if (el && el.parentNode) el.parentNode.removeChild(el);
                        }
                    } catch (e) {}
                },
                args: [gracefulPause]
            }, function () { void chrome.runtime.lastError; });
        });
        if (cb) cb();
    });
}

function pauseBackgroundQueues() {
    WEB_ENRICH.paused = true;
    DELIVERY_DETECT.paused = true;
    debugLog('queues.pause_requested', {
        websiteQueued: WEB_ENRICH.queue.length,
        websiteActive: WEB_ENRICH.inFlight,
        deliveryQueued: DELIVERY_DETECT.queue.length,
        deliveryActive: DELIVERY_DETECT.inFlight
    });
}

function resumeBackgroundQueues() {
    WEB_ENRICH.paused = false;
    DELIVERY_DETECT.paused = false;
    pumpEnrich();
    pumpDelivery();
}

function stopBackgroundQueues() {
    WEB_ENRICH.paused = false;
    DELIVERY_DETECT.paused = false;
    WEB_ENRICH.queue = [];
    DELIVERY_DETECT.queue = [];
    updateEnrichStatus();
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;

    if (msg.type === 'START_AUTO_SCRAPE') {
        if (!EXTENSION_ENABLED) { sendResponse({ started: false, error: 'Extension is off.' }); return; }
        resumeBackgroundQueues();
        var categories = parseCategoriesMsg(msg);
        var category = categories[0] || '';
        var location = (msg.location || '').trim();
        var radiusMiles = Number(msg.radiusMiles) || 0;
        var turbo = Boolean(msg.turbo);
        var filters = {
            excludeText: (msg.excludeKeywords != null ? String(msg.excludeKeywords) : ''),
            conditionsText: (msg.conditions != null ? String(msg.conditions) : ''),
            skipTempClosed: msg.skipTempClosed !== false,
            speed: speedFactor(msg.speed)
        };
        if (!categories.length || !location) { sendResponse({ started: false, error: 'Category and location are required.' }); return; }
        debugLog('scrape.start.requested', { categories: categories, location: location, radiusMiles: radiusMiles, turbo: turbo, filters: filters });

        // Restaurant Mode config (shared contract with popup.js). Persist the five
        // platform keys so mergeScrapedItems and the delivery detector — which read
        // config from storage, the same way the food filter is threaded — pick them
        // up as leads flow in. Unmatched defaults to 'tag' (non-destructive) if absent.
        var restaurantMode = msg.restaurantMode === true;
        var platformUnmatched = (msg.platformUnmatched === 'skip') ? 'skip' : 'tag';
        chrome.storage.local.set({
            gmes_restaurant_mode: restaurantMode,
            gmes_platform_any: msg.platformAny === true,
            gmes_platform_include: Array.isArray(msg.platformInclude) ? msg.platformInclude : [],
            gmes_platform_exclude: Array.isArray(msg.platformExclude) ? msg.platformExclude : [],
            gmes_platform_unmatched: platformUnmatched
        });

        resolveScrapeTab(function (tabId) {
            if (!tabId) { return; }
            // Step 1: navigate to geocode the location.
            chrome.tabs.update(tabId, { url: buildMapsSearchUrl(location) }, function () {
                if (chrome.runtime.lastError) return;
                // Step 2: wait for the map center to resolve.
                waitForMapsCenter(tabId, function (center) {
                    if (!center) {
                        // Geocode failed: fall back to a plain "category in location"
                        // search with no center. Category chaining needs a grid center,
                        // so only the first category runs on this rare fallback path.
                        chrome.storage.local.remove(['gmes_cat_queue', 'gmes_cat_shared', 'gmes_cat_total', 'gmes_cat_index']);
                        chrome.tabs.update(tabId, { url: buildMapsSearchUrl(category + ' in ' + location) }, function () {
                            setTimeout(function () { injectAutoScraper(tabId, { lat: '', lng: '' }, radiusMiles, turbo, filters); }, 3500);
                        });
                        return;
                    }
                    // Step 3: if "Any" mode (radius=0), derive coverage from the zoom Maps chose.
                    var effectiveRadius = radiusMiles;
                    if (!effectiveRadius && center.zoom) effectiveRadius = zoomToRadius(center.zoom);
                    if (!effectiveRadius) effectiveRadius = 25; // last-resort fallback
                    // Queue any remaining categories to run after this one finishes,
                    // reusing this same geocoded center (see finishGridScan chaining).
                    setCategoryQueue(categories, location, center, effectiveRadius, turbo, filters);
                    startGridScan(tabId, category, location, center, effectiveRadius, turbo, filters);
                });
            });
        });
        // Enrich any leads carrying a website that haven't been scraped yet (backlog
        // from earlier runs/manual adds); fresh leads enqueue as they're merged.
        sweepExistingForEnrichment();
        // Restaurant Mode: run delivery-platform detection over the existing backlog
        // too (fresh leads resolve/enqueue as they're merged in mergeScrapedItems).
        if (restaurantMode) sweepExistingForDelivery();
        sendResponse({ started: true });
        return;
    }

    if (msg.type === 'RESUME_AUTO_SCRAPE') {
        if (!EXTENSION_ENABLED) { sendResponse({ resumed: false, error: 'Extension is off.' }); return; }
        debugLog('scrape.resume.requested', {});
        resumeBackgroundQueues();
        resumeGridScan(function (ok) {
            debugLog(ok ? 'scrape.resume.started' : 'scrape.resume.failed', {});
            sendResponse({ resumed: Boolean(ok) });
        });
        return true;
    }

    // Pause: halt the running scan but KEEP the saved grid cursor (gmes_grid_state
    // and the cell counters) so the popup can offer "Resume". Clears autoresume so
    // the watchdog won't silently reopen a tab. The active session id stays put so
    // resuming continues tagging into the same session.
    if (msg.type === 'PAUSE_AUTO_SCRAPE') {
        gridScan = null;
        clearGridWatchdog();
        pauseBackgroundQueues();
        debugLog('scrape.pause_requested', {});
        chrome.storage.local.set({ gmes_background_scraping: false, gmes_scrape_heartbeat: 0, gmes_grid_autoresume: false });
        stopMapsContentScripts(function () { sendResponse({ paused: true, graceful: true }); }, { gracefulPause: true });
        return true;
    }

    if (msg.type === 'STOP_AUTO_SCRAPE') {
        gridScan = null;
        clearGridWatchdog();
        stopBackgroundQueues();
        debugLog('scrape.stopped', {});
        chrome.storage.local.remove([GRID_STATE_KEY, 'gmes_cat_queue', 'gmes_cat_shared']);
        chrome.storage.local.set({ gmes_background_scraping: false, gmes_scrape_heartbeat: 0, gmes_grid_total: 0, gmes_grid_current: 0, gmes_grid_autoresume: false, gmes_active_session_id: '', gmes_active_session_started: 0, gmes_cat_total: 0, gmes_cat_index: 0 });
        stopMapsContentScripts(function () { sendResponse({ stopped: true }); });
        return true;
    }

    if (msg.type === 'GRID_CELL_DONE') {
        advanceGridScan();
        return;
    }
});

// ----------------------------------------------------------------------------
// Run-flag recovery: keep gmes_background_scraping honest if the controller dies.
// ----------------------------------------------------------------------------
// auto_scraper.js resets the flag in its finish() path, but closing the Maps tab
// destroys the injected controller before it can — leaving the popup stuck on
// "Stop Scraping". Clearing the flag on tab-close is unambiguous and safe.
//
// NOTE: do NOT also reset on tabs.onUpdated 'loading' — Google Maps fires that
// status during its in-app place/back navigations, which the controller survives,
// so doing that would wrongly flip the button to "Start Scraping" mid-run. The
// reload-death case (a real document load that does tear the controller down) is
// handled by the popup's heartbeat-staleness check instead, which can't misfire
// while the loop is still ticking.
function clearScrapeRunIfTab(tabId) {
    chrome.storage.local.get([GRID_STATE_KEY, 'gmes_scrape_tab', 'gmes_background_scraping'], function (d) {
        var gs = d[GRID_STATE_KEY];
        if (gs && gs.tabId === tabId) {
            // The grid's tab was closed. Keep the saved cursor so the run can be
            // resumed from the popup, but clear autoresume so the watchdog won't
            // silently reopen a tab the user deliberately closed. The cell counters
            // (gmes_grid_total/current) stay put so the popup can show "Resume X/Y".
            gridScan = null;
            chrome.storage.local.set({ gmes_background_scraping: false, gmes_scrape_heartbeat: 0, gmes_grid_autoresume: false });
        } else if (d.gmes_background_scraping && d.gmes_scrape_tab === tabId) {
            chrome.storage.local.set({ gmes_background_scraping: false, gmes_scrape_heartbeat: 0 });
        }
    });
}

chrome.tabs.onRemoved.addListener(function (tabId) {
    clearScrapeRunIfTab(tabId);
});

// Normalized phone digits for a lead (primary number), or '' if none/too short.
// Strips formatting and a leading US country code so "(555) 123-4567",
// "+1 555-123-4567" and "5551234567" all collapse to the same key.
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

// True if a lead carries a usable phone number.
function hasPhone(item) {
    return phoneDigits(item) !== '';
}

var US_STATE_CODES_FOR_VALIDATION = {
    AL: true, AK: true, AZ: true, AR: true, CA: true, CO: true, CT: true, DE: true, FL: true, GA: true,
    HI: true, ID: true, IL: true, IN: true, IA: true, KS: true, KY: true, LA: true, ME: true, MD: true,
    MA: true, MI: true, MN: true, MS: true, MO: true, MT: true, NE: true, NV: true, NH: true, NJ: true,
    NM: true, NY: true, NC: true, ND: true, OH: true, OK: true, OR: true, PA: true, RI: true, SC: true,
    SD: true, TN: true, TX: true, UT: true, VT: true, VA: true, WA: true, WV: true, WI: true, WY: true,
    DC: true
};

var US_STATE_NAMES_FOR_VALIDATION = {
    alabama: true, alaska: true, arizona: true, arkansas: true, california: true, colorado: true,
    connecticut: true, delaware: true, florida: true, georgia: true, hawaii: true, idaho: true,
    illinois: true, indiana: true, iowa: true, kansas: true, kentucky: true, louisiana: true,
    maine: true, maryland: true, massachusetts: true, michigan: true, minnesota: true, mississippi: true,
    missouri: true, montana: true, nebraska: true, nevada: true, 'new hampshire': true,
    'new jersey': true, 'new mexico': true, 'new york': true, 'north carolina': true,
    'north dakota': true, ohio: true, oklahoma: true, oregon: true, pennsylvania: true,
    'rhode island': true, 'south carolina': true, 'south dakota': true, tennessee: true, texas: true,
    utah: true, vermont: true, virginia: true, washington: true, 'west virginia': true,
    wisconsin: true, wyoming: true, 'district of columbia': true
};

function itemPhoneDigitsForValidation(item) {
    var raw = [];
    if (item && item.phone) raw.push(item.phone);
    if (item && Array.isArray(item.phones)) {
        item.phones.forEach(function (p) { if (p) raw.push(p.number || p); });
    }
    for (var i = 0; i < raw.length; i++) {
        var s = String(raw[i] || '').trim();
        var d = s.replace(/\D/g, '');
        if (/^\s*\+1\b/.test(s) || (d.length === 11 && d.charAt(0) === '1')) return 'explicit-us';
        if (d.length === 10) continue;
        if (d.length > 0) return 'non-us';
    }
    return '';
}

function coordsInUnitedStates(lat, lng) {
    var la = parseFloat(lat), lo = parseFloat(lng);
    if (!isFinite(la) || !isFinite(lo)) return false;
    var mainland = la >= 24 && la <= 50 && lo >= -125 && lo <= -66;
    var alaska = la >= 51 && la <= 72 && lo >= -170 && lo <= -129;
    var hawaii = la >= 18 && la <= 23 && lo >= -161 && lo <= -154;
    return mainland || alaska || hawaii;
}

function validateUnitedStatesLead(item) {
    var reasons = [];
    var explicitRejects = [];
    var text = [
        item && item.address,
        item && item.city,
        item && item.state,
        item && item.zip,
        item && item.country
    ].filter(Boolean).join(' ').toLowerCase();

    if (/\b(canada|mexico|united kingdom|uk|australia|india|pakistan|uae|dubai|qatar|saudi|germany|france|spain|italy)\b/.test(text)) {
        explicitRejects.push('address/country is outside the United States');
    }

    var phone = itemPhoneDigitsForValidation(item);
    if (phone === 'non-us') explicitRejects.push('phone number is not a US +1/10-digit number');
    else if (phone === 'explicit-us') reasons.push('explicit +1 phone');

    var state = String((item && item.state) || '').trim();
    if (state) {
        if (US_STATE_CODES_FOR_VALIDATION[state.toUpperCase()] || US_STATE_NAMES_FOR_VALIDATION[state.toLowerCase()]) {
            reasons.push('US state ' + state.toUpperCase());
        } else {
            explicitRejects.push('state is not a US state');
        }
    }

    var zip = String((item && (item.zip || item.postalCode)) || '').trim();
    if (zip && /^\d{5}(?:-\d{4})?$/.test(zip)) reasons.push('US ZIP ' + zip);
    if (/\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY|DC)\s+\d{5}(?:-\d{4})?\b/i.test(text)) {
        reasons.push('US state/ZIP in address');
    }
    if (/\b(united states|usa|u\.s\.a\.|u\.s\.)\b/i.test(text)) reasons.push('United States in address');
    if (coordsInUnitedStates(item && item.lat, item && item.lng)) reasons.push('coordinates inside United States');

    if (explicitRejects.length) return { ok: false, reason: explicitRejects.join('; '), evidence: reasons };
    if (reasons.length) return { ok: true, reason: reasons.join(', '), evidence: reasons };
    return { ok: false, reason: 'missing confident United States evidence', evidence: [] };
}

// Derive a stable identity for a scraped place used for de-duplication. The phone
// number is the strongest signal (a business has a unique number, while two
// different places can share a name/address), so it's preferred. When no phone is
// known we fall back to Google's stable feature id (the 0x..:0x.. pair in the
// data= blob), then the place's own !3d/!4d coordinates, then title+address. The
// raw place-link href can't be used directly because it embeds the live map
// @lat,lng,zoom, which differs between overlapping grid cells.
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

function cardIdentityFromLead(item) {
    if (!item) return '';
    var href = String(item.href || '');
    var m = href.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
    if (m) return 'cid:' + m[1].toLowerCase();
    m = href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return 'geo:' + m[1] + ',' + m[2];
    var pathMatch = href.match(/\/maps\/place\/([^/@?]+)/);
    if (pathMatch) { try { return 'path:' + decodeURIComponent(pathMatch[1]).toLowerCase(); } catch (e) { return 'path:' + pathMatch[1].toLowerCase(); } }
    var title = (item.title || '').toLowerCase().trim();
    if (title) return 'title:' + title;
    return '';
}

function rememberRejectedScrapeCard(item) {
    var keys = [placeIdentity(item), cardIdentityFromLead(item)].filter(Boolean);
    if (!keys.length) return;
    chrome.storage.local.get(['gmes_rejected_scrape_cards'], function (d) {
        var list = Array.isArray(d.gmes_rejected_scrape_cards) ? d.gmes_rejected_scrape_cards : [];
        var seen = {};
        list.concat(keys).forEach(function (k) { if (k) seen[k] = true; });
        var next = Object.keys(seen).slice(-1000);
        chrome.storage.local.set({ gmes_rejected_scrape_cards: next });
    });
}

// Fill empty fields on `target` from a duplicate `src` (e.g. recover a phone that
// only one grid cell captured). Returns true if anything changed.
function fillMissingFields(target, src) {
    if (!target || !src) return false;
    var changed = false;
    var FIELDS = ['phone', 'companyUrl', 'address', 'city', 'state', 'zip', 'industry', 'businessTimings', 'email', 'instaSearch', 'closedStatus'];
    FIELDS.forEach(function (f) {
        var cur = target[f];
        if ((cur == null || cur === '') && src[f] != null && src[f] !== '') { target[f] = src[f]; changed = true; }
    });
    if ((!Array.isArray(target.phones) || !target.phones.length) && Array.isArray(src.phones) && src.phones.length) {
        target.phones = src.phones; changed = true;
    }
    return changed;
}

// Collapse duplicate places in a list, keeping the first occurrence (in order) and
// enriching it with any fields later duplicates filled in. Items with no derivable
// identity are kept as-is.
function dedupeItemList(list) {
    var byKey = new Map();
    var out = [];
    (list || []).forEach(function (item) {
        if (!item) return;
        var key = placeIdentity(item);
        if (!key) { out.push(item); return; }
        if (byKey.has(key)) {
            fillMissingFields(byKey.get(key), item);
        } else {
            byKey.set(key, item);
            out.push(item);
        }
    });
    return out;
}

// One-time cleanup of the stored leads list (collapses duplicates left by older
// runs that keyed on the raw href). Safe to call on startup.
function dedupeStoredResults() {
    chrome.storage.local.get(['gmes_results'], function (data) {
        var list = Array.isArray(data.gmes_results) ? data.gmes_results : [];
        if (list.length < 2) return;
        var deduped = dedupeItemList(list);
        if (deduped.length !== list.length) chrome.storage.local.set({ gmes_results: deduped });
    });
}

function enforceStoredResultsUnitedStates() {
    chrome.storage.local.get(['gmes_results'], function (data) {
        var list = Array.isArray(data.gmes_results) ? data.gmes_results : [];
        if (!list.length) return;
        var kept = [];
        list.forEach(function (item) {
            var us = validateUnitedStatesLead(item);
            if (us.ok) {
                if (item && item.companyUrl && !isRealWebsite(item.companyUrl)) item.companyUrl = '';
                kept.push(item);
            }
            else debugLog('lead.removed_from_cache', { title: item && item.title, reason: us.reason });
        });
        if (kept.length !== list.length) chrome.storage.local.set({ gmes_results: kept });
    });
}

// Merge freshly scraped items into storage, applying the ignore lists and the
// (source-aware) food filter. cb(addedCount) when done. The whole read-modify-write
// runs under withResultsLock so it can't race the async website-enrichment writes.
function mergeScrapedItems(newItems, source, cb) {
    if (!Array.isArray(newItems) || !newItems.length) { if (cb) cb(0); return; }
    withResultsLock(function (release) {
        chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries', 'gmes_food_filter_enabled', 'gmes_active_session_id', 'gmes_restaurant_mode', 'gmes_platform_any', 'gmes_platform_include', 'gmes_platform_exclude', 'gmes_platform_unmatched'], function (data) {
            var existingRaw = Array.isArray(data.gmes_results) ? data.gmes_results : [];
            // Collapse any duplicates left by older runs before merging in new items.
            var existing = dedupeItemList(existingRaw).filter(function (item) {
                var us = validateUnitedStatesLead(item);
                if (!us.ok) debugLog('lead.removed_from_cache', { title: item && item.title, reason: us.reason });
                return us.ok;
            });
            var changed = existing.length !== existingRaw.length;
            var ignoreNamesArr = Array.isArray(data.gmes_ignore_names) ? data.gmes_ignore_names : [];
            var ignoreIndustriesArr = Array.isArray(data.gmes_ignore_industries) ? data.gmes_ignore_industries : [];
            var ignoreNamesSet = new Set(ignoreNamesArr.map(function (s) { return String(s).toLowerCase().trim(); }));
            var ignoreIndustriesSet = new Set(ignoreIndustriesArr.map(function (s) { return String(s).toLowerCase().trim(); }));
            // Food filter is enabled by default, but auto-scrape (a user-chosen category)
            // bypasses it so non-food categories aren't silently discarded.
            var foodFilterEnabled = data.gmes_food_filter_enabled !== false && source !== 'auto';
            // Tag leads from the active scraping session so the popup can count this
            // run's leads (and which are still local-only) and snapshot them on save.
            var activeSessionId = data.gmes_active_session_id || '';

            var byKey = new Map();
            existing.forEach(function (it) { var k = placeIdentity(it); if (k) byKey.set(k, it); });
            var addedCount = 0;
            var addedItems = [];   // newly stored leads (candidates for website enrichment)
            // Restaurant Mode: maps-direct + no-website leads resolve synchronously
            // below; real-website leads go here for the async platform detector.
            var deliveryDeferred = [];
            var restaurantMode = data.gmes_restaurant_mode === true;
            var deliveryCfg = restaurantMode ? {
                platformAny: data.gmes_platform_any === true,
                platformInclude: Array.isArray(data.gmes_platform_include) ? data.gmes_platform_include : [],
                platformExclude: Array.isArray(data.gmes_platform_exclude) ? data.gmes_platform_exclude : [],
                platformUnmatched: data.gmes_platform_unmatched === 'skip' ? 'skip' : 'tag'
            } : null;

            newItems.forEach(function (item) {
                if (item && item.companyUrl && !isRealWebsite(item.companyUrl)) item.companyUrl = '';
                var key = placeIdentity(item);
                if (!key) {
                    debugLog('lead.rejected', { source: source || 'unknown', title: item && item.title, reason: 'missing lead identity' });
                    return;
                }
                if (byKey.has(key)) {
                    // Same place seen again (overlapping cell) — enrich the stored copy
                    // with any fields this capture filled, but don't add a new row.
                    if (fillMissingFields(byKey.get(key), item)) changed = true;
                    debugLog('lead.duplicate', { source: source || 'unknown', title: item && item.title, identity: key });
                    return;
                }

                // Only collect leads that have a phone number (auto-scrape). The
                // injected scraper already gates on this, but enforce it here too so a
                // phone-less item can never reach storage from any auto-scrape path.
                if (source === 'auto' && !hasPhone(item)) {
                    debugLog('lead.rejected', { source: source, title: item && item.title, identity: key, reason: 'auto-scrape lead has no phone number' });
                    return;
                }

                var us = validateUnitedStatesLead(item);
                if (!us.ok) {
                    rememberRejectedScrapeCard(item);
                    debugLog('lead.rejected', { source: source || 'unknown', title: item && item.title, identity: key, reason: us.reason, evidence: us.evidence });
                    return;
                }

                // Apply food industry filter
                if (foodFilterEnabled && !isFoodRelatedIndustry(item.industry)) {
                    debugLog('lead.rejected', { source: source || 'unknown', title: item && item.title, identity: key, reason: 'industry failed food filter', industry: item && item.industry });
                    return;
                }

                try {
                    if (chainNameMatchesIgnoreList(item && item.title, ignoreNamesSet)) {
                        debugLog('lead.rejected', { source: source || 'unknown', title: item && item.title, identity: key, reason: 'name matched blocklist' });
                        return;
                    }
                    if (industryMatchesIgnoreList(item && item.industry, ignoreIndustriesSet)) {
                        debugLog('lead.rejected', { source: source || 'unknown', title: item && item.title, identity: key, reason: 'industry matched blocklist', industry: item && item.industry });
                        return;
                    }
                } catch (e) { }

                if (activeSessionId && !item.sessionId) item.sessionId = activeSessionId;

                // Restaurant Mode fast path: resolve delivery platforms the moment a
                // lead is merged. A maps-direct hit (the Maps "website" link is itself
                // an ordering platform) or a lead with no real site to visit is fully
                // qualified here — skip mode filters it out (return), tag mode keeps it
                // with a [Delivery: ...] note. Real-website leads defer to the detector.
                if (restaurantMode) {
                    var directKeys = matchPlatformHosts(item.companyUrl);
                    if (directKeys.length) {
                        if (!applyDeliveryToLead(item, directKeys, 'maps-direct', deliveryCfg)) {
                            debugLog('lead.rejected', { source: source || 'unknown', title: item && item.title, identity: key, reason: 'restaurant mode delivery filter rejected maps-direct lead' });
                            return;
                        }
                    } else if (!isRealWebsite(item.companyUrl)) {
                        if (!applyDeliveryToLead(item, [], '', deliveryCfg)) {
                            debugLog('lead.rejected', { source: source || 'unknown', title: item && item.title, identity: key, reason: 'restaurant mode rejected lead with no matched website platform' });
                            return;
                        }
                    } else {
                        deliveryDeferred.push(item);
                        debugLog('lead.pending_delivery', { source: source || 'unknown', title: item && item.title, identity: key, website: item.companyUrl, rules: describeDeliveryRules(deliveryCfg) });
                        return;
                    }
                }

                byKey.set(key, item);
                existing.push(item);
                addedItems.push(item);
                addedCount++;
                debugLog('lead.accepted', { source: source || 'unknown', title: item && item.title, identity: key, reason: us.reason });
            });

            function finish() {
                release();
                if (cb) cb(addedCount);
                // Kick off website enrichment for the leads we just added (gated by
                // the gmes_scrape_websites toggle inside enqueueItemsForEnrichment).
                if (addedItems.length) enqueueItemsForEnrichment(addedItems);
                // Restaurant Mode: detect ordering platforms for real-website leads
                // (maps-direct + no-site leads were already resolved above).
                if (restaurantMode && deliveryDeferred.length) enqueueItemsForDelivery(deliveryDeferred, deliveryCfg);
            }

            if (addedCount || changed) chrome.storage.local.set({ gmes_results: existing }, finish);
            else finish();
        });
    });
}

// Accept items posted from injected content scripts and merge them into storage
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'INJECTED_SCRAPE_ITEMS' || !Array.isArray(msg.items)) return;
    if (!EXTENSION_ENABLED) return;
    mergeScrapedItems(msg.items, msg.source);
});

// Check for updates on extension startup
chrome.runtime.onStartup.addListener(function () {
    checkForUpdates();
});

// Check for updates when extension is installed or enabled
chrome.runtime.onInstalled.addListener(function () {
    disableExtension();
    checkForUpdates();
    setupUpdateAlarm();
});

// Set up alarm on service worker startup (for Manifest V3)
setupUpdateAlarm();
// Also check immediately on startup
checkForUpdates();
// Clean up any duplicate leads left by older runs (pre stable-identity dedup).
dedupeStoredResults();
enforceStoredResultsUnitedStates();

// ============================================================================
// End of Update Checker
// ============================================================================

// ============================================================================
// Food/Restaurant Business Filter
// ============================================================================

// Industries to INCLUDE (food-related businesses)
var FOOD_INDUSTRIES = [
    'restaurant', 'restaurants', 'cafe', 'cafes', 'coffee', 'coffee shop', 'coffee house',
    'bakery', 'bakeries', 'pizza', 'pizzeria', 'burger', 'burgers', 'sushi', 'thai',
    'chinese', 'mexican', 'italian', 'indian', 'japanese', 'korean', 'vietnamese',
    'mediterranean', 'greek', 'french', 'american', 'seafood', 'steakhouse', 'steak house',
    'bbq', 'barbecue', 'grill', 'diner', 'bistro', 'brasserie', 'trattoria', 'osteria',
    'taqueria', 'cantina', 'pub', 'gastropub', 'tavern', 'bar', 'wine bar', 'sports bar',
    'brewery', 'brewpub', 'taproom', 'food truck', 'food stand', 'food court',
    'fast food', 'fast casual', 'quick service', 'takeout', 'take out', 'takeaway',
    'delivery', 'catering', 'caterer', 'deli', 'delicatessen', 'sandwich', 'sandwiches',
    'sub', 'subs', 'wrap', 'wraps', 'salad', 'salads', 'soup', 'noodle', 'noodles',
    'ramen', 'pho', 'dim sum', 'dumpling', 'dumplings', 'wonton', 'hotpot', 'hot pot',
    'shabu', 'yakiniku', 'tempura', 'teriyaki', 'hibachi', 'teppanyaki',
    'ice cream', 'gelato', 'frozen yogurt', 'froyo', 'dessert', 'desserts', 'pastry',
    'donut', 'donuts', 'doughnut', 'doughnuts', 'cupcake', 'cupcakes', 'cake', 'cakes',
    'tea', 'tea house', 'bubble tea', 'boba', 'juice', 'juice bar', 'smoothie', 'smoothies',
    'brunch', 'breakfast', 'lunch', 'dinner', 'supper', 'buffet', 'all you can eat',
    'fine dining', 'casual dining', 'family dining', 'family restaurant',
    'ethnic', 'fusion', 'contemporary', 'modern', 'traditional', 'authentic',
    'vegetarian', 'vegan', 'plant based', 'organic', 'farm to table', 'health food',
    'wings', 'chicken', 'fried chicken', 'rotisserie', 'wing', 'fish', 'fish and chips',
    'lobster', 'crab', 'oyster', 'clam', 'shrimp', 'crawfish', 'cajun', 'creole',
    'soul food', 'southern', 'comfort food', 'home cooking', 'homestyle',
    'tapas', 'small plates', 'appetizers', 'snacks', 'street food', 'hawker',
    'food hall', 'eatery', 'eating', 'dining', 'kitchen', 'cookhouse', 'chophouse',
    'pancake', 'waffle', 'crepe', 'crepes', 'bagel', 'bagels', 'toast', 'acai',
    'poke', 'bowl', 'bowls', 'grain bowl', 'rice bowl', 'burrito', 'burritos', 'taco', 'tacos',
    'quesadilla', 'nachos', 'enchilada', 'fajita', 'chimichanga', 'tamale', 'tamales',
    'curry', 'tandoori', 'biryani', 'kebab', 'kebabs', 'shawarma', 'falafel', 'hummus',
    'gyro', 'gyros', 'souvlaki', 'moussaka', 'spanakopita',
    'pad thai', 'spring roll', 'egg roll', 'fried rice', 'chow mein', 'lo mein',
    'general tso', 'kung pao', 'sweet and sour', 'orange chicken', 'mongolian',
    'vietnamese', 'banh mi', 'bun', 'vermicelli', 'congee', 'jook',
    'fondue', 'raclette', 'schnitzel', 'bratwurst', 'sausage', 'pretzel',
    'croissant', 'baguette', 'patisserie', 'confectionery', 'chocolatier',
    'food', 'meal', 'meals', 'cuisine', 'culinary', 'chef', 'cook', 'cooking'
];

// Industries to EXCLUDE (non-food businesses that might appear in food searches)
var NON_FOOD_INDUSTRIES = [
    'grocery', 'groceries', 'supermarket', 'supermarkets', 'market', 'mart',
    'convenience store', 'corner store', 'bodega', 'mini mart', 'minimart',
    'gas station', 'gas', 'fuel', 'petrol', 'filling station', 'service station',
    'liquor store', 'liquor', 'wine shop', 'beer store', 'bottle shop', 'off license',
    'pharmacy', 'drug store', 'drugstore', 'chemist',
    'dollar store', 'dollar', 'discount store', 'variety store',
    'department store', 'retail', 'retailer', 'shop', 'store', 'outlet',
    'warehouse', 'wholesale', 'distributor', 'supplier',
    'hotel', 'motel', 'inn', 'lodge', 'resort', 'hostel', 'bed and breakfast',
    'laundry', 'laundromat', 'dry cleaner', 'dry cleaning',
    'bank', 'atm', 'credit union', 'financial',
    'gym', 'fitness', 'health club', 'spa', 'salon', 'barber', 'hair',
    'auto', 'car', 'automotive', 'mechanic', 'repair', 'tire', 'oil change',
    'hardware', 'home improvement', 'lumber', 'building',
    'office', 'corporate', 'business center',
    'school', 'college', 'university', 'education', 'learning',
    'hospital', 'clinic', 'medical', 'doctor', 'dentist', 'dental',
    'church', 'mosque', 'temple', 'synagogue', 'religious',
    'parking', 'storage', 'moving', 'shipping',
    'real estate', 'property', 'apartment', 'rental',
    'clothing', 'apparel', 'fashion', 'shoes', 'jewelry',
    'electronics', 'computer', 'phone', 'mobile', 'tech',
    'pet store', 'pet shop', 'veterinary', 'vet', 'animal',
    'florist', 'flower', 'plant', 'nursery', 'garden',
    'furniture', 'mattress', 'home decor', 'interior',
    'travel', 'tourism', 'tour', 'agency',
    'insurance', 'lawyer', 'attorney', 'legal', 'law firm',
    'accounting', 'tax', 'consultant', 'consulting'
];

// Check if an industry is food-related
function isFoodRelatedIndustry(industry) {
    if (!industry) return true; // If no industry, include it (might be a restaurant without category)
    var industryLower = String(industry).toLowerCase().trim();
    if (!industryLower) return true;

    // Check if it matches any excluded industry
    for (var i = 0; i < NON_FOOD_INDUSTRIES.length; i++) {
        var excluded = NON_FOOD_INDUSTRIES[i];
        if (industryLower === excluded || industryLower.indexOf(excluded) !== -1) {
            return false;
        }
    }

    // Check if it matches any included food industry
    for (var i = 0; i < FOOD_INDUSTRIES.length; i++) {
        var foodInd = FOOD_INDUSTRIES[i];
        if (industryLower === foodInd || industryLower.indexOf(foodInd) !== -1) {
            return true;
        }
    }

    // If not in either list, include it (benefit of the doubt)
    return true;
}

// ============================================================================
// End of Food/Restaurant Filter
// ============================================================================

// ============================================================================
// Restaurant Mode — 3rd-party ordering/delivery platform registry + matcher
// ----------------------------------------------------------------------------
// "Restaurant Mode" qualifies leads by which online-ordering / delivery platform
// they use. Detection runs in three passes (cheapest first): a maps-direct check
// on the Maps "website" link (mergeScrapedItems), a fetch() of the site's HTML,
// then an inactive-tab DOM scan with an optional single hybrid click. The keys
// and lead fields below are a SHARED CONTRACT with popup.js and the results UI —
// do not rename them.
// ============================================================================

// Platform key -> host substrings that identify that platform (matched against a
// URL's hostname, so "order.doordash.com" still matches "doordash.com").
var PLATFORM_DOMAINS = {
    doordash: ['doordash.com', 'order.online', 'trycaviar.com', 'caviar.com'],
    ubereats: ['ubereats.com', 'eats.uber.com'],
    postmates: ['postmates.com'],
    grubhub: ['grubhub.com', 'seamless.com'],
    toast:   ['toasttab.com'],
    chownow: ['chownow.com'],
    slice:   ['slicelife.com']
};

// Generic online-ordering hosts. These are folded into the synthetic key 'other'
// and ONLY qualify a lead when platformAny is true (see computeMatched) — a user
// asking specifically for DoorDash must not match a menufy/olo site.
var GENERIC_PLATFORM_DOMAINS = ['menufy.com', 'olo.com', 'beyondmenu.com', 'square.site'];

// Display labels used in the [Delivery: ...] note token and the results UI.
var PLATFORM_LABELS = {
    doordash: 'DoorDash',
    ubereats: 'Uber Eats',
    postmates: 'Postmates',
    grubhub:  'Grubhub/Seamless',
    toast:    'Toast',
    chownow:  'ChowNow',
    slice:    'Slice',
    other:    'Other'
};

// The user-selectable platform keys. The "Any" rule expands to exactly these
// (plus the synthetic 'other'); 'other' is intentionally NOT listed so it can
// never satisfy a specific include list.
var ALL_KNOWN_KEYS = ['doordash', 'ubereats', 'postmates', 'grubhub', 'toast', 'chownow', 'slice'];

// Flat list of every platform host substring (specific + generic), passed to the
// injected DOM scanner so it stays self-contained/serializable.
function allPlatformSubstrings() {
    var subs = [];
    ALL_KNOWN_KEYS.forEach(function (k) { subs = subs.concat(PLATFORM_DOMAINS[k]); });
    return subs.concat(GENERIC_PLATFORM_DOMAINS);
}

// Parse a URL's host and return the platform keys it matches. Reuses the
// isGoogleHostBg guard so Google/empty/invalid URLs return []. Generic hosts map
// to the synthetic key 'other'.
function matchPlatformHosts(url) {
    if (!url) return [];
    var host;
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return []; }
    if (!host || isGoogleHostBg(url)) return [];
    var found = {};
    var keys = Object.keys(PLATFORM_DOMAINS);
    for (var i = 0; i < keys.length; i++) {
        var subs = PLATFORM_DOMAINS[keys[i]];
        for (var j = 0; j < subs.length; j++) {
            if (host === subs[j] || host.indexOf(subs[j]) !== -1) { found[keys[i]] = 1; break; }
        }
    }
    for (var g = 0; g < GENERIC_PLATFORM_DOMAINS.length; g++) {
        if (host === GENERIC_PLATFORM_DOMAINS[g] || host.indexOf(GENERIC_PLATFORM_DOMAINS[g]) !== -1) { found.other = 1; break; }
    }
    return Object.keys(found);
}

// Qualification rule (shared contract):
//   excluded  = platformExclude
//   candidate = platformAny ? ALL_KNOWN_KEYS(+other) : platformInclude
//   matched   = (detected ∩ candidate) − excluded
function computeMatched(detectedKeys, cfg) {
    detectedKeys = detectedKeys || [];
    cfg = cfg || {};
    var candidate = cfg.platformAny ? ALL_KNOWN_KEYS.concat(['other']) : (cfg.platformInclude || []);
    var candSet = {}; candidate.forEach(function (k) { candSet[k] = 1; });
    var exclSet = {}; (cfg.platformExclude || []).forEach(function (k) { exclSet[k] = 1; });
    var matched = [], seen = {};
    detectedKeys.forEach(function (k) {
        if (!candSet[k] || exclSet[k] || seen[k]) return;   // excluded wins over include/any
        seen[k] = 1; matched.push(k);
    });
    return matched;
}

function describeDeliveryRules(cfg) {
    cfg = cfg || {};
    return {
        mode: cfg.platformAny ? 'any' : 'include',
        include: cfg.platformAny ? ALL_KNOWN_KEYS.concat(['other']) : (cfg.platformInclude || []),
        exclude: cfg.platformExclude || [],
        unmatched: cfg.platformUnmatched === 'skip' ? 'skip' : 'tag'
    };
}

// Append a [Delivery: DoorDash, Grubhub] (or [Delivery: none]) token to a lead's
// note. Never overwrites an existing note and never double-appends its own token.
function appendDeliveryNote(lead, matched) {
    if (!lead) return;
    var note = (lead.note != null) ? String(lead.note) : '';
    if (/\[Delivery:[^\]]*\]/i.test(note)) return;   // already tagged — don't duplicate
    var labels = (matched && matched.length)
        ? matched.map(function (k) { return PLATFORM_LABELS[k] || k; }).join(', ')
        : 'none';
    var token = '[Delivery: ' + labels + ']';
    lead.note = note ? (note + ' ' + token) : token;
}

// Set the delivery fields on a lead from a detected platform set + source, apply
// the qualification rule, and return whether the lead should be KEPT (true) or
// PRUNED (false — only possible in skip mode when nothing qualified).
function applyDeliveryToLead(lead, detectedKeys, source, cfg) {
    if (!lead) return true;
    cfg = cfg || {};
    var matched = computeMatched(detectedKeys, cfg);
    lead.deliveryPlatforms = matched;
    lead.deliverySource = source || '';
    lead.deliveryChecked = true;
    var qualified = matched.length > 0;
    if (cfg.platformUnmatched === 'skip' && !qualified) return false;   // filter out
    appendDeliveryNote(lead, matched);                                  // qualified OR tag mode
    return true;
}

// Read the persisted Restaurant Mode config. Unmatched defaults to 'tag'
// (non-destructive) when unset so a missing key can never silently prune leads.
function getRestaurantConfig(cb) {
    chrome.storage.local.get(['gmes_restaurant_mode', 'gmes_platform_any', 'gmes_platform_include', 'gmes_platform_exclude', 'gmes_platform_unmatched'], function (d) {
        cb({
            restaurantMode: d.gmes_restaurant_mode === true,
            platformAny: d.gmes_platform_any === true,
            platformInclude: Array.isArray(d.gmes_platform_include) ? d.gmes_platform_include : [],
            platformExclude: Array.isArray(d.gmes_platform_exclude) ? d.gmes_platform_exclude : [],
            platformUnmatched: d.gmes_platform_unmatched === 'skip' ? 'skip' : 'tag'
        });
    });
}

// ============================================================================
// End of Restaurant Mode registry
// ============================================================================

// ============================================================================
// Chain-Name Blocklist Matcher
// ============================================================================

// Normalize for chain comparison: lowercase, drop apostrophes, collapse non-alphanum
// to single spaces. Lets "McDonald's" and "mcdonalds" compare equal.
function normalizeChainName(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/['\u2018\u2019]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Whole-word phrase match: returns true if `phrase` appears as a complete
// word sequence inside `text`. Avoids matching "wonder" inside "wonderful".
function chainPhraseMatches(text, phrase) {
    if (!text || !phrase) return false;
    if (text === phrase) return true;
    if (text.indexOf(phrase + ' ') === 0) return true;
    var tail = ' ' + phrase;
    if (text.length >= tail.length && text.lastIndexOf(tail) === text.length - tail.length) return true;
    if (text.indexOf(' ' + phrase + ' ') !== -1) return true;
    return false;
}

// Words used to recognize that a multi-word blocklist entry ends in a
// location qualifier (e.g. "Wonder Manhattan", "Joe's Pizza Midtown East"),
// which lets us fall back to matching just the chain prefix.
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

// Match a Google Maps title against a blocklist of chain names. Catches
// location modifiers ("Wonder Lower East Side" blocked by "Wonder") AND
// over-specific blocklist entries that bake in a location ("Wonder Manhattan"
// still blocks "Wonder Lower East Side") — but only when the trailing words
// look like a location, so "Pizza Hut" does NOT incorrectly block "Pizza Place".
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

// Industry blocklist: keep the original substring semantics (industries are
// short categorical tokens, not chain names).
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
// End of Chain-Name Blocklist Matcher
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
// Website Enrichment — scrape each lead's site for emails & extra phones
// ----------------------------------------------------------------------------
// For every stored lead that has a real (non-Google) website, visit the site to
// pull contact emails and any phone numbers Google Maps didn't carry. Strategy
// is HYBRID: the service worker first fetch()es the homepage HTML (and one
// contact/about page) and regex-extracts contacts — fast, invisible, parallel.
// If that fails or finds no email on a page that looks JS-rendered, it falls
// back to opening the site in an inactive background tab and DOM-scanning it,
// which handles client-rendered sites. Results merge into the lead's `emails`
// array and `phones[]` (deduped). Gated by the gmes_scrape_websites toggle
// (default on). Each lead is marked `websiteScraped` so it's only processed once.
// ============================================================================

// --- Serialized gmes_results writer -----------------------------------------
// Both the scrape-merge path and the async enrichment updates read-modify-write
// gmes_results. Without serialization a slow enrichment write could clobber a
// fresh batch of scraped leads (or vice-versa). Every mutation runs as a task in
// this chain and holds the lock until it calls release().
var _resultsLockChain = Promise.resolve();
function withResultsLock(task) {
    _resultsLockChain = _resultsLockChain.then(function () {
        return new Promise(function (resolve) {
            var released = false;
            function release() { if (released) return; released = true; resolve(); }
            try { task(release); } catch (e) { release(); }
        });
    });
    // Never let a thrown task break the chain for everyone after it.
    _resultsLockChain = _resultsLockChain.catch(function () {});
}

// Separate serialized writer for the website-scrape log (a different storage key,
// so it can't conflict with gmes_results, but parallel enrichments still race it).
var _logLockChain = Promise.resolve();
function withLogLock(task) {
    _logLockChain = _logLockChain.then(function () {
        return new Promise(function (resolve) {
            var released = false;
            function release() { if (released) return; released = true; resolve(); }
            try { task(release); } catch (e) { release(); }
        });
    });
    _logLockChain = _logLockChain.catch(function () {});
}

// Append/upsert an entry into the persistent website-scrape log. One entry per
// lead identity (a backfill re-run replaces it); bounded to the most recent 2000.
// This records EVERY scraped site, whether or not an email was found.
function recordEnrichLog(job, result) {
    withLogLock(function (release) {
        chrome.storage.local.get(['gmes_website_scrape_log'], function (d) {
            var log = Array.isArray(d.gmes_website_scrape_log) ? d.gmes_website_scrape_log : [];
            var emails = (result && result.emails) || [];
            var phones = (result && result.phones) || [];
            var entry = {
                identity: job.identity,
                title: job.title || '',
                url: job.url || '',
                emails: emails.slice(0, 5),
                emailCount: emails.length,
                phoneCount: phones.length,
                method: (result && result.method) || '',   // 'fetch' | 'tab'
                found: emails.length > 0 || phones.length > 0,
                at: Date.now()
            };
            var replaced = false;
            for (var i = 0; i < log.length; i++) {
                if (log[i] && log[i].identity === entry.identity) { log[i] = entry; replaced = true; break; }
            }
            if (!replaced) log.push(entry);
            if (log.length > 2000) log = log.slice(log.length - 2000);
            chrome.storage.local.set({ gmes_website_scrape_log: log }, function () { release(); });
        });
    });
}

// True if `url` is a real external website we can scrape (http(s), non-Google).
function isGoogleHostBg(url) {
    try {
        var host = new URL(url).hostname.toLowerCase();
        if (host === 'google.com' || host.endsWith('.google.com')) return true;
        if (host.endsWith('.gstatic.com') || host.endsWith('.ggpht.com')) return true;
        return false;
    } catch (e) { return true; }
}
function isBlockedWebsiteHostBg(url) {
    try {
        var host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        if (isGoogleHostBg(url)) return true;
        return host === 'facebook.com' || host.endsWith('.facebook.com') ||
            host === 'instagram.com' || host.endsWith('.instagram.com') ||
            host === 'tiktok.com' || host.endsWith('.tiktok.com') ||
            host === 'twitter.com' || host.endsWith('.twitter.com') ||
            host === 'x.com' || host.endsWith('.x.com') ||
            host === 'linkedin.com' || host.endsWith('.linkedin.com') ||
            host === 'youtube.com' || host.endsWith('.youtube.com') ||
            host === 'youtu.be' ||
            host === 'linktr.ee' || host.endsWith('.linktr.ee');
    } catch (e) { return true; }
}
function isRealWebsite(url) {
    if (!url) return false;
    if (!/^https?:\/\//i.test(String(url))) return false;
    return !isBlockedWebsiteHostBg(url);
}

// --- Contact extraction (shared by the fetch path) --------------------------
var ENRICH_EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
var ENRICH_PHONE_RE = /(?:\+?1[\s.\-]?)?(?:\(\s*[2-9]\d{2}\s*\)|[2-9]\d{2})[\s.\-]?[2-9]\d{2}[\s.\-]?\d{4}/g;
var ENRICH_BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|bmp|ico|css|js|mp4|woff2?|ttf)$/i;
var ENRICH_JUNK_EMAIL = /(sentry|wixpress|\.wixpress|example\.com|@2x|@3x|godaddy|squarespace\.com|sentry\.io|core-js|polyfill)/i;

function cleanEmails(raw) {
    var out = [], seen = {};
    (raw || []).forEach(function (e) {
        if (!e) return;
        e = String(e).toLowerCase().split('?')[0].replace(/^[<(\["']+/, '').replace(/[.,;:'")\]>]+$/, '');
        if (e.indexOf('@') === -1 || e.length > 80) return;
        if (ENRICH_BAD_EMAIL.test(e) || ENRICH_JUNK_EMAIL.test(e)) return;
        if (seen[e]) return;
        seen[e] = 1; out.push(e);
    });
    return out.slice(0, 5);
}

function dedupNormalizedPhones(raw) {
    var out = [], seen = {};
    (raw || []).forEach(function (p) {
        var norm = normalizePhone(typeof p === 'string' ? p : (p && p.number));
        if (!norm || seen[norm]) return;
        seen[norm] = 1; out.push(norm);
    });
    return out.slice(0, 10);
}

// Pull emails + phones out of raw HTML (mailto:/tel: links + visible text).
function extractContactsFromHtml(html) {
    html = String(html || '');
    var emails = [], m;
    var mailtoRe = /mailto:([^"'?>\s]+)/gi;
    while ((m = mailtoRe.exec(html))) emails.push(m[1]);

    var tels = [], telRe = /tel:([+\d().\-\s]{7,})/gi;
    while ((m = telRe.exec(html))) tels.push(m[1]);

    var text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
    var textEmails = text.match(ENRICH_EMAIL_RE) || [];
    emails = emails.concat(textEmails);
    var textPhones = (tels.join(' ') + ' ' + text).match(ENRICH_PHONE_RE) || [];

    return { emails: cleanEmails(emails), phones: dedupNormalizedPhones(textPhones), siteCredit: extractSiteCreditFromHtml(html) };
}

// --- Site-builder credit ("Powered by X" / "Website by X") ------------------
// Many small-business sites carry a footer credit for whoever built the site
// (e.g. "Powered by TableTurnerr", "Website by Acme Studio"). We surface that in
// the lead note + lead.siteBuilder so reps can see who made the site.
var SITE_CREDIT_RE = /(?:powered|designed|developed|built|created|website|web\s*design|site)\s+by\b[:\s]*([^<>\n\r|·•]{2,60})/i;

// Trim a captured credit phrase down to a short builder name (or '' if it looks
// like a sentence fragment rather than a name/brand).
function cleanSiteCredit(s) {
    s = String(s || '').replace(/&amp;/g, '&').replace(/&nbsp;/gi, ' ');
    s = s.split(/[|·•\n\r]| [-–—] |\.\s|\s{2,}|©/)[0];              // stop at first delimiter/sentence break
    s = s.replace(/^["'“”\s.,;:&\-]+/, '').replace(/["'“”\s.,;:&\-]+$/, '').trim();
    if (s.length < 2 || s.length > 45) return '';
    if (s.split(/\s+/).length > 5) return '';                        // too long to be a name
    if (/\b(us|you|your|our|the team)\b/i.test(s) && s.indexOf('.') === -1) return '';
    return s;
}

function extractSiteCreditFromHtml(html) {
    if (!html) return '';
    var text = String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
    var m = text.match(SITE_CREDIT_RE);
    if (m) { var c = cleanSiteCredit(m[1]); if (c) return c; }
    return '';
}

// Append a [Site by: X] token to a lead's note (and set lead.siteBuilder). Never
// overwrites an existing note and never double-appends its own token.
function appendSiteCreditNote(lead, name) {
    if (!lead) return;
    name = cleanSiteCredit(name);
    if (!name) return;
    lead.siteBuilder = name;
    var note = (lead.note != null) ? String(lead.note) : '';
    if (/\[Site by:[^\]]*\]/i.test(note)) return;
    var token = '[Site by: ' + name + ']';
    lead.note = note ? (note + ' ' + token) : token;
}

// Heuristic: does this HTML look like a JS-rendered shell with little real text?
function looksJsRendered(html) {
    if (!html) return true;
    var text = String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ').trim();
    if (text.length < 400) return true;
    if (text.length < 1200 &&
        /<div id="root">\s*<\/div>|<div id="app">\s*<\/div>|__NEXT_DATA__|window\.__NUXT__|ng-version=/i.test(html)) {
        return true;
    }
    return false;
}

// Find a likely contact/about page URL referenced from the homepage HTML.
function findContactUrl(html, baseUrl) {
    try {
        var re = /<a\b[^>]*href=["']([^"'#\s]+)["'][^>]*>([\s\S]*?)<\/a>/gi, m, fallback = '';
        while ((m = re.exec(html))) {
            var href = m[1];
            var label = (m[2] || '').replace(/<[^>]+>/g, ' ').toLowerCase();
            var hrefLc = href.toLowerCase();
            var looksContact = /contact|kontakt/.test(hrefLc) || /contact us|contact|get in touch/.test(label);
            var looksAbout = /\babout\b|about-us|reach|connect/.test(hrefLc) || /\babout\b/.test(label);
            if (!looksContact && !looksAbout) continue;
            try {
                var abs = new URL(href, baseUrl).href;
                if (!/^https?:/i.test(abs)) continue;
                if (looksContact) return abs;     // strongest signal — use immediately
                if (!fallback) fallback = abs;
            } catch (e) {}
        }
        return fallback;
    } catch (e) { return ''; }
}

// Fetch a URL's HTML with a hard timeout. cb({ok, html, finalUrl}).
function fetchWebsiteHtml(url, timeoutMs, cb) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } }, timeoutMs || 8000);
    var opts = { redirect: 'follow', credentials: 'omit' };
    if (ctrl) opts.signal = ctrl.signal;
    var settled = false;
    function settle(v) { if (settled) return; settled = true; clearTimeout(timer); cb(v); }
    try {
        fetch(url, opts).then(function (res) {
            if (!res || !res.ok) { settle({ ok: false, status: res ? res.status : 0 }); return; }
            var ct = (res.headers.get('content-type') || '').toLowerCase();
            if (ct && ct.indexOf('html') === -1 && ct.indexOf('text/plain') === -1) {
                settle({ ok: false, nonHtml: true });
                return;
            }
            res.text().then(function (txt) {
                settle({ ok: true, html: String(txt || '').slice(0, 600000), finalUrl: res.url || url });
            }, function () { settle({ ok: false }); });
        }, function () { settle({ ok: false }); });
    } catch (e) { settle({ ok: false }); }
}

// Try to enrich a site via fetch only. cb({ok, emails, phones, jsRendered}).
function enrichViaFetch(url, cb) {
    fetchWebsiteHtml(url, 8000, function (res) {
        if (!res.ok) { cb({ ok: false, emails: [], phones: [], jsRendered: true, siteCredit: '' }); return; }
        var c = extractContactsFromHtml(res.html);
        var js = looksJsRendered(res.html);
        var credit = c.siteCredit || '';
        if (!c.emails.length) {
            var contactUrl = findContactUrl(res.html, res.finalUrl || url);
            if (contactUrl && contactUrl !== url && contactUrl !== (res.finalUrl || url)) {
                fetchWebsiteHtml(contactUrl, 8000, function (res2) {
                    if (res2.ok) {
                        var c2 = extractContactsFromHtml(res2.html);
                        c.emails = cleanEmails(c.emails.concat(c2.emails));
                        c.phones = dedupNormalizedPhones(c.phones.concat(c2.phones));
                        if (!credit) credit = c2.siteCredit || '';
                    }
                    cb({ ok: true, emails: c.emails, phones: c.phones, jsRendered: js, siteCredit: credit });
                });
                return;
            }
        }
        cb({ ok: true, emails: c.emails, phones: c.phones, jsRendered: js, siteCredit: credit });
    });
}

// Injected into the page during the tab fallback. Self-contained (no external
// refs) so chrome.scripting.executeScript can serialize it. Returns {emails, phones}.
function scanWebsiteForContacts() {
    try {
        var emails = [], seenE = {};
        function addEmail(e) {
            if (!e) return;
            e = String(e).toLowerCase().split('?')[0].replace(/^[<(\["']+/, '').replace(/[.,;:'")\]>]+$/, '');
            if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)) return;
            if (/\.(png|jpe?g|gif|svg|webp|bmp|ico|css|js)$/.test(e)) return;
            if (/sentry|wixpress|example\.com|godaddy/.test(e)) return;
            if (seenE[e]) return; seenE[e] = 1; emails.push(e);
        }
        document.querySelectorAll('a[href^="mailto:"]').forEach(function (a) {
            addEmail((a.getAttribute('href') || '').replace(/^mailto:/i, ''));
        });
        var bodyText = (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 200000);
        (bodyText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []).forEach(addEmail);
        document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
            try {
                (function walk(o) {
                    if (!o || typeof o !== 'object') return;
                    if (Array.isArray(o)) { o.forEach(walk); return; }
                    if (o.email) addEmail(String(o.email));
                    Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') walk(o[k]); });
                })(JSON.parse(s.textContent));
            } catch (e) {}
        });

        var phones = [], seenP = {};
        function normP(raw) {
            var d = String(raw || '').replace(/\D/g, '');
            if (d.length === 10) d = '1' + d;
            if (d.length !== 11 || d[0] !== '1') return null;
            return d;
        }
        function addPhone(raw) {
            var n = normP(raw); if (!n || seenP[n]) return; seenP[n] = 1;
            phones.push({ number: n, label: 'Website' });
        }
        document.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
            addPhone((a.getAttribute('href') || '').replace(/^tel:/i, ''));
        });
        var phoneRe = /(?:\+?1[\s.\-]?)?(?:\(\s*[2-9]\d{2}\s*\)|[2-9]\d{2})[\s.\-]?[2-9]\d{2}[\s.\-]?\d{4}/g;
        (bodyText.match(phoneRe) || []).forEach(addPhone);

        // Site-builder credit — prefer the footer, then fall back to full page text.
        var siteCredit = '';
        try {
            var creditRe = /(?:powered|designed|developed|built|created|website|web\s*design|site)\s+by\b[:\s]*([^\n\r|·•]{2,60})/i;
            var foot = document.querySelector('footer');
            var scope = (foot && foot.innerText) ? foot.innerText : bodyText;
            var cm = scope.match(creditRe) || bodyText.match(creditRe);
            if (cm && cm[1]) {
                var cc = cm[1].split(/[|·•\n\r]| [-–—] |\.\s|\s{2,}|©/)[0]
                    .replace(/^["'“”\s.,;:&\-]+/, '').replace(/["'“”\s.,;:&\-]+$/, '').trim();
                if (cc.length >= 2 && cc.length <= 45 && cc.split(/\s+/).length <= 5) siteCredit = cc;
            }
        } catch (e) {}

        return { emails: emails.slice(0, 5), phones: phones.slice(0, 10), siteCredit: siteCredit };
    } catch (e) {
        return { emails: [], phones: [], siteCredit: '' };
    }
}

// Fallback: open the site in an inactive tab, DOM-scan it, then close it.
function tabScrapeContacts(url, cb) {
    var finished = false, createdTabId = null, listener = null;
    function finish(result) {
        if (finished) return; finished = true;
        clearTimeout(killTimer);
        if (listener) { try { chrome.tabs.onUpdated.removeListener(listener); } catch (e) {} }
        if (createdTabId != null) { try { chrome.tabs.remove(createdTabId, function () { void chrome.runtime.lastError; }); } catch (e) {} }
        cb(result || { emails: [], phones: [] });
    }
    var killTimer = setTimeout(function () { finish(null); }, 22000);
    try {
        chrome.tabs.create({ url: url, active: false }, function (tab) {
            if (chrome.runtime.lastError || !tab) { finish(null); return; }
            createdTabId = tab.id;
            listener = function (tabId, info) {
                if (tabId !== createdTabId || info.status !== 'complete') return;
                chrome.tabs.onUpdated.removeListener(listener);
                listener = null;
                // Settle briefly so late-injected contact widgets render.
                setTimeout(function () {
                    if (finished) return;
                    chrome.scripting.executeScript({ target: { tabId: createdTabId }, func: scanWebsiteForContacts }, function (results) {
                        var out = (results && results[0] && results[0].result) || { emails: [], phones: [] };
                        finish(out);
                    });
                }, 900);
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    } catch (e) { finish(null); }
}

// Merge discovered contacts into a stored lead. Always sets websiteScraped so the
// lead is never re-queued. Returns true (we always persist the flag).
function mergeContactsIntoLead(lead, contacts) {
    if (!lead) return false;
    lead.websiteScraped = true;
    contacts = contacts || {};

    var existingEmails = Array.isArray(lead.emails) ? lead.emails.slice() : (lead.email ? [String(lead.email).toLowerCase()] : []);
    var have = {};
    existingEmails.forEach(function (e) { have[String(e).toLowerCase()] = 1; });
    (contacts.emails || []).forEach(function (e) {
        var le = String(e).toLowerCase();
        if (le && !have[le]) { have[le] = 1; existingEmails.push(le); }
    });
    if (existingEmails.length) {
        lead.emails = existingEmails;
        if (!lead.email) lead.email = existingEmails[0];
    }

    var phones = Array.isArray(lead.phones) ? lead.phones : [];
    var havePhones = {};
    phones.forEach(function (p) { havePhones[String(p && p.number || '').replace(/\D/g, '')] = 1; });
    (contacts.phones || []).forEach(function (p) {
        if (phones.length >= 10) return;
        var norm = normalizePhone(typeof p === 'string' ? p : (p && p.number));
        if (!norm || havePhones[norm]) return;
        havePhones[norm] = 1;
        phones.push({ number: norm, label: (p && p.label) || 'Website', location_name: '', location_address: '' });
    });
    if (phones.length) {
        lead.phones = phones;
        if (!lead.phone) lead.phone = phones[0].number;
    }
    // Record who built the site (footer "Powered by …") in the note column.
    if (contacts.siteCredit) appendSiteCreditNote(lead, contacts.siteCredit);
    return true;
}

// Write enrichment results back to the matching stored lead (by identity).
function applyEnrichmentToLead(identity, contacts, done) {
    withResultsLock(function (release) {
        chrome.storage.local.get(['gmes_results'], function (data) {
            var list = Array.isArray(data.gmes_results) ? data.gmes_results : [];
            var changed = false;
            for (var i = 0; i < list.length; i++) {
                if (placeIdentity(list[i]) !== identity) continue;
                changed = mergeContactsIntoLead(list[i], contacts) || changed;
                break;
            }
            if (changed) chrome.storage.local.set({ gmes_results: list }, function () { release(); if (done) done(); });
            else { release(); if (done) done(); }
        });
    });
}

// --- Enrichment queue + concurrency-limited worker --------------------------
var WEB_ENRICH = {
    queue: [],
    seen: new Set(),   // identities queued this SW lifetime (pre-persist guard)
    inFlight: 0,
    MAX: 3,
    total: 0,
    completed: 0,
    paused: false
};

function updateEnrichStatus() {
    var pending = WEB_ENRICH.queue.length + WEB_ENRICH.inFlight;
    try {
        chrome.storage.local.set({
            gmes_enrich_status: {
                pending: pending,
                active: WEB_ENRICH.inFlight,
                total: WEB_ENRICH.total,
                completed: WEB_ENRICH.completed,
                updated: Date.now()
            }
        });
    } catch (e) {}
}

function enrichOne(job, done) {
    function finalize(emails, phones, method, siteCredit) {
        recordEnrichLog(job, { emails: emails, phones: phones, method: method });
        applyEnrichmentToLead(job.identity, { emails: emails, phones: phones, siteCredit: siteCredit || '' }, done);
    }
    enrichViaFetch(job.url, function (fres) {
        var needTab = (!fres.ok) || (!fres.emails.length && fres.jsRendered);
        if (!needTab) {
            finalize(fres.emails, fres.phones, 'fetch', fres.siteCredit);
            return;
        }
        tabScrapeContacts(job.url, function (tres) {
            var emails = cleanEmails((fres.emails || []).concat((tres && tres.emails) || []));
            var phones = dedupNormalizedPhones((fres.phones || []).concat((tres && tres.phones) || []));
            var credit = (fres && fres.siteCredit) || (tres && tres.siteCredit) || '';
            finalize(emails, phones, 'tab', credit);
        });
    });
}

function pumpEnrich() {
    if (WEB_ENRICH.paused) {
        updateEnrichStatus();
        return;
    }
    while (WEB_ENRICH.inFlight < WEB_ENRICH.MAX && WEB_ENRICH.queue.length) {
        var job = WEB_ENRICH.queue.shift();
        WEB_ENRICH.inFlight++;
        enrichOne(job, function () {
            WEB_ENRICH.inFlight--;
            WEB_ENRICH.completed++;
            updateEnrichStatus();
            pumpEnrich();
        });
    }
    updateEnrichStatus();
}

// Queue leads for enrichment. Gated by the gmes_scrape_websites toggle (default
// on) unless opts.force is set (an explicit user backfill overrides the toggle).
// Skips Google/empty URLs and anything already scraped or already queued.
function enqueueItemsForEnrichment(items, opts) {
    opts = opts || {};
    if (!items || !items.length || !EXTENSION_ENABLED) return;
    chrome.storage.local.get(['gmes_scrape_websites'], function (d) {
        if (!opts.force && d.gmes_scrape_websites === false) return;
        var added = 0;
        items.forEach(function (it) {
            if (!it || it.websiteScraped) return;
            if (!isRealWebsite(it.companyUrl)) return;
            var id = placeIdentity(it);
            if (!id || WEB_ENRICH.seen.has(id)) return;
            WEB_ENRICH.seen.add(id);
            WEB_ENRICH.queue.push({ identity: id, url: it.companyUrl, title: it.title || '' });
            WEB_ENRICH.total++;
            added++;
        });
        if (added) { updateEnrichStatus(); pumpEnrich(); }
    });
}

// Sweep every stored lead that still has a real website but hasn't been scraped
// yet (covers leads added before the toggle was on, manual adds, prior sessions).
function sweepExistingForEnrichment() {
    chrome.storage.local.get(['gmes_scrape_websites', 'gmes_results'], function (d) {
        if (d.gmes_scrape_websites === false) return;
        var list = Array.isArray(d.gmes_results) ? d.gmes_results : [];
        var pending = list.filter(function (it) { return it && !it.websiteScraped && isRealWebsite(it.companyUrl); });
        if (pending.length) enqueueItemsForEnrichment(pending);
    });
}

// On-demand backfill from the results tab: scrape every lead that has a real
// website but hasn't been scraped yet, so empty email fields get populated.
// Forced (ignores the toggle) since the user explicitly asked for it.
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'BACKFILL_WEBSITE_EMAILS') return;
    if (!EXTENSION_ENABLED) { sendResponse({ queued: 0, disabled: true }); return; }
    chrome.storage.local.get(['gmes_results'], function (d) {
        var list = Array.isArray(d.gmes_results) ? d.gmes_results : [];
        var pending = list.filter(function (it) { return it && !it.websiteScraped && isRealWebsite(it.companyUrl); });
        enqueueItemsForEnrichment(pending, { force: true });
        sendResponse({ queued: pending.length });
    });
    return true; // async sendResponse
});

// Re-scrape leads that have a real website but no email yet (including those
// previously scraped with no result). Resets the scraped flag and clears the
// in-memory seen set for each affected lead so the enrichment queue accepts them.
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'RESCAN_NO_EMAIL_LEADS') return;
    if (!EXTENSION_ENABLED) { sendResponse({ queued: 0, disabled: true }); return; }
    chrome.storage.local.get(['gmes_results'], function (d) {
        var list = Array.isArray(d.gmes_results) ? d.gmes_results : [];
        var pending = list.filter(function (it) {
            return it && isRealWebsite(it.companyUrl) && !it.email;
        });
        pending.forEach(function (it) {
            it.websiteScraped = false;
            var id = placeIdentity(it);
            if (id) WEB_ENRICH.seen.delete(id);
        });
        chrome.storage.local.set({ gmes_results: list }, function () {
            enqueueItemsForEnrichment(pending, { force: true });
            sendResponse({ queued: pending.length });
        });
    });
    return true; // async sendResponse
});

// ============================================================================
// End of Website Enrichment
// ============================================================================

// ============================================================================
// Restaurant Mode — ordering-platform detection (hybrid: fetch → tab → click)
// ----------------------------------------------------------------------------
// detectOrderPlatforms(url, cb) resolves which delivery/ordering platforms a
// restaurant's website uses. Modeled on enrichViaFetch/tabScrapeContacts:
//   1. Fetch the HTML (cheap, invisible) and scan href/src/iframe/script plus the
//      final redirect URL for platform hosts. Any hit resolves immediately.
//   2. If the fetch found nothing, open the site in an inactive tab, DOM-scan for
//      platform links + order/menu buttons, and — only when no platform host is
//      present but a pure-JS order button exists — click it ONCE and watch for a
//      cross-domain navigation to a platform. The tab is always removed.
// cb({ platforms: [keys], source: 'redirect'|'embed'|'click'|'' }).
// ============================================================================

function hostOfUrl(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; }
}
function absUrl(href, base) {
    try { return new URL(href, base).href; } catch (e) { return String(href || ''); }
}

// Scan fetched HTML for platform hosts in attributes + the final (redirect) URL.
// source is 'redirect' when the final URL landed on a platform host different
// from the site's own host, otherwise 'embed'.
function scanHtmlForPlatforms(html, finalUrl, originalUrl) {
    html = String(html || '');
    var found = {}, redirected = false;
    var finalKeys = matchPlatformHosts(finalUrl);
    if (finalKeys.length) {
        var fh = hostOfUrl(finalUrl), oh = hostOfUrl(originalUrl);
        if (fh && fh !== oh) redirected = true;
        finalKeys.forEach(function (k) { found[k] = 1; });
    }
    var attrRe = /(?:href|src)\s*=\s*["']([^"']+)["']/gi, m;
    while ((m = attrRe.exec(html))) {
        matchPlatformHosts(absUrl(m[1], finalUrl || originalUrl)).forEach(function (k) { found[k] = 1; });
    }
    var platforms = Object.keys(found);
    return { platforms: platforms, source: platforms.length ? (redirected ? 'redirect' : 'embed') : '' };
}

// Injected into the site tab. Self-contained (no external refs) so executeScript
// can serialize it. platformSubs is the flat host-substring list. Returns
// { platformHostsFound: [urls], orderCandidates: [{href, isJsButton}] }.
function scanOrderLinks(platformSubs) {
    try {
        platformSubs = platformSubs || [];
        function absOf(u) { try { return new URL(u, location.href).href; } catch (e) { return ''; } }
        function hostMatches(u) {
            var h; try { h = new URL(u, location.href).hostname.toLowerCase(); } catch (e) { return false; }
            for (var i = 0; i < platformSubs.length; i++) {
                if (h === platformSubs[i] || h.indexOf(platformSubs[i]) !== -1) return true;
            }
            return false;
        }
        var hostsFound = [], seenH = {};
        function addHost(u) {
            var a = absOf(u); if (!a || !hostMatches(a) || seenH[a]) return;
            seenH[a] = 1; hostsFound.push(a);
        }
        document.querySelectorAll('a[href]').forEach(function (a) { addHost(a.getAttribute('href')); });
        document.querySelectorAll('iframe[src]').forEach(function (f) { addHost(f.getAttribute('src')); });
        document.querySelectorAll('script[src]').forEach(function (s) { addHost(s.getAttribute('src')); });

        var orderRe = /order|menu|delivery|pickup/i;
        var candidates = [], seenC = {};
        function considerEl(el) {
            if (!el) return;
            var txt = (el.textContent || '').trim();
            if (!txt || !orderRe.test(txt)) return;
            var tag = (el.tagName || '').toLowerCase();
            var rawHref = el.getAttribute ? (el.getAttribute('href') || '') : '';
            var abs = rawHref ? absOf(rawHref) : '';
            var usableHttp = /^https?:\/\//i.test(abs);
            // A button, or an anchor with no usable http href, is a JS-driven button.
            var isJsButton = (tag === 'button') || !usableHttp;
            var key = (abs || '') + '|' + txt.slice(0, 40) + '|' + tag;
            if (seenC[key]) return; seenC[key] = 1;
            candidates.push({ href: usableHttp ? abs : '', isJsButton: isJsButton });
        }
        document.querySelectorAll('a, button, [role="button"]').forEach(considerEl);

        // Site-builder credit — prefer the footer.
        var credit = '';
        try {
            var creditRe = /(?:powered|designed|developed|built|created|website|web\s*design|site)\s+by\b[:\s]*([^\n\r|·•]{2,60})/i;
            var foot = document.querySelector('footer');
            var scope = (foot && foot.innerText) ? foot.innerText : ((document.body && document.body.innerText) || '');
            var cm = scope.match(creditRe);
            if (cm && cm[1]) {
                var cc = cm[1].split(/[|·•\n\r]| [-–—] |\.\s|\s{2,}|©/)[0]
                    .replace(/^["'“”\s.,;:&\-]+/, '').replace(/["'“”\s.,;:&\-]+$/, '').trim();
                if (cc.length >= 2 && cc.length <= 45 && cc.split(/\s+/).length <= 5) credit = cc;
            }
        } catch (e) {}

        return { platformHostsFound: hostsFound.slice(0, 50), orderCandidates: candidates.slice(0, 40), credit: credit };
    } catch (e) {
        return { platformHostsFound: [], orderCandidates: [], credit: '' };
    }
}

// Injected to fire the ONE hybrid click: re-find the first order-ish pure-JS
// button/anchor and click it. Self-contained. Returns true if it clicked.
function clickOrderButton() {
    try {
        var orderRe = /order|menu|delivery|pickup/i;
        var els = document.querySelectorAll('a, button, [role="button"]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var txt = (el.textContent || '').trim();
            if (!txt || !orderRe.test(txt)) continue;
            var tag = (el.tagName || '').toLowerCase();
            var href = el.getAttribute ? (el.getAttribute('href') || '') : '';
            var usableHttp = /^https?:\/\//i.test(href);
            if (!((tag === 'button') || !usableHttp)) continue;   // only pure-JS buttons
            try { el.click(); return true; } catch (e) {}
        }
        return false;
    } catch (e) { return false; }
}

// Tab-pass fallback for detectOrderPlatforms. Mirrors tabScrapeContacts: opens an
// inactive tab with a finish() guard + killTimer, and ALWAYS removes the tab.
function detectOrderPlatformsViaTab(url, cb) {
    var finished = false, createdTabId = null, loadListener = null, navListener = null;
    var originalHost = hostOfUrl(url);
    var platformSubs = allPlatformSubstrings();
    var scanCredit = '';   // site-builder credit picked up from the DOM scan
    function finish(result) {
        if (finished) return; finished = true;
        clearTimeout(killTimer);
        if (loadListener) { try { chrome.tabs.onUpdated.removeListener(loadListener); } catch (e) {} }
        if (navListener) { try { chrome.tabs.onUpdated.removeListener(navListener); } catch (e) {} }
        if (createdTabId != null) { try { chrome.tabs.remove(createdTabId, function () { void chrome.runtime.lastError; }); } catch (e) {} }
        var out = result || { platforms: [], source: '' };
        if (!out.credit && scanCredit) out.credit = scanCredit;
        cb(out);
    }
    var killTimer = setTimeout(function () { finish(null); }, 30000);

    function handleScan(out) {
        out = out || { platformHostsFound: [], orderCandidates: [] };
        if (out.credit) scanCredit = out.credit;
        var hostsFound = out.platformHostsFound || [];
        var candidates = out.orderCandidates || [];
        var union = {}, hasPlatformOrderLink = false;
        hostsFound.forEach(function (u) { matchPlatformHosts(u).forEach(function (k) { union[k] = 1; }); });
        candidates.forEach(function (c) {
            if (!c || !c.href) return;
            var ks = matchPlatformHosts(c.href);
            if (ks.length) { hasPlatformOrderLink = true; ks.forEach(function (k) { union[k] = 1; }); }
        });
        var keys = Object.keys(union);
        if (keys.length) {
            // An order button pointing straight at a platform is a redirect; a bare
            // embedded link/iframe/script is an embed.
            finish({ platforms: keys, source: hasPlatformOrderLink ? 'redirect' : 'embed' });
            return;
        }
        // Hybrid click: only when NO platform host is present anywhere AND a pure-JS
        // order button exists (the link is built/opened by JS on click).
        var hasJsButton = candidates.some(function (c) { return c && c.isJsButton; });
        if (hostsFound.length === 0 && hasJsButton) { doHybridClick(); return; }
        finish({ platforms: [], source: '' });
    }

    function doHybridClick() {
        // Watch for a cross-domain navigation triggered by the single click.
        navListener = function (tabId, info, tab) {
            if (tabId !== createdTabId) return;
            var u = (tab && tab.url) || info.url || '';
            var h = hostOfUrl(u);
            if (!h || h === originalHost) return;   // still on the restaurant's own site
            var keys = matchPlatformHosts(u);
            if (keys.length) finish({ platforms: keys, source: 'click' });
        };
        chrome.tabs.onUpdated.addListener(navListener);
        chrome.scripting.executeScript({ target: { tabId: createdTabId }, func: clickOrderButton }, function () {
            void chrome.runtime.lastError;
        });
        // Bound the click wait to ~8s; give up (no platform) if no cross-domain nav.
        setTimeout(function () { if (!finished) finish({ platforms: [], source: '' }); }, 8000);
    }

    try {
        chrome.tabs.create({ url: url, active: false }, function (tab) {
            if (chrome.runtime.lastError || !tab) { finish(null); return; }
            createdTabId = tab.id;
            loadListener = function (tabId, info) {
                if (tabId !== createdTabId || info.status !== 'complete') return;
                chrome.tabs.onUpdated.removeListener(loadListener); loadListener = null;
                // Settle briefly so late-injected order widgets render.
                setTimeout(function () {
                    if (finished) return;
                    chrome.scripting.executeScript({ target: { tabId: createdTabId }, func: scanOrderLinks, args: [platformSubs] }, function (results) {
                        handleScan(results && results[0] && results[0].result);
                    });
                }, 900);
            };
            chrome.tabs.onUpdated.addListener(loadListener);
        });
    } catch (e) { finish(null); }
}

// Hybrid entry point: fetch pass first, tab pass only if the fetch found nothing.
function detectOrderPlatforms(url, cb) {
    if (!url) { cb({ platforms: [], source: '', credit: '' }); return; }
    fetchWebsiteHtml(url, 8000, function (res) {
        var credit = (res && res.ok) ? extractSiteCreditFromHtml(res.html) : '';
        if (res && res.ok) {
            var scan = scanHtmlForPlatforms(res.html, res.finalUrl || url, url);
            if (scan.platforms.length) { cb({ platforms: scan.platforms, source: scan.source, credit: credit }); return; }
        }
        // No platform from the fetch pass: fall through to the tab pass, but keep the
        // fetch-derived credit as a fallback if the DOM scan doesn't find one.
        detectOrderPlatformsViaTab(url, function (r) {
            r = r || { platforms: [], source: '' };
            if (!r.credit) r.credit = credit;
            cb(r);
        });
    });
}

// --- Delivery-detection queue (parallel to the contact-enrichment queue) -----
// TRADEOFF: this runs as a SEPARATE pass from the contact-scan enrichment queue
// rather than sharing one tab visit. Both are fetch-first, so the common case
// opens no tab for either; a tab only opens on each one's fallback. Cleanly
// folding order-link scanning into scanWebsiteForContacts (and threading the
// click/redirect follow-up back through tabScrapeContacts) was judged too
// invasive for the shared enrichment path, so they stay independent. This queue
// is gated ONLY by restaurant mode (NOT the gmes_scrape_websites toggle), since
// delivery detection is its own feature.
var DELIVERY_DETECT = {
    queue: [],
    seen: new Set(),   // identities queued this SW lifetime (pre-persist guard)
    inFlight: 0,
    MAX: 2,
    paused: false
};

function enqueueItemsForDelivery(items, cfg) {
    if (!items || !items.length || !EXTENSION_ENABLED) return;
    items.forEach(function (it) {
        // Only real-website leads that aren't already resolved reach the detector;
        // maps-direct + no-site leads were qualified at merge time.
        if (!it || it.deliveryChecked) return;
        if (!isRealWebsite(it.companyUrl)) return;
        var id = placeIdentity(it);
        if (!id || DELIVERY_DETECT.seen.has(id)) return;
        DELIVERY_DETECT.seen.add(id);
        DELIVERY_DETECT.queue.push({ identity: id, url: it.companyUrl, cfg: cfg, item: it });
    });
    pumpDelivery();
}

function detectDeliveryOne(job, done) {
    detectOrderPlatforms(job.url, function (res) {
        applyDeliveryResultToLead(job.identity, (res && res.platforms) || [], (res && res.source) || '', job.cfg, (res && res.credit) || '', job.item || null, done);
    });
}

function pumpDelivery() {
    if (DELIVERY_DETECT.paused) return;
    while (DELIVERY_DETECT.inFlight < DELIVERY_DETECT.MAX && DELIVERY_DETECT.queue.length) {
        var job = DELIVERY_DETECT.queue.shift();
        DELIVERY_DETECT.inFlight++;
        detectDeliveryOne(job, function () {
            DELIVERY_DETECT.inFlight--;
            pumpDelivery();
        });
    }
}

// Write a detection result back to the matching stored lead (by identity), then
// keep or prune it per the qualification rule. Skip-mode pruning splices the lead
// out of gmes_results under the shared write lock so it can't race a scrape merge.
function applyDeliveryResultToLead(identity, platforms, source, cfg, credit, pendingItem, done) {
    withResultsLock(function (release) {
        chrome.storage.local.get(['gmes_results'], function (data) {
            var list = Array.isArray(data.gmes_results) ? data.gmes_results : [];
            var changed = false;
            var found = false;
            var addedItem = null;
            for (var i = 0; i < list.length; i++) {
                if (placeIdentity(list[i]) !== identity) continue;
                found = true;
                var keep = applyDeliveryToLead(list[i], platforms, source, cfg);
                if (!keep) {
                    debugLog('lead.rejected', { source: 'delivery', title: list[i] && list[i].title, identity: identity, reason: 'restaurant mode delivery filter rejected stored lead', detectedPlatforms: platforms, deliverySource: source, rules: describeDeliveryRules(cfg) });
                    list.splice(i, 1);
                } else {
                    if (credit) appendSiteCreditNote(list[i], credit);
                    debugLog('lead.accepted.delivery', { source: 'delivery', title: list[i] && list[i].title, identity: identity, detectedPlatforms: platforms, deliverySource: source, rules: describeDeliveryRules(cfg) });
                }
                changed = true;
                break;
            }
            if (!found && pendingItem) {
                var keepPending = applyDeliveryToLead(pendingItem, platforms, source, cfg);
                if (keepPending) {
                    if (credit) appendSiteCreditNote(pendingItem, credit);
                    list.push(pendingItem);
                    addedItem = pendingItem;
                    changed = true;
                    debugLog('lead.accepted', { source: 'delivery', title: pendingItem && pendingItem.title, identity: identity, reason: 'restaurant mode delivery rules matched', detectedPlatforms: platforms, deliverySource: source, rules: describeDeliveryRules(cfg) });
                } else {
                    debugLog('lead.rejected', { source: 'delivery', title: pendingItem && pendingItem.title, identity: identity, reason: 'restaurant mode delivery rules did not match', detectedPlatforms: platforms, deliverySource: source, rules: describeDeliveryRules(cfg) });
                }
            }
            if (changed) {
                chrome.storage.local.set({ gmes_results: list }, function () {
                    release();
                    if (addedItem) enqueueItemsForEnrichment([addedItem]);
                    if (done) done();
                });
            } else {
                release();
                if (done) done();
            }
        });
    });
}

// Sweep the stored backlog when Restaurant Mode starts: resolve maps-direct +
// no-website leads synchronously (under the write lock) and enqueue real-website
// leads for async detection. Only touches leads not yet deliveryChecked.
function sweepExistingForDelivery() {
    getRestaurantConfig(function (cfg) {
        if (!cfg.restaurantMode) return;
        withResultsLock(function (release) {
            chrome.storage.local.get(['gmes_results'], function (d) {
                var list = Array.isArray(d.gmes_results) ? d.gmes_results : [];
                var kept = [], deferred = [], changed = false;
                for (var i = 0; i < list.length; i++) {
                    var it = list[i];
                    if (!it || it.deliveryChecked) { if (it) kept.push(it); continue; }
                    var directKeys = matchPlatformHosts(it.companyUrl);
                    if (directKeys.length) {
                        if (applyDeliveryToLead(it, directKeys, 'maps-direct', cfg)) kept.push(it);
                        changed = true;
                    } else if (!isRealWebsite(it.companyUrl)) {
                        if (applyDeliveryToLead(it, [], '', cfg)) kept.push(it);
                        changed = true;
                    } else {
                        kept.push(it);
                        deferred.push(it);
                    }
                }
                function after() {
                    release();
                    if (deferred.length) enqueueItemsForDelivery(deferred, cfg);
                }
                if (changed) chrome.storage.local.set({ gmes_results: kept }, after);
                else after();
            });
        });
    });
}

// ============================================================================
// End of Restaurant Mode detection
// ============================================================================

chrome.commands.onCommand.addListener(function (command) {
    if (!EXTENSION_ENABLED) {
        // Cheap visual feedback: flash a red OFF badge so the user knows the
        // shortcut fired but the extension is paused.
        if (chrome.action && chrome.action.setBadgeText) {
            chrome.action.setBadgeText({ text: 'OFF' });
            chrome.action.setBadgeBackgroundColor({ color: '#ea4335' });
            setTimeout(updateToolbarBadge, 1200);
        }
        return;
    }
    if (command === 'scrape') {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var tab = tabs && tabs[0];
            if (!tab) return;
            var tabUrl = tab.url || '';
            if (tabUrl.startsWith('chrome://') || tabUrl.startsWith('edge://') || tabUrl.startsWith('about:')) return;

            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: scrapeData
            }, function (results) {
                if (!results || !results[0] || !results[0].result) return;
                var newItems = results[0].result;

                mergeScrapedItems(newItems, 'shortcut');
            });
        });
    } else if (command === 'manual_add_to_list') {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                var u = tabs[0].url || '';
                if (u.startsWith('chrome://') || u.startsWith('edge://') || u.startsWith('about:')) return;
                chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_MANUAL_ADD' }, function () {
                    if (chrome.runtime.lastError) { /* receiver not ready — ignore */ }
                });
            }
        });
    } else if (command === 'open_website') {
        console.log('GMES: Command open_website received');
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var tab = tabs && tabs[0];
            if (!tab) {
                 console.warn('GMES: No active tab found');
                 return;
            }
            var tabUrl = tab.url || '';
            if (tabUrl.startsWith('chrome://') || tabUrl.startsWith('edge://') || tabUrl.startsWith('about:')) {
                console.warn('GMES: Cannot interact with restricted URL:', tabUrl);
                return;
            }

            function sendMessageToTab() {
                chrome.tabs.sendMessage(tab.id, { type: 'GET_CURRENT_WEBSITE' }, function(response) {
                    if (chrome.runtime.lastError) {
                        console.error('Error getting website URL:', chrome.runtime.lastError);
                        // If we failed, maybe try to inject the script?
                        if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes('receiving end does not exist')) {
                             console.log('GMES: Content script not found, injecting...');
                             chrome.scripting.executeScript({
                                 target: { tabId: tab.id },
                                 files: ['manual_mode_maps.js']
                             }, function() {
                                 if (chrome.runtime.lastError) {
                                     console.error('GMES: Failed to inject script:', chrome.runtime.lastError);
                                 } else {
                                     // Retry sending message after short delay
                                     setTimeout(sendMessageToTab, 500);
                                 }
                             });
                        }
                        return;
                    }
                    if (response && response.url) {
                        console.log('Opening website:', response.url);
                        chrome.tabs.create({ url: response.url });
                    } else {
                        console.warn('No URL returned from content script', response);
                    }
                });
            }
            
            sendMessageToTab();
        });
    }
});

// Handle opening shortcuts settings + CRM login poll start
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (msg.type === 'OPEN_SHORTCUTS_SETTINGS') {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    }
    if (msg.type === 'OPEN_RESULTS') {
        chrome.tabs.create({ url: 'results_tab.html' });
    }
    if (msg.type === 'OPEN_POPUP_TAB') {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1') });
    }
    if (msg.type === 'DEBUG_LOG') {
        debugLog(msg.event, msg.details || {});
        sendResponse({ ok: true });
    }
    if (msg.type === 'START_CRM_LOGIN_POLL') {
        // Poll every 30 seconds (minimum allowed by Chrome is ~0.5 min = 30s)
        chrome.storage.local.set({ gmes_ghl_wait_started: Date.now() });
        chrome.alarms.create(GHL_POLL_ALARM, { periodInMinutes: 0.5 });
    }
    if (msg.type === 'STOP_CRM_LOGIN_POLL') {
        chrome.alarms.clear(GHL_POLL_ALARM);
        chrome.storage.local.set({ gmes_ghl_waiting: false });
    }
    if (msg.type === 'OPEN_CRM_LOGIN') {
        // Open (or focus) the connect page that runs the GHL OAuth flow.
        chrome.tabs.query({ url: TT_APP_URL + '/*' }, function (tabs) {
            if (tabs && tabs.length > 0) {
                chrome.tabs.update(tabs[0].id, { url: TT_CONNECT_URL, active: true });
                chrome.storage.local.set({ gmes_ghl_waiting: true, gmes_ghl_connect_tab: tabs[0].id, gmes_ghl_wait_started: Date.now() });
                chrome.alarms.create(GHL_POLL_ALARM, { periodInMinutes: 0.5 });
            } else {
                chrome.tabs.create({ url: TT_CONNECT_URL }, function (tab) {
                    var set = { gmes_ghl_waiting: true, gmes_ghl_wait_started: Date.now() };
                    if (tab && tab.id != null) set.gmes_ghl_connect_tab = tab.id;
                    chrome.storage.local.set(set);
                    chrome.alarms.create(GHL_POLL_ALARM, { periodInMinutes: 0.5 });
                });
            }
        });
    }
});

// GHL proxy for content scripts (manual-mode overlays). Content scripts can read
// chrome.storage but their fetches are subject to page-origin CORS, so they route
// every GoHighLevel call through the worker, which uses the shared `GHL` client.
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type || msg.type.indexOf('GHL_') !== 0) return;
    switch (msg.type) {
        case 'GHL_IS_CONNECTED':
            GHL.isConnected(function (connected) { sendResponse({ connected: connected }); });
            return true;
        case 'GHL_STATUS':
            GHL.status(function (s) { sendResponse(s || { connected: false }); });
            return true;
        case 'GHL_FETCH_LOCATIONS':
            GHL.fetchLocations(Boolean(msg.force), function (items) { sendResponse({ items: items || [] }); });
            return true;
        case 'GHL_FETCH_USERS':
            GHL.fetchUsers(msg.locationId, Boolean(msg.force), function (items) { sendResponse({ items: items || [] }); });
            return true;
        case 'GHL_FETCH_TAGS':
            GHL.fetchTags(msg.locationId, Boolean(msg.force), function (items) { sendResponse({ items: items || [] }); });
            return true;
        case 'GHL_FETCH_PIPELINES':
            GHL.fetchPipelines(msg.locationId, Boolean(msg.force), function (items) { sendResponse({ items: items || [] }); });
            return true;
        case 'GHL_CHECK_DUPLICATE':
            GHL.checkDuplicate(msg.locationId, msg.phones, msg.email, function (res) { sendResponse(res || { exists: false }); });
            return true;
        case 'GHL_SEND_LEAD':
            var us = validateUnitedStatesLead(msg.item || {});
            if (!us.ok) {
                debugLog('ghl.send.rejected', { title: msg.item && msg.item.title, reason: us.reason, evidence: us.evidence });
                sendResponse({ success: false, error: 'Lead rejected: only United States leads can be sent. ' + us.reason });
                return true;
            }
            debugLog('ghl.send.start', { title: msg.item && msg.item.title, locationId: msg.locationId, usEvidence: us.evidence });
            GHL.sendLead(msg.locationId, msg.item, msg.opts || {}, function (res) {
                debugLog(res && res.success ? 'ghl.send.success' : 'ghl.send.failed', {
                    title: msg.item && msg.item.title,
                    locationId: msg.locationId,
                    status: res && res.status,
                    duplicate: Boolean(res && res.duplicate),
                    error: res && res.error
                });
                sendResponse(res || { success: false, error: 'No response' });
            });
            return true;
        default:
            return;
    }
});

// Handle MANUAL_ADD_ITEM messages from content scripts
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'MANUAL_ADD_ITEM' || !msg.item) return;
    if (!EXTENSION_ENABLED) {
        sendResponse({ success: false, error: 'Extension is paused. Toggle it back on from the popup.' });
        return;
    }

    handleManualAddItem(msg.item).then(function (result) {
        sendResponse(result || { success: true });
    }).catch(function (err) {
        console.error('Error adding manual item:', err);
        sendResponse({ success: false, error: err.message });
    });

    // Return true to indicate async response
    return true;
});

// Handle CHECK_SHOULD_SHOW_OVERLAY messages for manual mode
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'CHECK_SHOULD_SHOW_OVERLAY') return;
    if (!EXTENSION_ENABLED) {
        sendResponse({ shouldShow: false });
        return;
    }

    chrome.storage.local.get(['gmes_mode', 'gmes_overlay_dismissed', 'gmes_manual_auto_popup', 'gmes_exception_sites'], function (data) {
        var isManualMode = data.gmes_mode === 'manual';
        var isDismissed = data.gmes_overlay_dismissed === true;
        var autoPopup = data.gmes_manual_auto_popup !== false; // default true
        var exceptions = Array.isArray(data.gmes_exception_sites) ? data.gmes_exception_sites : [];

        // Check if the sender's hostname is in the exceptions list
        var senderHostname = '';
        try {
            if (sender && sender.tab && sender.tab.url) {
                senderHostname = new URL(sender.tab.url).hostname;
            }
        } catch (e) {}
        var isException = senderHostname && exceptions.indexOf(senderHostname) !== -1;

        sendResponse({ shouldShow: isManualMode && !isDismissed && autoPopup && !isException });
    });

    // Return true to indicate async response
    return true;
});

// Handle ADD_EXCEPTION_SITE messages from content scripts
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'ADD_EXCEPTION_SITE') return;
    var hostname = msg.hostname || '';
    if (!hostname) { sendResponse({ success: false }); return; }
    chrome.storage.local.get(['gmes_exception_sites'], function (data) {
        var sites = Array.isArray(data.gmes_exception_sites) ? data.gmes_exception_sites : [];
        if (sites.indexOf(hostname) === -1) sites.push(hostname);
        chrome.storage.local.set({ gmes_exception_sites: sites }, function () {
            sendResponse({ success: true });
        });
    });
    return true;
});

function handleManualAddItem(item) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries'], function (result) {
            var existingItems = Array.isArray(result.gmes_results) ? result.gmes_results : [];
            var ignoreNames = Array.isArray(result.gmes_ignore_names) ? result.gmes_ignore_names : [];
            var ignoreIndustries = Array.isArray(result.gmes_ignore_industries) ? result.gmes_ignore_industries : [];

            var key = item.href || (item.title + '|' + item.address);
            var seen = new Set(existingItems.map(function (i) { return i.href || (i.title + '|' + i.address); }));

            if (seen.has(key)) {
                console.log('Duplicate item, skipping:', item.title);
                debugLog('lead.duplicate', { source: 'manual', title: item && item.title, identity: key });
                resolve({ success: true, duplicate: true });
                return;
            }

            var us = validateUnitedStatesLead(item);
            if (!us.ok) {
                debugLog('lead.rejected', { source: 'manual', title: item && item.title, identity: key, reason: us.reason, evidence: us.evidence });
                resolve({ success: false, error: 'Lead rejected: only United States leads can be saved. ' + us.reason });
                return;
            }

            var ignoreNamesSet = new Set(ignoreNames.map(function (s) { return String(s).toLowerCase().trim(); }));
            var ignoreIndustriesSet = new Set(ignoreIndustries.map(function (s) { return String(s).toLowerCase().trim(); }));

            if (chainNameMatchesIgnoreList(item.title, ignoreNamesSet)) {
                console.log('Item ignored by name filter:', item.title);
                debugLog('lead.rejected', { source: 'manual', title: item && item.title, identity: key, reason: 'name matched blocklist' });
                resolve({ success: false, error: 'Lead rejected by name blocklist.' });
                return;
            }

            if (industryMatchesIgnoreList(item.industry, ignoreIndustriesSet)) {
                console.log('Item ignored by industry filter:', item.industry);
                debugLog('lead.rejected', { source: 'manual', title: item && item.title, identity: key, reason: 'industry matched blocklist', industry: item && item.industry });
                resolve({ success: false, error: 'Lead rejected by industry blocklist.' });
                return;
            }

            existingItems.push(item);
            debugLog('lead.accepted', { source: 'manual', title: item && item.title, identity: key, reason: us.reason });
            chrome.storage.local.set({ gmes_results: existingItems }, function () { resolve({ success: true }); });
        });
    });
}

// ============================================================================
// Auto-Popup: inject overlays automatically when Manual Mode + Auto-Popup is on
// ============================================================================
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete') return;
    var url = tab.url || '';
    // Skip non-http pages (chrome://, extensions, about:, etc.)
    if (!url || !url.startsWith('http')) return;

    chrome.storage.local.get(['gmes_mode', 'gmes_manual_auto_popup', 'gmes_exception_sites'], function (data) {
        if (data.gmes_mode !== 'manual') return;
        if (data.gmes_manual_auto_popup === false) return;

        // Check exceptions list
        var exceptions = Array.isArray(data.gmes_exception_sites) ? data.gmes_exception_sites : [];
        var hostname = '';
        try { hostname = new URL(url).hostname; } catch (e) {}
        if (hostname && exceptions.indexOf(hostname) !== -1) return;

        // Maps pages are already injected via manifest; reset dismissed flag and
        // notify the content script in case it already ran its startup check
        if (url.indexOf('google.com/maps') !== -1) {
            chrome.storage.local.set({ gmes_overlay_dismissed: false }, function () {
                chrome.tabs.sendMessage(tabId, { type: 'SHOW_OVERLAY' }, function () {
                    // Ignore "receiving end does not exist" — script may not be ready yet
                    if (chrome.runtime.lastError) { /* ignore */ }
                });
            });
            return;
        }

        // For all other websites, inject the website scanner overlay
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['manual_mode_website.js']
        }, function () {
            if (chrome.runtime.lastError) {
                // Some pages (Web Store, etc.) block injection — ignore silently
            }
        });
    });
});
// ============================================================================
// End of Auto-Popup
// ============================================================================

// ============================================================================
// GHL → Zoom Phone enhancer injection (white-label / custom domains)
// ----------------------------------------------------------------------------
// Known GoHighLevel hosts are covered by the static content_scripts entry in
// the manifest. White-label and custom GHL domains can't be enumerated there,
// so we inject ghl_enhancements.js on other pages too; the script fingerprints
// the page and bails immediately if it isn't GoHighLevel. This is intentionally
// independent of the master power switch (the GHL features run whenever you're
// on a GHL page, even with scraping turned off).
// ============================================================================

// Hosts already handled by the manifest content script — skip to avoid a
// redundant injection (the in-page __GMES_GHL_ENH__ guard also dedupes).
function isKnownGhlHost(hostname) {
    if (!hostname) return false;
    return hostname === 'app.gohighlevel.com'
        || hostname === 'ghl.tableturnerr.com'
        || /\.gohighlevel\.com$/.test(hostname)
        || /\.leadconnectorhq\.com$/.test(hostname);
}

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete') return;
    var url = tab.url || '';
    if (!url || url.indexOf('http') !== 0) return;

    var hostname = '';
    try { hostname = new URL(url).hostname; } catch (e) { return; }
    if (isKnownGhlHost(hostname)) return; // manifest already injects here

    chrome.storage.local.get(['gmes_zoom_enabled'], function (data) {
        // Inject only when the Zoom dialer feature could be active.
        var zoomOn = data.gmes_zoom_enabled !== false; // default ON
        if (!zoomOn) return;

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['ghl_enhancements.js']
        }, function () {
            // Some pages block injection; the script also self-bails on non-GHL
            // pages. Ignore errors either way.
            void chrome.runtime.lastError;
        });
    });
});

// ============================================================================
// Zoom web-phone recording bridge → CRM Agent (Native Messaging)  (Workstream F)
// ----------------------------------------------------------------------------
// The Zoom call detector content script (zoom_call_detect.js) emits:
//   {type:'ZOOM_CALL_STARTED', phoneE164, counterpartyName, connectTsMs}
//   {type:'ZOOM_CALL_ENDED', endTsMs}
// We relay these to the local "CRM Agent" desktop app over Chrome Native
// Messaging (host name com.tableturnerr.crm_agent), using the frozen START/STOP
// shapes from the architecture plan §4. The native host manifest installed by
// the agent must list this extension's ID in allowed_origins (see
// ZOOM_RECORDING_NOTES.md). The agent is authoritative for repUserId on upload,
// so the value we send is a routing/label hint.
//
// Defensive: the agent may not be installed/running. connectNative throws/errors
// asynchronously via the port's onDisconnect; we swallow it so a missing agent
// never breaks the extension. One native port is held for the duration of a call
// and torn down shortly after STOP.
// ============================================================================

var CRM_AGENT_HOST = 'com.tableturnerr.crm_agent';

// Per-call native bridge state. Only one web call is expected at a time per
// browser profile, so a single active port keyed by callId is sufficient.
var ZOOM_BRIDGE = {
    port: null,
    callId: null,
    disconnectTimer: null
};

// Best-effort rep identity. Priority:
//   1. the rep's real GoHighLevel user id (gmes_ghl_user_id), resolved from the
//      compulsory GHL login — this is what the agent stamps calls with (repKey),
//      so GHL attributes the call log to the right user
//   2. explicit override gmes_zoom_rep_user_id
//   3. the connected CRM email (gmes_ghl_email), a stable per-rep label
//   4. a persisted random fallback id so callIds stay consistent on this machine
function resolveRepUserId(cb) {
    chrome.storage.local.get(['gmes_ghl_user_id', 'gmes_zoom_rep_user_id', 'gmes_ghl_email', 'gmes_rep_fallback_id'], function (d) {
        var ghlUserId = (d.gmes_ghl_user_id || '').toString().trim();
        if (ghlUserId) { cb(ghlUserId); return; }
        var explicit = (d.gmes_zoom_rep_user_id || '').toString().trim();
        if (explicit) { cb(explicit); return; }
        var email = (d.gmes_ghl_email || '').toString().trim();
        if (email && email.toLowerCase() !== 'connected') { cb(email); return; }
        if (d.gmes_rep_fallback_id) { cb(d.gmes_rep_fallback_id); return; }
        var fallback = 'rep_' + Math.random().toString(36).slice(2, 10);
        chrome.storage.local.set({ gmes_rep_fallback_id: fallback }, function () { cb(fallback); });
    });
}

// Push the rep's resolved GHL user id to the local agent so it attributes both
// web AND desktop recordings without any per-machine setup. Uses a short-lived
// native port separate from the call bridge so it never disturbs a live call.
function pushIdentityToAgent(repUserId) {
    if (!repUserId) return;
    try {
        var port = chrome.runtime.connectNative(CRM_AGENT_HOST);
        port.onDisconnect.addListener(function () {
            var err = chrome.runtime.lastError; // host not installed / closed pipe
            if (err) console.debug('[GMES][Zoom] identity port closed:', err.message);
        });
        port.onMessage.addListener(function () { /* ack — nothing required */ });
        port.postMessage({ type: 'IDENTITY', repUserId: repUserId });
        // Close shortly after so we don't hold the port open outside a call.
        setTimeout(function () { try { port.disconnect(); } catch (e) {} }, 1500);
    } catch (e) {
        console.debug('[GMES][Zoom] identity push failed:', e && e.message);
    }
}

// Resolve the rep's GHL user id from the CRM session and hand it to the agent.
// Called on service-worker startup and after a GHL login completes so the agent
// always knows who is on this machine.
function syncRepIdentity() {
    try {
        GHL.status(function (st) {
            if (st && st.connected && st.ghlUserId) {
                chrome.storage.local.set({ gmes_ghl_user_id: st.ghlUserId });
                pushIdentityToAgent(st.ghlUserId);
            }
        });
    } catch (e) {
        console.debug('[GMES][Zoom] syncRepIdentity failed:', e && e.message);
    }
}

// Tear down the native port after a call ends. `forCallId` is the callId that was
// active when teardown was scheduled; if a fast back-to-back call has since taken
// over ZOOM_BRIDGE.callId, this teardown is stale and must NOT run (it would kill
// the in-flight call's bridge). Called with no arg => unconditional teardown.
function teardownZoomBridge(forCallId) {
    if (forCallId != null && ZOOM_BRIDGE.callId !== forCallId) {
        // A newer call owns the bridge now; leave it alone.
        return;
    }
    if (ZOOM_BRIDGE.disconnectTimer) { clearTimeout(ZOOM_BRIDGE.disconnectTimer); ZOOM_BRIDGE.disconnectTimer = null; }
    if (ZOOM_BRIDGE.port) {
        try { ZOOM_BRIDGE.port.disconnect(); } catch (e) {}
    }
    ZOOM_BRIDGE.port = null;
    ZOOM_BRIDGE.callId = null;
}

// Open (or reuse) the native port to the CRM Agent and post a message.
function sendToAgent(message, onFail) {
    try {
        if (!ZOOM_BRIDGE.port) {
            ZOOM_BRIDGE.port = chrome.runtime.connectNative(CRM_AGENT_HOST);
            ZOOM_BRIDGE.port.onDisconnect.addListener(function () {
                // Host not installed, crashed, or closed the pipe. lastError carries
                // the reason (e.g. "Specified native messaging host not found.").
                var err = chrome.runtime.lastError;
                if (err) console.debug('[GMES][Zoom] CRM Agent native port closed:', err.message);
                ZOOM_BRIDGE.port = null;
                ZOOM_BRIDGE.callId = null;
                if (ZOOM_BRIDGE.disconnectTimer) { clearTimeout(ZOOM_BRIDGE.disconnectTimer); ZOOM_BRIDGE.disconnectTimer = null; }
            });
            ZOOM_BRIDGE.port.onMessage.addListener(function (msg) {
                // The agent may ack or PING; nothing required here yet.
                console.debug('[GMES][Zoom] CRM Agent →', msg);
            });
        }
        ZOOM_BRIDGE.port.postMessage(message);
    } catch (e) {
        console.debug('[GMES][Zoom] connectNative failed:', e && e.message);
        ZOOM_BRIDGE.port = null;
        if (onFail) onFail(e);
    }
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;

    if (msg.type === 'ZOOM_CALL_STARTED') {
        // Back-to-back calls: a previous STOP may have scheduled teardownZoomBridge
        // ~2s out. Cancel it immediately so call 2's bridge isn't torn down mid-call.
        if (ZOOM_BRIDGE.disconnectTimer) { clearTimeout(ZOOM_BRIDGE.disconnectTimer); ZOOM_BRIDGE.disconnectTimer = null; }
        // Honor the feature toggle (default ON). Gate here as a backstop even
        // though the content script also checks it.
        chrome.storage.local.get(['gmes_zoom_record_calls'], function (d) {
            if (d.gmes_zoom_record_calls === false) return;
            resolveRepUserId(function (repUserId) {
                var connectTsMs = Number(msg.connectTsMs) || Date.now();
                // callId = "web:" + repUserId + ":" + connectTsMs  (plan §4).
                var callId = 'web:' + repUserId + ':' + connectTsMs;
                ZOOM_BRIDGE.callId = callId;
                // Identifier-only contract: the extension forwards a unique call id,
                // the channel, and (when known) the phone number. It does NOT send
                // call direction or enrichment (e.g. counterparty name) — the cloud
                // bridge owns direction detection and contact matching. repUserId is
                // kept because it is a component of callId and a routing label the
                // agent already overrides on upload.
                var start = {
                    type: 'START',
                    callId: callId,
                    repUserId: repUserId,
                    channel: 'web',
                    phoneE164: (msg.phoneE164 != null ? msg.phoneE164 : null),
                    connectTsMs: connectTsMs
                };
                sendToAgent(start);
            });
        });
        return; // no async response needed
    }

    if (msg.type === 'ZOOM_CALL_ENDED') {
        var endTsMs = Number(msg.endTsMs) || Date.now();
        var callId = ZOOM_BRIDGE.callId;
        if (!callId) return; // no active call we started — nothing to stop
        sendToAgent({ type: 'STOP', callId: callId, endTsMs: endTsMs });
        // Keep the port briefly so the STOP is delivered, then tear down — but only
        // if THIS call still owns the bridge. If call 2's START arrives in the next
        // 2s it clears this timer (and the guard below ignores a stale fire anyway).
        if (ZOOM_BRIDGE.disconnectTimer) clearTimeout(ZOOM_BRIDGE.disconnectTimer);
        ZOOM_BRIDGE.disconnectTimer = setTimeout(function () {
            ZOOM_BRIDGE.disconnectTimer = null;
            teardownZoomBridge(callId);
        }, 2000);
        return;
    }
});

// Resolve the rep's GHL user id and hand it to the agent on browser start and on
// install/update — NOT on every service-worker wake (MV3 respawns the worker
// constantly, which would spam status fetches and agent launches). This covers
// desktop-only reps who never trigger a web-call START; their calls are detected
// by the agent itself, so attribution still needs the identity pushed once.
try {
    chrome.runtime.onStartup.addListener(function () { setTimeout(syncRepIdentity, 3000); });
    chrome.runtime.onInstalled.addListener(function () { setTimeout(syncRepIdentity, 3000); });
} catch (e) { /* listeners already registered */ }

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

        if (container) {
            var allLinks = Array.from(container.querySelectorAll('a[href]'));
            var filteredLinks = allLinks.filter(a => !a.href.startsWith("https://www.google.com/maps/place/"));
            if (filteredLinks.length > 0) {
                companyUrl = filteredLinks[0].href;
            }
        }

        if (container) {
            // Better phone regex - requires area code and proper format
            var phoneRegex = /(?:\+1\s?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[-.\s]?[2-9]\d{2}[-.\s]?\d{4}/;
            var phoneMatch = containerText.match(phoneRegex);
            phone = phoneMatch ? phoneMatch[0] : '';
        }

        // Normalize and build phones array
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

        // Coordinates: the place URL carries the precise pin as !3d<lat>!4d<lng>,
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
