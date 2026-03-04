/// <reference path="../pb_data/types.d.ts" />

// ============================================================================
// Discord Follow-up Cron — pb_hooks/discord_cron.pb.js
// ============================================================================
//
// Fires at xx:00 and xx:30 every hour.
//
// Each run does TWO things:
//
//   A) UPCOMING WINDOW — pending follow-ups due in the CURRENT 30-minute slot
//      Sends one rich embed per follow-up to the assigned user's personal
//      webhook AND batches them all into the team channel.
//
//   B) OVERDUE SUMMARY — ALL pending follow-ups whose scheduled_time is
//      already in the past (overdue & unresolved).
//      Sends a single "Overdue Follow-Ups" summary embed to the team channel
//      and also pings each uniquely-assigned user's personal webhook.
//      This section fires on EVERY run so the team is always aware of
//      outstanding items even when no follow-up is due in the current slot.
//
// Required environment variables:
//   CRM_URL                         Public URL of the CRM dashboard
//                                   e.g. https://crm.tableturnerr.com
//
// Optional environment variables:
//   DISCORD_TEAM_FOLLOWUPS_WEBHOOK  Team channel webhook URL — receives ALL
//                                   follow-up notifications for every user
//
// ============================================================================

cronAdd("discord_followup_check", "0,30 * * * *", function () {

    // ── Helper: HTTP webhook sender ───────────────────────────────────────
    var sendWebhook = function(url, payload) {
        if (!url || url.indexOf("https://discord.com/api/webhooks/") !== 0) {
            $app.logger().warn("[discord_cron] skipping invalid webhook URL", "url_prefix", url ? url.slice(0, 40) : "(empty)");
            return;
        }
        try {
            var res = $http.send({
                url:     url,
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(payload),
                timeout: 10,
            });
            if (res.statusCode === 429) {
                $app.logger().warn("[discord_cron] rate-limited by Discord", "retryAfter", res.headers["Retry-After"]);
            } else if (res.statusCode < 200 || res.statusCode >= 300) {
                $app.logger().warn("[discord_cron] webhook error",
                    "status", res.statusCode,
                    "body",   res.raw ? String(res.raw).slice(0, 300) : "");
            } else {
                $app.logger().info("[discord_cron] webhook sent ok", "status", res.statusCode);
            }
        } catch (e) {
            $app.logger().error("[discord_cron] $http.send failed", "error", String(e));
        }
    };

    // ── Helper: gather all data for a follow-up record ────────────────────
    var gatherData = function(fu, crmBaseUrl) {
        var data = {
            followUpId:       fu.id,
            scheduledTime:    String(fu.get("scheduled_time") || ""),
            clientTimezone:   String(fu.get("client_timezone") || ""),
            notes:            String(fu.get("notes") || ""),
            companyId:        String(fu.get("company") || ""),
            phoneRecordId:    String(fu.get("phone_number_record") || ""),
            assignedUserId:   String(fu.get("assigned_to") || ""),
            createdById:      String(fu.get("created_by") || ""),
            companyName:      "",
            companyStatus:    "",
            ownerName:        "",
            email:            "",
            instagram:        "",
            googleMapsLink:   "",
            googleRating:     "",
            googleReviews:    "",
            source:           "",
            companyUrl:       "",
            phoneNumber:      "",
            phoneLabel:       "",
            receptionistName: "",
            locationName:     "",
            locationAddress:  "",
            allPhones:        [],
            assignedUserName: "",
            createdByName:    "",
            personalWebhook:       "",
            discordFollowUpEnabled: true,
        };

        if (data.companyId) {
            try {
                var company = $app.findRecordById("companies", data.companyId);
                data.companyName    = String(company.get("company_name")         || "");
                data.companyStatus  = String(company.get("status")               || "");
                data.ownerName      = String(company.get("owner_name")           || "");
                data.email          = String(company.get("email")                || "");
                data.instagram      = String(company.get("instagram_handle")     || "");
                data.googleMapsLink = String(company.get("google_maps_link")     || "");
                data.googleRating   = String(company.get("google_rating")        || "");
                data.googleReviews  = String(company.get("google_reviews_count") || "");
                data.source         = String(company.get("source")               || "");
                if (crmBaseUrl) {
                    data.companyUrl = crmBaseUrl + "/companies/" + data.companyId;
                }
            } catch (e) {
                $app.logger().warn("[discord_cron] company not found", "id", data.companyId);
            }

            try {
                var phones = $app.findRecordsByFilter(
                    "phone_numbers",
                    "company = '" + data.companyId + "'",
                    "created", 20, 0
                );
                for (var p = 0; p < phones.length; p++) {
                    var ph = phones[p];
                    if (ph.get("disassociated") === true) continue;
                    data.allPhones.push({
                        id:           ph.id,
                        number:       String(ph.get("phone_number")      || ""),
                        label:        String(ph.get("label")             || ""),
                        receptionist: String(ph.get("receptionist_name") || ""),
                        location:     String(ph.get("location_name")     || ""),
                        address:      String(ph.get("location_address")  || ""),
                    });
                }
            } catch (e) {
                // No phone_numbers records — not fatal
            }
        }

        var primaryPhone = null;
        if (data.phoneRecordId) {
            for (var pi = 0; pi < data.allPhones.length; pi++) {
                if (data.allPhones[pi].id === data.phoneRecordId) {
                    primaryPhone = data.allPhones[pi];
                    break;
                }
            }
        }
        if (!primaryPhone && data.allPhones.length > 0) primaryPhone = data.allPhones[0];
        if (primaryPhone) {
            data.phoneNumber      = primaryPhone.number;
            data.phoneLabel       = primaryPhone.label;
            data.receptionistName = primaryPhone.receptionist;
            data.locationName     = primaryPhone.location;
            data.locationAddress  = primaryPhone.address;
        }

        var resolveUserName = function(userId) {
            if (!userId) return "";
            try {
                var u = $app.findRecordById("users", userId);
                return String(u.get("name") || u.get("email") || "");
            } catch (e) { return ""; }
        };
        data.assignedUserName = resolveUserName(data.assignedUserId);
        data.createdByName    = resolveUserName(data.createdById);
        if (!data.assignedUserName) data.assignedUserName = data.createdByName;

        var lookupUserId = data.assignedUserId || data.createdById;
        if (lookupUserId) {
            try {
                var prefs = $app.findFirstRecordByFilter(
                    "user_preferences",
                    "user = '" + lookupUserId + "'"
                );
                if (prefs) {
                    var ns = prefs.get("notification_settings");
                    if (typeof ns === "string") {
                        try { ns = JSON.parse(ns); } catch (e) { ns = null; }
                    }
                    if (ns && typeof ns === "object") {
                        data.personalWebhook = String(ns["discord_webhook_url"] || "").trim();
                        if (ns["discord_follow_up_reminders"] === false) {
                            data.discordFollowUpEnabled = false;
                        }
                    }
                }
            } catch (e) {
                // No preferences record — not fatal
            }
        }

        return data;
    };

    // ── Helper: build single follow-up embed ──────────────────────────────
    var buildEmbed = function(data, windowStart, isOverdue) {
        var BLURPLE = 0x5865F2, GREEN = 0x57F287, RED = 0xED4245;
        var schedMs = new Date(data.scheduledTime.replace(" ", "T")).getTime();
        var color = isOverdue ? RED : ((schedMs - windowStart.getTime() < 2 * 60 * 1000) ? GREEN : BLURPLE);

        var schedDate = new Date(data.scheduledTime.replace(" ", "T"));
        var timeStr = isNaN(schedDate.getTime())
            ? data.scheduledTime
            : schedDate.toLocaleString("en-US", {
                weekday: "short", month: "short", day: "numeric",
                hour: "numeric", minute: "2-digit", hour12: true,
              }) + " UTC" + (data.clientTimezone ? "  (" + data.clientTimezone + ")" : "");

        var companyDisplay = data.companyName || "Unknown Company";
        var fields = [];
        fields.push({ name: "⏰ Scheduled", value: timeStr || "—", inline: false });
        if (data.assignedUserName) fields.push({ name: "👤 Assigned To", value: data.assignedUserName, inline: true });
        if (data.companyStatus) {
            var statusEmojis = { "Cold No Reply": "🥶", "Replied": "💬", "Warm": "🔥", "Booked": "📅", "Paid": "💰", "Client": "⭐", "Excluded": "🚫" };
            fields.push({ name: "📊 Status", value: (statusEmojis[data.companyStatus] || "•") + " " + data.companyStatus, inline: true });
        }
        if (data.ownerName)  fields.push({ name: "🏢 Owner / Contact", value: data.ownerName, inline: true });
        if (data.source)     fields.push({ name: "📋 Source", value: data.source, inline: true });
        if (data.phoneNumber) {
            var phoneLines = ["`" + data.phoneNumber + "`"];
            if (data.phoneLabel)       phoneLines.push("Label: " + data.phoneLabel);
            if (data.receptionistName) phoneLines.push("Receptionist: " + data.receptionistName);
            if (data.locationName)     phoneLines.push("📍 " + data.locationName + (data.locationAddress ? ", " + data.locationAddress : ""));
            fields.push({ name: "📞 Phone", value: phoneLines.join("\n").slice(0, 1024), inline: false });
        }
        if (data.allPhones.length > 1) {
            var others = [];
            for (var i = 0; i < data.allPhones.length; i++) {
                var oph = data.allPhones[i];
                if (oph.number === data.phoneNumber) continue;
                var ln = "`" + oph.number + "`";
                if (oph.label)    ln += " · " + oph.label;
                if (oph.location) ln += " · " + oph.location;
                others.push(ln);
            }
            if (others.length > 0) fields.push({ name: "📞 Other Numbers", value: others.join("\n").slice(0, 1024), inline: false });
        }
        if (data.email)     fields.push({ name: "✉️ Email", value: data.email, inline: true });
        if (data.instagram) {
            var handle = data.instagram.startsWith("@") ? data.instagram : "@" + data.instagram;
            fields.push({ name: "📸 Instagram", value: handle, inline: true });
        }
        if (data.googleRating) {
            var ratingStr = "⭐ " + data.googleRating + (data.googleReviews ? "  (" + data.googleReviews + " reviews)" : "");
            fields.push({ name: "Google Rating", value: ratingStr, inline: true });
        }
        if (data.googleMapsLink) fields.push({ name: "🗺️ Google Maps", value: "[View on Maps →](" + data.googleMapsLink + ")", inline: true });
        if (data.notes)      fields.push({ name: "📝 Follow-up Notes", value: data.notes.slice(0, 1024), inline: false });
        if (data.companyUrl) fields.push({ name: "🔗 Open in CRM", value: "[View " + companyDisplay + " →](" + data.companyUrl + ")", inline: false });

        return {
            title:       (isOverdue ? "🚨 Overdue Follow-up — " : "🔔 Follow-up Due — ") + companyDisplay.slice(0, 200),
            url:         data.companyUrl || undefined,
            description: "**" + (data.assignedUserName || "Someone") + "** has a follow-up" +
                         (isOverdue ? " **OVERDUE**" : " due") + " with **" + companyDisplay + "**.",
            color:       color,
            fields:      fields,
            timestamp:   new Date().toISOString(),
            footer:      { text: "Tableturnerr CRM  •  Follow-up ID: " + data.followUpId },
        };
    };

    // ── Helper: build overdue summary embed ───────────────────────────────
    var buildOverdueSummaryEmbed = function(overdueDataList, crmBaseUrl) {
        var lines = [];
        for (var i = 0; i < overdueDataList.length; i++) {
            var d = overdueDataList[i];
            var company = d.companyName || "Unknown";
            var schedDate = new Date(d.scheduledTime.replace(" ", "T"));
            var timeStr = isNaN(schedDate.getTime())
                ? d.scheduledTime
                : schedDate.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) + " UTC";
            var line = "**" + (i + 1) + ".** " + (d.companyUrl ? "[" + company + "](" + d.companyUrl + ")" : company);
            line += "  ·  ⏰ " + timeStr;
            if (d.assignedUserName) line += "  ·  👤 " + d.assignedUserName;
            if (d.phoneNumber)      line += "\n    📞 `" + d.phoneNumber + "`" + (d.phoneLabel ? " · " + d.phoneLabel : "");
            if (d.notes)            line += "\n    📝 " + d.notes.slice(0, 80) + (d.notes.length > 80 ? "…" : "");
            lines.push(line);
        }

        var fields = [];
        var chunk = "";
        for (var j = 0; j < lines.length; j++) {
            var toAdd = (chunk ? "\n\n" : "") + lines[j];
            if (chunk.length + toAdd.length > 980) {
                fields.push({ name: fields.length === 0 ? "📋 Overdue Items" : "📋 Overdue Items (cont.)", value: chunk, inline: false });
                chunk = lines[j];
            } else {
                chunk += toAdd;
            }
        }
        if (chunk) fields.push({ name: fields.length === 0 ? "📋 Overdue Items" : "📋 Overdue Items (cont.)", value: chunk, inline: false });
        if (crmBaseUrl) fields.push({ name: "🔗 View All", value: "[Open Follow-Ups Dashboard →](" + crmBaseUrl + "/follow-ups)", inline: false });

        return {
            title:       "🚨 " + overdueDataList.length + " Overdue Follow-Up" + (overdueDataList.length !== 1 ? "s" : "") + " — Action Required",
            description: "The following follow-ups are **past their scheduled time** and still pending. Please action them as soon as possible.",
            color:       0xED4245,
            fields:      fields,
            timestamp:   new Date().toISOString(),
            footer:      { text: "Tableturnerr CRM  •  Overdue Summary" },
        };
    };

    // ── Helper: send personal notification ───────────────────────────────
    var sendPersonalNotification = function(data, embed) {
        if (!data.personalWebhook) return;
        if (!data.discordFollowUpEnabled) {
            $app.logger().info("[discord_cron] personal discord disabled for user",
                "userId", data.assignedUserId || data.createdById);
            return;
        }
        sendWebhook(data.personalWebhook, { username: "Tableturnerr CRM", embeds: [embed] });
    };

    // ── Config ────────────────────────────────────────────────────────────
    var TEAM_WEBHOOK = ($os.getenv("DISCORD_TEAM_FOLLOWUPS_WEBHOOK") || "").trim();
    var CRM_URL      = ($os.getenv("CRM_URL") || "").replace(/\/$/, "");

    $app.logger().info("[discord_cron] starting run",
        "team_webhook_set", TEAM_WEBHOOK !== "",
        "crm_url_set",      CRM_URL !== ""
    );

    // ── Compute current 30-minute window ─────────────────────────────────
    var now = new Date();
    var windowStart = new Date(now);
    windowStart.setSeconds(0, 0);
    windowStart.setMinutes(windowStart.getMinutes() >= 30 ? 30 : 0);
    var windowEnd = new Date(windowStart.getTime() + 30 * 60 * 1000);

    var pbDate = function(d) {
        return d.toISOString().replace("T", " ").slice(0, 23) + "Z";
    };

    // ── Section A: Upcoming follow-ups in this 30-min window ──────────────
    var upcomingFilter = "status = 'pending' && scheduled_time >= '" + pbDate(windowStart) +
                         "' && scheduled_time < '"  + pbDate(windowEnd) + "'";

    $app.logger().info("[discord_cron] querying upcoming window",
        "window_start", pbDate(windowStart),
        "window_end",   pbDate(windowEnd)
    );

    var upcomingFollowUps;
    try {
        upcomingFollowUps = $app.findRecordsByFilter(
            "follow_ups", upcomingFilter, "scheduled_time", 100, 0
        );
    } catch (e) {
        $app.logger().error("[discord_cron] failed to query upcoming follow_ups", "error", String(e));
        upcomingFollowUps = [];
    }

    $app.logger().info("[discord_cron] upcoming follow-ups found", "count", upcomingFollowUps ? upcomingFollowUps.length : 0);

    var teamUpcomingEmbeds = [];
    if (upcomingFollowUps && upcomingFollowUps.length > 0) {
        for (var i = 0; i < upcomingFollowUps.length; i++) {
            var fu = upcomingFollowUps[i];
            try {
                var data  = gatherData(fu, CRM_URL);
                var embed = buildEmbed(data, windowStart, false);
                sendPersonalNotification(data, embed);
                teamUpcomingEmbeds.push(embed);
            } catch (e) {
                $app.logger().error("[discord_cron] error processing upcoming follow-up",
                    "id", fu.id, "error", String(e));
            }
        }
        if (TEAM_WEBHOOK && teamUpcomingEmbeds.length > 0) {
            for (var s = 0; s < teamUpcomingEmbeds.length; s += 10) {
                sendWebhook(TEAM_WEBHOOK, {
                    username:   "Tableturnerr CRM",
                    avatar_url: "",
                    embeds:     teamUpcomingEmbeds.slice(s, s + 10),
                });
            }
        }
    } else {
        $app.logger().info("[discord_cron] no upcoming follow-ups in this window");
    }

    // ── Section B: Overdue summary ────────────────────────────────────────
    var overdueFilter = "status = 'pending' && scheduled_time < '" + pbDate(windowStart) + "'";

    var overdueFollowUps;
    try {
        overdueFollowUps = $app.findRecordsByFilter(
            "follow_ups", overdueFilter, "scheduled_time", 200, 0
        );
    } catch (e) {
        $app.logger().error("[discord_cron] failed to query overdue follow_ups", "error", String(e));
        overdueFollowUps = [];
    }

    $app.logger().info("[discord_cron] overdue follow-ups found", "count", overdueFollowUps ? overdueFollowUps.length : 0);

    if (overdueFollowUps && overdueFollowUps.length > 0) {
        var overdueDataList = [];
        for (var oi = 0; oi < overdueFollowUps.length; oi++) {
            try {
                overdueDataList.push(gatherData(overdueFollowUps[oi], CRM_URL));
            } catch (e) {
                $app.logger().error("[discord_cron] error gathering overdue data",
                    "id", overdueFollowUps[oi].id, "error", String(e));
            }
        }

        if (overdueDataList.length > 0) {
            if (TEAM_WEBHOOK) {
                var overdueEmbed = buildOverdueSummaryEmbed(overdueDataList, CRM_URL);
                sendWebhook(TEAM_WEBHOOK, {
                    username:   "Tableturnerr CRM",
                    avatar_url: "",
                    embeds:     [overdueEmbed],
                });
            }

            var byUser = {};
            for (var pi = 0; pi < overdueDataList.length; pi++) {
                var od = overdueDataList[pi];
                var uid = od.assignedUserId || od.createdById || "__unassigned__";
                if (!byUser[uid]) byUser[uid] = { data: od, items: [] };
                byUser[uid].items.push(od);
            }
            for (var uid in byUser) {
                var group = byUser[uid];
                if (!group.data.personalWebhook)        continue;
                if (!group.data.discordFollowUpEnabled) continue;
                sendWebhook(group.data.personalWebhook, {
                    username: "Tableturnerr CRM",
                    embeds:   [buildOverdueSummaryEmbed(group.items, CRM_URL)],
                });
            }
        }
    }
});


