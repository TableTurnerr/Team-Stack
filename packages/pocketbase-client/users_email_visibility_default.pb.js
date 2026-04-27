/// <reference path="../pb_data/types.d.ts" />

// ============================================================================
// Users emailVisibility default — pb_hooks/users_email_visibility_default.pb.js
// ============================================================================
//
// Forces emailVisibility=true on every new `users` record so emails are
// exposed via the API by default. Runs before create so the value is
// persisted with the initial insert.
//
// ============================================================================

onRecordCreate((e) => {
    e.record.set("emailVisibility", true);
    e.next();
}, "users");
