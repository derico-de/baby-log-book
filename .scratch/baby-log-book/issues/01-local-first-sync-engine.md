# Local-first sync engine: build or buy?

Type: research
Status: resolved

## Question

We need offline-first writes with a **full local replica** of a household's log. Should we adopt an existing local-first sync engine, or hand-roll IndexedDB plus a pull/push endpoint pair?

Cost the hand-rolled option honestly — it is a serious contender at this scale and should not be dismissed by default.

### What the data looks like

- Append-mostly: roughly 15–20 entries per baby per day, a few thousand rows per year, single-digit megabytes.
- Client-generated UUIDs; last-write-wins on edits; soft deletes.
- One special merge rule: duplicate **open sessions** (two devices both started a sleep for the same baby) must merge at sync time, keeping the earlier start.
- Scoped per household — a device only ever replicates its own household.

### Constraints

- Must be **self-hostable inside one container** with SQLite on the server. No SaaS dependency, no separate sync service, no Postgres requirement.
- Must integrate with our own auth (see the accounts ticket) rather than imposing its own identity provider.
- SvelteKit on `adapter-node`; the client half must work in a PWA and survive being offline for days.
- Bundle size matters. So do project maturity, licence, and whether it is still maintained.

### Candidates to cover

ElectricSQL, PowerSync, RxDB, Dexie.js (with and without Dexie Cloud), TinyBase, Evolu, Triplit, Replicache/Zero, Automerge and Yjs (CRDT-based), SQLite WASM in the browser (wa-sqlite / OPFS).

### Deliverable

A comparison table plus a clear recommendation, written to `.scratch/baby-log-book/research/local-first-sync-engine.md`. Flag anything that would force a change to the single-container or SQLite constraints — that is a finding, not a blocker.

## Answer

**Hand-roll the sync, on Dexie, implementing RxDB's documented pull/push/checkpoint contract. RxDB is the named fallback; TinyBase is the alternative if UI reactivity turns out to decide it.**

Findings: [`research/local-first-sync-engine.md`](../research/local-first-sync-engine.md) — eleven candidates, bundle sizes measured from published tarballs rather than quoted from docs.

### What decided it

**"No Postgres, no separate service" eliminates the three best-funded products in the category** — and that is the most important line in the research. Zero requires Postgres 15+ with logical replication plus a separate `zero-cache`; PowerSync offers no server-side SQLite at all; ElectricSQL needs Postgres logical replication plus an Elixir service, and syncs only the *read* path, leaving writes to us anyway.

The rest fall out on: **Dexie Cloud** (own identity provider; self-hosting is a closed-source paid licence), **Evolu** (mnemonic identity plus mandatory E2EE — kills server-side export, queries and content-driven notifications), **Triplit** (AGPL-3.0-only in browser-shipped code, and ~11 months silent), **Replicache** (archived; vendor says migrate to Zero), **Automerge** (1.09–1.59 MB *gzipped* WASM to manage single-digit MB per year), **Yjs** (light and good, but turns our server SQLite into an opaque blob store, surrendering SQL over our own log), **SQLite WASM** (~540 kB gzip, and the official OPFS path demands COOP/COEP across the whole app).

Only **RxDB** and **TinyBase** survive cleanly. Both would work.

### Why hand-rolled beats both anyway

1. **The one rule we actually need is the one nothing sells us.** Every engine resolves conflicts *within* a document, row or cell. Our duplicate-open-session rule is a **cross-document business merge** — two rows with different UUIDs declared to be the same real-world sleep, keeping the earlier start, with a `merged_into` redirect so the losing device's late "stop" lands on the survivor. That is domain logic: 1–2 days whichever path we take, and an engine makes it *harder*, because it must be expressed inside someone else's write model instead of thirty lines inside our own push transaction.
2. **Buying removes less than it looks.** An engine takes the endpoint plumbing, the cursor loop and the retry/multi-tab scheduler — roughly 3–4 days of an 8–11 day, 500–800 line build. In exchange: a dependency, a schema language, 70–110 kB of bundle, and an open-core vendor relationship. (RxDB *is* open-core — OPFS/IndexedDB/SQLite/Worker storages are paid `rxdb-premium`; the free Dexie storage is fine at our scale.)
3. **Our data is small enough to make the hard problems optional.** With the whole replica at single-digit MB, "drop the local database and re-pull" is always a valid recovery move — no snapshot/bootstrap path, and a class of local-migration bugs becomes a few seconds of inconvenience. Sync engines earn their keep on partial replication, large initial loads and rich concurrent merges. We have none of those.

### What we take from the engines rather than adopt

- **Implement RxDB's protocol, not our own invention** — its three-handler contract (`pullHandler`, `pushHandler`, optional `pullStream`) is documented and battle-tested, and it makes the fallback cheap: dropping RxDB onto the *same* server endpoints becomes a client-side change, not a rewrite.
- **Read Replicache's push/pull docs as the reference design.**
- **Adopt Dexie as the local store** — it is what free RxDB would sit on anyway, so the choice is compatible with both paths.

### Two hazards to carry into the sync-protocol ticket

- **Never use wall-clock `updated_at` as the pull cursor.** A row can commit after another yet carry an earlier timestamp; a client past that watermark never sees it, and the row is silently lost forever. Use a per-household counter bumped inside the write transaction, or an append-only `changes` table keyed by rowid.
- **Clock skew is data corruption under last-write-wins**, not merely odd ordering. Mitigate with server-returned time plus a sanity window.

Neither is a hand-rolling penalty — every LWW candidate shares them.

### Reversal rule

Switch to **RxDB** if we ever need more than one household replicated per device, if multi-tab/retry scheduling produces bugs we cannot close in a week, or if a cold sync stops fitting in a few seconds on a phone. Choose **TinyBase** if UI reactivity turns out to decide it — the only survivor with first-party Svelte 5 runes bindings, ~10× smaller than RxDB, accepting a bus factor of one. Explicitly *not* a reason to switch: the duplicate-open-session rule getting complicated. That code is ours in every scenario.

### Finding to flag upward

**If "no Postgres" ever becomes negotiable, this recommendation changes** — Zero would become a serious contender. The constraint, not the engine quality, is what decided this ticket.