// ============================================================================
// SETUP INSTRUCTIONS
// ============================================================================
//
// 1. Copy this file into the `pb_hooks/` folder next to your PocketBase binary.
//
// 2. Set environment variables before starting PocketBase:
//
//    Linux / macOS:
//      export CRM_URL="https://crm.tableturnerr.com"
//      export DISCORD_TEAM_FOLLOWUPS_WEBHOOK="https://discord.com/api/webhooks/..."
//      ./pocketbase serve
//
//    Windows (PowerShell):
//      $env:CRM_URL = "https://crm.tableturnerr.com"
//      $env:DISCORD_TEAM_FOLLOWUPS_WEBHOOK = "https://discord.com/api/webhooks/..."
//      .\pocketbase.exe serve
//
//    Docker (add to your docker-compose.yml or Dockerfile):
//      environment:
//        - CRM_URL=https://crm.tableturnerr.com
//        - DISCORD_TEAM_FOLLOWUPS_WEBHOOK=https://discord.com/api/webhooks/...
//
// 3. Personal webhooks:
//    Each user pastes their own Discord webhook URL in the CRM under:
//    Settings → Notifications → Discord Notifications
//    The URL is saved in user_preferences.notification_settings.discord_webhook_url
//
// 4. PocketBase will hot-reload pb_hooks automatically — no restart needed
//    when you edit this file.
//
// 5. Check PocketBase logs for [discord_cron] lines to verify the cron is firing.
//    The first log line on each run will tell you whether the env vars are set:
//      [discord_cron] starting run  team_webhook_set=true  crm_url_set=true
//    If team_webhook_set=false the DISCORD_TEAM_FOLLOWUPS_WEBHOOK env var is missing.
//
// 6. Troubleshooting "no notifications when manually triggered":
//    The cron sends UPCOMING notifications only for follow-ups due in the
//    current 30-minute window. But Section B (Overdue Summary) sends REGARDLESS
//    — so if you have any past-due pending follow-ups you will always see a
//    notification when the cron fires (or is manually triggered).
//
// ============================================================================
