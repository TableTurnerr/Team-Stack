/// <reference path="../pb_data/types.d.ts" />

// ============================================================================
// Email Sequence Triggers — pb_hooks/email_sequence_triggers.pb.js
// ============================================================================
//
// Record hooks that auto-enroll companies into sequences and auto-stop
// enrollments based on CRM events:
//
//   1. companies.afterUpdate  → trigger_type='status_change' sequences
//   2. companies.afterCreate  → trigger_type='new_company' sequences
//   3. interactions.afterCreate → stop enrollments if inbound email + stop_on_reply
//
// ============================================================================

// ── 1. Status Change Trigger ───────────────────────────────────────────────
onRecordAfterUpdateRequest("companies", (e) => {
    var company = e.record;
    var oldStatus = String(e.record.originalCopy()?.get("status") || "");
    var newStatus = String(company.get("status") || "");

    // Only trigger if status actually changed
    if (oldStatus === newStatus) return;

    var email = String(company.get("email") || "");
    if (!email || email.indexOf("@") === -1) return;
    if (company.get("do_not_contact") === true) return;

    // Find active sequences with trigger_type='status_change'
    var sequences;
    try {
        sequences = $app.findRecordsByFilter(
            "email_sequences",
            "status = 'active' && trigger_type = 'status_change'",
            "created",
            50, 0
        );
    } catch (e) {
        return;
    }

    if (!sequences || sequences.length === 0) return;

    for (var i = 0; i < sequences.length; i++) {
        var seq = sequences[i];
        try {
            var triggerConfig = seq.get("trigger_config");
            if (typeof triggerConfig === "string") {
                try { triggerConfig = JSON.parse(triggerConfig); } catch (e) { triggerConfig = {}; }
            }

            // Check if the new status matches the trigger config
            var triggerStatuses = triggerConfig?.statuses || triggerConfig?.status;
            if (triggerStatuses) {
                if (typeof triggerStatuses === "string") triggerStatuses = [triggerStatuses];
                var matched = false;
                for (var si = 0; si < triggerStatuses.length; si++) {
                    if (triggerStatuses[si] === newStatus) { matched = true; break; }
                }
                if (!matched) continue;
            }

            // Check not already enrolled in this sequence
            try {
                var existing = $app.findFirstRecordByFilter(
                    "email_sequence_enrollments",
                    "sequence = '" + seq.id + "' && company = '" + company.id + "' && status = 'active'"
                );
                if (existing) continue; // Already enrolled
            } catch (e) {
                // No existing enrollment — good, proceed
            }

            // Check suppression
            try {
                var unsub = $app.findFirstRecordByFilter(
                    "email_unsubscribes",
                    "email_address = '" + email.toLowerCase() + "'"
                );
                if (unsub) continue;
            } catch (e) { /* no unsub — continue */ }

            // Enroll
            enrollCompany(seq, company);

        } catch (e) {
            $app.logger().error("[email_sequence_triggers] status_change error",
                "sequence", seq.id, "company", company.id, "error", String(e));
        }
    }
});

// ── 2. New Company Trigger ─────────────────────────────────────────────────
onRecordAfterCreateRequest("companies", (e) => {
    var company = e.record;
    var email = String(company.get("email") || "");
    if (!email || email.indexOf("@") === -1) return;
    if (company.get("do_not_contact") === true) return;

    var sequences;
    try {
        sequences = $app.findRecordsByFilter(
            "email_sequences",
            "status = 'active' && trigger_type = 'new_company'",
            "created",
            50, 0
        );
    } catch (e) {
        return;
    }

    if (!sequences || sequences.length === 0) return;

    for (var i = 0; i < sequences.length; i++) {
        var seq = sequences[i];
        try {
            // Check suppression
            try {
                var unsub = $app.findFirstRecordByFilter(
                    "email_unsubscribes",
                    "email_address = '" + email.toLowerCase() + "'"
                );
                if (unsub) continue;
            } catch (e) { /* no unsub — continue */ }

            // Check audience list filter if specified
            var audienceListId = String(seq.get("audience_list") || "");
            if (audienceListId) {
                if (!companyMatchesList(company, audienceListId)) continue;
            }

            enrollCompany(seq, company);

        } catch (e) {
            $app.logger().error("[email_sequence_triggers] new_company error",
                "sequence", seq.id, "company", company.id, "error", String(e));
        }
    }
});

