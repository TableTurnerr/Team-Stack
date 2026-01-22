// Background service worker: listens for the "scrape" command and runs the scraping
// function in the active tab, then merges results into chrome.storage.local

// ============================================================================
// Update Checker - Checks for new versions from GitHub
// ============================================================================

var VERSION_JSON_URL = 'https://raw.githubusercontent.com/Hashaam101/google-maps-easy-scrape/main/version.json';
var UPDATE_CHECK_ALARM_NAME = 'checkForUpdates';
var CHECK_INTERVAL_MINUTES = 60;

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

// Fetch version.json from GitHub
function fetchVersionInfo() {
    return fetch(VERSION_JSON_URL)
        .then(function (response) {
            if (!response.ok) {
                throw new Error('Failed to fetch version info: ' + response.status);
            }
            return response.json();
        })
        .catch(function (error) {
            console.error('Error fetching version info:', error);
            throw error;
        });
}

// Check for updates and show notification if newer version is available
function checkForUpdates() {
    var currentVersion = getCurrentVersion();

    fetchVersionInfo()
        .then(function (versionInfo) {
            if (!versionInfo || !versionInfo.version) {
                console.error('Invalid version.json format');
                return;
            }

            var remoteVersion = versionInfo.version;
            var comparison = compareVersions(remoteVersion, currentVersion);

            if (comparison > 0) {
                // Newer version available
                console.log('New version available: ' + remoteVersion + ' (current: ' + currentVersion + ')');

                // Store update info in chrome.storage.local
                chrome.storage.local.set({
                    updateAvailable: true,
                    updateVersion: remoteVersion,
                    updateUrl: versionInfo.downloadUrl || 'https://github.com/Hashaam101/google-maps-easy-scrape/releases/latest',
                    updateReleaseNotes: versionInfo.releaseNotes || 'Bug fixes and improvements'
                }, function () {
                    showUpdateNotification(remoteVersion, versionInfo.downloadUrl, versionInfo.releaseNotes);
                });
            } else {
                console.log('Extension is up to date: ' + currentVersion);
                // Clear update flag if no update available
                chrome.storage.local.set({ updateAvailable: false });
            }
        })
        .catch(function (error) {
            // Handle errors gracefully - don't show notification for network errors
            console.error('Update check failed:', error);
        });
}

// Show Chrome notification for new version
function showUpdateNotification(version, downloadUrl, releaseNotes) {
    var notificationId = 'update-available-' + Date.now();
    var message = 'Version ' + version + ' is now available!';
    if (releaseNotes) {
        message += '\n' + releaseNotes;
    }

    chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('map.png'),
        title: 'Google Maps Easy Scrape - Update Available',
        message: message,
        buttons: [
            { title: 'Download Update' }
        ],
        priority: 2
    }, function (createdId) {
        if (chrome.runtime.lastError) {
            console.error('Error showing notification:', chrome.runtime.lastError);
        } else {
            // Store download URL for this notification
            chrome.storage.local.set({
                ['notification_' + createdId + '_url']: downloadUrl
            });
        }
    });
}

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener(function (notificationId, buttonIndex) {
    if (buttonIndex === 0) {
        // Download Update button clicked
        chrome.storage.local.get(['notification_' + notificationId + '_url', 'updateUrl'], function (data) {
            var url = data['notification_' + notificationId + '_url'] || data.updateUrl || 'https://github.com/Hashaam101/google-maps-easy-scrape/releases/latest';
            chrome.tabs.create({ url: url });
            // Clear notification URL
            chrome.storage.local.remove('notification_' + notificationId + '_url');
        });
        chrome.notifications.clear(notificationId);
    }
});

