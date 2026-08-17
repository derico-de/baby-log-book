# Local-first sync engine: build or buy?

Research for [issue 01](../issues/01-local-first-sync-engine.md). Status: **complete** — all eleven candidates confirmed against primary sources, synthesis sections written. Claims that could not be verified directly are marked ⚠️.

Context (given, not re-litigated): SvelteKit on `adapter-node`, one Docker container, SQLite on the server, no SaaS, no separate sync service, no Postgres requirement, our own auth, PWA offline for days. ~15–20 entries/baby/day, single-digit MB/year. Client UUIDs, last-write-wins, soft deletes, plus one merge rule: duplicate open sessions merge keeping the earlier start.

## Recommendation

**Hand-roll the sync, on Dexie, implementing RxDB's documented pull/push/checkpoint contract. Keep RxDB as the named fallback.**

### Why not buy

Eleven engines were examined; the constraints eliminate nine of them, and mostly for structural reasons rather than close calls:

- **Postgres or a second service** — ElectricSQL (Postgres with logical replication, plus an Elixir service, and it only syncs the *read* path), PowerSync (Postgres/MongoDB/MySQL/SQL Server — server-side SQLite is not offered), Zero (*"Today only Postgres is supported… v15.0 or higher… logical replication"*, plus a separate `zero-cache`). These are the three most credible commercial products in the category and all three fail the same constraint. That is the single most important finding in this document.
- **Imposes its own identity or blindness** — Dexie Cloud (own accounts/realms, and self-hosting means a closed-source paid perpetual licence), Evolu (mnemonic identity plus mandatory E2EE, which kills server-side export, queries and content-driven notifications).
- **Licence or liveness** — Triplit is AGPL-3.0-only *in code that ships to the browser*, and has been silent for about eleven months; Replicache is archived and its vendor tells users to migrate to Zero.
- **Wrong abstraction, priced as if it were right** — Automerge costs ~1.09–1.59 MB of gzipped WASM to manage a dataset measured in single-digit MB per *year*; Yjs is far lighter but turns our server-side SQLite into an opaque blob store, surrendering SQL over our own log; SQLite WASM costs ~540 kB gzip and, in the official build, cross-origin isolation of the entire application, to query a few thousand rows.

Only **RxDB** and **TinyBase** survive cleanly. Both are genuinely good, and either would work.

### Why hand-rolled wins anyway

Three specific reasons, in order of weight:

1. **The one rule we actually need is the one nothing sells us.** Every engine here resolves conflicts *within* a document, row or cell. Our duplicate-open-session rule is a **cross-document business merge** — two rows with different UUIDs declared to be the same real-world sleep, keeping the earlier start, with a `merged_into` redirect so the other device's late "stop" event lands on the survivor. That is domain logic. It costs 1–2 days whichever path we take, and adopting an engine makes it *harder*, because it must then be expressed inside someone else's write model and pushed through their change feed rather than written as thirty lines inside our own push transaction.

2. **What buying removes is smaller than it looks.** An engine takes over the endpoint plumbing, the cursor loop, and the retry/multi-tab scheduler — items 1, 3, 7 and part of 4 above, about 3–4 days of an 8–11 day build. In exchange we take on a dependency, a schema language, 70–110 kB of bundle, and an open-core vendor relationship. That is a thin margin for a permanent architectural commitment.

3. **Our data is small enough to make the hard problems optional.** Because the whole replica is single-digit MB, "drop the local database and re-pull" is always a valid recovery move. That removes the need for a snapshot/bootstrap path, converts a class of local-migration bugs into a few seconds of inconvenience, and gives us a lever that most local-first architectures cannot pull. Sync engines earn their keep by managing partial replication, large initial loads and rich concurrent merges. We have none of those problems.

There is also a soft argument that matters for a project like this: the hand-rolled version is **~500–800 lines we fully understand**, in a domain (UUIDs, LWW, soft deletes, a monotonic counter) that is well within ordinary application-code competence. A sync engine is a black box that we would nonetheless have to understand deeply the first time a night feed goes missing.

### What we should take from the engines rather than adopt

- **Implement RxDB's protocol, not our own invention.** Its three-handler contract (`pullHandler`, `pushHandler`, optional `pullStream`) is documented, client-tested against thousands of apps, and — this is the point — makes the fallback cheap. If our hand-rolled client half proves harder than budgeted, dropping RxDB in on top of the *same* server endpoints is a client-side change, not a rewrite.
- **Read Replicache's push/pull documentation as a reference design.** It is the most thoroughly explained version of this exact contract, from a team that ran it in production for five years before moving on.
- **Adopt Dexie as the local store** — it is what free RxDB would sit on anyway, so this choice is compatible with both paths.

### Decision rule for reversing this

Switch to **RxDB** if any of these become true: we need more than a single household replicated per device; multi-tab or retry scheduling produces bugs we cannot close in a week; or the dataset stops being small enough for full re-sync (roughly, if a cold sync exceeds a few seconds on a phone). Choose **TinyBase** instead if the deciding factor turns out to be UI reactivity — it is the only survivor with **first-party Svelte 5 runes bindings** and it is ~10× smaller than RxDB — accepting its effective bus factor of one.

Explicitly *not* a reason to switch: the duplicate-open-session rule getting complicated. That code is ours in every scenario.

## Hand-rolled option — honest cost

