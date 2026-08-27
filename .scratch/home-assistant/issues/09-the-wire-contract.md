# 09 — The wire contract

Type: grilling
Status: open
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
