/// <reference path="../pb_data/types.d.ts" />

// ============================================================================
// Hierarchy sync — call_logs.warm_lead → call_logs.call_outcome
// pb_hooks/warm_lead_outcome_sync.pb.js
// ============================================================================
//
// Triggering the `warm_lead` boolean on a call log should also surface
// "Warm Lead" as a call outcome so reporting / filters that key off
// call_outcome stay consistent. We treat the boolean as the source of truth:
//
//   warm_lead === true  → ensure "Warm Lead" is present in call_outcome
//   warm_lead === false → ensure "Warm Lead" is absent from call_outcome
//
// `call_outcome` is a multi-select array on this collection.
//
// The hook fires on create and update. It is idempotent — already-synced
// records are not mutated.
// ============================================================================

const WARM_LEAD = "Warm Lead";

function syncWarmLeadOutcome(e) {
    try {
        const isWarm = !!e.record.get("warm_lead");
        const raw = e.record.get("call_outcome");

        let outcomes = [];
        if (Array.isArray(raw)) {
            outcomes = raw.slice();
        } else if (typeof raw === "string" && raw) {
            outcomes = [raw];
        }

        const has = outcomes.indexOf(WARM_LEAD) !== -1;

        if (isWarm && !has) {
            outcomes.push(WARM_LEAD);
            e.record.set("call_outcome", outcomes);
        } else if (!isWarm && has) {
            outcomes = outcomes.filter(function (o) { return o !== WARM_LEAD; });
            e.record.set("call_outcome", outcomes);
        }
    } catch (err) {
        $app.logger().error(
            "[warm_lead_outcome_sync] sync failed",
            "record_id", e.record ? e.record.id : "",
            "error", String(err),
        );
    }

    e.next();
}

onRecordCreate(syncWarmLeadOutcome, "call_logs");
onRecordUpdate(syncWarmLeadOutcome, "call_logs");