Costed as an actual work breakdown rather than a gut feeling. The shape being costed: **Dexie (IndexedDB) on the client, two SvelteKit endpoints on the server, UUIDs + last-write-wins + soft deletes, checkpoint-based pull/push.** This is not an invented design — it is the same contract RxDB specifies for its "dumb backend" ([replication.md](https://raw.githubusercontent.com/pubkey/rxdb/master/docs-src/docs/replication.md)) and the same contract Replicache built a company on. That is worth stating plainly: *the thing we would hand-roll is a well-known, documented, three-endpoint protocol, not a research project.*

### 1. Sync endpoint pair — small

Two SvelteKit routes, `GET /api/sync/pull?cursor=` and `POST /api/sync/push`. Both scoped to the household on `event.locals.session`, so household isolation is one `WHERE household_id = ?` and reuses the auth we are building anyway. Pull returns `{ rows, cursor, hasMore }` with a page limit; push takes an array of rows and returns `{ applied, conflicts, cursor }`.

**Effort: half a day.** This part is genuinely trivial and stays trivial.

### 2. Change tracking — small, but with one classic trap

Server-side, every syncable table gets a monotonic `seq INTEGER` assigned at write time, plus `updated_at` (client wall clock) and `deleted_at`.

The trap, which is worth writing down because it is the single most common way hand-rolled sync loses data: **do not use a wall-clock `updated_at` as the pull cursor.** With concurrent transactions, a row can commit *after* another row yet carry an *earlier* timestamp; a client that has advanced its watermark past that timestamp will never see it, and the row is silently lost forever. Two safe options:

- a per-household counter row bumped inside the same transaction as the write (`UPDATE household SET seq = seq + 1 ... RETURNING seq`), which SQLite's write serialisation makes correct and cheap; or
- an append-only `changes` table whose `rowid` is the cursor.

The counter is simpler and avoids a second table. Either way, this must be a documented invariant, not a convention — it is the kind of thing that is fine for two years and then eats a night's sleep log.

**Effort: half a day, including writing the invariant down.**

### 3. Cursor / watermark — small

Client keeps one integer per household in a Dexie `meta` table. Pull sends it, gets rows with `seq > cursor ORDER BY seq LIMIT n`, applies them, advances. Initial sync is the same loop from cursor `0`, which at single-digit MB completes in a couple of pages — **no separate bootstrap/snapshot path is needed**, which removes a whole subsystem that larger-scale designs require.

One rule to respect: advance the cursor **only after** the batch is committed to IndexedDB, inside the same Dexie transaction. Crash between the two and you re-fetch a page — harmless, because applying is idempotent.

**Effort: half a day.**

### 4. Conflict resolution — small, given our rules

Last-write-wins per row, compared on client `updated_at`, ties broken deterministically by `device_id` (lexicographic) so every replica reaches the same answer. Soft deletes participate in LWW like any other field — a delete is just a write that sets `deleted_at`, so an edit that genuinely happened after a delete wins, which is what a user would expect when two phones disagree.

Because rows carry client-generated UUIDs and the server upserts by primary key, **push is naturally idempotent**. That single property is what makes the whole design cheap: a lost response after a committed write costs a harmless replay, so retry logic does not need distributed-transaction thinking.

The honest caveat: LWW on client wall clocks means **clock skew becomes data corruption**, not just odd ordering. A phone an hour fast wins every conflict for an hour. Mitigations are cheap and should be in scope: have the server return its own time on each sync, store the observed offset, and either correct or refuse to accept timestamps beyond a sanity window. Note this is not a hand-rolling penalty — every LWW engine in this document has the same exposure.

**Effort: one day including the skew guard.**

### 5. The duplicate-open-session merge — the genuinely custom piece

This is the part worth reading twice, because it drives the recommendation.

The rule: two devices each start a sleep for the same baby; at sync time the two open sessions must merge, **keeping the earlier start**. Implemented server-side inside the push transaction:

1. After upserting incoming rows, select open sessions (`ended_at IS NULL`, not deleted) for each affected baby.
2. If more than one exists, the winner is the one with the earliest `started_at` (ties broken by UUID, so it is deterministic and both devices agree).
3. The losers get `deleted_at` set **and** `merged_into = <winner uuid>`.
4. Both winner and losers get new `seq` values so the merge propagates to every device on the next pull.

Step 3's `merged_into` is the subtle bit and the reason this cannot be skipped: **the losing session's device may still be holding the "stop" event.** Device B ends *its* session an hour later and pushes an update to a UUID that no longer exists as a live row. Without a redirect, that write either resurrects a deleted session or vanishes. With `merged_into`, the push handler follows the pointer and applies the end time to the winner. The redirect must be followed transitively (A→B→C) and the operation must be idempotent so a replayed push does not merge twice.

**No sync engine in this document does this for us.** Every candidate here — RxDB, TinyBase, Yjs, Automerge, Triplit, Zero — resolves conflicts *within a single document or cell*. This rule is a **cross-document business merge**: two rows with different primary keys are declared to be the same real-world event. That is domain logic, and it lands in our code no matter what we adopt. Buying an engine does not reduce this line item; if anything it complicates it, because the merge must then be expressed inside the engine's write model and made to propagate through its change feed.

**Effort: one to two days, most of it on the redirect-following and its tests.** This is the highest-risk item in the entire build and it is unavoidable.

### 6. Local store — already decided, effectively free

**Dexie** (Apache-2.0, 29 kB gzip, twelve years old, `liveQuery()` for reactive reads that Svelte consumes as an observable with `$`). Three object stores: `entries` (the replica), `outbox` (or a `_dirty` flag on entries — a flag is simpler and avoids keeping two copies in sync), `meta` (cursor, device id, clock offset).

The main alternative, SQLite WASM, costs 400–540 kB gzip and possibly cross-origin isolation of the whole app (see that section) to query a few thousand rows. Not close at this scale.

**Effort: negligible, and it is the same choice free RxDB would make underneath us.**

### 7. Retry / backoff / scheduling — medium, and the most underestimated item

This is where hand-rolling actually costs something, because it is a pile of small correct-behaviours rather than one algorithm:

- exponential backoff with jitter and a ceiling, reset on success;
- trigger on `online`, on visibility change, on app start, and after every local write (debounced);
- distinguish "offline" from "server said 4xx" — the first retries forever, the second must not spin;
- **multi-tab coordination**: two tabs pushing the same dirty rows concurrently is the most likely source of duplicate work and confusing behaviour. The Web Locks API (`navigator.locks.request`) makes single-flight sync about ten lines, and a `BroadcastChannel` tells other tabs to refresh after a pull. Both are baseline browser APIs now, but they must be remembered;
- surviving days offline: nothing special, since the outbox is durable in IndexedDB and the cursor only advances on success — but it needs a test that actually simulates it.

**Effort: one to two days.** This is the block that a sync engine would genuinely take off our hands, and the honest argument for buying.

### 8. Local replica migration — small, with a cheap escape hatch

Dexie's `db.version(n).stores({...}).upgrade(tx => ...)` is a solved, well-trodden path. Add a protocol/schema version to the sync response so a stale client is told to update rather than silently mis-parsing new fields.

The escape hatch matters more than the migration machinery: at single-digit MB, **"drop the local database and re-pull from scratch"** is a few seconds of work and is always available, because the server is the source of truth and every unsynced write lives in the outbox. Most local-first projects cannot afford that lever. We can, and it converts a class of migration bugs into a recoverable inconvenience.

**Effort: half a day, plus the discipline to always keep the escape hatch working.**

### 9. Tests — the real long tail

The code is small; the state space is not. Minimum credible coverage: offline→online transition with queued writes, partial push (server commits, response lost), clock skew in both directions, two devices editing the same row, the duplicate-open-session merge including the late "stop" event via `merged_into`, transitive merges, multi-tab single-flight, and a local schema migration with a non-empty outbox.

**Effort: two to three days.** Non-negotiable — this is the part that makes the difference between a hand-rolled sync that is fine for years and one that quietly loses a night feed.

### Bottom line

| Item | Effort |
| --- | --- |
| Sync endpoint pair | 0.5 d |
| Change tracking + monotonic seq | 0.5 d |
| Cursor / watermark | 0.5 d |
| LWW conflict resolution + clock-skew guard | 1 d |
| **Duplicate-open-session merge + redirects** | **1–2 d** |
| Local store (Dexie) wiring | 0.5 d |
| Retry / backoff / multi-tab scheduling | 1–2 d |
| Local migration + reset escape hatch | 0.5 d |
| Tests | 2–3 d |
| **Total** | **~8–11 days** |

Roughly **500–800 lines of application code** plus tests, of which the merge rule and the scheduler are the only genuinely hard parts. Adopting an engine removes at most items 1, 3, 7 and part of 4 — call it 3–4 days — while adding a dependency, a schema language, 70–110 kB of bundle, and the obligation to express item 5 inside someone else's write model.

Two things make hand-rolling unusually attractive *here* specifically, and neither generalises: the dataset is small enough that full re-sync is always a valid recovery strategy, and the conflict model (UUIDs, LWW, soft deletes) is the simplest one that exists. Both would collapse at 100× the data or with real collaborative editing. Neither is going to change for a baby log.

## Candidates

### TinyBase — *confirmed*

- **Licence**: MIT ([LICENSE](https://github.com/tinyplex/tinybase/blob/main/LICENSE)).
- **What it is**: a reactive in-memory store with optional Persisters and Synchronizers ([tinybase.org](https://tinybase.org/), [Synchronization guide](https://tinybase.org/guides/synchronization/)). `MergeableStore` is its native CRDT type — last-write-wins with reconciliation metadata ([Using a MergeableStore](https://tinybase.org/guides/synchronization/using-a-mergeablestore/)).
- **Server**: official WS sync server, `createWsServer(new WebSocketServer(...))`, wrapping a standard `ws` `WebSocketServer` ([createWsServer](https://tinybase.org/api/synchronizer-ws-server/functions/creation/createwsserver/)). It can persist to SQLite server-side via a per-path Persister factory (`persister-sqlite3`, Node native binding). **No Postgres requirement** — Postgres is one optional persister among many.
- **Embeddable?** Because it consumes a plain `ws` server, and `ws` supports attaching to an existing `http.Server`, it very plausibly runs in-process alongside adapter-node. ⚠️ **Inference from `ws`'s API, not a quoted TinyBase example** — no doc page showing the SvelteKit/Express attach was found. Verify before committing.
- **Auth**: no built-in identity system at all. Nothing to fight; integrates with our own auth cleanly.
- **Bundle**: core store ~4.8 kB min+gzip, all core modules ~9.2 kB. ⚠️ From the npm page summary, not independently re-verified on Bundlephobia. No client WASM unless you opt into `persister-sqlite-wasm`.
- **Maintenance**: v8.2.0 published ~late July 2026, betas through May 2026 — actively developed. ~4.9k stars, 123 forks. Primary maintainer `jamesgpearce`; effectively one person, though the exact contributor count could not be pulled. Version history v4→v8 reads as incremental growth, no destabilising rewrite.
- **Svelte**: official and first-class — a `ui-svelte` module built on Svelte 5 runes, plus `ui-svelte-dom` ([Building UIs With Svelte](https://tinybase.org/guides/building-uis-with-svelte/)).
- **Constraint threats**: none found. Bus factor is the flag, not a technical blocker.

### Evolu — *confirmed, with a decisive clash*

- **Licence**: MIT ([LICENSE](https://github.com/evoluhq/evolu/blob/main/LICENSE)).
- **What it is**: client-side SQLite via WASM on OPFS, every change captured as a CRDT message, with **mandatory end-to-end encryption** ([FAQ](https://www.evolu.dev/docs/faq), [How Evolu Works](https://www.evolu.dev/docs/how-evolu-works)).
- **Server**: Evolu Relay, MIT and self-hostable, Dockerfiles in `apps/relay`, described as stateless and storing via SQLite (no Postgres). ⚠️ **Whether it can run embedded in our single container rather than as its own process/port is unverified** — `evolu.dev` fetches failed repeatedly; needs a direct read of the `apps/relay` source.
- **Auth — the decisive question**: identity is a **BIP39-style mnemonic**, not an account. The relay is blind to user data by design, seeing only an anonymous `OwnerId`, timestamps and encrypted blobs. ⚠️ Sourced from a WebSearch extract of `evolu.dev/docs/privacy`, not a page fetched directly — but it is the whole premise of the architecture and is stated consistently across the FAQ and relay docs.
- **Consequence if accurate**: server-side CSV export, server-side queries and content-driven push notifications all become unworkable without client-side decryption, and the mnemonic identity model does not map onto per-person accounts inside a shared household. That is fighting the tool's core design, not configuring it.
- **Bundle**: package renamed/rewritten from `evolu` to scoped `@evolu/*`. `@evolu/react` 10.4.0 ~2 months old; `@evolu/common` version could not be reconciled between sources. Bundles a SQLite-WASM engine — ⚠️ **~1–2 MB estimated, not verified**; check the build output directly.
- **Maintenance**: 1.8k stars, 68 forks, 388 closed / 0 open PRs. Active, but the `evolu` → `@evolu/*` monorepo move was a substantial architectural rewrite, so the API and protocol are still moving.
- **Svelte**: a Svelte + Vite PWA example exists and SDK docs mention Svelte, but whether it is a first-class maintained SDK or example-level is unclear. Weaker than TinyBase's versioned `ui-svelte`.
- **Constraint threats**: **yes, potentially decisive** — see auth above, plus the unverified embedding question and the WASM payload.

### ElectricSQL — *confirmed, disqualified*

- **Licence**: Apache-2.0 ([repo metadata](https://github.com/electric-sql/electric), [LICENSE](https://github.com/electric-sql/electric/blob/main/LICENSE)). Note a [Contributor License Agreement](https://github.com/electric-sql/electric/blob/main/CLA.md) exists — relevant only if we contributed.
- **What it is**: "Real-time sync for Postgres… Specifically, Electric is a **read-path** sync engine for Postgres" ([README](https://raw.githubusercontent.com/electric-sql/electric/main/README.md), lines 27/55). It streams Postgres tables out over an [HTTP shape API](https://electric-sql.com/docs/api/http).
- **Server**: hard requirement, stated in the README's own quickstart: you must "have a Postgres database with **logical replication enabled**", then run the Electric sync service (`docker compose -f .support/docker-compose.yml up`). Two disqualifiers in one sentence — Postgres, and a separate long-running service written in Elixir, not something that can be `import`ed into adapter-node.
- **Write path**: there isn't one. Electric syncs *out of* Postgres; writes are entirely our problem, so we would still hand-roll the push endpoint and conflict handling. We would be paying the whole infrastructure cost for half the feature.
- **Auth**: gatekeeping is done by proxying the shape API behind our own endpoint, so our auth would work — irrelevant given the above.
- **Bundle**: measured from the published tarball of `@electric-sql/client@1.5.26` — `dist/index.browser.mjs` is 57 kB raw / **18 kB gzip**. Genuinely small; the weight is all server-side.
- **Maintenance**: excellent — 10.3k stars, pushed 2026-08-14, 87 versions since 2024-08. Not the problem.
- **Svelte**: no first-party `@electric-sql/svelte` package on npm (searched; the org publishes `client`, `pglite`, `pglite-*`). ⚠️ Framework integrations may live inside the monorepo docs rather than as separate packages — not chased, since the candidate is already out.
- **Constraint threats**: **decisive**. Violates "no Postgres requirement" and "no separate sync service" simultaneously, and does not even cover writes.

### PowerSync — *confirmed, disqualified*

- **Licence**: client SDK `@powersync/web` is Apache-2.0 ([npm](https://registry.npmjs.org/@powersync/web)). The **server** repo `powersync-ja/powersync-service` reports `NOASSERTION` via the GitHub API — i.e. a custom, non-standard licence file rather than a recognised OSI one ([repo](https://github.com/powersync-ja/powersync-service)). ⚠️ Not read line-by-line; flagged because "Apache client, bespoke server licence" is a common open-core shape.
- **Server**: disqualifying, and stated plainly in the service README: PowerSync "syncs between SQLite on the client-side and **Postgres, MongoDB, MySQL or SQL Server** on the server-side" ([README](https://raw.githubusercontent.com/powersync-ja/powersync-service/main/README.md), line 5). Server-side SQLite is not on the list. It also ships as its own Docker image (`journeyapps/powersync-service`) — a second container by design.
- **Auth**: PowerSync authenticates clients with JWTs we mint, so our own auth would slot in. Irrelevant given the backend requirement.
- **Bundle**: heavy. `@powersync/web@2.2.0` unpacks to **10.3 MB** and depends on `@journeyapps/wa-sqlite` — a full SQLite WASM build in the client, so realistically several hundred kB gzip on the wire before app code ([npm](https://registry.npmjs.org/@powersync/web)).
- **Maintenance**: healthy — 706 stars on the JS SDK repo, pushed 2026-08-13, 228 versions. Commercially backed.
- **Svelte**: no `@powersync/svelte` on npm; the org publishes `react`, `web`, `node`, `op-sqlite`, `common`. React-first.
- **Constraint threats**: **decisive**. Requires a server database we do not have and a separate service container.

### RxDB — *confirmed, strongest "buy" candidate*

- **Licence**: Apache-2.0 for the core ([LICENSE.txt](https://raw.githubusercontent.com/pubkey/rxdb/master/LICENSE.txt), verified — it is the literal Apache 2.0 text). **But it is open-core**: a paid `rxdb-premium` package (published in lockstep, v17.4.0) gates a long list of plugins. Confirmed against the docs source: the 👑 premium set includes the native **IndexedDB storage, OPFS storage, SQLite storage, Worker/SharedWorker storages, sharding, memory-mapped and the localStorage meta-optimizer** ([rx-storage.md](https://raw.githubusercontent.com/pubkey/rxdb/master/docs-src/docs/rx-storage.md)). The **free** browser storages are localStorage, in-memory, LokiJS and **Dexie.js** — the docs explicitly label the Dexie storage "(free)" and recommend it for bigger datasets without premium. At a few thousand rows a year, the free Dexie storage is comfortably sufficient; we would never hit the premium wall. Worth knowing the wall exists.
- **Server**: **no server requirement at all** — this is the key finding. "The backend server does not have to be an RxDB instance; you can build a replication with **any infrastructure**" ([replication.md](https://raw.githubusercontent.com/pubkey/rxdb/master/docs-src/docs/replication.md)). The sync engine deliberately puts the complexity on the client: "Complex Parts are in RxDB, not in the Backend… the backend can be 'dumb'". Our SvelteKit server implements exactly three things:
  - `pullHandler` — given a checkpoint (or null), return documents written after it, plus the new checkpoint;
  - `pushHandler` — given `{assumedMasterState, newForkState}` pairs, apply them and return the master state of any conflicts (empty array if none);
  - `pullStream` — an observable of master writes; **optional**, it can be replaced by polling on reconnect, which is all a baby log needs.
  That is the same protocol we would hand-roll (see below), already specified, already client-tested.
- **Optional RxServer**: if we ever wanted it, `rxdb-server` can "add it on top of an **existing http server** (like express) in nodejs" ([rx-server.md](https://raw.githubusercontent.com/pubkey/rxdb/master/docs-src/docs/rx-server.md)) — so even the optional server half is in-process, not a sidecar. The Fastify adapter is premium; the Express one ships with core. We probably do not need this at all: writing the three handlers as SvelteKit `+server.ts` routes is simpler.
- **Auth**: none imposed. The pull/push handlers are our own HTTP endpoints, so household scoping and session auth are ordinary SvelteKit route logic. Best-in-class fit for the "our own auth" constraint.
- **Conflict resolution**: git-style. The client sends its `assumedMasterState`; if the server's current state differs, the server returns the conflict and **RxDB resolves it on the client** via a `conflictHandler` we supply. Last-write-wins is the default shape, and our duplicate-open-session rule is expressible as custom conflict-handler logic — though note it is a *cross-document* merge (two different UUIDs), which a per-document conflict handler does **not** cover. ⚠️ That rule would still need bespoke server-side code regardless of RxDB. This is important: RxDB does not buy us out of the one genuinely custom merge rule.
- **Bundle**: measured from the `rxdb@17.4.0` tarball, gzipped ESM (unminified, so a real build will be smaller after tree-shaking and minification): core `dist/esm/*.js` **66 kB gz**, `plugins/replication` **7.7 kB gz**, `plugins/storage-dexie` **6.4 kB gz**, plus `dexie@4.4.5` minified ESM **29 kB gz**. Realistic shipped total in the **~70–110 kB gzip** band. Not trivial, but no WASM, and an order of magnitude below anything SQLite-in-the-browser.
- **Maintenance**: the healthiest in this list. 23.3k stars, 1173 forks, only 20 open issues, pushed 2026-08-15, 650 versions since 2016, v17 current. Commercially sustained by the premium plugins — a real bus-factor answer, unlike TinyBase.
- **Svelte**: **no first-party Svelte binding.** npm has `rxdb-hooks` (React) but nothing equivalent for Svelte. RxDB queries expose RxJS observables, which map onto Svelte 5 runes or `$`-stores in a few lines, so this is a small adapter we write once — but it is not the first-class support TinyBase offers.
- **Constraint threats**: none. Runs entirely in our container, no server database imposed, SQLite server-side is fine because the server is just our own code.

### Dexie.js (with and without Dexie Cloud) — *confirmed; plain Dexie yes, Dexie Cloud no*

Two very different products under one name; they must be judged separately.

**Plain Dexie.js — a local store, not a sync engine**

- **Licence**: Apache-2.0 ([npm](https://registry.npmjs.org/dexie), [repo](https://github.com/dexie/Dexie.js)).
- **What it is**: an IndexedDB wrapper — indexes, transactions, schema versioning with upgrade functions, and `liveQuery()` for reactive reads. It offers **no sync of any kind**; it is the local half only.
- **Server**: none. Nothing to host.
- **Auth**: n/a.
- **Bundle**: measured from the `dexie@4.4.5` tarball — `dist/modern/dexie.min.mjs` is 85 kB raw / **29 kB gzip**. The smallest credible local store here apart from raw IndexedDB.
- **Maintenance**: 14.5k stars, pushed 2026-08-14, 188 versions since 2014, v4 current. Twelve years old and still shipping. 594 open issues is high but is a function of age and popularity, not neglect.
- **Svelte**: no official binding. `dexie-react-hooks` is first-party (v4.4.0, 2026-03); for Svelte there is only the community `dexie-svelte-query@1.0.0` (2025-12). In practice `liveQuery()` returns an Observable that Svelte consumes directly with `$`, so the gap is cosmetic.
- **Verdict**: the **default local store** for a hand-rolled build, and also what free RxDB sits on. Its schema-versioning story (`db.version(n).stores(...).upgrade(...)`) directly answers the "migration of the local replica" line item below.

**Dexie Cloud — commercial, disqualified**

- **Licence**: the client addon `dexie-cloud-addon@4.4.14` is Apache-2.0 ([npm](https://registry.npmjs.org/dexie-cloud-addon)), but the **server is not open source**. Self-hosting is sold as a separate perpetual "Server Software License" — licence forever, source included, no storage or user limits, no recurring cost, bundled with 5 years of binary updates and 1 year of Gold Support ([Server Software License terms](https://dexie.org/cloud/server-software-license-terms), [pricing](https://dexie.org/cloud/pricing)). ⚠️ **No public price** — dexie.org renders client-side and returned an empty document to `curl`; the terms above come from a search extract, and the figure is quoted only via "contact sales". A pay-to-self-host, closed-source server is a poor fit for a personal self-hosted project even before the price is known.
- **Server**: without the on-prem licence it is a **SaaS dependency**, which the ticket rules out outright.
- **Auth**: Dexie Cloud brings **its own identity system** — accounts, email OTP login, invites and per-object sharing/realm ACLs. That is precisely the "imposes its own identity provider" pattern the constraints reject. ⚠️ Characterised from the addon's dependency surface and product docs summary rather than a fetched auth page.
- **Bundle**: `dexie-cloud-addon` unpacks to 11.6 MB and pulls in `yjs`, `y-dexie`, `y-protocols` and `rxjs` — a CRDT stack on top of Dexie. Substantially heavier than Dexie alone.
- **Constraint threats**: **decisive** — SaaS-or-paid-licence, and its own identity provider.

### Triplit — *confirmed; good fit on paper, disqualified on licence and liveness*

- **Licence**: **AGPL-3.0-only** for `@triplit/client` ([npm](https://registry.npmjs.org/@triplit/client)) and AGPL-3.0 on the repo ([GitHub](https://github.com/aspen-cloud/triplit)). The client library ships **into the browser**, so the copyleft reaches our application code, not just the server. For a project we may want to license permissively — or simply not reason about — this is a real constraint, and the standard escape hatch (a commercial licence from the vendor) depends on a vendor that appears to have stopped (below).
- **What it is**: a "full stack database" — the same database engine runs on client and server and syncs over WebSockets, with relational queries, schemas, server-enforced authorization and property-level CRDT conflict resolution ([README](https://raw.githubusercontent.com/aspen-cloud/triplit/main/README.md)).
- **Server**: genuinely good news on our constraint — pluggable storage including **SQLite** and IndexedDB, and `@triplit/server` is a plain Node server built on Hono (`@hono/node-server`, `@hono/node-ws`). No Postgres anywhere. `@triplit/server-core` is described as "protocol agnostic library for building servers running Triplit", which suggests it could be mounted in-process. ⚠️ Not verified that it embeds cleanly into adapter-node/SvelteKit rather than running standalone.
- **Auth**: token-based, verified server-side, with read/write rules attached to the schema — designed to accept externally-issued JWTs rather than owning identity. Would have fitted our auth well.
- **Bundle**: `@triplit/client@1.0.50` unpacks to 811 kB (the smallest unpacked footprint of the "full database" candidates). Not gzip-measured. ⚠️ `@triplit/db` pulls `core-js`, which is a smell for bundle bloat.
- **Maintenance**: **the disqualifier.** Last npm publish for `@triplit/client`, `@triplit/db`, `@triplit/server` and `@triplit/svelte` is all **2025-07-31**. Last commit to the repo is **2025-09-11**, and the two before it are from 2025-08-05 — i.e. roughly **eleven months of silence** as of 2026-08-15, with 40 issues open. 3.1k stars and a venture-backed vendor (Aspen Cloud) that appears to have moved on. Adopting a dormant AGPL sync protocol means we inherit maintenance of a database engine.
- **Svelte**: `@triplit/svelte` exists as a **first-party** package — one of only two candidates here with official Svelte bindings — but it is frozen at 1.0.50 (2025-07-31) alongside everything else.
- **Constraint threats**: no architectural threat; the container/SQLite story is one of the best in this list. Ruled out on **AGPL reaching client code** plus **abandonment**.

### Replicache / Zero — *confirmed, both disqualified for different reasons*

**Replicache — end-of-life**

- **Licence**: the npm `license` field is not an SPDX identifier at all, it is a URL: `"license": "https://roci.dev/terms.html"` ([npm](https://registry.npmjs.org/replicache)). Rocicorp subsequently open-sourced it and dropped all charges. ⚠️ The relicensing and zero-cost claim comes from a search extract of Rocicorp's own announcement plus [replicache.dev](https://replicache.dev/) — both `roci.dev/terms.html` and `replicache.dev` render client-side and returned empty documents to `curl`, so the current licence text was not read directly. Do not treat "it's open source now" as verified.
- **Status**: **maintenance mode.** The public repo [rocicorp/replicache](https://github.com/rocicorp/replicache) is **archived** (GitHub `archived: true`, last push 2022-05-07); development moved into the [rocicorp/mono](https://github.com/rocicorp/mono) monorepo, whose own README lists Replicache alongside Zero and files the retired Reflect under "Older Projects". Rocicorp's guidance is that existing users should migrate to Zero; no new features are planned. `replicache@15.3.0` was last published 2025-07-02 — over a year stale.
- **Server**: this was its best feature for us — Replicache is a client-side key-value store with a *push/pull endpoint contract* and no database requirement whatsoever. Its "dumb backend" design is close to what we would hand-roll. But adopting a product whose vendor tells you to migrate off it is not a decision worth defending.
- **Bundle**: 198 kB unpacked — by far the leanest of the full sync engines.
- **Verdict**: architecturally the closest commercial precedent for our hand-rolled design, and worth **reading as a reference implementation** of the push/pull contract. Not worth adopting.

**Zero — Postgres-only, disqualified**

- **Licence**: Apache-2.0 ([npm](https://registry.npmjs.org/@rocicorp/zero), [repo](https://github.com/rocicorp/mono)).
- **Server**: **hard Postgres requirement, stated unambiguously in the docs**: "In the future, Zero will work with many different backend databases. Today only Postgres is supported. Specifically, Zero requires **Postgres v15.0 or higher, and support for logical replication**" ([connecting-to-postgres](https://raw.githubusercontent.com/rocicorp/zero-docs/main/contents/docs/connecting-to-postgres.mdx)). It goes further and uses Postgres **event triggers** for schema migration. The npm dependency list corroborates it — `postgres`, `pg-format`, plus `fastify` for the standalone `zero-cache` server process.
- **Architecture**: `zero-cache` is a **separate server-side component** (its own package, its own process) sitting between Postgres and clients. Second disqualifier.
- **Auth**: JWT-based (`jose` is a direct dependency), so our auth would have worked.
- **Bundle**: 8.6 MB unpacked, and the package bundles both client and server halves.
- **Maintenance**: very active — 3.4k stars, pushed 2026-08-15, v1.9.0 published 2026-08-14, 643 versions. Not the problem.
- **Svelte**: no first-party binding; the community `zero-svelte@2.0.0` (2026-07-17, [stolinski/zero-svelte](https://github.com/stolinski/zero-svelte)) is the option.
- **Constraint threats**: **decisive** — Postgres 15+ with logical replication, plus a separate `zero-cache` service.

### Automerge — *confirmed; disqualified on payload and modelling mismatch*

- **Licence**: MIT ([npm](https://registry.npmjs.org/@automerge/automerge-repo), [repo](https://github.com/automerge/automerge-repo)). Cleanest licence in the list.
- **What it is**: a general-purpose JSON CRDT with full operation history, implemented in Rust and shipped to the browser as WebAssembly. `automerge-repo` adds document management, storage adapters and network adapters on top.
- **Server**: no database requirement — `@automerge/automerge-repo-sync-server` is a small Node/Express + `ws` process storing documents on the filesystem (`@automerge/automerge-repo-storage-nodefs`) ([npm](https://registry.npmjs.org/@automerge/automerge-repo-sync-server)). Being Express-based it would plausibly mount in-process. **But that package was last published 2024-07-03** — two years stale while the core moved on. We would end up writing our own sync-server wiring against `automerge-repo`'s network adapters. ⚠️ In-process mounting inferred from the Express dependency, not from a documented example.
- **Auth**: nothing imposed; auth is per-connection, so our session cookie would gate the WebSocket. Fine.
- **Bundle**: **the disqualifier.** Measured from the `@automerge/automerge@3.4.1` tarball: `automerge.wasm` is **3.57 MB raw**, and the gzipped variants measure **~1.09–1.59 MB gzip** depending on build (`dist/mjs/wasm_bindgen_output/workerd/automerge_wasm_bg.wasm` = 1.09 MB gz; the base64-inlined builds 1.57–1.59 MB gz). For an app whose entire dataset is single-digit MB *per year*, shipping ~1 MB of compressed WASM to every device to manage it is absurd — the engine outweighs a decade of data.
- **Maintenance**: active but unsettled — `automerge-repo` latest is **2.6.0-alpha.3** (a prerelease), 701 stars, 76 open issues, pushed 2026-08-15.
- **Svelte**: no first-party binding. First-party hooks exist for React (`@automerge/automerge-repo-react-hooks`); for Svelte only the community `@onsetsoftware/automerge-svelte@0.19.0`, **last published 2024-04-15** and therefore pre-Svelte-5.
- **Modelling mismatch**: Automerge's value is *rich concurrent merging of shared documents* — merging concurrent edits inside a text field or a nested object. Our data is an append-mostly log of independent rows with client-generated UUIDs, last-write-wins and soft deletes. There is essentially no concurrent-edit problem to solve; the two devices touching the same row is a rarity, and the one interesting case (duplicate open sessions) is a **cross-document business rule** that no CRDT resolves for us. We would pay the full CRDT tax for a problem we do not have.
- **Constraint threats**: no container/SQLite threat. Ruled out on ~1 MB gzip WASM, alpha-versioned repo layer, stale Svelte and server packages, and a wrong-shaped abstraction.

### Yjs — *confirmed; technically viable, wrong abstraction*

- **Licence**: MIT ([npm](https://registry.npmjs.org/yjs)). The GitHub API reports `NOASSERTION` for the repo, which reflects a licence file its detector could not classify rather than a restriction — npm metadata and the project consistently state MIT. ⚠️ LICENSE file not read line-by-line.
- **What it is**: the most battle-tested CRDT implementation in JavaScript — shared types (`Y.Map`, `Y.Array`, `Y.Text`) that merge concurrent updates, plus a binary update/state-vector protocol. Written in plain JavaScript, **no WASM**, which is its decisive advantage over Automerge.
- **Server**: no database requirement. `y-websocket@3.1.0` (MIT, published 2026-08-06, deps only `lib0` and `y-protocols`) provides a WebSocket sync server; persistence is a pluggable provider, so writing updates into our SQLite is a small adapter. Because the server side is plain Node with a `ws` server, running it in-process alongside adapter-node is realistic. ⚠️ In-process mounting not verified against a documented SvelteKit example.
- **Auth**: nothing imposed — auth happens at the WebSocket upgrade, which our SvelteKit/`ws` handler controls. Clean fit.
- **Bundle**: measured from the `yjs@13.6.32` tarball — `dist/yjs.mjs` is 292 kB raw / **61 kB gzip**, but the published dist is **not minified**, so a real production build lands materially lower (rough expectation ~30–40 kB gz). ⚠️ Not independently minified and re-measured. Add `y-protocols` and a provider on top. Roughly Dexie-class, and about 25× lighter than Automerge.
- **Maintenance**: excellent and long-lived — 22.4k stars, 313 versions since 2015, pushed 2026-08-06. Enormous ecosystem (Tiptap, Lexical, Liveblocks all build on it), which is strong evidence it will still exist in five years.
- **Svelte**: no first-party binding, and no maintained community one — the closest general-purpose wrapper, `@syncedstore/core`, was last published **2023-10-15**. We would write the reactive glue ourselves.
- **The real objection — server-side opacity**: Yjs persists a document as an **opaque binary update log**, not as rows. Our server would hold a blob it cannot `SELECT` against. Server-side CSV export, per-household queries and content-driven push notifications would all require the server to load the `Y.Doc` into memory and materialise it in JavaScript. That is *possible* — Yjs runs fine in Node, so unlike Evolu's E2EE this is not a hard wall — but it means giving up SQL over our own data and reimplementing querying in application code. For a log we will want to report over, that is a bad trade. A second, quieter cost: a CRDT update log **only grows**; garbage collection helps but the document never shrinks the way a row-based table does, which sits awkwardly with "single-digit MB/year, forever".
- **Modelling mismatch**: same as Automerge. A `Y.Array` of log entries gives us conflict-free concurrent appends — which we get for free anyway from client-generated UUIDs — and gives us nothing for the duplicate-open-session rule.
- **Constraint threats**: SQLite survives as a *blob store* rather than as a queryable database. Flagged as a finding, not a blocker.

### SQLite WASM in the browser (wa-sqlite / OPFS) — *confirmed; not a sync engine, and expensive*

This is a **local store option**, not a sync engine — it answers "what holds the replica", the same slot as Dexie/IndexedDB. It buys nothing towards sync.

**Official `@sqlite.org/sqlite-wasm`**

- **Licence**: Apache-2.0 per npm ([npm](https://registry.npmjs.org/@sqlite.org/sqlite-wasm)); SQLite itself is public domain. The GitHub API reports no detected licence on [sqlite/sqlite-wasm](https://github.com/sqlite/sqlite-wasm). ⚠️ Not read directly; the permissive status is not in doubt.
- **Bundle**: **the disqualifier.** Measured from the `3.53.0-build1` tarball: `dist/sqlite3.wasm` is 844 kB raw / **391 kB gzip**, and the JS glue `dist/index.mjs` is 564 kB raw / **151 kB gzip** (the worker build `sqlite3-worker1.mjs` is essentially the same size). Call it **~540 kB gzip** before a line of our own code — roughly 5–7× the entire RxDB + Dexie stack, to store a few thousand rows.
- **Deployment constraint — a real finding**: OPFS persistence only works in a Worker, and the README's own instructions require serving the app **cross-origin isolated**: `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` ([README](https://raw.githubusercontent.com/sqlite/sqlite-wasm/main/README.md), lines 42–44 and 124–125). "Only the worker versions allow you to use the origin private file system (OPFS) storage back-end" (line 34) — the main-thread build has **no persistence at all**. Cross-origin isolation is a global property of the document: it must be set on our SvelteKit responses and it breaks embedding any third-party resource that does not send CORP headers. That is a permanent architectural tax on the whole app, paid for a storage backend.
- **Deprecation note**: the README states that "as of 2026-04-15" the **Worker1 and Promiser1 APIs are deprecated** (they will not be removed). Since the worker API is the only one with OPFS, this means the documented persistence path is on a deprecated interface. ⚠️ Which API supersedes it was not chased.
- **Maintenance**: active — 1040 stars, pushed 2026-07-13, 84 versions.

**`wa-sqlite` (rhashimoto)**

- **Licence**: **MIT** since 2023-02-10, changed from GPLv3 by sponsorship; existing licensees may stay on GPLv3 ([README](https://raw.githubusercontent.com/rhashimoto/wa-sqlite/master/README.md), lines 75–78).
- **Packaging caveat**: the npm package literally named `wa-sqlite` is **not the real thing** — v1.0.0, published 2024-01-05, single version ever, **no repository field and no licence field** in its metadata ([npm](https://registry.npmjs.org/wa-sqlite)). The maintained project is consumed from GitHub, or via a fork such as `@journeyapps/wa-sqlite@2.0.3` (2026-08-13), which is what PowerSync ships. Anyone installing `wa-sqlite` from npm by name should check what they got.
- **What it adds over the official build**: a pluggable VFS layer with several OPFS strategies (`AccessHandlePoolVFS`, `OPFSCoopSyncVFS`, `OPFSAdaptiveVFS`, `OPFSWriteAheadVFS`) and IndexedDB-backed VFSes (`IDBBatchAtomicVFS`, `IDBMirrorVFS`). Notably, the `AccessHandlePoolVFS` / `OPFSCoopSyncVFS` configurations run against the non-asyncify build, which is the usual route to **avoiding the COOP/COEP requirement** — the main practical reason to prefer wa-sqlite over the official package. ⚠️ The COOP/COEP-free claim is inferred from the VFS/build matrix in the README, not from an explicit statement.
- **Bundle**: the npm tarball unpacks to 2.18 MB. Comparable order to the official build.
- **Maintenance**: healthy for a single-maintainer project — 1403 stars, only 9 open issues, pushed 2026-08-11.
- **Svelte**: n/a — it is a database, not a UI library.

**Verdict**: SQLite in the browser earns its cost when you need real SQL over tens of thousands of rows offline, or when you want the same queries on client and server. We have a few thousand rows a year. Paying ~400–540 kB gzip and, in the official build's case, cross-origin isolation of the entire application, to avoid writing a handful of IndexedDB queries is a bad trade. **IndexedDB via Dexie is the right local store at this scale.**

## Comparison table

Bundle figures are **measured from published npm tarballs** (gzip of the shipped dist), not quoted from docs, except where marked. "Server DB" is the disqualifier column.

| Candidate | Licence | Server requirement | One container? | Own auth? | Client bundle (gzip, measured) | Svelte | Maintained | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Hand-rolled** (Dexie + 2 endpoints) | ours | **our SQLite** | ✅ by construction | ✅ it *is* our auth | **~29 kB** (Dexie only) | native — `liveQuery()` + `$` | us | **Recommended** |
| **RxDB** (free tier + Dexie storage) | Apache-2.0, **open-core** (👑 premium plugins) | **none — "any infrastructure"** | ✅ our own endpoints | ✅ nothing imposed | ~70–110 kB (core 66 + repl 8 + dexie-storage 6 + dexie 29, unminified) | ❌ no first-party; RxJS→runes glue | ✅✅ 23.3k★, pushed 2026-08-15, v17 | **Runner-up / fallback** |
| **TinyBase** | MIT | none (optional WS server, SQLite persisters) | ✅ likely in-process ⚠️ | ✅ nothing imposed | ~4.8–9.2 kB ⚠️ (from npm page, not re-measured) | ✅✅ **first-party `ui-svelte`, Svelte 5 runes** | ✅ v8.2 mid-2026; **bus factor ≈ 1** | Strong second buy option |
| **Dexie.js** (plain) | Apache-2.0 | none — **no sync at all** | ✅ | ✅ | **29 kB** (`dexie.min.mjs`) | community only | ✅✅ 14.5k★, 12 yrs, pushed 2026-08-14 | **Adopt as the local store** |
| Dexie **Cloud** | client Apache-2.0; **server closed, paid perpetual licence** ⚠️ | SaaS, or paid on-prem | ❌ paid/SaaS | ❌ **own identity provider** | heavy (11.6 MB unpacked, bundles Yjs) | community only | ✅ active | ❌ SaaS + own auth |
| **Evolu** | MIT | Evolu Relay (SQLite, self-hostable) | ⚠️ unverified | ❌ **mnemonic identity, mandatory E2EE** | ~1–2 MB ⚠️ est. (SQLite WASM) | example-level | ✅ but mid-rewrite | ❌ E2EE kills server-side export/queries/notifications |
| **ElectricSQL** | Apache-2.0 | **Postgres + logical replication**, separate Elixir service | ❌ | ✅ (proxy pattern) | **18 kB** (`index.browser.mjs`) | ❌ none on npm | ✅✅ 10.3k★ | ❌ Postgres, separate service, **read-path only** |
| **PowerSync** | client Apache-2.0; service `NOASSERTION` ⚠️ | **Postgres / MongoDB / MySQL / SQL Server** + own Docker service | ❌ | ✅ (JWT) | heavy (10.3 MB unpacked, wa-sqlite WASM) | ❌ none | ✅ 706★, pushed 2026-08-13 | ❌ no server-side SQLite option |
| **Zero** (Rocicorp) | Apache-2.0 | **Postgres 15+ w/ logical replication + event triggers**, separate `zero-cache` | ❌ | ✅ (JWT/`jose`) | heavy (8.6 MB unpacked) | community `zero-svelte` | ✅✅ v1.9.0, 2026-08-14 | ❌ Postgres-only, by the docs |
| **Replicache** | **URL, not SPDX** (`roci.dev/terms.html`) ⚠️ | none — push/pull endpoints | ✅ | ✅ | 198 kB unpacked (leanest engine) | ❌ | ❌ **archived repo, maintenance mode, migrate to Zero** | ❌ EOL — but **read as a reference design** |
| **Triplit** | **AGPL-3.0-only** (reaches client code) | SQLite/IndexedDB, Hono Node server, **no Postgres** | ✅ likely ⚠️ | ✅ (JWT + schema rules) | 811 kB unpacked | ✅ first-party `@triplit/svelte` (frozen) | ❌ **~11 months silent** (npm 2025-07-31, commit 2025-09-11) | ❌ AGPL + dormant |
| **Automerge** | MIT | none (fs-based sync server, **stale 2024-07**) | ⚠️ inferred | ✅ | **1.09–1.59 MB WASM** (3.57 MB raw) | community, **pre-Svelte-5 (2024-04)** | ⚠️ repo layer on `2.6.0-alpha.3` | ❌ ~1 MB gzip to manage MBs/yr |
| **Yjs** | MIT | none (`y-websocket`, pluggable persistence) | ✅ plausible ⚠️ | ✅ (at WS upgrade) | **61 kB** unminified (~30–40 kB minified ⚠️) | none maintained (`@syncedstore` 2023) | ✅✅ 22.4k★, 11 yrs | ❌ server holds an **opaque blob** — no SQL over our own data |
| **SQLite WASM** (official) | Apache-2.0 | n/a — local store only | ✅ | n/a | **~540 kB** (wasm 391 + glue 151) | n/a | ✅ | ❌ cost + **COOP/COEP required for OPFS** |
| **wa-sqlite** | **MIT** (since 2023-02) | n/a — local store only | ✅ | n/a | 2.18 MB unpacked | n/a | ✅ 1403★, 9 open issues | ❌ same cost; npm name is a **decoy package** |

Reading the table top to bottom, the constraint that does the most work is **"no Postgres, no separate service"** — it eliminates ElectricSQL, PowerSync and Zero outright, which are otherwise the three best-funded and best-maintained products in the field.

## Findings that threaten the single-container or SQLite constraints

Reported as findings, per the ticket — not as blockers.

1. **The "no Postgres, no separate service" constraint is what decides this ticket.** It eliminates the three best-funded, best-maintained products in the category — ElectricSQL, PowerSync and Zero — and it eliminates all three for structural reasons that will not soften. Zero's docs are explicit ("Today only Postgres is supported"); PowerSync's README lists Postgres/MongoDB/MySQL/SQL Server with no server-side SQLite; Electric requires Postgres logical replication and only syncs reads. **If we ever relax to "Postgres allowed", the answer to this ticket changes completely** — Zero in particular would become a serious contender. Worth knowing the price of the constraint.
2. **Evolu**: mandatory E2EE makes the server unable to read data, which breaks server-side export, queries and content-based notifications. Mnemonic identity does not fit household accounts.
3. **Yjs / Automerge turn server-side SQLite into a blob store.** CRDT persistence is an opaque binary update log. The server could materialise it in Node, but we would lose SQL over our own data and reimplement querying in application code. Secondary: a CRDT update log only grows, which sits awkwardly with a record meant to last years.
4. **SQLite WASM (official build) would force cross-origin isolation on the entire app.** OPFS persistence works only in a Worker, and the documented setup requires `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` on our SvelteKit responses. That is a global property of the document and breaks embedding any third-party resource lacking CORP headers. `wa-sqlite`'s `AccessHandlePoolVFS`/`OPFSCoopSyncVFS` configurations appear to avoid it ⚠️, but the whole option costs ~400–540 kB gzip either way.
5. **Dexie Cloud self-hosting is a paid, closed-source perpetual licence with no public price** — a SaaS dependency in practice unless purchased.
6. **RxDB is open-core.** The Apache-2.0 core is real and sufficient for us (free storages: Dexie/IndexedDB, localStorage, memory, LokiJS), but the OPFS, native IndexedDB, SQLite, Worker and sharding storages are paid `rxdb-premium`. At our scale we never reach that wall; at 100× we might.
7. **PowerSync's server licence is `NOASSERTION`** on GitHub while the client SDK is Apache-2.0 — the classic open-core split. ⚠️ Not read line-by-line.
8. **Clock skew is a data-integrity risk in every LWW design here, including the hand-rolled one.** Not a differentiator, but it must be mitigated (server-returned time, observed offset, sanity window) rather than assumed away.
9. **The npm package literally named `wa-sqlite` is not the maintained project** — v1.0.0, single version, no repository, no licence field. The real project is consumed from GitHub or via forks such as `@journeyapps/wa-sqlite`.

## Sources

Inline above. Method note: package metadata, licences, publish dates and dependency graphs were read directly from the npm registry API; repository health (stars, archived status, last push) from the GitHub REST API; documentation from `raw.githubusercontent.com` where the docs site rendered client-side. **Bundle sizes were measured by downloading the published tarballs and gzipping the shipped dist files**, not quoted from documentation or size-badge services. Two claims (Dexie Cloud's on-prem licence terms, Replicache's relicensing) rest on search extracts because the relevant sites are client-rendered and returned empty documents — both are marked ⚠️ in place.