// ── 3. Inbound Email → Stop Enrollment ─────────────────────────────────────
onRecordAfterCreateRequest("interactions", (e) => {
    var interaction = e.record;
    var channel = String(interaction.get("channel") || "");
    var direction = String(interaction.get("direction") || "");

    if (channel !== "email" || direction !== "inbound") return;

    var companyId = String(interaction.get("company") || "");
    if (!companyId) return;

    // Find active enrollments for this company where the sequence has stop_on_reply=true
    var enrollments;
    try {
        enrollments = $app.findRecordsByFilter(
            "email_sequence_enrollments",
            "company = '" + companyId + "' && status = 'active'",
            "created",
            50, 0
        );
    } catch (e) {
        return;
    }

    if (!enrollments || enrollments.length === 0) return;

    for (var i = 0; i < enrollments.length; i++) {
        var enrollment = enrollments[i];
        try {
            var sequenceId = String(enrollment.get("sequence") || "");
            var sequence = $app.findRecordById("email_sequences", sequenceId);

            if (sequence.get("stop_on_reply") === true) {
                enrollment.set("status", "stopped_reply");
                $app.save(enrollment);
                $app.logger().info("[email_sequence_triggers] stopped enrollment on reply",
                    "enrollment", enrollment.id, "company", companyId);

                // Create event
                try {
                    var evtCollection = $app.findCollectionByNameOrId("email_events");
                    var evt = new Record(evtCollection);
                    evt.set("enrollment", enrollment.id);
                    evt.set("company", companyId);
                    evt.set("event_type", "sequence_stopped");
                    evt.set("event_data", JSON.stringify({ reason: "inbound_reply" }));
                    $app.save(evt);
                } catch (e2) { /* non-fatal */ }
            }
        } catch (e) {
            $app.logger().error("[email_sequence_triggers] stop_on_reply error",
                "enrollment", enrollment.id, "error", String(e));
        }
    }
});

// ── Helper: Enroll a company in a sequence ─────────────────────────────────
function enrollCompany(sequence, company) {
    // Find the first step to compute initial next_send_at
    var steps;
    try {
        steps = $app.findRecordsByFilter(
            "email_sequence_steps",
            "sequence = '" + sequence.id + "'",
            "step_order",
            1, 0
        );
    } catch (e) {
        return;
    }

    if (!steps || steps.length === 0) return;

    var firstStep = steps[0];
    var delayDays = parseInt(firstStep.get("delay_days") || "0", 10);
    var delayHours = parseInt(firstStep.get("delay_hours") || "0", 10);

    var nextSendAt = new Date();
    nextSendAt.setDate(nextSendAt.getDate() + delayDays);
    nextSendAt.setHours(nextSendAt.getHours() + delayHours);

    var firstStepOrder = parseInt(firstStep.get("step_order") || "0", 10);

    var enrollCollection = $app.findCollectionByNameOrId("email_sequence_enrollments");
    var enrollment = new Record(enrollCollection);
    enrollment.set("sequence", sequence.id);
    enrollment.set("company", company.id);
    enrollment.set("status", "active");
    enrollment.set("current_step", firstStepOrder);
    enrollment.set("next_send_at", nextSendAt.toISOString().replace("T", " ").slice(0, 23) + "Z");
    enrollment.set("enrolled_at", new Date().toISOString().replace("T", " ").slice(0, 23) + "Z");
    $app.save(enrollment);

    $app.logger().info("[email_sequence_triggers] enrolled company",
        "sequence", sequence.id, "company", company.id, "enrollment", enrollment.id);
}

// ── Helper: Check if company matches an audience list ──────────────────────
function companyMatchesList(company, listId) {
    try {
        var list = $app.findRecordById("email_lists", listId);
        var listType = String(list.get("list_type") || "");

        if (listType === "static") {
            var companyIds = list.get("company_ids");
            if (typeof companyIds === "string") {
                try { companyIds = JSON.parse(companyIds); } catch (e) { return true; }
            }
            if (Array.isArray(companyIds)) {
                for (var i = 0; i < companyIds.length; i++) {
                    if (companyIds[i] === company.id) return true;
                }
                return false;
            }
        } else if (listType === "dynamic") {
            var filterJson = list.get("filter_json");
            if (typeof filterJson === "string") {
                try { filterJson = JSON.parse(filterJson); } catch (e) { return true; }
            }
            if (filterJson && typeof filterJson === "object") {
                if (filterJson.status && String(company.get("status") || "") !== filterJson.status) return false;
                if (filterJson.source && String(company.get("source") || "") !== filterJson.source) return false;
                if (filterJson.has_email && !company.get("email")) return false;
            }
        }

        return true;
    } catch (e) {
        return true; // Default to match if list can't be resolved
    }
}
