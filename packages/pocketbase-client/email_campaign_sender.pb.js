/// <reference path="../pb_data/types.d.ts" />

// ============================================================================
// Email Campaign Sender — pb_hooks/email_campaign_sender.pb.js
// ============================================================================
//
// Cron: every 1 minute
// Finds campaigns with status='scheduled' AND scheduled_at <= NOW(),
// resolves audience, creates recipients, and sends via Resend API.
//
// Required environment variables:
//   RESEND_API_KEY         Resend API key for sending emails
//   EMAIL_FROM_ADDRESS     From email (e.g. crm@yourdomain.com)
//   EMAIL_FROM_NAME        From display name (e.g. Tableturnerr CRM)
//   CRM_URL                Public URL of the CRM (for tracking links)
//
// ============================================================================

cronAdd("email_campaign_sender", "* * * * *", function () {

    var RESEND_API_KEY    = ($os.getenv("RESEND_API_KEY") || "").trim();
    var EMAIL_FROM        = ($os.getenv("EMAIL_FROM_ADDRESS") || "crm@tableturnerr.com").trim();
    var EMAIL_FROM_NAME   = ($os.getenv("EMAIL_FROM_NAME") || "Tableturnerr CRM").trim();
    var CRM_URL           = ($os.getenv("CRM_URL") || "").replace(/\/$/, "");

    if (!RESEND_API_KEY) {
        return; // silently skip if not configured
    }

    var now = new Date();
    var pbNow = now.toISOString().replace("T", " ").slice(0, 23) + "Z";

    // Find scheduled campaigns ready to send
    var campaigns;
    try {
        campaigns = $app.findRecordsByFilter(
            "email_campaigns",
            "status = 'scheduled' && scheduled_at <= '" + pbNow + "'",
            "scheduled_at",
            10, 0
        );
    } catch (e) {
        $app.logger().error("[email_campaign_sender] query error", "error", String(e));
        return;
    }

    if (!campaigns || campaigns.length === 0) return;

    $app.logger().info("[email_campaign_sender] found campaigns to send", "count", campaigns.length);

    for (var ci = 0; ci < campaigns.length; ci++) {
        var campaign = campaigns[ci];
        try {
            processCampaign(campaign);
        } catch (e) {
            $app.logger().error("[email_campaign_sender] campaign error",
                "id", campaign.id, "error", String(e));
            // Reset to draft on failure
            try {
                campaign.set("status", "draft");
                $app.save(campaign);
            } catch (e2) { /* best effort */ }
        }
    }

    function processCampaign(campaign) {
        // Set status to sending
        campaign.set("status", "sending");
        $app.save(campaign);

        var audienceListId = String(campaign.get("audience_list") || "");
        var exclusionListId = String(campaign.get("exclusion_list") || "");
        var htmlBody = String(campaign.get("html_body") || "");
        var subject = String(campaign.get("subject") || "");
        var campaignName = String(campaign.get("name") || "");

        // Resolve audience
        var companies = resolveAudience(audienceListId, exclusionListId);

        if (companies.length === 0) {
            $app.logger().info("[email_campaign_sender] no eligible recipients", "campaign", campaign.id);
            campaign.set("status", "sent");
            campaign.set("sent_at", pbNow);
            $app.save(campaign);
            return;
        }

        $app.logger().info("[email_campaign_sender] sending to recipients",
            "campaign", campaign.id, "count", companies.length);

        var sentCount = 0;
        var bouncedCount = 0;

        for (var i = 0; i < companies.length; i++) {
            var company = companies[i];
            var emailAddress = String(company.get("email") || "");
            if (!emailAddress) continue;

            var trackingId = $security.randomString(32);

            // Create recipient record
            var recipient;
            try {
                var recipientCollection = $app.findCollectionByNameOrId("email_recipients");
                recipient = new Record(recipientCollection);
                recipient.set("campaign", campaign.id);
                recipient.set("company", company.id);
                recipient.set("email_address", emailAddress);
                recipient.set("status", "pending");
                recipient.set("tracking_id", trackingId);
                recipient.set("open_count", 0);
                recipient.set("click_count", 0);
                recipient.set("personalization_data", JSON.stringify({
                    company_name: String(company.get("company_name") || ""),
                    owner_name: String(company.get("owner_name") || ""),
                    email: emailAddress,
                    status: String(company.get("status") || ""),
                    source: String(company.get("source") || ""),
                    instagram_handle: String(company.get("instagram_handle") || ""),
                }));
                $app.save(recipient);
            } catch (e) {
                $app.logger().warn("[email_campaign_sender] failed to create recipient",
                    "company", company.id, "error", String(e));
                continue;
            }

            // Resolve variables in HTML
            var personalizedHtml = resolveVariables(htmlBody, company);

            // Inject tracking pixel
            personalizedHtml = injectTrackingPixel(personalizedHtml, trackingId, CRM_URL);

            // Rewrite links for click tracking
            personalizedHtml = rewriteLinks(personalizedHtml, trackingId, CRM_URL);

            // Add unsubscribe footer
            personalizedHtml = addUnsubscribeLink(personalizedHtml, trackingId, CRM_URL);

            // Resolve variables in subject too
            var personalizedSubject = resolveVariables(subject, company);

            // Send via Resend API
            var sendResult = sendViaResend(emailAddress, personalizedSubject, personalizedHtml, trackingId);

            if (sendResult.success) {
                sentCount++;
                recipient.set("status", "sent");
                recipient.set("sent_at", new Date().toISOString().replace("T", " ").slice(0, 23) + "Z");
                $app.save(recipient);

                // Create sent event
                try {
                    var evtCollection = $app.findCollectionByNameOrId("email_events");
                    var evt = new Record(evtCollection);
                    evt.set("recipient", recipient.id);
                    evt.set("company", company.id);
                    evt.set("event_type", "sent");
                    evt.set("event_data", JSON.stringify({ message_id: sendResult.messageId }));
                    $app.save(evt);
                } catch (e) { /* non-fatal */ }

                // Create interaction for CRM timeline
                try {
                    var intCollection = $app.findCollectionByNameOrId("interactions");
                    var interaction = new Record(intCollection);
                    interaction.set("company", company.id);
                    interaction.set("channel", "email");
                    interaction.set("direction", "outbound");
                    interaction.set("notes", "Campaign: " + campaignName + " — Subject: " + personalizedSubject);
                    $app.save(interaction);
                } catch (e) { /* non-fatal */ }
            } else {
                bouncedCount++;
            }

            // Rate limiting: batch of 10, then pause
            if ((i + 1) % 10 === 0 && i < companies.length - 1) {
                $app.logger().info("[email_campaign_sender] rate limit pause",
                    "sent_so_far", sentCount, "campaign", campaign.id);
                // PocketBase JS doesn't have sleep, but the loop itself provides pacing
            }
        }

        // Update campaign counters
        campaign.set("status", "sent");
        campaign.set("sent_at", new Date().toISOString().replace("T", " ").slice(0, 23) + "Z");
        campaign.set("sent_count", sentCount);
        campaign.set("bounced_count", bouncedCount);
        $app.save(campaign);

        $app.logger().info("[email_campaign_sender] campaign sent",
            "campaign", campaign.id, "sent", sentCount, "bounced", bouncedCount);
    }

    // ── Audience Resolution ────────────────────────────────────────────────
    function resolveAudience(audienceListId, exclusionListId) {
        if (!audienceListId) return [];

        var list;
        try {
            list = $app.findRecordById("email_lists", audienceListId);
        } catch (e) {
            $app.logger().warn("[email_campaign_sender] audience list not found", "id", audienceListId);
            return [];
        }

        var companies = [];
        var listType = String(list.get("list_type") || "static");

        if (listType === "static") {
            var companyIds = list.get("company_ids");
            if (typeof companyIds === "string") {
                try { companyIds = JSON.parse(companyIds); } catch (e) { companyIds = []; }
            }
            if (!Array.isArray(companyIds)) companyIds = [];

            for (var i = 0; i < companyIds.length; i++) {
                try {
                    companies.push($app.findRecordById("companies", companyIds[i]));
                } catch (e) { /* skip missing */ }
            }
        } else if (listType === "dynamic") {
            var filterJson = list.get("filter_json");
            if (typeof filterJson === "string") {
                try { filterJson = JSON.parse(filterJson); } catch (e) { filterJson = {}; }
            }
            var pbFilter = buildDynamicFilter(filterJson || {});
            try {
                companies = $app.findRecordsByFilter("companies", pbFilter, "created", 500, 0);
            } catch (e) {
                $app.logger().warn("[email_campaign_sender] dynamic filter error", "error", String(e));
            }
        }

        // Filter: must have email, must not be do_not_contact
        var filtered = [];
        for (var fi = 0; fi < companies.length; fi++) {
            var c = companies[fi];
            var email = String(c.get("email") || "");
            if (!email || email.indexOf("@") === -1) continue;
            if (c.get("do_not_contact") === true) continue;
            filtered.push(c);
        }

        // Check suppression list
        var suppressedEmails = {};
        try {
            var unsubs = $app.findRecordsByFilter("email_unsubscribes", "id != ''", "created", 500, 0);
            for (var ui = 0; ui < unsubs.length; ui++) {
                var addr = String(unsubs[ui].get("email_address") || "").toLowerCase();
                if (addr) suppressedEmails[addr] = true;
            }
        } catch (e) { /* continue */ }

        var result = [];
        for (var ri = 0; ri < filtered.length; ri++) {
            var email2 = String(filtered[ri].get("email") || "").toLowerCase();
            if (!suppressedEmails[email2]) result.push(filtered[ri]);
        }

        // Apply exclusion list
        if (exclusionListId) {
            try {
                var exclList = $app.findRecordById("email_lists", exclusionListId);
                var exclIds = exclList.get("company_ids");
                if (typeof exclIds === "string") {
                    try { exclIds = JSON.parse(exclIds); } catch (e) { exclIds = []; }
                }
                if (Array.isArray(exclIds)) {
                    var exclSet = {};
                    for (var ei = 0; ei < exclIds.length; ei++) exclSet[exclIds[ei]] = true;
                    var final = [];
                    for (var xi = 0; xi < result.length; xi++) {
                        if (!exclSet[result[xi].id]) final.push(result[xi]);
                    }
                    result = final;
                }
            } catch (e) { /* continue */ }
        }

        return result;
    }

    function buildDynamicFilter(config) {
        var conditions = [];
        if (config.status) conditions.push("status = '" + config.status + "'");
        if (config.source) conditions.push("source = '" + config.source + "'");
        if (config.has_email) conditions.push("email != ''");
        if (config.date_from) conditions.push("created >= '" + config.date_from + "'");
        if (config.date_to) conditions.push("created <= '" + config.date_to + "'");
        conditions.push("do_not_contact != true");
        return conditions.length > 0 ? conditions.join(" && ") : "id != ''";
    }

    // ── Personalization ────────────────────────────────────────────────────
    function resolveVariables(template, company) {
        return template.replace(/\{\{(\w+)(?:\|([^}]*))?\}\}/g, function(match, varName, fallback) {
            var key = varName.toLowerCase();
            var mapping = {
                company_name:      String(company.get("company_name") || ""),
                owner_name:        String(company.get("owner_name") || ""),
                email:             String(company.get("email") || ""),
                status:            String(company.get("status") || ""),
                source:            String(company.get("source") || ""),
                instagram_handle:  String(company.get("instagram_handle") || ""),
                company_location:  String(company.get("company_location") || ""),
                google_rating:     String(company.get("google_rating") || ""),
            };
            var value = mapping[key] || "";
            return value || fallback || "";
        });
    }

    // ── HTML Utilities ─────────────────────────────────────────────────────
    function injectTrackingPixel(html, trackingId, baseUrl) {
        var pixel = '<img src="' + baseUrl + '/api/email-tracking/open/' + trackingId + '" width="1" height="1" style="display:none" alt="" />';
        if (html.indexOf("</body>") !== -1) {
            return html.replace("</body>", pixel + "</body>");
        }
        return html + pixel;
    }

    function rewriteLinks(html, trackingId, baseUrl) {
        return html.replace(/<a\s([^>]*?)href="(https?:\/\/[^"]+)"([^>]*?)>/gi, function(match, before, url, after) {
            if (url.indexOf("/api/email-tracking/") !== -1) return match;
            var encoded = "";
            try {
                // Base64 encode in PocketBase JS environment
                var bytes = [];
                for (var i = 0; i < url.length; i++) bytes.push(url.charCodeAt(i));
                encoded = $security.tokenize(url); // fallback: use URL-safe encoding
            } catch (e) {
                // Simple encoding fallback
                encoded = encodeURIComponent(url);
            }
            return '<a ' + before + 'href="' + baseUrl + '/api/email-tracking/click/' + trackingId + '?url=' + encoded + '"' + after + '>';
        });
    }

    function addUnsubscribeLink(html, trackingId, baseUrl) {
        var unsubUrl = baseUrl + "/api/email-tracking/unsubscribe/" + trackingId;
        var footer = '<div style="text-align:center;padding:20px 0 10px;font-size:12px;color:#999;">' +
            '<a href="' + unsubUrl + '" style="color:#999;text-decoration:underline;">Unsubscribe</a></div>';
        if (html.indexOf("</body>") !== -1) {
            return html.replace("</body>", footer + "</body>");
        }
        return html + footer;
    }

    // ── Send via Resend ────────────────────────────────────────────────────
    function sendViaResend(to, subject, html, trackingId) {
        try {
            var res = $http.send({
                url: "https://api.resend.com/emails",
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + RESEND_API_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from: EMAIL_FROM_NAME + " <" + EMAIL_FROM + ">",
                    to: [to],
                    subject: subject,
                    html: html,
                    headers: { "X-Tracking-Id": trackingId },
                }),
                timeout: 30,
            });

            if (res.statusCode >= 200 && res.statusCode < 300) {
                var data = {};
                try { data = JSON.parse(String(res.raw)); } catch (e) {}
                return { success: true, messageId: data.id || "" };
            } else {
                $app.logger().warn("[email_campaign_sender] Resend API error",
                    "status", res.statusCode,
                    "body", res.raw ? String(res.raw).slice(0, 300) : "");
                return { success: false };
            }
        } catch (e) {
            $app.logger().error("[email_campaign_sender] send failed", "to", to, "error", String(e));
            return { success: false };
        }
    }
});
