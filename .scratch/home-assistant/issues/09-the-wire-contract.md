# 09 — The wire contract

Type: grilling
Status: resolved
Blocked by: 06

## Question

`GET /api/companion/state` pinned field by field, serving [The entity model](06-the-entity-model.md) — plus the conditional-request contract, which charting found a hole in: **[ADR-0034](../../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md)'s cursor-as-ETag only holds if the payload is a pure function of the log**, and `headerState()` returns `elapsedMs`, `remainingMs` and `overdue` — functions of `now`. A Feed goes overdue with no new revision, so a `304` would hold the Hub on a stale answer.

The likely resolution, to confirm or refute: **the endpoint ships instants only** — session starts, `lastAt`, `dueAt`, the day's totals — and the Hub derives elapsed and overdue itself, exactly as the phone ticks its timers with no traffic and exactly what `device_class: timestamp` wants. Then the payload *is* a pure function of `(log, targets, settings)` and the cursor is an honest ETag… almost: today's *totals* change at the Day Start with no revision, so either the ETag folds the day key in, or totals move client-side too, or the `304` window is bounded. Decide it.

Also pinned here:

- The exact JSON shape, one schema for all Babies (the endpoint takes no ids).
- The **error contract**: `unauthenticated`, `removed`, `lapsed` — status codes and bodies, and that `lapsed` is checked *before* any fold ([ADR-0022](../../../docs/adr/0022-a-lapsed-household-stops-syncing.md): no read-only tier by accident).
- The version/`server_time` block the Hub corrects its clock against, shared with [One repo or two](08-one-repo-or-two.md)'s handshake.
- What the server half needs from `store.ts` (`entriesSince()` beside `noticeEntries()`) and that both folds run unmodified — the card cannot disagree with the app's own header, because it is the same fold.
- SSE (`/api/sync/live`) as the refresh signal, poll as fallback, backoff **with jitter** — stated as contract so the Python agent implements it without inventing.

## Answer

Grilled 2026-08-28, all nine recommendations taken. No new ADR — like [The action surface](07-the-action-surface.md), this is spec content composing [ADR-0034](../../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md), [ADR-0036](../../../docs/adr/0036-the-deployment-never-wakes-a-hub.md) and [ADR-0022](../../../docs/adr/0022-a-lapsed-household-stops-syncing.md). The one surprising trade-off (the day key in the ETag) is server-internal and reversible because the ETag is opaque to the Hub, so it fails the hard-to-reverse test.

### The endpoint

**`GET /api/hub/state`** — not `companion`: the glossary word is **Hub**, and the API surface follows CONTEXT.md word for word like everything else. No parameters, no ids: the session names the Household, the payload carries every Baby. The name is release-coupled (the integration hardcodes the path), so it is final at first integration release.

### Conditional contract — the ETag folds the day key in

The payload is a pure function of `(log, targets, settings, dayKey)` — ADR-0036 already removed `now` from the wire (instants only) — so the honest ETag is that tuple's identity: **strong ETag `"<cursor>-<dayKey>"`**, with `dayKey = dayBucketOf(now, dayStart, zone)`, the app's own day-key function. This closes the charting hole: at the Day Start the totals reset with no new revision, and the ETag misses exactly once, refolds, and serves the new day. The Hub echoes the ETag **verbatim in `If-None-Match`, never parses it** — stated in the spec, so the format stays a server freedom. A match answers **`304` with empty body**. Check order per request: session → `removed` → `lapsed` → ETag → fetch → fold; a quiet night costs `currentCursor()` plus a day-key computation, never a fold.

### The payload

Epoch-milliseconds instants everywhere (one representation across the whole API; the integration converts with `dt_util.utc_from_timestamp(ms/1000)`). Field names byte-for-byte the entity `unique_id` keys from [The entity model](06-the-entity-model.md), so payload→entity needs no translation table:

```jsonc
{
  // versionBlock(), verbatim — the handshake block of ADR-0039
  "protocol_version": 2, "app_version": "1.18.0", "git_sha": "…", "source": "…",
  "server_time": 1724800000000,
  "cursor": 1234,                     // the same number the ETag folds in
  "household": {
    "id": "…", "name": "…",
    "day_reset_at": 1724821200000     // today's Day Start instant, Household Zone → every total's last_reset
  },
  "babies": [
    {
      "id": "…", "name": "Emma",      // HA device name, as the Household spelled her
      // timestamps (7)
      "last_feed": 1724798000000, "feed_due": 1724805200000,
      "asleep_since": null, "awake_since": 1724795000000,
      "wake_window_up": 1724801000000, "bottle_runs_out": null, "last_poop": 1724790000000,
      // binaries (3)
      "asleep": false, "feeding": false, "bottle_open": false,
      // totals (6) — sleep/tummy in minutes, floored server-side
      "feeds_today": 5, "sleep_today": 154, "tummy_today": 12,
      "pees_today": 4, "poops_today": 2, "milk_today": 240
    }
  ]
}
```

- **Inapplicable = `null`** (entity shows `unknown`), matching the entity model's existence rule.
- **`milk_today` and `tummy_today` are omitted, not null, until first use** — and the gate is **ever-logged** (a cheap predicate over the live entries the fold already fetched), *not* `statsFor`'s window-scoped `has*`: once a Household tracks tummy time, *0 minutes today* is a true statement forever, and the payload never drops a field it once carried. "The rule only adds" holds on the wire, not just in the integration.
- `day_reset_at` is Household-level — Day Start is a Household setting, not per-Baby.
- The Household device's `last_update` diagnostic needs **no field**: it is the coordinator's own "when did I last hear the server".
- Deliberately absent stays absent: no Entries, no Meals/Milestones/Measurements, no per-Entry ids.

### Error contract

Every error body is `{ "code": …, …versionBlock() }`, exactly the existing `requireMember` shape:

| status | code | integration behavior |
|---|---|---|
| 401 | `unauthenticated` | re-auth flow → fresh Claim Link |
| 403 | `removed` | config entry is dead; repair issue, stop polling |
| 402 | `lapsed` | repair issue "hosting is paused"; keep the entry, keep polling gently |

`lapsed` is checked **before any fold** (ADR-0022: no read-only tier by accident) — and before the ETag check, so a Lapsed Household cannot even learn "nothing changed". The code does not implement Lapsed yet (it lands with the hosted-service effort); the contract names it now so the Python half handles it from day one, and the status-level distinction means the integration never parses a body to know which flow it is in.

### Clock offset

`offset := server_time − local_now`, updated on **every non-304 response** (state reads and push responses), applied to merge keys per ADR-0034. 304s carry no clock channel — the nightly Day-Start miss guarantees at least one 200 per day, far tighter than the push path's five-minute `SKEW_TOLERANCE_MS`.

### Refresh cadence — numbers as contract

- SSE `GET /api/sync/live` is the wake signal; on `wake`, a conditional state read (a wake caused by the Hub's own push costs a 304). Debounce wakes ~1 s.
- Coordinator poll floor **5 minutes** while SSE is healthy — a safety net, nearly always 304.
- SSE reconnect: **exponential backoff, base 5 s, cap 5 min, full jitter** (a deploy never brings the fleet back in one second).
- While SSE is down: poll every **60 s** — the wall is the Household's live surface; five stale minutes during an outage would be noticed.

### What the server half needs

One new store function, **`liveEntries(db, householdId)`** — all live Entries of the Household — not a `since`-bounded fetch: the folds' lookbacks are unbounded (`last_poop` and `last_feed` reach arbitrarily far; `statsFor` wants 15 day-buckets; ever-logged wants the whole log), and a floor would quietly break "she hasn't pooped since Tuesday". Both folds (`headerState`, `statsFor`) run **unmodified** per ADR-0034 — the wall cannot disagree with the app's own header because it is the same fold. A heavy year is tens of thousands of SQLite rows, milliseconds to fold, and the fold only runs on content changes or once at Day Start. Escape hatch recorded, not built: if folding ever shows in a profile, memoize the rendered payload keyed by the ETag.
