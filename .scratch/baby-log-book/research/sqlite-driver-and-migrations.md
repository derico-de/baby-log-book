# SQLite driver, query layer and migrations

Research for [issue 03](../issues/03-sqlite-driver-and-migrations.md). Status: **complete** — all sections confirmed against primary sources, with two source gaps recorded in §8 (`sqlite.org` and `hub.docker.com` were unreachable from the research environment).

Context (given, not re-litigated): SvelteKit on `adapter-node`, single Docker container, SQLite file on a mounted volume, no separate DB process. Schema per [ADR-0001](../../../docs/adr/0001-single-entries-table.md) (one `entries` table, type discriminator, JSON payload) and [ADR-0002](../../../docs/adr/0002-append-only-revisions.md) (append-only revisions, permanent soft deletes).

## 1. Recommendation

**Driver: `better-sqlite3` (13.x). Query layer: plain SQL behind a thin typed helper module. Migrations: a hand-rolled boot-time runner, ~40 lines, one transaction per migration file, run as a separate process before the server starts.**

### Why

**The native-module objection is dead, so better-sqlite3 wins on merit.** The entire historical case for avoiding it was Docker pain: an install script that either downloads a prebuild over the network at image-build time or falls back to `node-gyp rebuild`, needing python3/make/g++ in the image and a rebuild on every Node upgrade. As of **13.0.2 (2026-07-29)** that is gone — the published package has `"gypfile": false`, **no `install` script at all**, and eight prebuilt Node-API addons inside the tarball covering linux/darwin/win32 × x64/arm64 plus **musl** variants for Alpine (§2.2, verified by unpacking the tarball). `npm ci` is a pure unpack, the image needs no toolchain, and Node-API means a Node 24→26 base-image bump requires no rebuild (§6.3). What remains is 27 MB of disk, trimmable to ~2.5 MB with two lines in the Dockerfile — irrelevant next to a ~200 MB base image (§6.4).

**`node:sqlite` is the runner-up and is genuinely close.** Zero dependencies, zero image cost, no supply chain. Two things keep it from winning. First, **it is still Stability 1.2 Release Candidate even in Node 26** (§2.1) — fine for most software, but this is the storage layer for irreplaceable data in a container that will be updated rarely and unattended. Second, it is **poorly supported by every query layer**: Drizzle has no `node:sqlite` driver at all (verified against both the 0.45.2 exports map and the `src/` tree on `main`, §3.1), and Kysely's `SqliteDialect` is explicitly shaped around better-sqlite3's `Statement` (§3.2). It also defaults `timeout` to `0`, so any lock contention throws immediately (§5). Choosing it means choosing plain SQL *and* hand-writing the transaction helper. That is a defensible combination — and if better-sqlite3 13.x proves flaky, it is the fallback — but it buys ~2.5 MB at the cost of an RC dependency and worse ergonomics.

**`@libsql/client` is out.** Its own README says *"If you're starting a new project, you probably want to look into Turso"* and *"new features are being developed in Turso"*, with Turso itself in beta (§2.3). Its headline feature, embedded replicas, requires a remote server to sync with — which does not exist in a single container. It is a knowingly-superseded 9.4 MB dependency offering nothing we can use.

**Plain SQL over Drizzle or Kysely, because ADR-0001 shrinks the problem an ORM solves.** One `entries` table, a Food catalogue, and perhaps ten queries total — reads happen against each device's local replica, not the server (ADR-0001). The type safety a query layer buys is proportional to schema breadth, and our schema is one table wide. Against that:

- **Drizzle** has the nicest JSON-payload ergonomics of the three — `text('payload', { mode: 'json' }).$type<EntryPayload>()` — and the safest migration failure mode (whole batch in one `BEGIN`, §4.4). But 0.45.2 is the only stable release of 2026 and `1.0.0-rc.5` is current: adopting it means a major-version migration lands mid-project (§3.1). And `$type` is an unchecked cast, so it does not actually give us the payload validation ADR-0001 says must live in application code.
- **Kysely** is calmer (0.29.5, MIT, zero deps, 1.65 MB) and its `JSONColumnType` models the read-object/write-string asymmetry honestly. But **its SQLite adapter reports `supportsTransactionalDdl: false`, so its migrator does not wrap migrations in a transaction on SQLite** (§4.4) — a halfway failure strands a partly-applied schema, on the one database engine that handles transactional DDL perfectly. That is the wrong default for an unattended container. Its `ParseJSONResultsPlugin` also parses any result string that looks like `{...}` or `[...]`, which will meet our free-text `note` column sooner or later (§3.4).
- **Plain SQL** puts `JSON.parse` and a real runtime validator in a single `rowToEntry()` mapper — which is where ADR-0001 says validation has to live anyway — and gives per-migration atomicity for free via better-sqlite3's `db.transaction()`. The cost is hand-written row interfaces; the mitigation is one `queries.ts` module plus an integration test that executes every statement against a freshly-migrated in-memory database (§3.3).

**Migrations: hand-rolled, per-file transaction, separate process.** `db.transaction(() => { db.exec(sql); recordApplied.run(name) })` per file makes each migration atomic *with its own bookkeeping row*, so the database can never be applied-but-unrecorded or recorded-but-unapplied (§4.4). Running it as `node scripts/migrate.js && node build` rather than in-process means a failure is a non-zero exit before the port is bound, which is the only observable failure signal a single-container deployment has (§4.3). `umzug` and `dbmate` were considered and are not proportionate (§4.2).

**Pragmas, non-negotiable (§5):** `journal_mode = WAL` (once, persists in the file), an explicit `busy_timeout`, `foreign_keys = ON` on *every* connection, and `synchronous` left at `NORMAL`. The sync endpoint writes each push batch inside one `BEGIN IMMEDIATE` with **no `await` inside the transaction**, fails whole batches rather than skipping rows, and only advances a client watermark after commit.

### The one thing that could change this

**§7.1:** if issue 01 lands on TinyBase *with* server-side SQLite persistence, TinyBase's persisters require `sqlite3` or `@libsql/client` as peer dependencies — there is no `better-sqlite3` persister — so the container would carry two native SQLite drivers. The fix is to use TinyBase as transport only, or point its persister at a separate `sync.db`, not to change this ticket's driver. Nothing here is blocked; it just needs to be a conscious decision rather than a surprise.

### Shopping list

| | Choice | Where |
| --- | --- | --- |
| Driver | `better-sqlite3` ^13.0.3, in **`dependencies`** (must be externalised, not bundled) | §2.2, §6.1 |
| Query layer | plain SQL in `src/lib/server/queries.ts` + typed row interfaces + a validator in `rowToEntry()` | §3.3, §3.4 |
| Migrations | `migrations/NNN-name.sql` + `scripts/migrate.js` (~40 lines) + a `_migrations` table | §4.2, §4.3 |
| Base image | `node:24-bookworm-slim` (Alpine also works — musl prebuilds ship) | §6.2 |
| Fallback if 13.x misbehaves | `node:sqlite` — same plain-SQL code, hand-written `transaction()` wrapper | §2.1, §2.4 |

## 2. Driver candidates

### 2.1 `node:sqlite` (built-in)

