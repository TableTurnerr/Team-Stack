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

                    // Respect ignore lists and merge into storage
                    chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries', 'gmes_food_filter_enabled'], function (data) {
                        var existing = Array.isArray(data.gmes_results) ? data.gmes_results : [];
                        var ignoreNamesArr = Array.isArray(data.gmes_ignore_names) ? data.gmes_ignore_names : [];
                        var ignoreIndustriesArr = Array.isArray(data.gmes_ignore_industries) ? data.gmes_ignore_industries : [];
                        var ignoreNamesSet = new Set(ignoreNamesArr.map(function (s) { return String(s).toLowerCase().trim(); }));
                        var ignoreIndustriesSet = new Set(ignoreIndustriesArr.map(function (s) { return String(s).toLowerCase().trim(); }));
                        // Food filter is enabled by default
                        var foodFilterEnabled = data.gmes_food_filter_enabled !== false;

                        var seen = new Set(existing.map(function (it) { return it.href || (it.title + '|' + it.address); }));
                        var added = false;

                        newItems.forEach(function (item) {
                            if (!item) return;
                            var key = item.href || (item.title + '|' + item.address);
                            if (!key) return;
                            if (seen.has(key)) return;

                            // Apply food industry filter
                            if (foodFilterEnabled && !isFoodRelatedIndustry(item.industry)) {
                                return;
                            }

                            try {
                                if (chainNameMatchesIgnoreList(item && item.title, ignoreNamesSet)) return;
                                if (industryMatchesIgnoreList(item && item.industry, ignoreIndustriesSet)) return;
                            } catch (e) {
                                // fallback to adding
                            }
                            seen.add(key);
                            existing.push(item);
                            added = true;
                        });

                        if (added) {
                            chrome.storage.local.set({ gmes_results: existing });
                        }
                    });
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

