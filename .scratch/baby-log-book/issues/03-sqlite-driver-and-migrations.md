# SQLite driver and migration tooling

Type: research
Status: resolved

## Question

Which SQLite driver, query layer, and migration tool should the server use, given SvelteKit on `adapter-node` in a single Docker container with the database on a mounted volume?

### Candidates to cover

- **Driver**: `better-sqlite3`, Node's built-in `node:sqlite`, `@libsql/client` (embedded mode).
- **Query layer**: Drizzle, Kysely, or plain SQL with a thin helper.
- **Migrations**: whatever the query layer offers, or a standalone runner.

### What to weigh

- **Native modules in Docker**: `better-sqlite3` compiles natively. What does that do to a multi-stage build, image size, and Node version upgrades? Is `node:sqlite` stable enough yet to avoid the problem entirely?
- **Migrations on boot**: the container should migrate itself on start. What does that look like, and what happens if it fails halfway?
- **WAL mode and concurrency**: household-scale writes, plus a sync endpoint that may write in batches.
- **Type safety** against the schema, since the domain model ticket will define real entities.
- **Alignment with the sync engine** — if the local-first research recommends something with server-side requirements, they must not fight.

### Deliverable

A recommendation with reasoning, written to `.scratch/baby-log-book/research/sqlite-driver-and-migrations.md`. Include a sketch of the Dockerfile implications of the recommended driver.

## Answer

**`better-sqlite3` 13.x + plain SQL behind a thin typed helper + a hand-rolled boot-time migration runner.**

Findings: [`research/sqlite-driver-and-migrations.md`](../research/sqlite-driver-and-migrations.md).

### The fact that overturns this ticket's premise

The ticket asked whether `node:sqlite` was stable enough to dodge better-sqlite3's native build. **It no longer needs dodging.** Verified by unpacking the published tarball rather than trusting write-ups: **better-sqlite3 13.0.2+ does not compile on install.** Its npm metadata carries `"gypfile": false` and *no `install` script*, and the tarball ships eight prebuilt Node-API addons — linux/darwin/win32 × x64/arm64, **plus `linuxmusl-x64` and `linuxmusl-arm64` for Alpine** — selected at runtime by `lib/binding.js`. The GitHub releases for v13.0.1–13.0.3 have zero assets because the binaries moved into the tarball itself.

So the whole historical Docker objection — a toolchain in the image, a network fetch at build time, a rebuild on every Node upgrade — is gone. Node-API keeps the same `.node` working across Node 24 → 26. The cost is 27 MB on disk, trimmable to ~2.5 MB, against a ~200 MB base image: **driver choice is not a size lever.**

### Why not the alternatives

- **`node:sqlite`** — a close runner-up, and genuinely capable (see §2.1: `exec()` for multi-statement files, synchronous throughout, everything a migration runner needs). Out on three counts: still Stability 1.2 Release Candidate in Node 26, `busy_timeout` defaults to 0, and **neither query layer supports it** — Drizzle ships no `node:sqlite` driver at all (confirmed against 0.45.2's exports map and `drizzle-orm/src` on `main`), and Kysely's `SqliteDialect` is explicitly better-sqlite3-shaped.
- **`@libsql/client`** — its own README says new development has moved to Turso (beta), and embedded replicas need a remote that a single container does not have.

### Why plain SQL over Drizzle or Kysely

ADR-0001 leaves us **one table and roughly ten queries**. That is below the threshold where a query layer pays for itself.

- **Drizzle** has the best JSON-payload ergonomics (`text({ mode: 'json' }).$type<T>()`) and the safest migrator — the whole batch in one `BEGIN` — but 0.45.2 is the only 2026 stable release, with `1.0.0-rc.5` current. Adopting it means adopting a version transition.
- **Kysely** is calmer, but its `SqliteAdapter` reports `supportsTransactionalDdl: false`, so **its migrator runs SQLite migrations outside any transaction** — a halfway failure strands a partial schema, and it does so on the one engine that implements transactional DDL properly.
- Hand-rolled `db.transaction(() => { exec(sql); record(name) })` gives per-migration atomicity in a single line, which is a better answer to this ticket's halfway-failure question than either library offers. And `rowToEntry()` is the natural home for the payload validation ADR-0001 requires.

### Cross-ticket flag

TinyBase's server persisters peer-depend on `sqlite3` or `@libsql/client` — **there is no `better-sqlite3` persister**. This does not bite today, since [the sync ticket](01-local-first-sync-engine.md) resolved to a hand-rolled client on Dexie, but it would if we ever take the TinyBase fallback with server-side persistence: it would put a second native driver in the image. The fix would be transport-only sync, or a separate `sync.db` — not a driver change.

### Gaps

`sqlite.org` and `hub.docker.com` were unreachable from the research environment, so raw SQLite WAL semantics are cited to driver docs and base-image sizes are marked unverified.