// Handle notification clicks (clicking the notification itself)
chrome.notifications.onClicked.addListener(function (notificationId) {
    chrome.storage.local.get(['notification_' + notificationId + '_url', 'updateUrl'], function (data) {
        var url = data['notification_' + notificationId + '_url'] || data.updateUrl || 'https://github.com/Hashaam101/google-maps-easy-scrape/releases/latest';
        chrome.tabs.create({ url: url });
        chrome.storage.local.remove('notification_' + notificationId + '_url');
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

    // Background continuous scraping alarm
    var BG_SCRAPE_ALARM = 'gmes_continuous_scrape';
    if (alarm.name === BG_SCRAPE_ALARM) {
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
                    chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries'], function (data) {
                        var existing = Array.isArray(data.gmes_results) ? data.gmes_results : [];
                        var ignoreNamesArr = Array.isArray(data.gmes_ignore_names) ? data.gmes_ignore_names : [];
                        var ignoreIndustriesArr = Array.isArray(data.gmes_ignore_industries) ? data.gmes_ignore_industries : [];
                        var ignoreNamesSet = new Set(ignoreNamesArr.map(function (s) { return String(s).toLowerCase().trim(); }));
                        var ignoreIndustriesSet = new Set(ignoreIndustriesArr.map(function (s) { return String(s).toLowerCase().trim(); }));

                        var seen = new Set(existing.map(function (it) { return it.href || (it.title + '|' + it.address); }));
                        var added = false;

                        newItems.forEach(function (item) {
                            var key = item.href || (item.title + '|' + item.address);
                            if (!key) return;
                            if (seen.has(key)) return;
                            try {
                                var ignoreMatch = false;
                                if (item && item.title) {
                                    var title = String(item.title).toLowerCase();
                                    for (var ig of ignoreNamesSet) {
                                        if (!ig) continue;
                                        if (title === ig || title.indexOf(ig) !== -1) { ignoreMatch = true; break; }
                                    }
                                }
                                if (!ignoreMatch && item && item.industry) {
                                    var industry = String(item.industry).toLowerCase();
                                    for (var ig of ignoreIndustriesSet) {
                                        if (!ig) continue;
                                        if (industry === ig || industry.indexOf(ig) !== -1) { ignoreMatch = true; break; }
                                    }
                                }
                                if (ignoreMatch) return;
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

// Accept items posted from injected content scripts and merge them into storage
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'INJECTED_SCRAPE_ITEMS' || !Array.isArray(msg.items)) return;

    var newItems = msg.items;
    chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries'], function (data) {
        var existing = Array.isArray(data.gmes_results) ? data.gmes_results : [];
        var ignoreNamesArr = Array.isArray(data.gmes_ignore_names) ? data.gmes_ignore_names : [];
        var ignoreIndustriesArr = Array.isArray(data.gmes_ignore_industries) ? data.gmes_ignore_industries : [];
        var ignoreNamesSet = new Set(ignoreNamesArr.map(function (s) { return String(s).toLowerCase().trim(); }));
        var ignoreIndustriesSet = new Set(ignoreIndustriesArr.map(function (s) { return String(s).toLowerCase().trim(); }));

        var seen = new Set(existing.map(function (it) { return it.href || (it.title + '|' + it.address); }));
        var added = false;

        newItems.forEach(function (item) {
            var key = item.href || (item.title + '|' + item.address);
            if (!key) return;
            if (seen.has(key)) return;
            try {
                var ignoreMatch = false;
                if (item && item.title) {
                    var title = String(item.title).toLowerCase();
                    for (var ig of ignoreNamesSet) { if (!ig) continue; if (title === ig || title.indexOf(ig) !== -1) { ignoreMatch = true; break; } }
                }
                if (!ignoreMatch && item && item.industry) {
                    var industry = String(item.industry).toLowerCase();
                    for (var ig of ignoreIndustriesSet) { if (!ig) continue; if (industry === ig || industry.indexOf(ig) !== -1) { ignoreMatch = true; break; } }
                }
                if (ignoreMatch) return;
            } catch (e) { }

            seen.add(key);
            existing.push(item);
            added = true;
        });

        if (added) chrome.storage.local.set({ gmes_results: existing });
    });
});

// Check for updates on extension startup
chrome.runtime.onStartup.addListener(function () {
    checkForUpdates();
});

// Check for updates when extension is installed or enabled
chrome.runtime.onInstalled.addListener(function () {
    checkForUpdates();
    setupUpdateAlarm();
});

// Set up alarm on service worker startup (for Manifest V3)
setupUpdateAlarm();
// Also check immediately on startup
checkForUpdates();

// ============================================================================
// End of Update Checker
// ============================================================================

chrome.commands.onCommand.addListener(function (command) {
    if (command !== 'scrape') return;

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs && tabs[0];
        if (!tab) return;

        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: scrapeData
        }, function (results) {
            if (!results || !results[0] || !results[0].result) return;
            var newItems = results[0].result;

            // Also respect ignore lists stored under 'gmes_ignore_names' and 'gmes_ignore_industries' (arrays of strings).
            chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries'], function (data) {
                var existing = Array.isArray(data.gmes_results) ? data.gmes_results : [];
                var ignoreNamesArr = Array.isArray(data.gmes_ignore_names) ? data.gmes_ignore_names : [];
                var ignoreIndustriesArr = Array.isArray(data.gmes_ignore_industries) ? data.gmes_ignore_industries : [];
                var ignoreNamesSet = new Set(ignoreNamesArr.map(function (s) { return String(s).toLowerCase().trim(); }));
                var ignoreIndustriesSet = new Set(ignoreIndustriesArr.map(function (s) { return String(s).toLowerCase().trim(); }));

                var seen = new Set(existing.map(function (it) { return it.href || (it.title + '|' + it.address); }));
                var added = false;

                newItems.forEach(function (item) {
                    var key = item.href || (item.title + '|' + item.address);
                    if (!key) return;
                    // skip if already seen
                    if (seen.has(key)) return;
                    // skip if title or industry matches an ignore token (case-insensitive substring match)
                    try {
                        var ignoreMatch = false;

                        // Check title/name
                        if (item && item.title) {
                            var title = String(item.title).toLowerCase();
                            for (var ig of ignoreNamesSet) {
                                if (!ig) continue;
                                if (title === ig || title.indexOf(ig) !== -1) {
                                    ignoreMatch = true;
                                    break;
                                }
                            }
                        }

                        // Check industry if title didn't match
                        if (!ignoreMatch && item && item.industry) {
                            var industry = String(item.industry).toLowerCase();
                            for (var ig of ignoreIndustriesSet) {
                                if (!ig) continue;
                                if (industry === ig || industry.indexOf(ig) !== -1) {
                                    ignoreMatch = true;
                                    break;
                                }
                            }
                        }

                        if (ignoreMatch) return;
                    } catch (e) {
                        // if matching fails, proceed with adding
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


// Manual Mode Message Handlers
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;

    if (msg.type === 'MANUAL_ADD_ITEM') {
        handleManualAddItem(msg.item).then(() => {
            sendResponse({ success: true });
        });
        return true; // async response
    }

    if (msg.type === 'GET_MODE') {
        chrome.storage.local.get(['gmes_mode'], function (result) {
            sendResponse({ mode: result.gmes_mode || 'scraping' });
        });
        return true;
    }

    if (msg.type === 'CHECK_SHOULD_SHOW_OVERLAY') {
        chrome.storage.local.get(['gmes_mode', 'gmes_overlay_dismissed'], function (result) {
            var shouldShow = result.gmes_mode === 'manual' && !result.gmes_overlay_dismissed;
            sendResponse({ shouldShow: shouldShow });
        });
        return true;
    }
});

// Toggle overlay command
chrome.commands.onCommand.addListener(function (command) {
    if (command === 'toggle_manual_overlay') {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (!tabs[0]) return;

            // Toggle the dismissed state
            chrome.storage.local.get(['gmes_overlay_dismissed', 'gmes_mode'], function (result) {
                var newDismissed = !result.gmes_overlay_dismissed;

                chrome.storage.local.set({ gmes_overlay_dismissed: newDismissed }, function () {
                    // Refresh overlay state in active tab
                    if (result.gmes_mode === 'manual') {
                        // We can just re-inject or let the user refresh, but let's try to reload the page or inject
                        if (tabs[0].url.includes('google.com/maps')) {
                            chrome.scripting.executeScript({
                                target: { tabId: tabs[0].id },
                                files: ['manual_mode_maps.js']
                            });
                        } else {
                            chrome.scripting.executeScript({
                                target: { tabId: tabs[0].id },
                                files: ['manual_mode_website.js']
                            });
                        }
                    }
                });
            });
        });
    }
});

chrome.commands.onCommand.addListener(function (command) {
    if (command === 'manual_add_to_list') {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_MANUAL_ADD' });
            }
        });
    }
});

function handleManualAddItem(item) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['gmes_results', 'gmes_ignore_names', 'gmes_ignore_industries'], function (result) {
            var existingItems = Array.isArray(result.gmes_results) ? result.gmes_results : [];
            var ignoreNames = Array.isArray(result.gmes_ignore_names) ? result.gmes_ignore_names : [];
            var ignoreIndustries = Array.isArray(result.gmes_ignore_industries) ? result.gmes_ignore_industries : [];

            // dedupe logic
            var key = item.href || (item.title + '|' + item.address);
            var seen = new Set(existingItems.map(function (i) { return i.href || (i.title + '|' + i.address); }));

            if (seen.has(key)) {
                console.log('Duplicate item, skipping:', item.title);
                resolve();
                return;
            }

            // ignore logic
            var titleLower = (item.title || '').toLowerCase();
            var industryLower = (item.industry || '').toLowerCase();

            for (var name of ignoreNames) {
                if (titleLower.includes(name.toLowerCase())) {
                    console.log('Item ignored by name filter:', item.title);
                    resolve();
                    return;
                }
            }

            for (var ind of ignoreIndustries) {
                if (industryLower.includes(ind.toLowerCase())) {
                    console.log('Item ignored by industry filter:', item.industry);
                    resolve();
                    return;
                }
            }

            existingItems.push(item);
            chrome.storage.local.set({ gmes_results: existingItems }, resolve);
        });
    });
}