**Stability as of 2026-08: `1.2 - Release candidate`. Not yet Stability 2.** Verified against the doc source on both `main` and the `v24.x` release branch — both carry `> Stability: 1.2 - Release candidate.` ([doc/api/sqlite.md @ main](https://raw.githubusercontent.com/nodejs/node/main/doc/api/sqlite.md), [@ v24.x](https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/sqlite.md)). Secondary write-ups claiming "stable in Node 26" are wrong; the RC marker is still there in the v26 docs ([nodejs.org/api/sqlite.html](https://nodejs.org/api/sqlite.html)).

Timeline from the doc's own changes history:

| Version | Change |
| --- | --- |
| v22.5.0 | Module added, behind `--experimental-sqlite` |
| v22.13.0 / v23.4.0 | "SQLite is no longer behind `--experimental-sqlite` but still experimental" |
| v24.15.0 / v25.7.0 | "SQLite is now a release candidate" |
| v26.x (current, 2026-08) | Still `1.2 - Release candidate` |

Practically: **no flag needed on any Node we would ship** (22 LTS, 24 LTS, 26). RC in Node's stability index means the API is settled barring a significant problem — semver-major breakage is possible but no longer expected.

API surface (from the same doc source):

- `DatabaseSync` — `exec()`, `prepare()`, `close()`, `open()`, `location()`, `function()`, `aggregate()`, `backup()`, `serialize()`/`deserialize()`, `loadExtension()`, `setAuthorizer()`, `createSession()`, `applyChangeset()`, `createTagStore()`, and an `isTransaction` property (on `main`).
- `StatementSync` — `run()`, `get()`, `all()`, `iterate()`, `setReadBigInts()`, `columns()`.
- `Session` (changeset/patchset) and `SQLTagStore` (LRU prepared-statement cache) are also exported.
- Constructor options include `timeout` (busy timeout ms, **default 0**), `readOnly`, `enableForeignKeyConstraints` (default true), `readBigInts`, `returnArrays`, `allowExtension`, `defensive`, `limits`.

**Does it expose what a migration runner needs?** Yes, everything:

- `db.exec(sql)` runs multi-statement SQL — enough to apply a whole migration file.
- Transactions are plain SQL: `db.exec('BEGIN')` / `'COMMIT'` / `'ROLLBACK'`. There is no `db.transaction(fn)` wrapper like better-sqlite3's; you write it yourself (about six lines).
- `db.prepare('PRAGMA journal_mode = WAL').get()` sets WAL; `PRAGMA user_version` / a `migrations` table works normally.
- Everything is **synchronous**, which is actually what a boot-time migration runner wants — no interleaving, no await-ordering bugs.

Gaps worth knowing: no `db.pragma()` sugar (use `prepare`/`exec`), no built-in `transaction()` helper, and the busy timeout defaults to 0, so it **must** be set explicitly.

### 2.2 `better-sqlite3`

**Latest: 13.0.3, published 2026-08-05. MIT. `engines.node: ">=22"`.** ([registry.npmjs.org/better-sqlite3](https://registry.npmjs.org/better-sqlite3))

**The headline finding: as of 13.0.2 it no longer compiles on install.** The npm metadata for 13.0.3 has `"gypfile": false`, **no `scripts.install` at all**, and its only runtime dependency is `node-addon-api`. Compare the three versions straight from the registry document:

| Version | `gypfile` | `scripts.install` | Runtime deps | Unpacked |
| --- | --- | --- | --- | --- |
| 12.11.1 | — | `prebuild-install \|\| node-gyp rebuild --release` | `bindings`, `prebuild-install` | 9.9 MB |
| 13.0.0 / 13.0.1 | `true` | `node-gyp rebuild` | `node-addon-api` | 26.0 MB |
| **13.0.2 / 13.0.3** | **`false`** | **none** | `node-addon-api` | 26–27 MB |

So the historical story ("v12 downloads a prebuild from a GitHub release, and silently falls back to `node-gyp rebuild` — i.e. python3 + make + g++ — when one is missing, e.g. on Alpine/musl") is **obsolete**, and briefly got *worse* in 13.0.0/13.0.1 (unconditional `node-gyp rebuild`) before being fixed. Note that the GitHub releases for v13.0.1–13.0.3 carry **zero assets** ([api.github.com/repos/WiseLibs/better-sqlite3/releases](https://api.github.com/repos/WiseLibs/better-sqlite3/releases)) — the prebuild-on-a-release-page mechanism is gone because the binaries now ship inside the tarball.

Verified by unpacking `better-sqlite3-13.0.3.tgz` (68 files) — it contains eight prebuilt addons:

```
package/prebuilds/linux-x64.node         2.23 MB
package/prebuilds/linux-arm64.node       2.07 MB
package/prebuilds/linuxmusl-x64.node     2.44 MB   <- Alpine
package/prebuilds/linuxmusl-arm64.node   2.31 MB   <- Alpine
package/prebuilds/darwin-x64|arm64.node  ~1.98 MB each
package/prebuilds/win32-x64|arm64.node   ~1.9–2.0 MB
package/deps/sqlite3/sqlite3.c           9.52 MB   (amalgamation, source only)
```

Resolution logic, from `lib/binding.js` in that tarball: it builds `${platform}-${arch}.node` from `process.platform`/`process.arch`, substituting `linuxmusl` when `process.report.getReport().header.glibcVersionRuntime` is absent, `require`s it if present, and only then falls back to `build/Release/better_sqlite3.node`. **Alpine and Debian, x64 and arm64, are all covered out of the box**, and there is no install-time network call.

Consequences for us:

- **No build toolchain in the Docker image, on any base, and no `--build-from-source` risk.** This kills the classic argument against better-sqlite3.
- **Cost is disk, not time**: ~27 MB in `node_modules`, of which ~16.6 MB is seven prebuilds we will never load plus 9.5 MB of C source we will never compile. Prunable — see §6.
- **Node upgrades are free**: the addon is built against Node-API (`node-addon-api` ^8), which is ABI-stable across Node majors, so the same `.node` file keeps working when the base image moves from Node 24 to 26. No rebuild step exists to break.
- It bundles its **own SQLite amalgamation**, so the SQLite version is pinned by the npm package rather than by the base image's system libsqlite3.

Ergonomics relevant later: `db.pragma()`, `db.transaction(fn)` (with `.immediate()`/`.exclusive()` variants), `db.exec()` for multi-statement SQL — i.e. every affordance `node:sqlite` makes you hand-roll (§2.1).

### 2.3 `@libsql/client` (embedded / local file mode)

**`@libsql/client` 0.17.4, published 2026-06-15. MIT.** ([registry.npmjs.org/@libsql/client](https://registry.npmjs.org/@libsql/client)) For a local file it does not talk SQLite itself: it depends on **`libsql` ^0.5.28** (the Node native binding, MIT, latest stable **0.5.29 published 2026-03-25**), alongside `@libsql/core`, `@libsql/hrana-client`, `js-base64` and `promise-limit`.

Native story is *also* compile-free, by a different mechanism: `libsql` declares nine **`optionalDependencies`** — `@libsql/linux-x64-gnu`, `@libsql/linux-x64-musl`, `@libsql/linux-arm64-gnu`, `@libsql/linux-arm64-musl`, `@libsql/linux-arm-gnueabihf`, `@libsql/linux-arm-musleabihf`, `@libsql/darwin-x64`, `@libsql/darwin-arm64`, `@libsql/win32-x64-msvc` — and picks one at runtime via `detect-libc` + `@neon-rs/load`. npm installs only the matching platform package, so unlike better-sqlite3 you pay for **one** binary, but it is a big one: **`@libsql/linux-x64-gnu` 0.5.29 unpacks to 9.27 MB**, musl 9.45 MB (Rust binaries statically linking a whole libSQL). ([registry.npmjs.org/@libsql/linux-x64-gnu](https://registry.npmjs.org/@libsql/linux-x64-gnu))

Two disqualifying-ish facts, both from the maintainers' own README:

1. **Embedded replicas need a remote.** The advertised feature is an "Embedded, in-app replica that syncs with a remote libSQL database" — the sync half is `syncUrl` pointing at Turso or a self-hosted `sqld`. In a single container with no second process there is nothing to sync *to*, so we would be using libSQL purely as a slower, fatter better-sqlite3. ([libsql-js README](https://raw.githubusercontent.com/tursodatabase/libsql-js/main/README.md))
2. **The project is in maintenance while the team rewrites elsewhere.** The README carries an `[!IMPORTANT]` block: *"libSQL is actively maintained, but new features are being developed in Turso"* and *"If you're starting a new project, you probably want to look into Turso"* — Turso being a from-scratch Rust reimplementation that is **"currently in beta"**. Same source. Taking libSQL means adopting a knowingly-superseded dependency; taking Turso means adopting a beta database for a system whose whole point is not losing data.

Corroborating staleness signal: stable `libsql` has not moved since 2026-03-25, with only `0.6.0-pre.*` tags since (latest pre.41, 2026-06-18).

API-wise it is deliberately "compatible with better-sqlite3 … but with opt-in promise API" (same README), so if we ever did want libSQL, better-sqlite3 code ports nearly unchanged. That makes it a cheap *exit option*, not a reason to start there.

### 2.4 Driver comparison table

| | `node:sqlite` | `better-sqlite3` 13.0.3 | `@libsql/client` 0.17.4 (file:) |
| --- | --- | --- | --- |
| Ships with Node | yes | no | no |
| Stability | **1.2 Release candidate** (§2.1) | stable, mature, MIT | MIT, but "new features are being developed in Turso" |
| Install compiles C/C++ | never | **never** (13.0.2+, no install script) | never (prebuilt Rust addon) |
| Alpine / musl | n/a | `linuxmusl-{x64,arm64}` prebuilds included | `@libsql/linux-*-musl` optional dep |
| arm64 (Pi / Apple silicon host) | n/a | yes | yes |
| Disk in `node_modules` | 0 | ~27 MB (~2.2 MB actually loaded) | ~9.4 MB + JS |
| Survives Node major upgrade | trivially | yes, Node-API ABI-stable | yes, Node-API/neon |
| Sync API | yes | yes | promise-first (sync API also exposed) |
| `transaction(fn)` helper | **no** — hand-roll BEGIN/COMMIT | yes, incl. `.immediate()` | yes (better-sqlite3-compatible) |
| `pragma()` helper | no | yes | yes |
| Drizzle support | yes (`drizzle-orm/node-sqlite`… see §3.1) | yes | yes |
| Kysely support | via community dialect | first-party `SqliteDialect` | community |
| Extra value here | zero deps | fastest, most-used, richest API | none — remote sync is unusable single-container |

## 3. Query layer candidates

### 3.1 Drizzle ORM

**`drizzle-orm` 0.45.2 (2026-03-27), Apache-2.0, ~9.9 MB unpacked, zero runtime dependencies** (all drivers are `peerDependencies`). **`drizzle-kit` 0.31.10 (2026-03-17), MIT** — the CLI, a devDependency; it pulls in `esbuild` and `tsx`. ([registry.npmjs.org/drizzle-orm](https://registry.npmjs.org/drizzle-orm), [drizzle-kit](https://registry.npmjs.org/drizzle-kit))

⚠️ **Version-churn flag.** 0.45.2 has been the only stable release of 2026; everything since is `1.0.0-rc.*` (latest `1.0.0-rc.5-169397b`, 2026-08-12), and drizzle-kit is on `1.0.0-rc.5` too. We would be adopting a library mid-major-rewrite, and a 1.0 upgrade will land during this project's life.

⚠️ **Drizzle has no `node:sqlite` driver.** The `exports` map of 0.45.2 lists `./better-sqlite3`, `./libsql/*`, `./bun-sqlite`, `./d1`, `./expo-sqlite`, `./op-sqlite`, `./durable-sqlite`, `./prisma/sqlite`, `./sqlite-proxy` — and nothing for the Node builtin. Confirmed against the repo too: `drizzle-orm/src` on `main` contains `better-sqlite3/`, `bun-sqlite/`, `libsql/`, `op-sqlite/`, … but **no `node-sqlite/`** ([GitHub contents API for `drizzle-orm/src`](https://api.github.com/repos/drizzle-team/drizzle-orm/contents/drizzle-orm/src?ref=main)). The 1.0 RC adds `@tursodatabase/database` to its peer list but still not the builtin. So **"Drizzle + `node:sqlite`" is not a combination that exists** — only via the generic `sqlite-proxy` driver, which means hand-writing the executor anyway.

### 3.2 Kysely

**`kysely` 0.29.5, published 2026-08-10. MIT. 1.65 MB unpacked. Zero dependencies, zero peer dependencies.** Exports are `.`, `./readonly`, `./migration`, `./helpers/{sqlite,postgres,mysql,mssql}`. ([registry.npmjs.org/kysely](https://registry.npmjs.org/kysely)) A `0.30.0-beta.*` line exists but 0.29.5 is current stable and recently released — a much calmer release story than Drizzle's.

It is a **query builder, not an ORM**: you hand it a `Database` interface you write (or generate), and it type-checks SQL construction against it. There is no schema-definition DSL that owns your DDL, which fits ADR-0001's "one table, application-level validation" posture — nothing is pretending to enforce the payload shape.

**Its built-in `SqliteDialect` is better-sqlite3-shaped.** From `dist/dialect/sqlite/sqlite-dialect-config.d.ts` in the 0.29.5 tarball, the config's `database` must satisfy:

```ts
export interface SqliteDatabase { close(): void; prepare(sql: string): SqliteStatement }
export interface SqliteStatement {
  readonly reader: boolean
  all(parameters: ReadonlyArray<unknown>): unknown[]
  run(parameters: ReadonlyArray<unknown>): { changes: number | bigint; lastInsertRowid: number | bigint }
  iterate(parameters: ReadonlyArray<unknown>): IterableIterator<unknown>
}
```

with the comment *"This interface is the subset of better-sqlite3 driver's `Database` class that kysely needs. We don't use the type from `better-sqlite3` here to not have a dependency to it."* — better-sqlite3 satisfies it as-is. `node:sqlite`'s `StatementSync` does **not**: it has no `reader` property and its `all()` takes spread arguments rather than an array, so pairing Kysely with the builtin needs a hand-written shim (small, but ours to maintain).

Note `SqliteAdapter.supportsMultipleConnections === false` — Kysely knows SQLite is a single-connection dialect and will not pool. That matters in §5.

### 3.3 Plain SQL + thin helper

No dependency, no version churn, no abstraction to fight. With better-sqlite3 the "thin helper" is genuinely thin, because the driver already provides the pieces a helper would otherwise add: `db.prepare()` with statement caching, `db.transaction(fn)` (plus `.immediate()` / `.exclusive()` variants), `db.pragma()` and `db.exec()` for multi-statement SQL — all documented in [the better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md). With `node:sqlite` the helper has to supply the transaction wrapper and pragma sugar itself (§2.1).

The cost is **type safety**, which the ticket calls out explicitly. Plain SQL gives you `unknown` rows: you hand-write `interface EntryRow` and a `rowToEntry()` mapper, and nothing checks that the SQL's selected columns match. For our shape that cost is smaller than usual — ADR-0001 means there is essentially **one table and a handful of queries** (insert revision, read entries-since-cursor, read latest-revision-per-entry, upsert food catalogue). Hand-written row types over ~10 queries is a genuinely tractable amount of typing to babysit; over 40 tables it would not be.

Where it bites is *refactoring*: rename a column and Drizzle/Kysely fail at `tsc`, while plain SQL fails at runtime. A mitigation that keeps most of the benefit: put every statement in one `queries.ts` module with explicit row types and a single integration test that runs each statement against a freshly-migrated in-memory database. That converts "silent runtime failure" into "test failure", which is most of what the type system was buying.

### 3.4 JSON payload column handling

This is the deciding sub-question, because ADR-0001 puts a JSON payload column on the single `entries` table.

**The column itself.** Store it as `TEXT`. SQLite's JSON functions (`json_extract`, `json_valid`, `->`, `->>`) operate on text; the built-in JSON functions are part of the core build since 3.38.0 ([sqlite.org/json1.html](https://www.sqlite.org/json1.html)). A `CHECK (json_valid(payload))` constraint is the one shape-guarantee the database *can* give us, which partly answers ADR-0001's "a bug writes malformed payloads that no constraint will catch" — it catches malformed *JSON*, not a malformed schema.

**Drizzle.** `text(name, { mode: 'json' })` produces a `SQLiteTextJson` column with `dataType: 'json'` (from `sqlite-core/columns/text.d.ts` in the 0.45.2 tarball), and `blob(name, { mode: 'json' })` also exists — but Drizzle's own doc comment in `sqlite-core/columns/blob.d.ts` says: *"It's recommended to use `text('...', { mode: 'json' })` instead of `blob` in JSON mode, because it supports JSON functions."* Combined with `.$type<T>()` ([`column-builder.d.ts`](https://registry.npmjs.org/drizzle-orm)), you get:

```ts
payload: text('payload', { mode: 'json' }).$type<EntryPayload>().notNull()
```

Drizzle serialises/parses at the driver boundary, so reads give you a typed object. **This is the best-in-class ergonomic for our exact case.** Caveat: `$type` is an unchecked cast — it asserts the payload's TypeScript type, it does not validate it. A discriminated union keyed on `entries.type` is *not* expressible; `$type<EntryPayload>()` gives you the union and you narrow manually after reading `type`.

**Kysely.** `JSONColumnType<SelectType, InsertType = string, UpdateType = string>` (from `dist/util/column-type.d.ts`) — an alias for `ColumnType<...>` that models the asymmetry honestly: **you read a parsed object and you write a string**. So `payload: JSONColumnType<EntryPayload>` means inserts take `JSON.stringify(payload)` explicitly, which is arguably more truthful than Drizzle's magic but is friction on every write.

Getting the *read* side to actually be an object at runtime requires the **`ParseJSONResultsPlugin`**. Read its options carefully — from `dist/plugin/parse-json-results/parse-json-results-plugin.d.ts`, `shouldParse` *"Defaults to a function that checks if the string starts and ends with `{}` or `[]`"*, applied to **every string in every result row**. Our `entries` table has a free-text `note` column per ADR-0001; a caregiver note of `[redacted]` or `{shrug}` would be fed to `JSON.parse` — and the same doc says *"If a detected JSON string fails to parse, an error is thrown."* **Using the plugin globally with our schema is a latent 3am bug.** Fixable by passing a `shouldParse` that only accepts the `$."payload"` JSON path, but it is a footgun you have to know about.

Kysely also ships `jsonArrayFrom` / `jsonObjectFrom` in `kysely/helpers/sqlite` (compiling to `json_group_array` + `json_object`), which are for nesting *subqueries* as JSON — irrelevant to a stored payload column, and they carry the same plugin requirement.

**Plain SQL.** `JSON.stringify` on write, `JSON.parse` in a single `rowToEntry()` mapper on read. Roughly six lines, in exactly one place, with no heuristic guessing which strings are JSON and no cast pretending to be a type check. Add a runtime validator (Zod/Valibot/hand-rolled) in that same mapper and you get something *stronger* than either library: ADR-0001 says validation must live in application code, and this is the one place it can be guaranteed to run on both the write and read paths.

**Verdict for §3.4:** Drizzle wins on ergonomics, plain SQL wins on honesty and on being the natural home for the validation ADR-0001 requires, and Kysely is mid — its type model is the most accurate but its runtime parsing story has a sharp edge on a table that also holds free text.

## 4. Migrations

### 4.1 What each query layer offers

**Drizzle** — two halves. `drizzle-kit generate` (dev-time CLI) diffs your TS schema against a snapshot and **emits plain `.sql` files** plus a `meta/_journal.json`; `migrate()` from `drizzle-orm/<driver>/migrator` (runtime) applies them. From `migrator.js` in the 0.45.2 tarball, `readMigrationFiles()` requires `<folder>/meta/_journal.json`, reads `<tag>.sql` per journal entry, and splits each file on the literal marker `--> statement-breakpoint`. Signature: `migrate(db, { migrationsFolder, migrationsTable? }): void` — **synchronous** for the better-sqlite3 driver.

The important structural property: **the generated artefacts are SQL text, not TS**. `drizzle-kit` is a devDependency only; the runtime path needs `drizzle-orm` plus the `drizzle/` folder. So the ~9.8 MB CLI (and its `esbuild`/`tsx` dependencies) never enters the production image.

**Kysely** — a first-class built-in `Migrator` under the `kysely/migration` export (`dist/migration/migrator.d.ts` in 0.29.5):

- Migrations are **TypeScript modules** exporting `up(db: Kysely<any>): Promise<void>` and optional `down(db)`. No SQL files, no schema-diffing — you write the DDL yourself via `db.schema` or `sql` templates.
- Two bookkeeping tables: `DEFAULT_MIGRATION_TABLE = "kysely_migration"` and `DEFAULT_MIGRATION_LOCK_TABLE = "kysely_migration_lock"`.
- API: `migrateToLatest()`, `migrateTo(name | NO_MIGRATIONS)`, `migrateUp()`, `migrateDown()`, `getMigrations()`. Returns a `MigrationResultSet` — `{ error?, results?: MigrationResult[] }` where each result has `migrationName`, `direction` and `status: 'Success' | 'Error' | 'NotExecuted'`. That is a genuinely good boot-time report.
- `FileMigrationProvider` loads from a directory; `allowUnorderedMigrations` and `nameComparator` are configurable.
- Because migrations are TS, **shipping them to production means either compiling them into the bundle or shipping `tsx`** — a real packaging wrinkle for adapter-node, where the app is bundled but the migrations directory is loaded dynamically at runtime.

An optional CLI exists — `kysely-ctl` 0.21.0 (MIT, 2026-05-10) — for scaffolding and running migrations from the terminal; it is not required to use the `Migrator` programmatically.

**Plain SQL** — nothing offered; see §4.2.

### 4.2 Standalone runners

- **`umzug` 3.8.3** (MIT, 2026-05-01, 0.13 MB, deps: `@rushstack/ts-command-line`, `emittery`, `pony-cause`, `tinyglobby`, `type-fest`). Storage-agnostic framework-independent runner; you supply the storage adapter, so with SQLite you are writing the "record applied migration" half yourself anyway. It buys ordering, up/down and events — the parts that are least hard.
- **`kysely-ctl` 0.21.0** — only meaningful with Kysely.
- **`dbmate` / `goose` / `atlas`** — Go binaries. Adding a second language runtime and a `COPY --from` stage to the image to run six `.sql` files is a poor trade at this scale, and the binary must be pinned and kept current independently of npm.
- **Hand-rolled, ~40 lines.** With better-sqlite3 the whole runner is: read `migrations/*.sql` sorted by filename, `SELECT name FROM _migrations`, and for each unapplied file run `db.transaction(() => { db.exec(sql); insertApplied.run(name) })`. `PRAGMA user_version` is the even smaller variant (an integer counter instead of a table), but a table with `name` + `applied_at` is more debuggable at 3am and costs one extra `CREATE TABLE IF NOT EXISTS`.

Given ADR-0001 (one entries table) and ADR-0002 (append-only, no purge job), the total migration surface for v1 is small and mostly additive — new columns and new indexes. **The hand-rolled runner is proportionate**; `umzug` is not obviously cheaper than the thing it replaces.

### 4.3 Boot-time migration flow

The container must migrate itself on start. Two shapes:

**(a) In-process, before the server listens.** In `src/lib/server/db.ts` (or a `hooks.server.ts`-adjacent init module), open the database, apply pragmas, run migrations, *then* let SvelteKit start serving. With a synchronous driver this is trivially ordered — better-sqlite3 and `node:sqlite` are both sync, so there is no window where a request can arrive mid-migration. Drizzle's better-sqlite3 `migrate()` is likewise `void`, not `Promise<void>`. Kysely's `migrateToLatest()` is async, so you must `await` it in a module top-level await or an explicit bootstrap before `server.listen()`.

**(b) A separate entrypoint step.** `CMD ["sh","-c","node migrate.js && node build/index.js"]`, or an entrypoint script. Cleaner failure semantics — a non-zero exit from the migrate step stops the container before it ever serves traffic, and Docker's restart policy makes the retry loop visible in `docker ps` rather than hidden inside the app. Costs one extra Node process start (~50 ms) per boot.

**Recommendation: (b), with the migration script sharing the same `db.ts` module as the app.** The deciding argument is observability: with (a) a migration failure surfaces as an app that logs an error and either crashes or — worse, if someone wraps it in a try/catch — serves requests against a half-migrated schema. With (b), "migrations failed" and "app crashed" are distinct exit events. A single-container deployment has no orchestrator to interpret subtle states, so making failure loud and terminal is worth 50 ms.

Ordering inside the boot step matters:

1. Open the database file (`mkdir -p` the volume directory first — a fresh mounted volume is empty).
2. `PRAGMA journal_mode = WAL` — persistent, so this is idempotent after the first boot.
3. `PRAGMA busy_timeout` / driver `timeout` option — see §5.
4. `PRAGMA foreign_keys = ON` if we use FKs (per-connection, not persistent, so it must be set on **every** connection, not just at migrate time).
5. Run migrations.
6. Exit 0.

Corollary for the running app: the pragmas in steps 3–4 are connection-scoped and must be re-applied when the app opens its own connection. Only `journal_mode` persists in the file.

### 4.4 Halfway-failure behaviour

SQLite has **transactional DDL** — `CREATE TABLE`, `ALTER TABLE` and friends participate in a transaction and roll back cleanly. This is the fact that makes SQLite migrations much safer than MySQL's, and the three options exploit it very differently.

**Drizzle: all-or-nothing across the whole batch.** From `sqlite-core/dialect.js` (0.45.2 tarball), `SQLiteDialect.migrate()` does:

```js
session.run(sql`BEGIN`);
try {
  for (const migration of migrations) {
    if (!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis) {
      for (const stmt of migration.sql) session.run(sql.raw(stmt));
      session.run(sql`INSERT INTO __drizzle_migrations ("hash","created_at") VALUES(...)`);
    }
  }
  session.run(sql`COMMIT`);
} catch (e) {
  session.run(sql`ROLLBACK`);
  throw e;
}
```

One `BEGIN` wrapping *every* pending migration, so a failure in migration 5 of 6 rolls back migrations 1–5 as well. The database is left exactly as it was. This is the **best halfway-failure behaviour of the three** — you restart the container after fixing the SQL and nothing is stranded.

Two Drizzle sharp edges visible in that same code:
- Dedupe is `lastDbMigration.created_at < migration.folderMillis` — it compares against the **newest applied timestamp**, not a set of applied hashes. A migration added out of order (an older `when` than something already applied) is silently skipped forever. Practically: never hand-edit `meta/_journal.json` timestamps, and never merge two branches' migrations without regenerating.
- The bookkeeping table is created as `id SERIAL PRIMARY KEY` — `SERIAL` is not a SQLite type. SQLite accepts it under type-affinity rules so it works, but the column is not an alias for the rowid and is never populated. Cosmetic, but it tells you the SQLite path shares a code path with Postgres.

**Kysely: NOT transactional on SQLite.** From `dist/dialect/sqlite/sqlite-adapter.js`, `SqliteAdapter.supportsTransactionalDdl` returns **`false`**, and `migration/migrator.js` gates on exactly that: `if (adapter.supportsTransactionalDdl && !disableTransactions) { … db.transaction().execute(...) }`. So **on SQLite, Kysely runs each migration outside any transaction it manages** — despite SQLite genuinely supporting transactional DDL. A failure partway through migration 5 leaves migrations 1–4 recorded, migration 5 half-applied and **not** recorded, and the next boot will try to re-run it from the top against a schema that is already partly changed. Recovery is manual.

This is fixable — wrap the body of each `up()` in an explicit transaction, or run the migrator inside `db.transaction()` yourself — but it is **opt-in, undocumented at the point of use, and the wrong default for an unattended self-hosted container**. It is the single strongest argument against Kysely here. (Kysely's `SqliteAdapter.acquireMigrationLock` is also a no-op, on the reasoning that "SQLite only has one connection that's reserved by the migration system" — fine for us, since our container is the only writer.)

**Hand-rolled: whatever we specify, and the right answer is per-migration.** `db.transaction(() => { db.exec(migrationSql); recordApplied.run(name) })` makes each file atomic *together with its bookkeeping row*, which is the invariant that actually matters: you can never end up with a migration applied but unrecorded, or recorded but unapplied. better-sqlite3's `.transaction()` is documented to *"begin a new transaction … If an exception is thrown, the transaction will be rolled back (and the exception will propagate as usual)"* ([docs/api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)), which is precisely the semantics wanted, in one line.

Per-migration atomicity is arguably better than Drizzle's whole-batch atomicity: after a failure, migrations 1–4 are durably applied and recorded, so the retry after a fix starts at 5 rather than redoing everything. Either is safe; neither is Kysely's default.

Two failure modes no runner protects against, worth writing into the runbook:

- **A SQL statement that is legal but wrong** (dropping a column that held data). Transactions do not help; ADR-0002's "never hard-delete" ethos should extend to migrations — prefer additive changes, and never `DROP COLUMN` on `entries` in the same release that stops writing it.
- **A crash-loop.** If migration 5 always fails, the container restart policy retries forever. Log the migration name and the SQLite error, exit non-zero, and rely on the volume being intact — with per-migration transactions the file is never in an inconsistent state, so the fix is "ship corrected SQL", not "restore a backup".

## 5. WAL mode and concurrency

> ⚠️ **Source gap.** `sqlite.org` / `www.sqlite.org` was **unreachable from this environment** (connection timeout on every attempt, via both `curl` and the fetch tool; `raw.githubusercontent.com` and `registry.npmjs.org` were fine from the same shell). Claims below are therefore cited to better-sqlite3's and Node's own documentation, which are primary for the *drivers*. The underlying SQLite semantics (WAL readers-don't-block-writers, one writer at a time, the 1000-page auto-checkpoint default) are stated here from general knowledge and **should be re-verified against `sqlite.org/wal.html` and `sqlite.org/pragma.html` from a machine that can reach them** before this becomes a spec.

**Turn WAL on.** better-sqlite3's own performance guide opens with: *"Concurrently reading and writing from an SQLite database can be very slow in some cases. Since concurrency is usually very important in web applications, it's recommended to turn on WAL mode to greatly increase overall performance"* — `db.pragma('journal_mode = WAL')` ([docs/performance.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)). `journal_mode` is stored in the database file header, so this survives restarts and only needs setting once (we set it every boot anyway; it is idempotent).

**What WAL buys us specifically.** Our shape is: a handful of household members' devices reading, plus a sync endpoint doing batched writes. WAL lets readers proceed while a writer is active, which is exactly the interleaving a sync push creates — a batch write must not stall a caregiver's page load at 3am. It does **not** give us concurrent writers: SQLite still serialises writes, so a second concurrent write attempt blocks and then fails `SQLITE_BUSY`.

**Busy timeout is the thing that must not be left at the default — and the default differs by driver.**

| Driver | Busy-timeout default | Source |
| --- | --- | --- |
| `node:sqlite` | **`0`** — *"the maximum amount of time that SQLite will wait for a database lock to be released before returning an error. **Default:** `0`"* | [doc/api/sqlite.md @ main](https://raw.githubusercontent.com/nodejs/node/main/doc/api/sqlite.md) |
| `better-sqlite3` | **`5000`** — *"the number of milliseconds to wait when executing queries on a locked database, before throwing a `SQLITE_BUSY` error (default: `5000`)"* | [docs/api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) |

`node:sqlite`'s `0` means **any** lock contention throws immediately rather than waiting. In a single-process Node server that mostly does not arise (one connection, serialised by the event loop), but it arises the moment there are two connections — the app's and the boot-time migration script's, or a `sqlite3` shell someone opened to poke at the volume. Set it explicitly either way.

**The batched sync endpoint.** Two rules, both cheap:

1. **One `BEGIN IMMEDIATE` transaction per push batch, not per row.** better-sqlite3 exposes this directly: `insertBatch.immediate(rows)` uses `BEGIN IMMEDIATE` ([docs/api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)). `IMMEDIATE` takes the write lock up front instead of upgrading mid-transaction, which is the standard way to avoid `SQLITE_BUSY` on upgrade under WAL. Per-row transactions would also be an fsync per row.
2. **Never hold a transaction across an `await`.** better-sqlite3's docs are blunt: *"Transaction functions do not work with async functions… because SQLite serializes all transactions, it's generally a very bad idea to keep a transaction open across event loop ticks anyways."* Same source. In a SvelteKit `+server.ts` handler this means: `await request.json()` first, validate, and only then enter the synchronous transaction. This is a real constraint on how the sync endpoint is written and should be stated in the sync-protocol ticket.

A related gotcha from the same doc, worth putting in the sync code review checklist: *"if you catch an SQLite error within a transaction, you must be aware that any further SQL that you execute might not be within the same transaction"* — SQLite may roll back on its own (`ON CONFLICT`, `SQLITE_BUSY`, `SQLITE_FULL`). So a per-row `try/catch` inside a batch that "skips bad rows and carries on" is unsound. The sync endpoint should fail the whole batch and let the client retry (idempotent, since ADR/issue-06 gives us client UUIDs).

**Durability.** better-sqlite3 ships SQLite compiled with `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`, i.e. *"databases in WAL mode default to the 'NORMAL' synchronous setting… introduces a slight loss of durability while in WAL mode"*, overridable with `db.pragma('synchronous = FULL')` ([docs/performance.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md)). Under `NORMAL` a power loss can lose the most recent committed transactions (not corrupt the database). For a self-hosted baby log this is a real, small risk: the data is irreplaceable (ADR-0002) but a device that pushed the entry still holds it locally and will re-push, because the local replica is authoritative until acknowledged. **Recommendation: leave `synchronous = NORMAL`**, and make sure the sync protocol only advances a device's watermark after the server has committed — that turns a lost tail-of-WAL into a re-sync rather than data loss. Flag for issue 06.

**Checkpoint starvation** — the WAL file growing without bound because reads never let it recycle — is explicitly scoped by better-sqlite3's docs: *"If you don't access the database from multiple processes or threads simultaneously, you'll never encounter this issue."* One container, one Node process, no worker threads ⇒ not a concern. If we ever add a backup process that holds a long read, the documented fix is `db.pragma('wal_checkpoint(RESTART)')` on a size threshold. Same source.

**Backups.** A WAL database is three files (`db`, `db-wal`, `db-shm`) and copying just the `.db` off the volume is not a valid backup. better-sqlite3 has `db.backup()` and `node:sqlite` has `db.backup()` too (§2.1) — use the API, not `cp`. Deployment ticket (12) should own this; noting it here because it is a direct consequence of turning WAL on.

**A note on network volumes.** WAL requires shared memory between connections, which is why it is documented as not working on some network filesystems. If the mounted volume is ever an NFS/SMB share rather than a local bind mount or Docker volume, WAL is unsafe. ⚠️ Unverified here (see the source gap above) — but the deployment ticket should state "local filesystem volume only".

## 6. Docker implications of the recommended driver

> ⚠️ **Source gap.** `hub.docker.com` was also unreachable from this environment, so the base-image sizes below are **from memory and explicitly unverified**. Everything about better-sqlite3's contents *is* verified — measured by unpacking the published tarball. Re-check the image sizes with `docker images` on the build machine before quoting them anywhere.

### 6.1 The one thing adapter-node forces

From the adapter's own docs: *"Development dependencies will be bundled into your app using Rollup. To control whether a given package is bundled or externalised, place it in `devDependencies` or `dependencies` respectively"*, and *"You will need the output directory, the project's `package.json`, and the production dependencies in `node_modules`… `npm ci --omit dev`"* ([adapter-node docs](https://raw.githubusercontent.com/sveltejs/kit/main/documentation/docs/25-build-and-deploy/40-adapter-node.md)).

**A native addon cannot be Rollup-bundled**, so `better-sqlite3` must sit in `dependencies`, not `devDependencies` — it gets externalised and resolved from `node_modules` at runtime. Conversely `drizzle-kit` (if used) belongs in `devDependencies` so it is bundled-or-dropped and never ships.

### 6.2 Multi-stage build sketch

```dockerfile
# ---- build ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci                       # no compiler needed: better-sqlite3 13.0.2+ has no install script
COPY . .
RUN npm run build                # vite build -> ./build via adapter-node

# ---- prod deps ----
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit dev \
 && find node_modules/better-sqlite3/prebuilds -type f ! -name 'linux-x64.node' -delete \
 && rm -rf node_modules/better-sqlite3/deps node_modules/better-sqlite3/src

# ---- runtime ----
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/build        ./build
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle      ./drizzle       # or ./migrations for the plain-SQL runner
COPY --from=build /app/scripts/migrate.js ./scripts/migrate.js
RUN mkdir -p /data && chown node:node /data
VOLUME /data
ENV DATABASE_PATH=/data/babylog.db
USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.js && node build"]
```

Notes on the sketch:

- **No `apt-get install python3 make g++`, and no build stage that exists only to compile a native module.** This is the whole payoff of §2.2: `npm ci` in *both* stages is a pure download-and-unpack. Before better-sqlite3 13.0.2 this Dockerfile would have needed either a toolchain or a fragile `prebuild-install` network fetch at image-build time.
- **The `find … -delete` line trims ~16.6 MB** of prebuilds for platforms this image will never run on, and `rm -rf deps src` drops another ~10 MB of C source (the 9.5 MB `sqlite3.c` amalgamation plus headers). That takes better-sqlite3 from ~27 MB to roughly **2.5 MB** in the final image. Verified against the tarball listing in §2.2. Pin the kept filename to the target platform (`linuxmusl-x64.node` on Alpine, `linux-arm64.node` on a Pi) — or simply drop the trim step if simplicity beats 25 MB, which at these sizes it plausibly does.
- **Alpine works too**, because `linuxmusl-x64.node` and `linuxmusl-arm64.node` ship in the tarball and `lib/binding.js` selects them by probing `process.report.getReport().header.glibcVersionRuntime` (§2.2). ⚠️ Base-image sizes unverified, but the usual ordering — `alpine` ≈ 50–60 MB, `bookworm-slim` ≈ 200 MB, full `bookworm` ≈ 1 GB — makes `alpine` the size win and `bookworm-slim` the fewer-surprises choice. Recommendation: **`-slim`**, because the ~150 MB saved is irrelevant for a self-hosted household app and glibc avoids a class of musl-specific oddities for a container that will be rebuilt rarely and debugged at 3am.
- **`USER node` + `chown /data`** matters more than usual: SQLite needs write access to the *directory*, not just the file, because WAL creates `-wal` and `-shm` sidecars next to the database. A volume mounted root-owned with a non-root process is the classic first-boot failure here.
- **`CMD` runs the migration as a separate process** per §4.3, so a migration failure exits non-zero before the server binds a port.

### 6.3 What a Node version upgrade costs

**Essentially nothing, and this is now true of all three drivers.**

better-sqlite3's prebuilds are compiled against **Node-API** — its only runtime dependency is `node-addon-api` ^8 (§2.2). Node-API is ABI-stable across Node major versions, so the same `linux-x64.node` binary loads on Node 22, 24 and 26 without recompilation. Combined with there being **no install script at all** in 13.0.2+, there is no rebuild step that a Node upgrade could break: bumping `FROM node:24-slim` to `node:26-slim` is a one-line change plus a rebuild.

Caveat worth writing down: `engines.node` for better-sqlite3 13.0.3 is `">=22"`, i.e. it no longer enumerates specific majors the way 12.11.1 did (`"20.x || 22.x || 23.x || 24.x || 25.x || 26.x"`). The open-ended range is a *policy* statement, not a guarantee that a future Node major is tested — but the failure mode, if any, would be a clean load error at boot, caught by the migration step before the app serves traffic.

The historical fear ("upgrading Node means `npm rebuild better-sqlite3`, which means keeping a toolchain in the image or maintaining your own prebuild cache") is **no longer true as of 13.0.2** and was only ever true for the non-Node-API build style. For `node:sqlite` the cost is likewise zero, and it is the one option where the *SQLite* version is tied to the Node version rather than to a package — a mild argument in its favour (security updates ride along with the base image) and a mild argument against (SQLite version changes under you when you bump the base image).

### 6.4 Image-size summary

| Component | Size | Verified? |
| --- | --- | --- |
| `better-sqlite3` as installed | ~27 MB | ✅ tarball, `unpackedSize` 27,302,969 B |
| `better-sqlite3` after trimming | ~2.5 MB | ✅ derived from the file listing |
| `@libsql/client` + `libsql` + one platform pkg | ~9.5 MB | ✅ registry `unpackedSize` |
| `node:sqlite` | 0 | ✅ builtin |
| `drizzle-orm` | ~9.9 MB | ✅ registry |
| `drizzle-kit` (dev only, never shipped) | ~9.8 MB | ✅ registry |
| `kysely` | ~1.65 MB | ✅ registry |
| `node:24-bookworm-slim` base | ~200 MB | ⚠️ unverified, Docker Hub unreachable |
| `node:24-alpine` base | ~55 MB | ⚠️ unverified, Docker Hub unreachable |

The base image dominates by an order of magnitude; **driver choice is not a meaningful lever on image size**, which removes what would otherwise be `node:sqlite`'s strongest practical argument.

## 7. Alignment with the sync engine (parallel ticket)

The sync research ([local-first-sync-engine.md](./local-first-sync-engine.md), issue 01) is still in progress, but two of its candidates are confirmed and one of them has a **direct, checkable collision with this ticket**.

### 7.1 TinyBase would bring a second SQLite driver

TinyBase 9.5.1 (MIT, published 2026-08-15) lists its server-side SQLite persisters in its `exports` map as `./persisters/persister-sqlite3` and `./persisters/persister-libsql`, with corresponding **`peerDependencies` of `sqlite3` and `@libsql/client`** ([registry.npmjs.org/tinybase](https://registry.npmjs.org/tinybase)). The full peer list contains no `better-sqlite3` and, being a peer list, obviously no `node:sqlite`.

So if issue 01 lands on TinyBase with server-side SQLite persistence, the container gets:

- `sqlite3` (node-sqlite3) — **a different native driver** from whatever we pick here, with its own build/prebuild story, its own SQLite amalgamation, and its own idea of connection handling; **or**
- `@libsql/client` — which §2.3 recommends against on maintenance grounds.

Two drivers holding two connections to the same file is workable under WAL (that is what WAL is for) but it doubles the surface: two busy-timeout settings, two pragma sets, two upgrade cadences, and a second native module in the image. **This is the single strongest cross-ticket constraint found.**

Three ways out, in preference order:

1. **Don't persist TinyBase's store to the same database.** Treat TinyBase as the *transport* (its `MergeableStore` CRDT + WS synchronizer) and write into our own `entries` table from the sync handler using our own driver. TinyBase's persisters are optional — the WS server can be given no persister, or a `persister-file` for durability of the sync state alone.
2. **Persist TinyBase to a separate `sync.db` file on the same volume**, keeping our `babylog.db` untouched. Two files, two drivers, but zero schema entanglement.
3. **Adopt `sqlite3` as *the* driver** to have only one. Not recommended — `sqlite3` is callback/async, has none of better-sqlite3's transaction ergonomics, and would make §5's synchronous-batch-transaction advice impossible.

Whichever wins, **nothing in this ticket's recommendation is blocked by it**: better-sqlite3 does not conflict with TinyBase, it simply isn't reusable *by* TinyBase's persister layer.

### 7.2 The hand-rolled sync option is the best fit

If issue 01 concludes "hand-roll a push/pull endpoint pair" — which its own framing says is a serious contender at this scale — then the server side is exactly what §5 describes: a synchronous `BEGIN IMMEDIATE` batch upsert into `entries`, plus a `SELECT … WHERE seq > ?` change feed. better-sqlite3 is the best possible driver for that shape, and no second driver appears.

### 7.3 Requirements this ticket imposes back on issue 01 / issue 06

Flagging these so the sync protocol is not designed into a corner:

- **No `await` inside a write transaction** (§5). The push handler must parse and validate the whole batch *before* entering the transaction. This rules out a protocol where the server has to call out to something else mid-batch.
- **Batch failure is all-or-nothing.** Per-row error recovery inside a batch is unsound because SQLite may roll back on its own (§5). The protocol needs a "reject the batch, client retries" path rather than a "partial success, here are the rows that failed" response — or, if partial success is wanted, each row must be its own transaction, which costs an fsync each.
- **Advance the client watermark only after commit** (§5, durability). With `synchronous = NORMAL` a power loss can lose the last committed transactions; a watermark advanced optimistically would turn that into permanent data loss instead of a re-push.
- **The change feed needs a monotonic server-side ordering column** to be a cheap `WHERE seq > ?` query. ADR-0002's append-only revisions give a natural candidate, but issue 06's "cursor or version per household?" question should land on something the server assigns (an `INTEGER PRIMARY KEY` rowid or an explicit sequence), because client timestamps are subject to the clock skew issue 06 already flags.
- **A JSON payload column is not queryable across types** without `json_extract` (ADR-0001, §3.4). If the sync protocol ever needs to filter server-side on a type-specific field (say, "open sleep sessions" for the merge rule in issue 01), that field must be promoted to a real column rather than left in the payload. **The open-session merge rule is exactly such a case** — the server needs to find "an open session for this baby", which means `ended_at IS NULL` must be a real column. ADR-0001 already lists `ended at` as a shared column, so this works — but it should be stated as a requirement, not a coincidence.

### 7.4 Evolu

Already ruled out in the sync research on E2EE/identity grounds. Worth noting it would also have taken the driver decision out of our hands entirely (its relay owns its own storage), so nothing here changes that verdict.

## 8. Open gaps

1. **`sqlite.org` was unreachable from this environment** (both `sqlite.org` and `www.sqlite.org`, via `curl` and the fetch tool; other hosts fine). Everything in §5 about SQLite's *own* semantics — WAL readers-vs-writers, the single-writer rule, the auto-checkpoint page threshold, `synchronous` levels, and the network-filesystem caveat — is stated from general knowledge and cited only to the drivers' documentation. **Re-verify against `sqlite.org/wal.html`, `sqlite.org/pragma.html` and `sqlite.org/json1.html` before this text is copied into a spec.**
2. **`hub.docker.com` was unreachable**, so every base-image size in §6 is unverified. Measure with `docker images` on the build machine.
3. **`node:sqlite` + Kysely shim** — §3.2 establishes that Kysely's `SqliteDatabase` interface does not match `StatementSync` (no `reader`, array-vs-spread parameters). The shim is described as "small" from reading the interface; it has not been written or tested. Moot under the recommendation.
4. **better-sqlite3 13.x maturity.** The prebuilds-in-tarball change is *very* recent (13.0.2, 2026-07-29; 13.0.3, 2026-08-05 — days old at time of writing). It is unambiguously the right direction, but v13 as a whole is ~3 weeks old. If we want conservatism, pin 12.11.1 and accept the install-script story — but note 12.11.1's `engines` allows Node 20–26 while 13.x requires ≥22, and 13.0.0/13.0.1 are the versions to *avoid* (unconditional `node-gyp rebuild`). ⚠️ **Verify the prebuild actually loads on the target platform in CI** before committing — one `node -e "new (require('better-sqlite3'))(':memory:')"` in the build is enough.
5. **Drizzle 1.0.** 0.45.2 is the only stable release of 2026 and `1.0.0-rc.5` is current. If we chose Drizzle we would be choosing a mid-rewrite library; the migration path from 0.45 to 1.0 has not been investigated here.
6. **TinyBase embedding** (from the sync research) is still unverified, and §7.1's collision analysis assumes TinyBase's server half runs in-process. If it turns out to need its own process, the collision gets worse, not better.
7. **Backup mechanism** (§5) is named but not specified — `db.backup()` on a schedule vs. volume snapshot belongs to issue 12.

## Sources

Primary sources, all fetched directly during this research (registry metadata and package tarballs via `curl`, docs via `raw.githubusercontent.com`):

**Node**
- [`doc/api/sqlite.md` @ `main`](https://raw.githubusercontent.com/nodejs/node/main/doc/api/sqlite.md) — stability index, API surface, `timeout` default `0`
- [`doc/api/sqlite.md` @ `v24.x`](https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/sqlite.md), [nodejs.org/api/sqlite.html](https://nodejs.org/api/sqlite.html)

**better-sqlite3**
- [registry.npmjs.org/better-sqlite3](https://registry.npmjs.org/better-sqlite3) — versions 12.11.1 / 13.0.0 / 13.0.1 / 13.0.2 / 13.0.3, `gypfile`, `scripts.install`, `dependencies`, `engines`, `unpackedSize`
- [`better-sqlite3-13.0.3.tgz`](https://registry.npmjs.org/better-sqlite3/-/better-sqlite3-13.0.3.tgz) — unpacked and inspected: `prebuilds/*.node` (8 platforms incl. `linuxmusl-*`), `lib/binding.js` platform selection, `deps/sqlite3/sqlite3.c`
- [api.github.com/repos/WiseLibs/better-sqlite3/releases](https://api.github.com/repos/WiseLibs/better-sqlite3/releases) — v13.0.1–13.0.3 carry zero release assets
- [`docs/api.md`](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — `timeout` default 5000, `.transaction()` semantics + `deferred`/`immediate`/`exclusive`, async caveat, self-rollback caveat, `.pragma()`
- [`docs/performance.md`](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) — WAL recommendation, checkpoint starvation, `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`

**libSQL / Turso**
- [registry.npmjs.org/@libsql/client](https://registry.npmjs.org/@libsql/client), [registry.npmjs.org/libsql](https://registry.npmjs.org/libsql), [@libsql/linux-x64-gnu](https://registry.npmjs.org/@libsql/linux-x64-gnu), [@libsql/linux-x64-musl](https://registry.npmjs.org/@libsql/linux-x64-musl)
- [libsql-js README](https://raw.githubusercontent.com/tursodatabase/libsql-js/main/README.md) — the "you probably want Turso" notice, embedded-replica-needs-a-remote, better-sqlite3 API compatibility

**Drizzle**
- [registry.npmjs.org/drizzle-orm](https://registry.npmjs.org/drizzle-orm), [registry.npmjs.org/drizzle-kit](https://registry.npmjs.org/drizzle-kit) — versions, licences, exports map, peer deps
- [`drizzle-orm-0.45.2.tgz`](https://registry.npmjs.org/drizzle-orm/-/drizzle-orm-0.45.2.tgz) — `sqlite-core/columns/text.d.ts` (`mode: 'json'`), `columns/blob.d.ts` (the "use text instead" note), `column-builder.d.ts` (`$type`), `migrator.js` (`meta/_journal.json`, `--> statement-breakpoint`), `sqlite-core/dialect.js` (the single-`BEGIN` migrate loop), `better-sqlite3/migrator.js`
- [api.github.com/repos/drizzle-team/drizzle-orm/contents/drizzle-orm/src](https://api.github.com/repos/drizzle-team/drizzle-orm/contents/drizzle-orm/src?ref=main) — no `node-sqlite/` directory on `main`

**Kysely**
- [registry.npmjs.org/kysely](https://registry.npmjs.org/kysely), [registry.npmjs.org/kysely-ctl](https://registry.npmjs.org/kysely-ctl)
- [`kysely-0.29.5.tgz`](https://registry.npmjs.org/kysely/-/kysely-0.29.5.tgz) — `dialect/sqlite/sqlite-dialect-config.d.ts` (better-sqlite3-shaped interface), `dialect/sqlite/sqlite-adapter.js` (`supportsTransactionalDdl === false`), `migration/migrator.{d.ts,js}`, `util/column-type.d.ts` (`JSONColumnType`), `plugin/parse-json-results/parse-json-results-plugin.d.ts`, `helpers/sqlite.d.ts`

**Other**
- [registry.npmjs.org/umzug](https://registry.npmjs.org/umzug)
- [registry.npmjs.org/tinybase](https://registry.npmjs.org/tinybase) — persister exports and peer deps (`sqlite3`, `@libsql/client`; no `better-sqlite3`)
- [SvelteKit adapter-node docs](https://raw.githubusercontent.com/sveltejs/kit/main/documentation/docs/25-build-and-deploy/40-adapter-node.md) — `npm ci --omit dev`, `dependencies` vs `devDependencies` bundling rule

**Unreachable (see §8):** `sqlite.org`, `www.sqlite.org`, `hub.docker.com`.
