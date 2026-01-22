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

chrome.commands.onCommand.addListener(function (command) {
    if (command === 'scrape') {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            var tab = tabs && tabs[0];
            if (!tab) return;

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
                chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_MANUAL_ADD' });
            }
        });
    } else if (command === 'open_website') {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_CURRENT_WEBSITE' }, function(response) {
                    if (chrome.runtime.lastError) {
                        console.error('Error getting website URL:', chrome.runtime.lastError);
                        return;
                    }
                    if (response && response.url) {
                        console.log('Opening website:', response.url);
                        chrome.tabs.create({ url: response.url });
                    } else {
                        console.warn('No URL returned from content script');
                    }
                });
            }
        });
    }
});

// Handle opening shortcuts settings
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === 'OPEN_SHORTCUTS_SETTINGS') {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    }
});

// Handle MANUAL_ADD_ITEM messages from content scripts
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'MANUAL_ADD_ITEM' || !msg.item) return;

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

    chrome.storage.local.get(['gmes_mode', 'gmes_overlay_dismissed'], function (data) {
        var isManualMode = data.gmes_mode === 'manual';
        var isDismissed = data.gmes_overlay_dismissed === true;
        sendResponse({ shouldShow: isManualMode && !isDismissed });
    });

    // Return true to indicate async response
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