/// <reference path="../pb_data/types.d.ts" />

// ============================================================================
// Email Sequence Engine — pb_hooks/email_sequence_engine.pb.js
// ============================================================================
//
// Cron: every 5 minutes
// Finds active sequence enrollments where next_send_at <= NOW(),
// sends the current step's email, then advances to the next step.
//
// Required environment variables:
//   RESEND_API_KEY         Resend API key
//   EMAIL_FROM_ADDRESS     From email address
//   EMAIL_FROM_NAME        From display name
//   CRM_URL                Public URL of the CRM
//
// ============================================================================

cronAdd("email_sequence_engine", "*/5 * * * *", function () {

    var RESEND_API_KEY    = ($os.getenv("RESEND_API_KEY") || "").trim();
    var EMAIL_FROM        = ($os.getenv("EMAIL_FROM_ADDRESS") || "crm@tableturnerr.com").trim();
    var EMAIL_FROM_NAME   = ($os.getenv("EMAIL_FROM_NAME") || "Tableturnerr CRM").trim();
    var CRM_URL           = ($os.getenv("CRM_URL") || "").replace(/\/$/, "");

    if (!RESEND_API_KEY) return;

    var now = new Date();
    var pbNow = now.toISOString().replace("T", " ").slice(0, 23) + "Z";

    // Find active enrollments ready to send
    var enrollments;
    try {
        enrollments = $app.findRecordsByFilter(
            "email_sequence_enrollments",
            "status = 'active' && next_send_at <= '" + pbNow + "'",
            "next_send_at",
            50, 0
        );
    } catch (e) {
        $app.logger().error("[email_sequence_engine] query error", "error", String(e));
        return;
    }

    if (!enrollments || enrollments.length === 0) return;

    $app.logger().info("[email_sequence_engine] processing enrollments", "count", enrollments.length);

    for (var i = 0; i < enrollments.length; i++) {
        try {
            processEnrollment(enrollments[i]);
        } catch (e) {
            $app.logger().error("[email_sequence_engine] enrollment error",
                "id", enrollments[i].id, "error", String(e));
        }
    }

    function processEnrollment(enrollment) {
        var sequenceId = String(enrollment.get("sequence") || "");
        var companyId = String(enrollment.get("company") || "");
        var currentStep = parseInt(enrollment.get("current_step") || "0", 10);

        // Fetch the sequence
        var sequence;
        try {
            sequence = $app.findRecordById("email_sequences", sequenceId);
        } catch (e) {
            $app.logger().warn("[email_sequence_engine] sequence not found", "id", sequenceId);
            enrollment.set("status", "stopped_manual");
            $app.save(enrollment);
            return;
        }

        // Check sequence is still active
        if (String(sequence.get("status") || "") !== "active") {
            $app.logger().info("[email_sequence_engine] sequence no longer active", "id", sequenceId);
            return;
        }

        // Fetch the company
        var company;
        try {
            company = $app.findRecordById("companies", companyId);
        } catch (e) {
            $app.logger().warn("[email_sequence_engine] company not found", "id", companyId);
            enrollment.set("status", "stopped_manual");
            $app.save(enrollment);
            return;
        }

        // Re-check suppression
        var email = String(company.get("email") || "");
        if (!email || company.get("do_not_contact") === true) {
            enrollment.set("status", "stopped_manual");
            $app.save(enrollment);
            return;
        }

        // Check suppression list
        try {
            var unsub = $app.findFirstRecordByFilter(
                "email_unsubscribes",
                "email_address = '" + email.toLowerCase() + "'"
            );
            if (unsub) {
                enrollment.set("status", "stopped_manual");
                $app.save(enrollment);
                return;
            }
        } catch (e) { /* no unsub found — continue */ }

        // Check stop conditions
        if (sequence.get("stop_on_status_change") === true) {
            var stopStatuses = sequence.get("stop_statuses");
            if (typeof stopStatuses === "string") {
                try { stopStatuses = JSON.parse(stopStatuses); } catch (e) { stopStatuses = []; }
            }
            if (Array.isArray(stopStatuses) && stopStatuses.length > 0) {
                var currentStatus = String(company.get("status") || "");
                for (var si = 0; si < stopStatuses.length; si++) {
                    if (currentStatus === stopStatuses[si]) {
                        enrollment.set("status", "stopped_status");
                        $app.save(enrollment);
                        return;
                    }
                }
            }
        }

        // Fetch the current step
        var steps;
        try {
            steps = $app.findRecordsByFilter(
                "email_sequence_steps",
                "sequence = '" + sequenceId + "' && step_order = " + currentStep,
                "step_order",
                1, 0
            );
        } catch (e) {
            $app.logger().warn("[email_sequence_engine] step query error", "error", String(e));
            return;
        }

        if (!steps || steps.length === 0) {
            // No more steps — sequence completed
            enrollment.set("status", "completed");
            $app.save(enrollment);
            $app.logger().info("[email_sequence_engine] enrollment completed",
                "enrollment", enrollment.id, "company", companyId);
            return;
        }

        var step = steps[0];

        // Check send window
        var sendWindowStart = String(step.get("send_window_start") || "");
        var sendWindowEnd = String(step.get("send_window_end") || "");
        if (sendWindowStart && sendWindowEnd) {
            var currentHour = now.getUTCHours();
            var startHour = parseInt(sendWindowStart.split(":")[0], 10);
            var endHour = parseInt(sendWindowEnd.split(":")[0], 10);
            if (currentHour < startHour || currentHour >= endHour) {
                // Outside send window — skip this cycle, will retry next cron run
                return;
            }
        }

        // Fetch template if referenced
        var htmlBody = String(step.get("body_override") || "");
        var subjectLine = String(step.get("subject_override") || "");
        var templateId = String(step.get("template") || "");

        if (templateId && (!htmlBody || !subjectLine)) {
            try {
                var template = $app.findRecordById("email_templates", templateId);
                if (!htmlBody) htmlBody = String(template.get("html_body") || "");
                if (!subjectLine) subjectLine = String(template.get("subject") || "");
            } catch (e) {
                $app.logger().warn("[email_sequence_engine] template not found", "id", templateId);
            }
        }

        if (!htmlBody || !subjectLine) {
            $app.logger().warn("[email_sequence_engine] step has no content",
                "step", step.id, "enrollment", enrollment.id);
            advanceToNextStep(enrollment, sequenceId, currentStep);
            return;
        }

        var trackingId = $security.randomString(32);

        // Personalize
        htmlBody = resolveVariables(htmlBody, company);
        subjectLine = resolveVariables(subjectLine, company);

        // Inject tracking
        if (CRM_URL) {
            htmlBody = injectTrackingPixel(htmlBody, trackingId, CRM_URL);
            htmlBody = rewriteLinks(htmlBody, trackingId, CRM_URL);
            htmlBody = addUnsubscribeLink(htmlBody, trackingId, CRM_URL);
        }

        // Create recipient record
        var recipient;
        try {
            var recipientCollection = $app.findCollectionByNameOrId("email_recipients");
            recipient = new Record(recipientCollection);
            recipient.set("company", companyId);
            recipient.set("email_address", email);
            recipient.set("status", "pending");
            recipient.set("tracking_id", trackingId);
            recipient.set("open_count", 0);
            recipient.set("click_count", 0);
            recipient.set("personalization_data", JSON.stringify({
                company_name: String(company.get("company_name") || ""),
                owner_name: String(company.get("owner_name") || ""),
            }));
            $app.save(recipient);
        } catch (e) {
            $app.logger().error("[email_sequence_engine] failed to create recipient", "error", String(e));
            return;
        }

        // Send via Resend
        var sendResult = sendViaResend(email, subjectLine, htmlBody, trackingId);

        if (sendResult.success) {
            recipient.set("status", "sent");
            recipient.set("sent_at", pbNow);
            $app.save(recipient);

            // Create event
            try {
                var evtCollection = $app.findCollectionByNameOrId("email_events");
                var evt = new Record(evtCollection);
                evt.set("recipient", recipient.id);
                evt.set("enrollment", enrollment.id);
                evt.set("company", companyId);
                evt.set("event_type", "sent");
                evt.set("event_data", JSON.stringify({
                    message_id: sendResult.messageId,
                    sequence: sequenceId,
                    step: currentStep,
                }));
                $app.save(evt);
            } catch (e) { /* non-fatal */ }

            // Create interaction
            try {
                var intCollection = $app.findCollectionByNameOrId("interactions");
                var interaction = new Record(intCollection);
                interaction.set("company", companyId);
                interaction.set("channel", "email");
                interaction.set("direction", "outbound");
                interaction.set("notes", "Sequence: " + String(sequence.get("name") || "") +
                    " — Step " + currentStep + " — Subject: " + subjectLine);
                $app.save(interaction);
            } catch (e) { /* non-fatal */ }
        }

        // Advance to next step
        advanceToNextStep(enrollment, sequenceId, currentStep);
    }

    function advanceToNextStep(enrollment, sequenceId, currentStep) {
        var nextStepOrder = currentStep + 1;

        // Check if next step exists
        var nextSteps;
        try {
            nextSteps = $app.findRecordsByFilter(
                "email_sequence_steps",
                "sequence = '" + sequenceId + "' && step_order = " + nextStepOrder,
                "step_order",
                1, 0
            );
        } catch (e) {
            nextSteps = [];
        }

        if (!nextSteps || nextSteps.length === 0) {
            // No more steps — completed
            enrollment.set("status", "completed");
            enrollment.set("current_step", currentStep);
            $app.save(enrollment);
            return;
        }

        var nextStep = nextSteps[0];
        var delayDays = parseInt(nextStep.get("delay_days") || "0", 10);
        var delayHours = parseInt(nextStep.get("delay_hours") || "0", 10);

        var nextSendAt = new Date();
        nextSendAt.setDate(nextSendAt.getDate() + delayDays);
        nextSendAt.setHours(nextSendAt.getHours() + delayHours);

        enrollment.set("current_step", nextStepOrder);
        enrollment.set("next_send_at", nextSendAt.toISOString().replace("T", " ").slice(0, 23) + "Z");
        $app.save(enrollment);
    }

    // ── Shared helpers (same as campaign sender) ───────────────────────────
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
            var encoded = encodeURIComponent(url);
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
                $app.logger().warn("[email_sequence_engine] Resend error",
                    "status", res.statusCode, "body", res.raw ? String(res.raw).slice(0, 300) : "");
                return { success: false };
            }
        } catch (e) {
            $app.logger().error("[email_sequence_engine] send failed", "to", to, "error", String(e));
            return { success: false };
        }
    }
});