// The scrapeData function is serialized and injected into the page by executeScript.
// It must not reference extension APIs; it only inspects the DOM and returns data.
function scrapeData() {
    var links = Array.from(document.querySelectorAll('a[href^="https://www.google.com/maps/place"]'));
    return links.map(link => {
        var container = link.closest('[jsaction*="mouseover:pane"]');
        var titleText = container ? container.querySelector('.fontHeadlineSmall').textContent : '';
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
                    var rating = parts[0];
                    var reviewCount = '(' + parts[2] + ')';
                } else {
                    rating = '0';
                    reviewCount = '0';
                }
            }
        }

        // Address and Industry
        if (container) {
            var containerText = container.textContent || '';
            var addressRegex = /\d+ [\w\s]+(?:#\s*\d+|Suite\s*\d+|Apt\s*\d+)?/;
            var addressMatch = containerText.match(addressRegex);

            if (addressMatch) {
                address = addressMatch[0];

                // Extract industry text based on the position before the address
                var textBeforeAddress = containerText.substring(0, containerText.indexOf(address)).trim();
                var ratingIndex = textBeforeAddress.lastIndexOf(rating + reviewCount);
                if (ratingIndex !== -1) {
                    // Assuming industry is the first significant text after rating and review count
                    var rawIndustryText = textBeforeAddress.substring(ratingIndex + (rating + reviewCount).length).trim().split(/[\r\n]+/)[0];
                    var cleanedRawIndustry = rawIndustryText.replace(/[·.,#!?]/g, '').trim();
                    var industryAlpha = cleanedRawIndustry.replace(/[^A-Za-z\s]/g, '').trim();
                    // keep only digits, $, hyphen, en-dash and plus
                    var expensivenessVal = cleanedRawIndustry.replace(/[^0-9$\-\u2013+]/g, '').trim();
                    industry = industryAlpha;
                    var expensiveness = expensivenessVal;
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

        // Phone Numbers
        if (container) {
            var containerText = container.textContent || '';
            var phoneRegex = /(\+\d{1,2}\s)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
            var phoneMatch = containerText.match(phoneRegex);
            phone = phoneMatch ? phoneMatch[0] : '';
        }

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
            rating: rating,
            reviewCount: reviewCount,
            phone: phone,
            industry: industry,
            expensiveness: (typeof expensiveness !== 'undefined') ? expensiveness : '',
            city: city,
            address: address,
            companyUrl: companyUrl,
            instaSearch: instaSearch,
            href: link.href,
        };
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.url.includes('google.com/maps/place')) {
        chrome.storage.local.get(['gmes_mode'], (result) => {
            if (result.gmes_mode === 'manual') {
                setTimeout(() => {
                    chrome.tabs.sendMessage(tabId, { type: 'URL_CHANGED' });
                }, 1000);
            }
        });
    }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (tab.url && tab.url.includes('google.com/maps/place')) {
            chrome.storage.local.get(['gmes_mode'], (result) => {
                if (result.gmes_mode === 'manual') {
                    chrome.tabs.sendMessage(activeInfo.tabId, { type: 'SHOW_OVERLAY' });
                }
            });
        }
    });
});
