# 11 — The config-flow failure taxonomy

Type: grilling
Status: resolved
Blocked by: 04

## Question

Graduated from the fog by [Re-binding a Hub](04-re-binding-a-hub.md): the failure cases are now enumerable, and the vocabulary is settled — [the conventions research](../research/ha-integration-conventions.md) supplies HA's idioms (form errors in the flow vs `ConfigEntryError`/`ConfigEntryAuthFailed` at setup, reconfigure vs re-auth, repair issues), [ADR-0037](../../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md) supplies where a fresh link comes from.

Map each failure to exactly one HA idiom, so the Python agent never invents a fourth:

- **At claim time, in the flow**: a spent/expired/burnt Claim Link (`used`/`expired`/`burnt`/`unknown` from `previewLink`); a URL that is not this app; plain HTTP against a public origin; a Lapsed Household answering the claim; a rescue whose Member was Removed between mint and claim (ADR-0037 burns these — what does the flow say?).
- **At runtime, after setup**: 401 → re-auth asking for a Rescue Link (settled); Lapsed → repair issue (settled by research) — confirm the *claim-time* Lapsed case doesn't want the same surface.
- **The version handshake failing** — too-old server for this integration or vice versa; where that lands may wait on [One repo or two](08-one-repo-or-two.md), so leave it explicitly open here if it does.

Small ticket: most rows are one-line decisions once seen together. The output is a table the spec ([Assemble the spec](10-assemble-the-spec.md)) pastes.

## Answer

Grilled 2026-08-28, all ten recommendations taken. No new ADR — like [The action surface](07-the-action-surface.md) and [The wire contract](09-the-wire-contract.md), this is spec content composing [ADR-0022](../../../docs/adr/0022-a-lapsed-household-stops-syncing.md), [ADR-0037](../../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md), [ADR-0038](../../../docs/adr/0038-a-hubs-member-is-marked-and-a-hub-stays-a-caregiver.md) and [ADR-0039](../../../docs/adr/0039-the-integration-gates-on-the-server-release.md).

### The flow's shape

One form field, **Claim Link** — the full pasted URL, exactly what Settings mints and WhatsApp carries. The flow parses origin + token, calls `GET /api/claim?token=…` (`previewLink` — looking never spends the link), then `POST /api/claim`. Every pre-claim failure is a **form error** so the user re-pastes; aborts are reserved for identity outcomes (`already_configured`, `wrong_member`). Initial setup accepts **both kinds** — an Invite *for a Hub* creates the Member, a Rescue Link re-binds an existing one (ADR-0037: add as much as recover). Kind is never enforced; identity is (see the wrong-Member row). The re-auth step reuses the same field and the same error rows.

Config entry `unique_id` = **Household id** — one entry per Household per HA instance; a second wall panel is a second HA instance, not a second entry. The claimed **Member id** lives in `entry.data`.

### The taxonomy — the table the spec pastes

**At claim time, in the flow** (all form errors unless marked abort):

| failure | detected by | HA idiom | key | message gist |
|---|---|---|---|---|
| link `expired` | preview / claim | form error | `link_expired` | Claim Links last 60 minutes — mint a fresh one in Settings |
| link `used` | preview / claim | form error | `link_used` | already claimed — if that wasn't you, check pending links in Settings |
| link `burnt` | preview / claim | form error | `link_burnt` | revoked (true for both a Parent's revoke and removal burning rescues — the flow needn't distinguish) |
| link `unknown` | preview / claim | form error | `link_unknown` | not a valid Claim Link |
| origin unreachable (DNS, timeout, refused) | network | form error | `cannot_connect` | standard HA key |
| origin answers, not our API shape | preview 404 / non-JSON | form error | `not_baby_log_book` | this address doesn't answer like a Baby Log Book server |
| `http://` against a public host | client-side URL check | form error | `http_public_origin` | a public address must use HTTPS; private hosts (loopback, RFC1918, `.local`/`.internal`) are exempt — self-hosters and dev stay unblocked. The flow checks; the server can't reliably see its scheme behind a proxy |
| Lapsed Household | `402 lapsed` from preview/claim, **before the link is spent** | form error | `hosting_paused` | hosting is paused; a Parent can resume it, then try again. A repair issue can't be the surface — there is no entry yet |
| server too old | version block vs `MIN_SERVER_VERSION` | form error | `server_too_old` | ADR-0039's claim-time half of the Mealie dual gate |
| Household already configured | `unique_id` | **abort** | `already_configured` | standard, via `_abort_if_unique_id_configured()` |
| claim yields a different Member than the entry (re-auth) | Member id compare, post-claim | **abort** | `wrong_member` | the link was for {name}, not this panel's Member — mint a Rescue Link for the Hub's Member. The integration first calls `DELETE /api/session` to discard the mis-claimed session: the link is spent (preview is deliberately thin, no member id — the mismatch is only visible after claiming), but nothing stays bound wrong |

**At setup and runtime:**

| failure | HA idiom | notes |
|---|---|---|
| network error at setup | `ConfigEntryNotReady` | automatic via `async_config_entry_first_refresh`; HA retries with its own backoff |
| network error / 5xx at runtime | `UpdateFailed` | entities unavailable, cadence unchanged, log once per outage (Silver `log-when-unavailable`) |
| `401 unauthenticated` | `ConfigEntryAuthFailed` → re-auth flow | asks for a Rescue Link (settled by [ticket 02](02-what-a-custom-integration-must-be.md)/[04](04-re-binding-a-hub.md)) |
| `403 removed` at runtime | repair issue + full stop — **never `ConfigEntryAuthFailed`** | a re-auth dialog would ask for a Rescue Link that cannot exist (Removal burns them, ADR-0037). Non-fixable issue `member_removed` (error): a Parent sends a new Invite for a Hub, then the integration is added again — a *new* entry, per ADR-0038's unplugged panel. Coordinator: stop SSE, `update_interval = None`, one `UpdateFailed` so entities go unavailable |
| `403 removed` at setup | `ConfigEntryError` | permanent, no retry |
| `402 lapsed` at runtime | repair issue + gentle poll | non-fixable issue `hosting_paused` (**warning** — billing state, not defect); `UpdateFailed` so entities go honestly unavailable (ADR-0022's full stop — a live-looking stale wall would be read-only sync by the back door); drop SSE (it 402s too); poll at the 5-minute floor, not the 60 s outage cadence — nothing changes while Lapsed. First 200: delete the issue (idempotent), restore SSE and normal cadence. Reactivation stays anticlimactic |
| `402 lapsed` at setup | `ConfigEntryError` + the same repair issue | keeps the entry; retry after reactivation is a reload |
| server rolls back below `MIN_SERVER_VERSION` mid-flight | **no runtime row** | deliberate operator act, out of contract per ADR-0039; surfaces as `UpdateFailed` until the next reload hits the setup gate. A per-response version check would be the fourth idiom this ticket exists to prevent |
| integration too old | repair issue *update the Baby Log Book integration* | as ADR-0039 wrote it |

### Contract consequence for the server half

`POST /api/claim` (and the preview) gain `402 { code: "lapsed" }`, checked **before the link is spent** — letting the claim succeed would burn a one-shot link and mint a session into a Household that then 402s everything. Like ticket 09's `402`, contract-only until the hosted-service effort implements Lapsed — and it gates **all** claims, not just the Hub's: a phone claiming an Invite into a Lapsed Household is the same trap. Recorded here as a consequence for that effort.