function startGridScan(tabId, category, location, center, radiusMiles, turbo, filters) {
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
    chrome.storage.local.set({
        gmes_grid_state: state,
        gmes_grid_total: points.length,
        gmes_grid_current: 0,
        gmes_grid_autoresume: true,
        // Fresh run => fresh session. Leads merged from now on get tagged with this
        // id (see mergeScrapedItems) so Pause/Stop can report and snapshot them.
        gmes_active_session_id: newSessionId(),
        gmes_active_session_started: Date.now()
    }, function () {
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
    gridScan = null;
    clearGridWatchdog();
    chrome.storage.local.remove(GRID_STATE_KEY);
    chrome.storage.local.set({
        gmes_background_scraping: false,
        gmes_scrape_heartbeat: 0,
        gmes_grid_total: 0,
        gmes_grid_current: 0,
        gmes_grid_autoresume: false
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
function stopMapsContentScripts(cb) {
    chrome.tabs.query({ url: ['*://www.google.com/maps/*'] }, function (tabs) {
        (tabs || []).forEach(function (tab) {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: function () {
                    try {
                        if (window.__GMES_AUTO_SCRAPER__) window.__GMES_AUTO_SCRAPER__.stop = true;
                        var el = document.getElementById('gmes-popdown');
                        if (el && el.parentNode) el.parentNode.removeChild(el);
                    } catch (e) {}
                }
            }, function () { void chrome.runtime.lastError; });
        });
        if (cb) cb();
    });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;

    if (msg.type === 'START_AUTO_SCRAPE') {
        if (!EXTENSION_ENABLED) { sendResponse({ started: false, error: 'Extension is off.' }); return; }
        var category = (msg.category || '').trim();
        var location = (msg.location || '').trim();
        var radiusMiles = Number(msg.radiusMiles) || 0;
        var turbo = Boolean(msg.turbo);
        var filters = {
            excludeText: (msg.excludeKeywords != null ? String(msg.excludeKeywords) : ''),
            conditionsText: (msg.conditions != null ? String(msg.conditions) : ''),
            skipTempClosed: msg.skipTempClosed !== false,
            speed: speedFactor(msg.speed)
        };
        if (!category || !location) { sendResponse({ started: false, error: 'Category and location are required.' }); return; }

        resolveScrapeTab(function (tabId) {
            if (!tabId) { return; }
            // Step 1: navigate to geocode the location.
            chrome.tabs.update(tabId, { url: buildMapsSearchUrl(location) }, function () {
                if (chrome.runtime.lastError) return;
                // Step 2: wait for the map center to resolve.
                waitForMapsCenter(tabId, function (center) {
                    if (!center) {
                        // Fall back to a plain "category in location" search with no center.
                        chrome.tabs.update(tabId, { url: buildMapsSearchUrl(category + ' in ' + location) }, function () {
                            setTimeout(function () { injectAutoScraper(tabId, { lat: '', lng: '' }, radiusMiles, turbo, filters); }, 3500);
                        });
                        return;
                    }
                    // Step 3: if "Any" mode (radius=0), derive coverage from the zoom Maps chose.
                    var effectiveRadius = radiusMiles;
                    if (!effectiveRadius && center.zoom) effectiveRadius = zoomToRadius(center.zoom);
                    if (!effectiveRadius) effectiveRadius = 25; // last-resort fallback
                    startGridScan(tabId, category, location, center, effectiveRadius, turbo, filters);
                });
            });
        });
        // Enrich any leads carrying a website that haven't been scraped yet (backlog
        // from earlier runs/manual adds); fresh leads enqueue as they're merged.
        sweepExistingForEnrichment();
        sendResponse({ started: true });
        return;
    }

    if (msg.type === 'RESUME_AUTO_SCRAPE') {
        if (!EXTENSION_ENABLED) { sendResponse({ resumed: false, error: 'Extension is off.' }); return; }
        resumeGridScan(function (ok) { sendResponse({ resumed: Boolean(ok) }); });
        return true;
    }

    // Pause: halt the running scan but KEEP the saved grid cursor (gmes_grid_state
    // and the cell counters) so the popup can offer "Resume". Clears autoresume so
    // the watchdog won't silently reopen a tab. The active session id stays put so
    // resuming continues tagging into the same session.
    if (msg.type === 'PAUSE_AUTO_SCRAPE') {
        gridScan = null;
        clearGridWatchdog();
        chrome.storage.local.set({ gmes_background_scraping: false, gmes_scrape_heartbeat: 0, gmes_grid_autoresume: false });
        stopMapsContentScripts(function () { sendResponse({ paused: true }); });
        return true;
    }

    if (msg.type === 'STOP_AUTO_SCRAPE') {
        gridScan = null;
        clearGridWatchdog();
        chrome.storage.local.remove(GRID_STATE_KEY);
        chrome.storage.local.set({ gmes_background_scraping: false, gmes_scrape_heartbeat: 0, gmes_grid_total: 0, gmes_grid_current: 0, gmes_grid_autoresume: false, gmes_active_session_id: '', gmes_active_session_started: 0 });
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

// Merge freshly scraped items into storage, applying the ignore lists and the
// (source-aware) food filter. cb(addedCount) when done. The whole read-modify-write
// runs under withResultsLock so it can't race the async website-enrichment writes.
function mergeScrapedItems(newItems, source, cb) {
    if (!Array.isArray(newItems) || !newItems.length) { if (cb) cb(0); return; }
    withResultsLock(function (release) {
        chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries', 'gmes_food_filter_enabled', 'gmes_active_session_id'], function (data) {
            var existingRaw = Array.isArray(data.gmes_results) ? data.gmes_results : [];
            // Collapse any duplicates left by older runs before merging in new items.
            var existing = dedupeItemList(existingRaw);
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

            newItems.forEach(function (item) {
                var key = placeIdentity(item);
                if (!key) return;
                if (byKey.has(key)) {
                    // Same place seen again (overlapping cell) — enrich the stored copy
                    // with any fields this capture filled, but don't add a new row.
                    if (fillMissingFields(byKey.get(key), item)) changed = true;
                    return;
                }

                // Only collect leads that have a phone number (auto-scrape). The
                // injected scraper already gates on this, but enforce it here too so a
                // phone-less item can never reach storage from any auto-scrape path.
                if (source === 'auto' && !hasPhone(item)) {
                    return;
                }

                // Apply food industry filter
                if (foodFilterEnabled && !isFoodRelatedIndustry(item.industry)) {
                    return;
                }

                try {
                    if (chainNameMatchesIgnoreList(item && item.title, ignoreNamesSet)) return;
                    if (industryMatchesIgnoreList(item && item.industry, ignoreIndustriesSet)) return;
                } catch (e) { }

                if (activeSessionId && !item.sessionId) item.sessionId = activeSessionId;
                byKey.set(key, item);
                existing.push(item);
                addedItems.push(item);
                addedCount++;
            });

            function finish() {
                release();
                if (cb) cb(addedCount);
                // Kick off website enrichment for the leads we just added (gated by
                // the gmes_scrape_websites toggle inside enqueueItemsForEnrichment).
                if (addedItems.length) enqueueItemsForEnrichment(addedItems);
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
function isRealWebsite(url) {
    if (!url) return false;
    if (!/^https?:\/\//i.test(String(url))) return false;
    return !isGoogleHostBg(url);
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

    return { emails: cleanEmails(emails), phones: dedupNormalizedPhones(textPhones) };
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
        if (!res.ok) { cb({ ok: false, emails: [], phones: [], jsRendered: true }); return; }
        var c = extractContactsFromHtml(res.html);
        var js = looksJsRendered(res.html);
        if (!c.emails.length) {
            var contactUrl = findContactUrl(res.html, res.finalUrl || url);
            if (contactUrl && contactUrl !== url && contactUrl !== (res.finalUrl || url)) {
                fetchWebsiteHtml(contactUrl, 8000, function (res2) {
                    if (res2.ok) {
                        var c2 = extractContactsFromHtml(res2.html);
                        c.emails = cleanEmails(c.emails.concat(c2.emails));
                        c.phones = dedupNormalizedPhones(c.phones.concat(c2.phones));
                    }
                    cb({ ok: true, emails: c.emails, phones: c.phones, jsRendered: js });
                });
                return;
            }
        }
        cb({ ok: true, emails: c.emails, phones: c.phones, jsRendered: js });
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

        return { emails: emails.slice(0, 5), phones: phones.slice(0, 10) };
    } catch (e) {
        return { emails: [], phones: [] };
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
    completed: 0
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
    function finalize(emails, phones, method) {
        recordEnrichLog(job, { emails: emails, phones: phones, method: method });
        applyEnrichmentToLead(job.identity, { emails: emails, phones: phones }, done);
    }
    enrichViaFetch(job.url, function (fres) {
        var needTab = (!fres.ok) || (!fres.emails.length && fres.jsRendered);
        if (!needTab) {
            finalize(fres.emails, fres.phones, 'fetch');
            return;
        }
        tabScrapeContacts(job.url, function (tres) {
            var emails = cleanEmails((fres.emails || []).concat((tres && tres.emails) || []));
            var phones = dedupNormalizedPhones((fres.phones || []).concat((tres && tres.phones) || []));
            finalize(emails, phones, 'tab');
        });
    });
}

function pumpEnrich() {
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

                chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries', 'gmes_food_filter_enabled'], function (data) {
                    var existing = Array.isArray(data.gmes_results) ? data.gmes_results : [];
                    var ignoreNamesArr = Array.isArray(data.gmes_ignore_names) ? data.gmes_ignore_names : [];
                    var ignoreIndustriesArr = Array.isArray(data.gmes_ignore_industries) ? data.gmes_ignore_industries : [];
                    var ignoreNamesSet = new Set(ignoreNamesArr.map(function (s) { return String(s).toLowerCase().trim(); }));
                    var ignoreIndustriesSet = new Set(ignoreIndustriesArr.map(function (s) { return String(s).toLowerCase().trim(); }));
                    // Food filter is enabled by default
                    var foodFilterEnabled = data.gmes_food_filter_enabled !== false;

                    var seen = new Set(existing.map(function (it) { return it.href || (it.title + '|' + it.address); }));
                    var added = false;

                    newItems.forEach(function (item) {
                        if (!item) return;
                        var key = item.href || (item.title + '|' + item.address);
                        if (!key) return;
                        if (seen.has(key)) return;

                        // Apply food industry filter
                        if (foodFilterEnabled && !isFoodRelatedIndustry(item.industry)) {
                            return;
                        }

                        try {
                            if (chainNameMatchesIgnoreList(item && item.title, ignoreNamesSet)) return;
                            if (industryMatchesIgnoreList(item && item.industry, ignoreIndustriesSet)) return;
                        } catch (e) {}

                        seen.add(key);
                        existing.push(item);
                        added = true;
                    });

                    if (added) {
                        chrome.storage.local.set({ gmes_results: existing });
                    }
                });
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
            GHL.sendLead(msg.locationId, msg.item, msg.opts || {}, function (res) { sendResponse(res || { success: false, error: 'No response' }); });
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

    handleManualAddItem(msg.item).then(function () {
        sendResponse({ success: true });
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
                resolve();
                return;
            }

            var ignoreNamesSet = new Set(ignoreNames.map(function (s) { return String(s).toLowerCase().trim(); }));
            var ignoreIndustriesSet = new Set(ignoreIndustries.map(function (s) { return String(s).toLowerCase().trim(); }));

            if (chainNameMatchesIgnoreList(item.title, ignoreNamesSet)) {
                console.log('Item ignored by name filter:', item.title);
                resolve();
                return;
            }

            if (industryMatchesIgnoreList(item.industry, ignoreIndustriesSet)) {
                console.log('Item ignored by industry filter:', item.industry);
                resolve();
                return;
            }

            existingItems.push(item);
            chrome.storage.local.set({ gmes_results: existingItems }, resolve);
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
//   1. explicit setting gmes_zoom_rep_user_id (ideally == the rep's Zoom user_id)
//   2. the connected CRM email (gmes_ghl_email), a stable per-rep label
//   3. a persisted random fallback id so callIds stay consistent on this machine
// The local agent overrides repUserId with its own config on upload, so this is
// only a label/routing hint — but we still send the best value we have.
function resolveRepUserId(cb) {
    chrome.storage.local.get(['gmes_zoom_rep_user_id', 'gmes_ghl_email', 'gmes_rep_fallback_id'], function (d) {
        var explicit = (d.gmes_zoom_rep_user_id || '').toString().trim();
        if (explicit) { cb(explicit); return; }
        var email = (d.gmes_ghl_email || '').toString().trim();
        if (email && email.toLowerCase() !== 'connected') { cb(email); return; }
        if (d.gmes_rep_fallback_id) { cb(d.gmes_rep_fallback_id); return; }
        var fallback = 'rep_' + Math.random().toString(36).slice(2, 10);
        chrome.storage.local.set({ gmes_rep_fallback_id: fallback }, function () { cb(fallback); });
    });
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