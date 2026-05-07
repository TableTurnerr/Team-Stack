// Background service worker: listens for the "scrape" command and runs the scraping
// function in the active tab, then merges results into chrome.storage.local

// ============================================================================
// Master Power State (global on/off)
// ============================================================================

// Module-level cache so handlers can gate sync without an extra storage round-trip.
// Service-worker memory is reset between wakeups; the storage listener and the
// initial fetch keep this in sync after each cold start.
var EXTENSION_ENABLED = true;

function refreshExtensionEnabled(cb) {
    chrome.storage.local.get(['gmes_extension_enabled'], function (data) {
        EXTENSION_ENABLED = data.gmes_extension_enabled !== false;
        if (cb) cb(EXTENSION_ENABLED);
    });
}

function updateToolbarBadge() {
    if (!chrome.action || !chrome.action.setBadgeText) return;
    if (!EXTENSION_ENABLED) {
        chrome.action.setBadgeText({ text: 'OFF' });
        chrome.action.setBadgeBackgroundColor({ color: '#5f6368' });
        return;
    }
    chrome.storage.local.get(['gmes_results'], function (data) {
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

chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.gmes_extension_enabled) {
        EXTENSION_ENABLED = changes.gmes_extension_enabled.newValue !== false;
        updateToolbarBadge();
    }
    if (changes.gmes_results) {
        updateToolbarBadge();
    }
});

// ============================================================================
// Update Checker - Checks for new versions from GitHub
// ============================================================================

var GITHUB_RELEASES_URL = 'https://api.github.com/repos/TableTurnerr/Team-Stack/releases';
var RELEASE_TAG_PREFIX = 'lead-scraper-v';
var UPDATE_CHECK_ALARM_NAME = 'checkForUpdates';
var CHECK_INTERVAL_MINUTES = 60;

// ============================================================================
// CRM Auto-Connect — Background login polling
// ============================================================================
var CRM_POLL_ALARM = 'gmes_crm_login_poll';
var CRM_BG_URL     = 'https://crm.tableturnerr.com';
var CRM_BG_PB_URL  = 'https://crmdb.tableturnerr.com';

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

// Show Chrome notification for new version
function showUpdateNotification(version, downloadUrl, releaseNotes) {
    var notificationId = 'update-available-' + Date.now();
    var message = 'Version ' + version + ' is now available!';
    if (releaseNotes) {
        message += '\n' + releaseNotes;
    }

    chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon.png'),
        title: 'TableTurner Lead Scraper - Update Available',
        message: message,
        buttons: [
            { title: 'Download Update' },
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

    // CRM login poll: fires every 30s while waiting for the user to log in
    if (alarm.name === CRM_POLL_ALARM) {
        chrome.storage.local.get(['gmes_crm_waiting'], function (data) {
            if (!data.gmes_crm_waiting) { chrome.alarms.clear(CRM_POLL_ALARM); return; }
            chrome.tabs.query({ url: CRM_BG_URL + '/*' }, function (tabs) {
                if (!tabs || !tabs.length) return;
                var nonLoginTab = null;
                for (var i = 0; i < tabs.length; i++) {
                    if (tabs[i].url && tabs[i].url.indexOf('/login') === -1) { nonLoginTab = tabs[i]; break; }
                }
                if (!nonLoginTab) return;
                chrome.scripting.executeScript({
                    target: { tabId: nonLoginTab.id },
                    func: function () {
                        try {
                            var raw = localStorage.getItem('pocketbase_auth');
                            if (!raw) return null;
                            var p = JSON.parse(raw);
                            if (!p || !p.token) return null;
                            var email = (p.model && (p.model.email || p.model.username)) || '';
                            return { token: p.token, email: email };
                        } catch (e) { return null; }
                    }
                }, function (results) {
                    var auth = results && results[0] && results[0].result;
                    if (auth && auth.token) {
                        chrome.alarms.clear(CRM_POLL_ALARM);
                        chrome.storage.local.set({
                            gmes_pb_url: CRM_BG_PB_URL,
                            gmes_pb_token: auth.token,
                            gmes_crm_email: auth.email,
                            gmes_crm_waiting: false
                        });
                    }
                });
            });
        });
        return;
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

// Accept items posted from injected content scripts and merge them into storage
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'INJECTED_SCRAPE_ITEMS' || !Array.isArray(msg.items)) return;
    if (!EXTENSION_ENABLED) return;

    var newItems = msg.items;
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
    if (msg.type === 'START_CRM_LOGIN_POLL') {
        // Poll every 30 seconds (minimum allowed by Chrome is ~0.5 min = 30s)
        chrome.alarms.create(CRM_POLL_ALARM, { periodInMinutes: 0.5 });
    }
    if (msg.type === 'OPEN_CRM_LOGIN') {
        var loginUrl = CRM_BG_URL + '/login';
        chrome.tabs.query({ url: CRM_BG_URL + '/*' }, function (tabs) {
            if (tabs && tabs.length > 0) {
                chrome.tabs.update(tabs[0].id, { url: loginUrl, active: true });
            } else {
                chrome.tabs.create({ url: loginUrl });
            }
            chrome.storage.local.set({ gmes_crm_waiting: true });
            chrome.alarms.create(CRM_POLL_ALARM, { periodInMinutes: 0.5 });
        });
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