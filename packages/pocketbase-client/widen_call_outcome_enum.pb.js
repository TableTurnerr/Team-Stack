/// <reference path="../pb_data/types.d.ts" />

// ============================================================================
// Widen call_logs.call_outcome enum on every custom_call_outcomes create
// pb_hooks/widen_call_outcome_enum.pb.js
// ============================================================================
//
// PocketBase select fields are strict — values not in the field's `values`
// list are rejected (or silently dropped) on save. The dashboard's "Other +"
// affordance creates a `custom_call_outcomes` record for every typed name,
// then immediately tries to save those names into `call_logs.call_outcome`.
// Without this hook, that second save quietly loses the custom value.
//
// This hook fires before each `custom_call_outcomes` create, normalises the
// name, and pushes it into the `values` array of the `call_outcome` field on
// `call_logs` if it isn't already there. Schema save and record create happen
// in the same request, so the dashboard can rely on the new value being
// accepted by the very next `call_logs` write.
//
// Idempotent — adding a name already present is a no-op (no schema save).
//
// ============================================================================

onRecordCreate((e) => {
    var raw = e.record.get("name");
    var name = (raw == null ? "" : String(raw)).trim();
    if (!name) {
        e.next();
        return;
    }
    // Persist the trimmed value so the records collection matches the enum.
    e.record.set("name", name);

    try {
        var collection = $app.findCollectionByNameOrId("call_logs");
        if (!collection) {
            e.next();
            return;
        }

        var fields = collection.fields;
        var field = null;
        for (var i = 0; i < fields.length; i++) {
            if (fields[i].name === "call_outcome") {
                field = fields[i];
                break;
            }
        }
        if (!field) {
            e.next();
            return;
        }

        var values = field.values || [];
        for (var j = 0; j < values.length; j++) {
            if (values[j] === name) {
                // Already present — nothing to do.
                e.next();
                return;
            }
        }

        values.push(name);
        field.values = values;
        $app.save(collection);
        $app.logger().info(
            "[widen_call_outcome_enum] added value to call_logs.call_outcome",
            "name", name,
            "total_values", values.length,
        );
    } catch (err) {
        // If the schema widen fails we don't want to also block the
        // custom_call_outcomes insert — log and let the create proceed. The
        // dashboard's call_log save would still fail with the original
        // validation error, which surfaces the problem visibly.
        $app.logger().error(
            "[widen_call_outcome_enum] failed to widen enum",
            "name", name,
            "error", String(err),
        );
    }

    e.next();
}, "custom_call_outcomes");
