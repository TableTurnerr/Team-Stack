/// <reference path="../pb_data/types.d.ts" />

// ============================================================================
// Email Analytics Cache — pb_hooks/email_analytics_cache.pb.js
// ============================================================================
//
// Cron: every 15 minutes
// 1. Recomputes aggregate stats on sent campaigns (open_rate, click_rate)
// 2. Updates cached_count on dynamic email_lists by evaluating filter_json
//
// ============================================================================

cronAdd("email_analytics_cache", "*/15 * * * *", function () {

    // ── Section 1: Update campaign aggregate stats ─────────────────────────
    var sentCampaigns;
    try {
        sentCampaigns = $app.findRecordsByFilter(
            "email_campaigns",
            "status = 'sent'",
            "sent_at",
            100, 0
        );
    } catch (e) {
        $app.logger().error("[email_analytics_cache] campaign query error", "error", String(e));
        sentCampaigns = [];
    }

    for (var ci = 0; ci < sentCampaigns.length; ci++) {
        var campaign = sentCampaigns[ci];
        try {
            updateCampaignStats(campaign);
        } catch (e) {
            $app.logger().error("[email_analytics_cache] campaign stats error",
                "id", campaign.id, "error", String(e));
        }
    }

    function updateCampaignStats(campaign) {
        var recipients;
        try {
            recipients = $app.findRecordsByFilter(
                "email_recipients",
                "campaign = '" + campaign.id + "'",
                "created",
                1000, 0
            );
        } catch (e) {
            return;
        }

        if (!recipients || recipients.length === 0) return;

        var sentCount = 0;
        var deliveredCount = 0;
        var openedCount = 0;
        var clickedCount = 0;
        var bouncedCount = 0;
        var unsubscribedCount = 0;

        for (var i = 0; i < recipients.length; i++) {
            var r = recipients[i];
            var status = String(r.get("status") || "");

            sentCount++;

            switch (status) {
                case "delivered":
                    deliveredCount++;
                    break;
                case "opened":
                    deliveredCount++;
                    openedCount++;
                    break;
                case "clicked":
                    deliveredCount++;
                    openedCount++;
                    clickedCount++;
                    break;
                case "bounced":
                    bouncedCount++;
                    break;
                case "unsubscribed":
                    deliveredCount++;
                    openedCount++;
                    unsubscribedCount++;
                    break;
            }
        }

        // Update campaign counters
        var changed = false;
        var fields = {
            sent_count: sentCount,
            delivered_count: deliveredCount,
            opened_count: openedCount,
            clicked_count: clickedCount,
            bounced_count: bouncedCount,
            unsubscribed_count: unsubscribedCount,
        };

        for (var key in fields) {
            var current = parseInt(campaign.get(key) || "0", 10);
            if (current !== fields[key]) {
                campaign.set(key, fields[key]);
                changed = true;
            }
        }

        if (changed) {
            $app.save(campaign);
        }
    }

    // ── Section 2: Update cached_count on dynamic email_lists ──────────────
    var dynamicLists;
    try {
        dynamicLists = $app.findRecordsByFilter(
            "email_lists",
            "list_type = 'dynamic'",
            "created",
            100, 0
        );
    } catch (e) {
        $app.logger().error("[email_analytics_cache] list query error", "error", String(e));
        dynamicLists = [];
    }

    for (var li = 0; li < dynamicLists.length; li++) {
        var list = dynamicLists[li];
        try {
            updateListCount(list);
        } catch (e) {
            $app.logger().error("[email_analytics_cache] list count error",
                "id", list.id, "error", String(e));
        }
    }

    function updateListCount(list) {
        var filterJson = list.get("filter_json");
        if (typeof filterJson === "string") {
            try { filterJson = JSON.parse(filterJson); } catch (e) { return; }
        }
        if (!filterJson || typeof filterJson !== "object") return;

        var conditions = [];
        if (filterJson.status) conditions.push("status = '" + filterJson.status + "'");
        if (filterJson.source) conditions.push("source = '" + filterJson.source + "'");
        if (filterJson.has_email) conditions.push("email != ''");
        if (filterJson.date_from) conditions.push("created >= '" + filterJson.date_from + "'");
        if (filterJson.date_to) conditions.push("created <= '" + filterJson.date_to + "'");
        conditions.push("do_not_contact != true");

        var pbFilter = conditions.join(" && ");

        var companies;
        try {
            companies = $app.findRecordsByFilter(
                "companies",
                pbFilter,
                "created",
                500, 0
            );
        } catch (e) {
            return;
        }

        // Also exclude suppressed emails
        var suppressedEmails = {};
        try {
            var unsubs = $app.findRecordsByFilter(
                "email_unsubscribes", "id != ''", "created", 500, 0
            );
            for (var ui = 0; ui < unsubs.length; ui++) {
                var addr = String(unsubs[ui].get("email_address") || "").toLowerCase();
                if (addr) suppressedEmails[addr] = true;
            }
        } catch (e) { /* continue */ }

        var count = 0;
        for (var ci = 0; ci < companies.length; ci++) {
            var email = String(companies[ci].get("email") || "").toLowerCase();
            if (email && email.indexOf("@") !== -1 && !suppressedEmails[email]) {
                count++;
            }
        }

        var currentCount = parseInt(list.get("cached_count") || "0", 10);
        if (currentCount !== count) {
            list.set("cached_count", count);
            $app.save(list);
        }
    }

    // ── Section 3: Update static list cached counts too ────────────────────
    var staticLists;
    try {
        staticLists = $app.findRecordsByFilter(
            "email_lists",
            "list_type = 'static'",
            "created",
            100, 0
        );
    } catch (e) {
        staticLists = [];
    }

    for (var si = 0; si < staticLists.length; si++) {
        var sList = staticLists[si];
        try {
            var companyIds = sList.get("company_ids");
            if (typeof companyIds === "string") {
                try { companyIds = JSON.parse(companyIds); } catch (e) { companyIds = []; }
            }
            var sCount = Array.isArray(companyIds) ? companyIds.length : 0;
            var sCurrent = parseInt(sList.get("cached_count") || "0", 10);
            if (sCurrent !== sCount) {
                sList.set("cached_count", sCount);
                $app.save(sList);
            }
        } catch (e) { /* non-fatal */ }
    }
});
