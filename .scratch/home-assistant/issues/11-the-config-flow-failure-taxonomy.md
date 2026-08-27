# 11 — The config-flow failure taxonomy

Type: grilling
Status: open
Blocked by: 04

## Question

Graduated from the fog by [Re-binding a Hub](04-re-binding-a-hub.md): the failure cases are now enumerable, and the vocabulary is settled — [the conventions research](../research/ha-integration-conventions.md) supplies HA's idioms (form errors in the flow vs `ConfigEntryError`/`ConfigEntryAuthFailed` at setup, reconfigure vs re-auth, repair issues), [ADR-0037](../../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md) supplies where a fresh link comes from.

Map each failure to exactly one HA idiom, so the Python agent never invents a fourth:

- **At claim time, in the flow**: a spent/expired/burnt Claim Link (`used`/`expired`/`burnt`/`unknown` from `previewLink`); a URL that is not this app; plain HTTP against a public origin; a Lapsed Household answering the claim; a rescue whose Member was Removed between mint and claim (ADR-0037 burns these — what does the flow say?).
- **At runtime, after setup**: 401 → re-auth asking for a Rescue Link (settled); Lapsed → repair issue (settled by research) — confirm the *claim-time* Lapsed case doesn't want the same surface.
- **The version handshake failing** — too-old server for this integration or vice versa; where that lands may wait on [One repo or two](08-one-repo-or-two.md), so leave it explicitly open here if it does.

Small ticket: most rows are one-line decisions once seen together. The output is a table the spec ([Assemble the spec](10-assemble-the-spec.md)) pastes.
