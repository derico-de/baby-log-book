# 02 — The derived read, conditional from the first commit

**What to build:** The one endpoint a Hub reads. It ships **no rows** — it runs the app's own `headerState` and `statsFor` server-side and returns a projection: the same numbers the sticky header prints, addressed to a client that cannot compute them. The app itself never calls it.

It is conditional from the first commit, not as an optimisation later: a phone disconnects, a Hub never does, and a deployment plans hundreds of Households holding idle connections.

Spec §5.4, §5.5 and §5.6 — the payload table, the ETag and the check order are all pinned there. Governed by [ADR-0034](../../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `GET /api/hub/state` takes **no parameters and no ids**: the session names the Household and the payload carries every Baby, one schema whether there is one Baby or three.
- [ ] A new store function returns **all live Entries** of the Household — deliberately not a `since`-bounded fetch, because the folds' lookbacks are unbounded and a floor would quietly break *she hasn't pooped since Tuesday*.
- [ ] **Both folds run unmodified.** The wall cannot disagree with the app's own header, because it is the same fold.
- [ ] The payload matches spec §5.5 field for field: the version block verbatim, the household block, and per Baby seven timestamps, three binaries and six totals. Epoch-milliseconds everywhere.
- [ ] Field names are **byte-for-byte the entity keys** in spec §6.5, so the integration needs no translation table.
- [ ] Inapplicable is `null`. `milk_today` and `tummy_today` are **omitted, not null**, until the Household has **ever** logged a bottle or tummy time — the gate is ever-logged, not the stats window's `has*`. Once carried, a field is never dropped again.
- [ ] `sleep_today` and `tummy_today` are whole minutes, floored server-side. `feeds_today` counts **rounds, not rows**.
- [ ] `day_reset_at` is today's Day Start instant in the Household Zone, Household-level, and becomes every total's `last_reset`.
- [ ] Strong ETag **`"<cursor>-<dayKey>-<nightBegun>"`**. The night key is load-bearing: [ADR-0040](../../../docs/adr/0040-the-night-moves-a-feed-only-once-it-has-begun.md) means `feed_due` moves at the stated Night Start with no revision and no day-key change, and without it the wall would hold a stale due instant through the evening.
- [ ] `If-None-Match` that matches answers **`304` with an empty body**.
- [ ] Check order, tested: session → removed → lapsed → ETag → fetch → fold. A quiet night costs a cursor lookup and two key computations, never a fold.
- [ ] Tests cover: the day rolling over forcing exactly one miss; the Night beginning forcing exactly one miss; a Household with no Night Period seeing no extra miss.
- [ ] A line under `## [Unreleased]` in `CHANGELOG.md`, same commit.
