// TODO: Alerts notification handler
//
// When implemented, this module will poll an `alerts` collection in PocketBase
// where CRM users can create manual alerts targeting a specific teammate.
//
// Expected `alerts` collection schema:
//   - id            : text       — PB record ID
//   - created_by    : relation → users — the user who created the alert
//   - target_user   : relation → users — the teammate to notify
//   - message       : text       — the alert message body
//   - sent          : bool       — bot sets this to true after sending the DM
//   - created       : autodate
//
// Logic (to implement):
//   1. Query: alerts where sent = false
//   2. Expand: target_user
//   3. For each record:
//      a. Get target_user.discord_user_id — skip if missing
//      b. Load user_preferences for target_user — check DND
//      c. Build an embed with the alert message and sender name
//      d. sendDM(client, discordUserId, embed)
//      e. Update record: { sent: true }
