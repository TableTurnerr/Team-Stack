/// <reference path="../pb_data/types.d.ts" />

// ============================================================================
// Email A/B Test Resolver — pb_hooks/email_ab_resolver.pb.js
// ============================================================================
//
// Cron: every 30 minutes
// Finds A/B parent campaigns where both variants have been sent but no winner
// has been decided. After a minimum of 4 hours, compares the winner metric
// (open_rate or click_rate) and sends the winner's content to the held-back
// audience.
//
// Required environment variables:
//   RESEND_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME, CRM_URL
//
// ============================================================================

cronAdd("email_ab_resolver", "0,30 * * * *", function () {

    var RESEND_API_KEY    = ($os.getenv("RESEND_API_KEY") || "").trim();
    var EMAIL_FROM        = ($os.getenv("EMAIL_FROM_ADDRESS") || "crm@tableturnerr.com").trim();
    var EMAIL_FROM_NAME   = ($os.getenv("EMAIL_FROM_NAME") || "Tableturnerr CRM").trim();
    var CRM_URL           = ($os.getenv("CRM_URL") || "").replace(/\/$/, "");

    if (!RESEND_API_KEY) return;

    var now = new Date();
    var FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    var TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

    // Find A/B parent campaigns that are 'sent' with campaign_type='ab_test'
    // and have no winner yet (ab_winner_metric is set but no 'winning' child)
    var parentCampaigns;
    try {
        parentCampaigns = $app.findRecordsByFilter(
            "email_campaigns",
            "campaign_type = 'ab_test' && status = 'sent'",
            "sent_at",
            20, 0
        );
    } catch (e) {
        $app.logger().error("[email_ab_resolver] query error", "error", String(e));
        return;
    }

    if (!parentCampaigns || parentCampaigns.length === 0) return;

    for (var pi = 0; pi < parentCampaigns.length; pi++) {
        try {
            resolveABTest(parentCampaigns[pi]);
        } catch (e) {
            $app.logger().error("[email_ab_resolver] error resolving A/B test",
                "campaign", parentCampaigns[pi].id, "error", String(e));
        }
    }

    function resolveABTest(parent) {
        var parentId = parent.id;
        var sentAt = String(parent.get("sent_at") || "");
        if (!sentAt) return;

        var sentDate = new Date(sentAt.replace(" ", "T"));
        var elapsed = now.getTime() - sentDate.getTime();

        // Must wait at least 4 hours
        if (elapsed < FOUR_HOURS_MS) return;

        // Find variant children
        var variants;
        try {
            variants = $app.findRecordsByFilter(
                "email_campaigns",
                "ab_parent = '" + parentId + "' && status = 'sent'",
                "created",
                10, 0
            );
        } catch (e) {
            return;
        }

        if (!variants || variants.length < 2) return;

        // Check if winner already decided (any variant already has 'won' status equivalent)
        // We use a convention: if parent has sent_count > sum of variant sent_counts, winner was already sent
        var parentSentCount = parseInt(parent.get("sent_count") || "0", 10);
        var variantTotalSent = 0;
        for (var vi = 0; vi < variants.length; vi++) {
            variantTotalSent += parseInt(variants[vi].get("sent_count") || "0", 10);
        }
        if (parentSentCount > 0 && parentSentCount > variantTotalSent) {
            // Winner already sent to remaining audience
            return;
        }

        // Determine winner metric
        var winnerMetric = String(parent.get("ab_winner_metric") || "open_rate");

        // Calculate metrics for each variant
        var variantMetrics = [];
        for (var i = 0; i < variants.length; i++) {
            var v = variants[i];
            var sent = parseInt(v.get("sent_count") || "0", 10);
            var openCount = 0;
            var clickCount = 0;

            // Count events from email_events for this campaign's recipients
            try {
                var recipients = $app.findRecordsByFilter(
                    "email_recipients",
                    "campaign = '" + v.id + "'",
                    "created",
                    500, 0
                );
                for (var ri = 0; ri < recipients.length; ri++) {
                    openCount += parseInt(recipients[ri].get("open_count") || "0", 10);
                    clickCount += parseInt(recipients[ri].get("click_count") || "0", 10);
                }
            } catch (e) { /* continue with 0 */ }

            var openRate = sent > 0 ? openCount / sent : 0;
            var clickRate = sent > 0 ? clickCount / sent : 0;
            var metric = winnerMetric === "click_rate" ? clickRate : openRate;

            variantMetrics.push({
                variant: v,
                openRate: openRate,
                clickRate: clickRate,
                metric: metric,
                sent: sent,
            });
        }

        // Sort by metric descending
        variantMetrics.sort(function(a, b) { return b.metric - a.metric; });

        var best = variantMetrics[0];
        var second = variantMetrics[1];

        // If difference < 2% and less than 24h elapsed, wait
        var diff = Math.abs(best.metric - second.metric);
        if (diff < 0.02 && elapsed < TWENTY_FOUR_HOURS_MS) {
            $app.logger().info("[email_ab_resolver] too close to call, waiting",
                "campaign", parentId, "diff", diff.toFixed(4));
            return;
        }

        $app.logger().info("[email_ab_resolver] winner determined",
            "campaign", parentId,
            "winner", best.variant.id,
            "metric", winnerMetric,
            "winner_value", best.metric.toFixed(4),
            "loser_value", second.metric.toFixed(4));

        // Send winner's content to the remaining held-back audience
        sendWinnerToRemainder(parent, best.variant);
    }

    function sendWinnerToRemainder(parent, winnerVariant) {
        var audienceListId = String(parent.get("audience_list") || "");
        var exclusionListId = String(parent.get("exclusion_list") || "");

        if (!audienceListId) return;

        // Collect all company IDs that already received a variant
        var alreadySent = {};
        try {
            var existingRecipients = $app.findRecordsByFilter(
                "email_recipients",
                "campaign = '" + parent.id + "' || campaign = '" + winnerVariant.id + "'",
                "created",
                1000, 0
            );
            // Also check other variants
            var allVariants;
            try {
                allVariants = $app.findRecordsByFilter(
                    "email_campaigns",
                    "ab_parent = '" + parent.id + "'",
                    "created", 10, 0
                );
            } catch (e) { allVariants = []; }

            for (var av = 0; av < allVariants.length; av++) {
                try {
                    var varRecipients = $app.findRecordsByFilter(
                        "email_recipients",
                        "campaign = '" + allVariants[av].id + "'",
                        "created", 500, 0
                    );
                    for (var vr = 0; vr < varRecipients.length; vr++) {
                        alreadySent[String(varRecipients[vr].get("company") || "")] = true;
                    }
                } catch (e) { /* continue */ }
            }

            for (var er = 0; er < existingRecipients.length; er++) {
                alreadySent[String(existingRecipients[er].get("company") || "")] = true;
            }
        } catch (e) { /* continue */ }

        // Resolve full audience
        var companies = resolveAudience(audienceListId, exclusionListId);

        // Filter out already-sent companies
        var remainder = [];
        for (var ci = 0; ci < companies.length; ci++) {
            if (!alreadySent[companies[ci].id]) {
                remainder.push(companies[ci]);
            }
        }

        if (remainder.length === 0) {
            $app.logger().info("[email_ab_resolver] no remaining audience", "campaign", parent.id);
            return;
        }

        $app.logger().info("[email_ab_resolver] sending winner to remainder",
            "campaign", parent.id, "count", remainder.length);

        var winnerHtml = String(winnerVariant.get("html_body") || "");
        var winnerSubject = String(winnerVariant.get("subject") || "");
        var sentCount = 0;

        for (var i = 0; i < remainder.length; i++) {
            var company = remainder[i];
            var email = String(company.get("email") || "");
            if (!email) continue;

            var trackingId = $security.randomString(32);

            // Create recipient under the parent campaign
            try {
                var recipientCollection = $app.findCollectionByNameOrId("email_recipients");
                var recipient = new Record(recipientCollection);
                recipient.set("campaign", parent.id);
                recipient.set("company", company.id);
                recipient.set("email_address", email);
                recipient.set("status", "pending");
                recipient.set("tracking_id", trackingId);
                recipient.set("open_count", 0);
                recipient.set("click_count", 0);
                $app.save(recipient);

                // Personalize & send
                var html = resolveVariables(winnerHtml, company);
                var subj = resolveVariables(winnerSubject, company);

                if (CRM_URL) {
                    html = injectTrackingPixel(html, trackingId, CRM_URL);
                    html = rewriteLinks(html, trackingId, CRM_URL);
                    html = addUnsubscribeLink(html, trackingId, CRM_URL);
                }

                var result = sendViaResend(email, subj, html, trackingId);
                if (result.success) {
                    sentCount++;
                    recipient.set("status", "sent");
                    recipient.set("sent_at", new Date().toISOString().replace("T", " ").slice(0, 23) + "Z");
                    $app.save(recipient);
                }
            } catch (e) {
                $app.logger().warn("[email_ab_resolver] send error",
                    "company", company.id, "error", String(e));
            }
        }

        // Update parent campaign sent_count
        var prevSent = parseInt(parent.get("sent_count") || "0", 10);
        parent.set("sent_count", prevSent + sentCount);
        $app.save(parent);

        $app.logger().info("[email_ab_resolver] winner sent to remainder",
            "campaign", parent.id, "sent", sentCount);
    }

    // ── Reusable helpers ───────────────────────────────────────────────────
    function resolveAudience(audienceListId, exclusionListId) {
        if (!audienceListId) return [];
        var list;
        try { list = $app.findRecordById("email_lists", audienceListId); } catch (e) { return []; }

        var companies = [];
        var listType = String(list.get("list_type") || "static");

        if (listType === "static") {
            var ids = list.get("company_ids");
            if (typeof ids === "string") { try { ids = JSON.parse(ids); } catch (e) { ids = []; } }
            if (Array.isArray(ids)) {
                for (var i = 0; i < ids.length; i++) {
                    try { companies.push($app.findRecordById("companies", ids[i])); } catch (e) {}
                }
            }
        } else if (listType === "dynamic") {
            var filterJson = list.get("filter_json");
            if (typeof filterJson === "string") { try { filterJson = JSON.parse(filterJson); } catch (e) { filterJson = {}; } }
            var conditions = [];
            if (filterJson.status) conditions.push("status = '" + filterJson.status + "'");
            if (filterJson.source) conditions.push("source = '" + filterJson.source + "'");
            if (filterJson.has_email) conditions.push("email != ''");
            conditions.push("do_not_contact != true");
            var pbFilter = conditions.length > 0 ? conditions.join(" && ") : "id != ''";
            try { companies = $app.findRecordsByFilter("companies", pbFilter, "created", 500, 0); } catch (e) {}
        }

        // Filter: has email, not suppressed
        var filtered = [];
        var suppressedEmails = {};
        try {
            var unsubs = $app.findRecordsByFilter("email_unsubscribes", "id != ''", "created", 500, 0);
            for (var ui = 0; ui < unsubs.length; ui++) {
                var addr = String(unsubs[ui].get("email_address") || "").toLowerCase();
                if (addr) suppressedEmails[addr] = true;
            }
        } catch (e) {}

        for (var fi = 0; fi < companies.length; fi++) {
            var c = companies[fi];
            var em = String(c.get("email") || "");
            if (!em || em.indexOf("@") === -1) continue;
            if (c.get("do_not_contact") === true) continue;
            if (suppressedEmails[em.toLowerCase()]) continue;
            filtered.push(c);
        }

        if (exclusionListId) {
            try {
                var exclList = $app.findRecordById("email_lists", exclusionListId);
                var exclIds = exclList.get("company_ids");
                if (typeof exclIds === "string") { try { exclIds = JSON.parse(exclIds); } catch (e) { exclIds = []; } }
                if (Array.isArray(exclIds)) {
                    var exclSet = {};
                    for (var ei = 0; ei < exclIds.length; ei++) exclSet[exclIds[ei]] = true;
                    var final = [];
                    for (var xi = 0; xi < filtered.length; xi++) {
                        if (!exclSet[filtered[xi].id]) final.push(filtered[xi]);
                    }
                    filtered = final;
                }
            } catch (e) {}
        }

        return filtered;
    }

    function resolveVariables(template, company) {
        return template.replace(/\{\{(\w+)(?:\|([^}]*))?\}\}/g, function(match, varName, fallback) {
            var key = varName.toLowerCase();
            var mapping = {
                company_name: String(company.get("company_name") || ""),
                owner_name: String(company.get("owner_name") || ""),
                email: String(company.get("email") || ""),
                status: String(company.get("status") || ""),
                source: String(company.get("source") || ""),
                instagram_handle: String(company.get("instagram_handle") || ""),
                company_location: String(company.get("company_location") || ""),
                google_rating: String(company.get("google_rating") || ""),
            };
            return mapping[key] || fallback || "";
        });
    }

    function injectTrackingPixel(html, trackingId, baseUrl) {
        var pixel = '<img src="' + baseUrl + '/api/email-tracking/open/' + trackingId + '" width="1" height="1" style="display:none" alt="" />';
        return html.indexOf("</body>") !== -1 ? html.replace("</body>", pixel + "</body>") : html + pixel;
    }

    function rewriteLinks(html, trackingId, baseUrl) {
        return html.replace(/<a\s([^>]*?)href="(https?:\/\/[^"]+)"([^>]*?)>/gi, function(match, before, url, after) {
            if (url.indexOf("/api/email-tracking/") !== -1) return match;
            return '<a ' + before + 'href="' + baseUrl + '/api/email-tracking/click/' + trackingId + '?url=' + encodeURIComponent(url) + '"' + after + '>';
        });
    }

    function addUnsubscribeLink(html, trackingId, baseUrl) {
        var footer = '<div style="text-align:center;padding:20px 0 10px;font-size:12px;color:#999;">' +
            '<a href="' + baseUrl + '/api/email-tracking/unsubscribe/' + trackingId + '" style="color:#999;text-decoration:underline;">Unsubscribe</a></div>';
        return html.indexOf("</body>") !== -1 ? html.replace("</body>", footer + "</body>") : html + footer;
    }

    function sendViaResend(to, subject, html, trackingId) {
        try {
            var res = $http.send({
                url: "https://api.resend.com/emails",
                method: "POST",
                headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
                body: JSON.stringify({
                    from: EMAIL_FROM_NAME + " <" + EMAIL_FROM + ">",
                    to: [to], subject: subject, html: html,
                    headers: { "X-Tracking-Id": trackingId },
                }),
                timeout: 30,
            });
            if (res.statusCode >= 200 && res.statusCode < 300) {
                var data = {};
                try { data = JSON.parse(String(res.raw)); } catch (e) {}
                return { success: true, messageId: data.id || "" };
            }
            return { success: false };
        } catch (e) {
            return { success: false };
        }
    }
});
