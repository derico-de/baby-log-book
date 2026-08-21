# Baby Log Book — Specification

**Status**: locked. This is the destination artefact of the [Baby Log Book map](map.md) — twenty tickets, thirteen ADRs and a glossary, assembled into one document. Nothing architectural in here is still open.

**Who this is for**: someone who was in none of those sessions and now has to slice this into implementation tickets and build it.

## How to read it

Three artefacts, and they do different jobs. Do not duplicate between them.

| Artefact | Holds |
|---|---|
| [`CONTEXT.md`](../../CONTEXT.md) | The **vocabulary**. Every capitalised term below is defined there, with the words we deliberately avoid. |
| [`docs/adr/`](../../docs/adr/) | The **thirteen decisions** that were expensive to reach and are costly to revisit — each with its consequences. |
| This spec | The **shape of the thing**: scope, model, protocol, screens, deployment. |

The reasoning behind any line here lives on its ticket, linked inline. When this spec and a ticket disagree, this spec wins — later tickets corrected earlier ones, and those corrections are folded in here.

A word on capitalisation: **Household**, **Baby**, **Member**, **Entry**, **Feed**, **Sleep**, **Target**, **Day Start**, **Claim Link**, **Device Setting** and their siblings are domain terms with exact meanings. They are capitalised throughout, and they are not synonyms for the everyday words they resemble.

---

## 1. What it is

A self-hosted **PWA** where the people who look after a Baby keep a shared log of their day — Feeds, Sleeps, Nappies, Meals, Measurements and Milestones — on phones that are often offline.

Four facts shape every decision below:

1. **The signature moment is 3am**, one-handed, in a dark room, holding a Baby. If a feature costs a tap or a second of thought at that moment, it loses.
2. **It is offline-first.** Every Device holds the Household's entire log. Writes never wait for a server.
3. **It is a distributable product, not one person's server.** An AGPL Docker image that strangers pull and run. The governing rule: **anything the deployment needs done correctly, the app does — not the proxy, not the runbook** ([Deployment shape](issues/12-deployment-shape.md)).
4. **Grandparents are users.** Whatever the auth story is, it has to be explainable in one sentence over the phone.

### Five rules the whole design obeys

These emerged separately and kept confirming each other. Treat them as invariants; a change that breaks one is a change to the architecture.

- **The app never writes data nobody entered.** No auto-closed Sleeps, no materialised expected Feeds, no synthesised end times. It reports; the parent judges. ([Logging interactions](issues/16-logging-interactions.md), [ADR-0006](../../docs/adr/0006-targets-are-stated-not-learned.md))
- **The app never hides data somebody just entered.** Logging clears an active filter. ([Timeline filtering](issues/19-timeline-filtering.md))
- **The app never reloads a screen nobody asked it to reload.** ([PWA update strategy](issues/20-pwa-update-strategy.md))
- **The app does not nag.** One escalation state and only one — overdue shifts colour once, never twice. The palette makes a second state impossible. ([Visual design direction](issues/11-visual-design-direction.md))
- **Anything used for ordering, merging, the cursor or a duration is an instant.** Local wall time is a display-time projection and never enters a comparison. ([ADR-0010](../../docs/adr/0010-instants-are-stored-the-zone-is-a-lens.md))

---

## 2. Scope

### v1 — what gets built

- **Logging** all eight Entry types, with Live Session timers for Feeds, Sleeps and Tummy Time.
- **Timeline** as the primary screen, with attribution, Revision history, correction and undo.
- **Timeline filtering** across six facets, which is also the history surface and the Food detail view.
- **Light schedules**: one Target per activity per Baby, elapsed-vs-target in a sticky header.
- **Stats**: five trend cards over a rolling seven days plus today.
- **Export**: a zip of per-type CSVs, everything, always.
- **Milestones** — in v1 rather than v2 because they are unrepeatable. A missed feed total is noise; a first tooth that happened while the app could not record it is gone. ([Stats and CSV export](issues/10-stats-and-export.md))
- **Offline sync** with a full local replica, a durable outbox and silent conflict resolution.
- **Claim Link** auth, Parent/Caregiver roles, Invites, the Rescue Link CLI.
- **Three languages** (EN, DE, RO), metric only.
- **PWA** install nudge, update strategy, appearance that follows the clock.
- **Deployment** as one multi-arch container with boot migrations, backups and a health check.

### v2 — designed for, not built

**Push notifications.** No schema change is needed ([Schedules in v1](issues/09-schedules-v1.md)): a Target is a duration plus an anchor, which is enough to compute a due instant, and Targets already sync as revisions so every Device computes the *same* instant without coordinating.

Two constraints v1 must honour so v2 stays additive:

- The due-instant computation lives in **one shared module** that the sticky header calls, so the future notifier calls the same function rather than reimplementing it.
- Notification preferences will be **Device Settings**. Do not hang a `notify` flag off Member.

The forgotten-Sleep notification comes free from the age-banded ceiling and the Meal contradiction (§6.6).

Also deferred to v2: **an optional Device PIN or biometric lock**. With no password and no session expiry, a found unlocked phone is a signed-in Household. For v1 the answer is the phone's own lock screen plus a Parent revoking the Device.

### v3 — not designed

- Growth charts and WHO percentile curves.
- Monthly/yearly stats. v1 deliberately ships **no navigation to earlier periods**, so v3 inherits the whole question of browsing aggregates.
- Drawing travel in the zone it actually happened in. The **Recording Zone is captured from v1** though nothing reads it, so this arrives without a migration over every Entry ever logged.

### Out of scope — ruled out, with the reason

| Excluded | Why |
|---|---|
| **Health events** (medication, temperature, illness) | Not in the brief; a separate domain with its own model. |
| **Photos and diary entries** | Photos are an attachment story (storage, payload size, thumbnails); diary entries are prose. Milestones were bundled here and have been split back out. |
| **Milk / bottle freshness** | Ruled out by the user during [Bottle freshness](issues/15-bottle-freshness.md). A Feed's start anchors the Feed Interval and nothing else. The shape it had reached is kept on that closed ticket; note its strongest argument — a Feed-anchored clock always reads *younger* than the milk really is, so the error is always in the unsafe direction. |
| **Multi-household sharing** | Separated parents, public share links, exporting a Baby to another Household. |
| **Nutrition data and allergen taxonomies** | Solids stop at a Household-built Food catalogue with derived first exposure and a free-text reaction note. |
| **Native app store builds** | PWA only. |
| **A hosted / multi-tenant cloud version** | A different deployment mode, not a v1 schema tax. The door is not nailed shut — every row already carries a Household boundary. |
| **Imperial units** | Metric only. |

---

## 3. Domain model

Full vocabulary in [`CONTEXT.md`](../../CONTEXT.md). This section is the shape; that file is the meaning.

### 3.1 Container entities

- **Household** — the boundary of all shared data. **One Household per deployment** ([ADR-0009](../../docs/adr/0009-one-household-per-deployment.md)): no selector, no multi-tenancy. Every row still carries a Household boundary, so a hosted version later is a deployment mode rather than a migration.
- **Baby** — multi-baby is in the data model from day one; the UI hides the selector until a second Baby exists. Carries a birth date (used to seed Targets and the stale-Sleep ceiling, never to filter Milestone suggestions).
- **Member** — a person with access. Roles: **Parent** and **Caregiver**. Every Entry records the Member who logged it. Removal is a *state*, never a deletion.
- **Food** — a named item in the Household's growing catalogue, reusable across Meals. Mutable, Household-scoped reference data. **Not an Entry**; syncs alongside entries.
- **Target** — one stated interval per activity per Baby (§6).

A Member belongs to **exactly one Household in v1**. The domain model allowed several ([Domain model](issues/05-domain-model.md)); [Accounts](issues/07-accounts-and-invites.md) narrowed it to one so every query is Household-scoped with no exceptions. Build the schema so a second is not a migration, but do not build the switcher.

### 3.2 The eight Entry types

Everything recorded about a Baby at a point in time is an **Entry**. Eight discriminator values:

| Type | Records | Session? |
|---|---|---|
| **Breast feed** | Side (left / right / both), duration | Yes — start anchors it, end optional |
| **Bottle feed** | Intake (ml), contents | Yes — same |
| **Meal** | Several Foods, each with an optional reaction note; coarse amounts (tasted / some / lots), never grams | No |
| **Sleep** | Start and end, nothing else | Yes — **the end is the whole point** |
| **Pee & Poop** | Pee / poop / both, optional consistency, and where it landed — nappy / potty / toilet | No |
| **Measurement** | Weight, height, head circumference — all optional, entered together | No |
| **Milestone** | A free-text Milestone Name | No |
| **Tummy Time** | Start and end, nothing else | Yes — **the end is the whole point**, and nothing rescues a forgotten one (§3.7) |

**Every Entry takes an optional free-text Note**, behind an icon so it costs no vertical space in the common path. It is the pressure valve that lets the rest of the model stay narrow — including on Milestone (§3.6).

**Feed and Meal are separate concepts sharing one timeline.** The machinery differs (a bottle has millilitres, a Meal has Foods) but the parent's question is *has she eaten*, so the header answers it from both. In the UI they are one entry point with a Breast / Bottle / Food switch that reveals only the relevant fields.

Breast feeds record the **side and total duration, not per-side timers** — too fiddly one-handed, and the data is rarely used.

### 3.3 The asymmetry that shapes half the app

**Feeds are anchored by their start; a Sleep is defined by its end.**

Nothing downstream depends on when a Feed ended — the Feed Interval measures from the previous Feed's *start* — so a Feed's end is optional detail and a forgotten stop is harmless. A Sleep left running has destroyed the record it existed to make.

This splits Stale Session handling in two, and it is why only Sleeps get a recovery banner and Feeds get none. The UI must not imply otherwise: a six-hour running Feed renders as an ordinary Live Session with a Stop button and draws nothing else.

**Tummy Time sits on the Sleep side of the asymmetry and is still refused the banner** — deliberately, and it is the one place the rule is paid for rather than derived. A stretch is minutes long, in daylight, with an adult over her; the stale-Sleep machinery is aimed at hours in the dark with nobody watching. The fan carries the end instead ([ADR-0027](../../docs/adr/0027-tummy-time-ends-in-the-fan.md)).

### 3.4 Representation

- **One `entries` table**, type discriminator, shared columns (baby, occurred at, ended at, logged by, note, revision metadata, tombstone), JSON payload for type-specific fields — [ADR-0001](../../docs/adr/0001-single-entries-table.md). The database cannot enforce payload shape; validation lives in application code, and `rowToEntry()` is its natural home.
- **Append-only revisions, permanent soft deletes** — [ADR-0002](../../docs/adr/0002-append-only-revisions.md). Correcting appends; the UI shows "edited by Oma, was 120 ml". A tombstone hides an Entry and never purges it, so a 3am mistake is recoverable on every Device.
- **A Live Session is an Entry with no end time.** Not a separate concept — a running timer syncs like any other row, and the merge rule is an ordinary rule about rows.
- **Canonical units** — millilitres, grams, millimetres — stored as integers, formatted at display. Keeps unit handling out of sync and stats, and (§8.3) is what makes a comma-delimited CSV safe in DE and RO.
- **A Bottle stores the Intake; the leftover is an affordance, not a fact** — [ADR-0018](../../docs/adr/0018-a-bottle-records-the-intake.md), superseding [ADR-0015](../../docs/adr/0015-a-bottle-records-what-was-offered-and-what-came-back.md). One stored amount, corrected in place: entering a leftover subtracts it from the Intake and is not kept. Entries from before the change carry the old offered/leftover pair and read as their difference — the old derivation survives as the reading rule for legacy rows, which is why there is no migration and no protocol bump. Stats, timeline and export all speak the one figure.
- **First exposure is derived, never stored** — the earliest Meal containing that Food for that Baby. A stored flag would drift the moment an entry is corrected, deleted, or a forgotten earlier Meal is added, and it would lie about precisely the thing you would consult it for. The **reaction note is observed information and is stored**, on the Food line within the Meal.

### 3.5 Derived, not recorded

A recurring pattern worth naming, because it is the reason several things have no column:

| Concept | Derived from |
|---|---|
| First exposure | Earliest Meal containing that Food for that Baby |
| **Nap vs Night Sleep** | Whether the Sleep crosses the Day Start (§6.5) |
| **Sleep Feed** | A Feed overlapping a running Sleep |
| Day bucket | Day Start resolved in the Household Zone, at display time |
| Milestone Name suggestions | The Milestones themselves |
| Every stats figure | A fold over the local replica |

Nothing in this table is ever materialised. If a fold ever gets slow the fix is an in-memory memo keyed on the last revision `seq` — still not a stored table.

### 3.6 Milestones

The seventh type costs one fan row, one glyph and one string. Everything that could have made it expensive was rejected. ([Milestones as an entry type](issues/18-milestones-entry-type.md), [ADR-0011](../../docs/adr/0011-milestone-names-are-written-not-chosen.md))

- **The name is written, not chosen.** A free-text string stored as typed, in a combobox suggested from the names this Household has already used. A Milestone Name is structurally a Food — a name someone typed, reusable, Household-grown — and nobody ever proposed a localised carrot.
- **But there is no catalogue.** A Food repeats constantly and that reuse pays for a mutable entity; **a Milestone name repeats once per Baby, if that**. So the suggestion list is *derived* from the Milestones themselves. It cannot drift: correct a typo on the entry and the bad suggestion goes with it, where a catalogue would keep the orphan.
- **Ten localised starter suggestions**, in rough chronological order, that are UI text and nothing more: *First smile · First laugh · Rolled over · Sat up unaided · First tooth · Started crawling · Pulled to stand · First steps · First word · Waved.* Two deliberate omissions — **"Slept through the night"** (the app holds every Sleep; it would be a hand-typed claim sitting beside data that contradicts it) and **any age annotation or age filtering** (the moment it reads "crawling: 7–10 months" a logging app has become a developmental schedule telling a parent their nine-month-old is late).
- **It stays an instant.** A date-only field would be the only value in the system that is not an instant, breaking [ADR-0010](../../docs/adr/0010-instants-are-stored-the-zone-is-a-lens.md) and the one-table shape. Precision is dropped at display instead: **the timeline shows no clock time on a Milestone row** — an em dash where the time would be. Dated today → the moment of logging. **Back-dated → the Day Start of that date**, so it sits at the head of its day, which is what makes a row with no visible time legible among timed ones.
- **Uniqueness is nobody's business.** "First tooth" happens once; "new word" and "new tooth" repeat by design, and the model cannot tell them apart without the stored key already rejected. Derivable by exact string match if anything ever wants it; enforced by nothing.
- **A single-line input, not a textarea.** The anti-baby-book boundary is held by what is *absent* — no photo, no attachment, no rich text, no dedicated screen, no sharing — not by amputating the Note that all six siblings have.

### 3.7 Tummy Time

The eighth type and the fourth Live Session: a stretch a Baby spent on their front, timed. It costs one fan row, one glyph, one hue and one stats card. ([ADR-0027](../../docs/adr/0027-tummy-time-ends-in-the-fan.md))

- **It is a Sleep without the payload.** Two ends and nothing else, so the payload is empty and the entry file is the shared columns plus a duration. Everything the timeline draws for a running session — the *running* pill, the Stop button, the duration line, both ends on a finished row — follows from membership of `SESSION_TYPES` rather than from anything type-specific.
- **The fan reflows the way it does for Sleep.** While a stretch runs there is no *Tummy time* to start, only *Off her tummy*, which ends the running one **at the instant it is pressed** — no time sheet in between, because unlike a Sleep nobody discovers twenty minutes late that it ended. Starting one *does* ask, with the same one-field sheet prefilled with now, because a stretch is normally logged a minute or two in.
- **No banner, and no merge.** A forgotten stop inflates the day's total and nothing corrects it — the accepted cost (§3.3, ADR-0027). Two open stretches are two rows, not a contradiction, so [ADR-0014](../../docs/adr/0014-only-sleeps-merge.md)'s refusal covers them: merging would tombstone one and delete minutes from the day, which is the Feed failure again.
- **No Target.** Tummy time is reported, never scheduled: nothing is overdue, the live grid keeps its two columns, and no age table seeds a number the app would then measure a Baby against.
- **A duration stats card with a quarter-hour axis**, appearing only once there is tummy time in the window like every other card. Minutes per day is a rate, which is the admission test; an hourly axis would draw an honest day as a stub. Beside the total it states **how many stretches today and the longest** — 30 minutes in one go is not 30 minutes in six.

---

## 4. Architecture

### 4.1 Stack

| Layer | Choice | Ticket |
|---|---|---|
| Framework | **SvelteKit** on `adapter-node` | brief |
| Server DB | **SQLite** via **`better-sqlite3` 13.x**, plain SQL behind a thin typed helper | [03](issues/03-sqlite-driver-and-migrations.md) |
| Migrations | **Hand-rolled boot-time runner**, one transaction per migration | [03](issues/03-sqlite-driver-and-migrations.md) |
| Client store | **Dexie** (IndexedDB) | [01](issues/01-local-first-sync-engine.md) |
| Sync | **Hand-rolled**, implementing RxDB's documented pull/push/checkpoint contract | [01](issues/01-local-first-sync-engine.md) |
| CSS | **Pico CSS v2** components + **Open Props** tokens + ~200 lines of our own | [02](issues/02-css-framework.md) |
| i18n | **Paraglide JS 2** (`@inlang/paraglide-js`), catalogues as JSON in git | [04](issues/04-i18n-approach.md) |
| Rendering | **One prerendered shell**, precached; everything drawn client-side | [ADR-0012](../../docs/adr/0012-the-app-is-a-precached-shell.md) |

**The server renders no UI.** `adapter-node` serves the sync endpoints, the claim endpoints and one static shell — nothing else. SSR earns its keep on server-owned data and there is none here: the server may not hold the Entry a Member logged thirty seconds ago.

### 4.2 Why the sync engine is ours

Worth restating, because it looks like the kind of thing you buy. ([Local-first sync engine](issues/01-local-first-sync-engine.md))

**"No Postgres, no separate service" eliminates the three best-funded products in the category** — Zero needs Postgres 15+ with logical replication plus a `zero-cache` process; PowerSync offers no server-side SQLite at all; ElectricSQL needs Postgres logical replication plus an Elixir service *and* syncs only the read path. Of the rest: Dexie Cloud brings its own identity provider, Evolu's mandatory E2EE kills server-side export, Triplit is AGPL-only in browser-shipped code, Replicache is archived, Automerge is 1–1.6 MB gzipped WASM, Yjs turns our SQLite into an opaque blob store, and SQLite WASM demands COOP/COEP across the whole app.

Only **RxDB** and **TinyBase** survive cleanly — and neither sells us the one rule we need. The duplicate-open-session merge is **cross-document business logic**: two rows with different UUIDs declared to be the same real-world Sleep. That is 1–2 days whichever path we take, and an engine makes it *harder*, because it has to be expressed inside someone else's write model instead of thirty lines inside our own push transaction. Buying removes roughly 3–4 days of an 8–11 day, 500–800 line build, in exchange for a dependency, a schema language, 70–110 kB of bundle and an open-core vendor relationship.

**Reversal rule** — switch to RxDB if we ever need more than one Household replicated per Device, if multi-tab/retry scheduling produces bugs we cannot close in a week, or if a cold sync stops fitting in a few seconds on a phone. Choose TinyBase if UI reactivity decides it (first-party Svelte 5 runes bindings, ~10× smaller, bus factor of one). **Explicitly not a reason to switch**: the merge rule getting complicated — that code is ours in every scenario. And **if "no Postgres" ever becomes negotiable, this recommendation changes**; the constraint decided it, not engine quality.

**Carried hazard for the TinyBase path only**: TinyBase's server persisters peer-depend on `sqlite3` or `@libsql/client` — there is no `better-sqlite3` persister. The fix would be transport-only sync or a separate `sync.db`, not a driver change.

### 4.3 Why plain SQL

[ADR-0001](../../docs/adr/0001-single-entries-table.md) leaves **one table and roughly ten queries** — below the threshold where a query layer pays for itself. Drizzle 0.45.2 is mid-transition to 1.0; **Kysely's SQLite migrator runs outside any transaction** (`supportsTransactionalDdl: false`), so a halfway failure strands a partial schema on the one engine that implements transactional DDL properly. Hand-rolled `db.transaction(() => { exec(sql); record(name) })` gives per-migration atomicity in one line.

**The premise this overturned**: `better-sqlite3` no longer compiles on install. 13.0.2+ carries `"gypfile": false`, no `install` script, and eight prebuilt Node-API addons in the tarball — including `linuxmusl-x64` and `linuxmusl-arm64` for Alpine. The historical Docker objection is gone; Node-API keeps the same binary working across Node 24 → 26. `node:sqlite` was the runner-up and is out on three counts: still Stability 1.2 RC in Node 26, `busy_timeout` defaults to 0, and no query layer supports it.

### 4.4 Deployment

One image, published for strangers. ([Deployment shape](issues/12-deployment-shape.md), [ADR-0009](../../docs/adr/0009-one-household-per-deployment.md))

**The container**

- **One HTTP port on the internal network, no host port published.** No TLS, no proxy config, no Traefik labels shipped. nginx, Caddy and Traefik are equally supported and none is configured by us.
- **`ORIGIN` is required and the container refuses to boot without it.** The app cannot discover its own public URL and it needs one: a Claim Link is an absolute URL sent over WhatsApp, so a wrong origin mints dead invites *silently*. Boot failure is the only failure mode cheap enough for a stranger to diagnose. Everything derives from it — the cookie gets `Secure` iff `ORIGIN` is `https`, so `http://localhost:3000` still works with no dev-only flag.
- **`TRUST_PROXY` defaults off.** Behind an unknown proxy topology an untrusted `X-Forwarded-For` is a forged client IP walking through the rate limit.
- **Multi-arch `linux/amd64` + `linux/arm64`.** Self-hosters run ARM NASes and Pis; `linuxmusl-arm64` already ships.
- **Version and git SHA baked in and shown in the UI**, beside a source link. This is how **AGPL §13** is satisfied for every operator automatically rather than every self-hoster being non-compliant by default. It doubles as the first question in every bug report.

**State**

- **One named volume at `/data`**; DB at `/data/app.db` with its WAL/SHM sidecars beside it (SQLite creates them in that directory — not optional). Container runs as a non-root uid owning `/data`. "DB inside the container" from the brief means *one process, one image*, not state in the container layer, which dies on every update.
- **The session signing key is generated on first boot into `/data/secret.key`, not an env var.** A lost `.env` or a redeploy that forgets it signs out every Device at once, and recovery is one Rescue Link per person. In the volume it can only be lost by destroying the data it protects. Overridable by env for deliberate rotation.

**Migrations, updates, rollback**

- **Migrations run on boot; failure refuses to start, loudly.** Read-only sounds kinder and is a trap: every Device keeps logging and queueing pushes that will never be accepted, so the failure stays silent for hours and arrives as a pile of rejected writes. A container that will not start is visible in 30 seconds.
- **Tags `:1`, `:1.4`, `:1.4.2`, `:latest`. Migrations are cumulative from any older version and never destructive within a major.** Operators skip versions and run unattended updaters. This is a contract, not a hope.
- **A backup is taken immediately before any migration.** This is the only thing that makes "roll back to the previous tag" real. Down-migrations are not written; rolling back across a major is documented as unsupported.
- **A restart mid-sync needs no handling** — the log is insert-only and idempotent and the outbox is never discarded, so a Device retries.

**Backups**

- **Nightly online `.backup` into `/data/backups/app-YYYY-MM-DD.db`, keeping ~14**, so a host-level snapshot picks up a consistent file rather than a torn mid-write WAL. Shipping them off-box is the operator's business; making them *correct* is ours.
- **`PRAGMA integrity_check` runs on each backup the moment it is written**, logging loudly on failure — a broken chain surfaces that night, not on the worst day.
- **Restore is deliberately dumb and documented, with no CLI verb**: stop the container, replace `/data/app.db`, delete the stale `-wal`/`-shm`, start. A file copy is something an operator can do under stress at 3am.

**Security surface**

- **Rate limiting lives in the app**, in memory, on the claim endpoint only: ~10 attempts per IP per hour and **5 per token before the token is burnt permanently**. The per-token limit is the one that matters, being the part an attacker cannot rotate around. In-memory is fine — one process, and a restart clearing counters is not a meaningful bypass. This **corrects [Accounts](issues/07-accounts-and-invites.md)**, which had assigned it to the reverse proxy; with a proxy-agnostic image half the operators would never configure it, and guessing a Claim Link token *is* the attack.
- Tokens carry **128 bits of randomness**, so rate limiting is a backstop rather than the defence.

**Operator tooling**

- **A second entrypoint in the same image** — `docker exec <container> babylog members` and `babylog rescue <member>` — opening the SQLite file directly rather than talking to the running server. That is what makes "works without the app running" free; WAL mode makes concurrent access from a second process fine.
- **No HTTP admin endpoint.** An admin route on a public-internet app is a door that only ever needs to exist for five minutes a year.
- **`GET /health` opens the DB and runs one trivial query, nothing more.** Not "did the last sync succeed" — a health check that goes unhealthy because a *client* misbehaves would restart-loop the container and make things worse. Generous `start-period` so boot migrations do not count as failure.

---

## 5. Offline and sync

[ADR-0003](../../docs/adr/0003-revisions-are-the-sync-unit.md), [ADR-0004](../../docs/adr/0004-cursor-is-not-the-merge-key.md), [ADR-0013](../../docs/adr/0013-the-replica-is-a-cache-the-outbox-is-data.md), [Sync protocol](issues/06-sync-protocol.md).

### 5.1 The shape

**Revisions are the sync unit, not rows.** A revision is immutable and names only the fields it changed; current state is a fold over the log, materialised on both sides.

This makes sync **insert-only**, and that single property collapses most of the problem: two inserts cannot conflict, so push is idempotent *by construction* rather than by implementation, replay is a no-op, every replica converges regardless of arrival order, and **a stale client physically cannot clobber a field it has never heard of.**

- **Last-write-wins is per field.** You fix the volume from 120 to 150 while Oma adds a Note to the same Feed; both survive.
- **One log for everything** — Entries, Foods, Babies, Members and Household settings (the Day Start above all) travel as revisions under a kind discriminator. One feed, one cursor, one fold, one tombstone rule. Members carry id, display name and role; **nothing authenticating ever syncs.**
- **Any collection nested in a payload is one field.** A Meal's Foods list is replaced wholesale by an edit, so two concurrent edits lose one list — recoverably, as a revision. Accepted deliberately rather than growing a second merge model with tombstones inside a payload.
- **Device Settings never enter the log** (§9.4). This is a real carve-out on "one log for everything", and it exists because mum dismissing the install banner must not hide it on Oma's phone.

### 5.2 The two clocks

Conflating either into the other loses data. [ADR-0004](../../docs/adr/0004-cursor-is-not-the-merge-key.md).

- **Cursor**: a monotonic `seq` on the revision log, assigned inside the write transaction. SQLite serialises writers, so sequence order is commit order. This closes the wall-clock-watermark trap *by construction* — never use `updated_at` as a cursor, because a row can commit after another yet carry an earlier timestamp, and a client past that watermark never sees it. Silently, permanently.
- **Merge key**: the writing Device's clock corrected by its observed server offset, ties broken lexicographically by `device_id`. Server arrival order is **not** usable — a phone offline for three days would beat yesterday's correction simply by landing later.
- **The skew guard is one-sided.** Past timestamps are always legitimate. More than ~5 minutes in the future *after correction* is clamped to server receipt time and flagged on the revision — **never rejected**, because refusing to record a night feed is worse than recording it slightly late.
- **A zone change is not skew.** `Date.now()` does not move when a phone changes zone or crosses a DST boundary. The invariant in §7.4 is what keeps that true.

### 5.3 Session Merge

Two Devices each start a Sleep for the same Baby while offline.

**Any two open Sleeps for one Baby are a contradiction** — a Baby cannot be asleep twice — so **no time-window heuristic is needed**. Earliest start wins; the loser gets a tombstone plus `merged_into` pointing at the survivor, followed transitively, so a late "stop" pressed on the losing Device lands on the right session. Runs server-side inside the push transaction, idempotently.

**Only Sleeps merge** — [ADR-0014](../../docs/adr/0014-only-sleeps-merge.md). An open Feed beside an open Sleep is a **Sleep Feed**, normal, deliberate and nightly ([Schedules in v1](issues/09-schedules-v1.md) corrected a kind-agnostic rule that would have tombstoned one of them). Two open *Feeds* are the same argument one level down: pumped breast milk followed by formula is a **combined feed**, two Feeds minutes apart, and both are real. The failures are not symmetric — a Sleep folded into a Sleep reads as one longer Sleep, while a Feed folded into a Feed deletes a bottle and its millilitres leave the day's volume. The rule the Feed exemption closes was reachable from the app's own Save button, which leaves a Feed open (§3.3).

**A merge appends a revision attributed to the app rather than to a Member**, so the history says honestly that no person did it. This is the one place an app-authored revision exists, and it does not weaken the rule in §1: reconciling two sessions a human did start is not the same as inventing one. **Synthesising an end time for a session nobody stopped stays forbidden.**

### 5.4 Push, pull, liveness

- **Push**: batches of up to ~200 revisions applied in one all-or-nothing transaction. The response returns the new cursor **and the server's own time**, so the client updates its offset.
- **Liveness**: a running timer needs no traffic at all — it ticks client-side from its start instant — so only start and stop events must propagate. An **SSE channel carries a bare wake-up signal and never data**, keeping exactly one path by which rows arrive, with a ~30s foreground poll as fallback when the connection drops.
- **Initial sync** is the ordinary paged pull from cursor 0. No bootstrap path, no snapshot subsystem. The timeline fills as pages land behind a quiet "catching up" line, and **logging is never blocked** — writes go to the outbox regardless.
- **Reset lever**: "drop the local DB and re-pull" — the move that made building beat buying — is an actual button in Settings. It **refuses while the outbox is non-empty**, and fires automatically when the version check reports an incompatible local schema.

### 5.5 Tombstones, conflicts, stale clients

- **Tombstones keep the full payload, permanently, with no garbage collection**, so a mistaken 3am delete is undoable on every Device rather than only on the one it happened on.
- **The user never sees a conflict.** No dialog, nothing that interrupts. The evidence lives in the Entry's Revision history and in the app-attributed line a Session Merge leaves. If a case ever proves loud enough to warrant a notice, it arrives as a new ticket rather than as a flag on this design.
- **A protocol version rides on every sync response.** Additive payload changes do not bump it; changes that would make an old client write something *wrong* do. On a bump the client stops pushing, keeps logging locally, shows the banner in §9.3 and triggers the PWA update. **The outbox is never discarded** and flushes once the update lands.

### 5.6 The replica is a cache; the outbox is data

[ADR-0013](../../docs/adr/0013-the-replica-is-a-cache-the-outbox-is-data.md). The replica can be dropped and re-pulled — which is why building the sync engine beat buying one. **The outbox holds the only copy of an unsynced Entry.**

Its consequence is a hard contract: **a new client must be able to read an old client's outbox records.** Otherwise an incompatible local schema meets the reset lever's non-empty-outbox refusal, and the only way out is to destroy Entries a Member typed.

### 5.7 When identity goes stale

The boundary with §6 auth: sync owns only what happens when the proof is stale.

- A **401 never blocks local writes and never wipes local data.** The outbox is durable; the UI shows a passive *"signed out — 14 entries waiting"* line, and re-authenticating flushes it.
- Explicit sign-out with a non-empty outbox **warns before clearing anything**.
- A **removed** response is deliberately distinct from a 401 (§6.4).

---

## 6. Auth, roles, schedules

### 6.1 There are no passwords

[ADR-0005](../../docs/adr/0005-claim-links-instead-of-passwords.md), [Accounts](issues/07-accounts-and-invites.md).

Everything that grants access is a **Claim Link**: single-use, 128 bits of entropy, and **claimed by a POST behind a button — never by the GET that fetches it.**

That detail is not a refinement, it is the difference between working and not: WhatsApp, Signal and Telegram all fetch a URL server-side to build the preview card, so a link that claims on GET is **burnt by the preview bot before the recipient ever sees it.** The page is `noindex` and the endpoint is rate-limited (§4.4).

Two flavours, differing only in what they bind to:

- **Invite** — creates a Member. A Parent types the display name and picks the role up front, so the timeline reads "Oma" from her first Entry rather than "Unnamed". **7-day expiry** — you send it on Wednesday, she taps it on Sunday. The **Member row is created on claim**, so a pending Invite is never a half-real person in the Household; until then it sits in a pending list the Parent can revoke.
- **Rescue Link** — re-binds a Device to a Member who *already exists*, minted from the container: `docker exec <container> babylog rescue <member>`. **15-minute expiry**, because you are standing at the terminal. It re-binds rather than creating a fresh Parent: a new row would leave two "Mamas" and split three years of attribution between them, since every Revision points at the old one.

**Bootstrap is the same mechanism with nothing to bind to.** On an empty Household the command creates the Household and the first Parent — and the app **prints that link to stdout at boot whenever there are zero Members**, so first run needs no command at all. Whatever the logging setup is, that line must be readable via `docker logs`.

**This is the only privileged path in. There is no public registration page.**

> **Spec note carried from [Deployment shape](issues/12-deployment-shape.md).** The boot claim link and the Rescue Link CLI are **a stranger's onboarding path, not the author's private recovery hatch.** Their wording must read that way. The boot line is the first thing a new operator sees after `docker run` and has to stand alone with no surrounding documentation: it should say plainly what the link is, that it expires on use, and that it makes whoever opens it the Household's first Parent. The `babylog rescue` output is read by someone whose phone is gone and who is unlikely to have done this before: it should name the Member it re-binds, state the 15-minute expiry, and say that it re-binds an existing person rather than creating a new one. Neither may assume the reader wrote the app or has read a runbook.

### 6.2 Sessions

**No fixed expiry. Revocation is the control, not a timer.** A 90-day timer signs Oma out precisely when she has not opened the app in a while — the moment re-authentication is hardest and you are least likely to be in the room to help.

- The token lives in an **HttpOnly, Secure, SameSite=Lax cookie**, not in IndexedDB, so page JavaScript cannot read it and an XSS cannot exfiltrate it. Sync is same-origin, so it rides along with no client-side handling at all.
- **Offline it is simply never checked.** Only the server validates it — which is exactly what lets a Device work for days with no server contact.
- **`device_id` outlives the session** and is stored beside the local replica, not with the credential. It is the lexicographic tie-breaker in the merge key and **never a proof of identity** — nothing may treat possession of one as authorisation. Sign-out, re-claim and rescue all keep it; only wiping the local database mints a new one, which is harmless.

### 6.3 Roles

**Every Member sees everything.** There is no per-member visibility scoping ([What may a caregiver see?](issues/14-caregiver-visibility-scope.md)) — within a single family Household there is no data worth hiding from a grandparent, and the machinery to hide it would be the most expensive part of the sync layer. Replication stays uniform and the change feed stays per-Household.

Roles gate **writes and management, never reads**:

| | Parent | Caregiver |
|---|---|---|
| Log Entries | ✅ | ✅ |
| Correct anyone's Entry | ✅ | ✅ |
| Delete Entries | ✅ | — |
| Invite, remove, promote/demote Members | ✅ | — |
| Add and manage Babies | ✅ | — |
| Household settings (Day Start, Household Zone, Targets) | ✅ | — |

**Multiple Parents.** Both of a baby's parents hold the Parent role, and the one-Parent Household is one lost phone away from being unmanageable — the very case that produced the Rescue Link. One hard rule: **the last Parent can be neither demoted nor removed.**

### 6.4 Removal and revocation

**Removal is a state, not a deletion.** The Member row survives forever, marked removed, because every Revision they ever wrote points at it — the timeline must still read "logged by Oma" in three years.

Server-side their tokens die immediately, and the next pull or push gets a **removed** response that is **deliberately distinct from the ordinary 401**. Conflating the two would turn every flaky session into data loss, since a 401 must never wipe local data. On a removed response the app makes a **best-effort local wipe** and says so plainly.

Two limitations accepted rather than papered over:

- **A Device kept offline forever keeps its copy.** Revocation gates future syncs; it does not retract. That copy is not recoverable or deletable by us.
- **Anything in that Device's outbox at the moment of removal is rejected and lost.**

### 6.5 Schedules: Targets

[ADR-0006](../../docs/adr/0006-targets-are-stated-not-learned.md), [Schedules in v1](issues/09-schedules-v1.md). A schedule in v1 is **one number per activity per Baby, and no machinery.**

- **Intervals only, with three different anchors.** The **Feed Interval** runs from the previous Feed's *start*; the **Wake Window** runs from the last Sleep's *end*; the **Bottle Life** runs from the start of the bottle that is *still open*. The sleep target is not "she sleeps every 3h" — it is how long she stays comfortably awake, a different anchor, and getting it wrong would have made the sleep number useless.
- A Target stores **a duration plus the anchor it measures from**, so clock-time schedules ("nap at 12:30") can arrive later as a second anchor kind. They are the older-baby model and do not earn their keep in v1.
- **Feeds, Sleep and started bottles.** Nappies keep the plain count in the header and get no target — "no wet nappy in 6 hours" is a real signal but a *health* one, and the one target that would genuinely alarm. Nothing on Measurements.
- **The Bottle Life is a countdown, not a verdict** ([ADR-0016](../../docs/adr/0016-the-bottle-life-is-a-target-not-a-verdict.md)). It shows on the row of a bottle Feed that has started and not been stopped — per row, because a Combined Feed can have two bottles open at once — keeps counting past the stated duration, shifts colour once, and never says whether the milk is safe. It is seeded at **1h** with no age table, because milk does not care how old she is, and it can only ever read *younger* than the milk: the Feed's start is the only instant the model has, so a bottle made up earlier or returned from the fridge is not modelled. Settings states that beside the field.
- **Targets are per Baby. Day Start is per Household.** Two Babies of different ages share no interval, but they must share a day boundary or "yesterday" means two things inside one Household.
- **Stated, never learned.** Seeded once at Baby creation from the age table below, never re-derived, never averaged from the log. Schedule settings renders the current band's typical value as a **static hint beside the field** (`typical at 3 months: 2h`) — no state, no dismissal flag to sync, never on the home screen.
- **Nothing is ever materialised.** No expected Entry is written; every due figure is a display-time fold.

**The age table — seeds only, never re-applied**

| Feed Interval | | Wake Window | |
|---|---|---|---|
| to 3 months | 3h | 0–1 months | 45m |
| to 6 months | 3h30 | 1–3 months | 1h15 |
| to 12 months | 4h | 3–6 months | 2h |
| after 12 months | none | 6–9 months | 2h30 |
| | | 9–12 months | 3h |
| | | 12–18 months | 4h |
| | | beyond | 5h |

After 12 months solids take over and a feed target stops meaning anything. The Bottle Life is not in the table: one seed, 1h, at every age.

### 6.6 Stale Sleep recovery

The threshold, after `1.5× her usual` was killed by ADR-0006 and no flat number worked (5h fires at 1am on every real night sleep of a six-month-old).

**Reframed**: a running session is already visible from anywhere on every Member's Device — *that* is the primary defence and it works continuously. The banner is only the backstop for when nobody noticed, and **a backstop can afford to be late; what it cannot afford is crying wolf nightly.**

- **A hidden, age-banded ceiling**, not editable and never shown: **8h** under 3 months, **11h** at 3–6 months, **13h** after. These are "no baby sleeps this long" figures, not averages, so a celebrated first 8-hour night draws nothing.
- **Plus one sound contradiction: a Meal.** You cannot spoon solids into a sleeping Baby. It catches the forgotten afternoon nap of an older Baby the same day — exactly the gap a 13h ceiling leaves.
- **A Feed is explicitly not a contradiction signal.** A Feed overlapping a Sleep is a Sleep Feed: normal, deliberate, nightly. Triggering on it would fire a false banner on the most common night pattern in the app. **Nappies are excluded too** — changing a sleeping baby is routine.

A Stale Session also **stops counting as a running Live Session** for the purpose of deferring a PWA update (§9.3), so a timer nobody ever stopped cannot block updates forever.

---

## 7. Time

### 7.1 Day Start

**The day boundary is a configured hour, per Household**, not midnight and not derived from the first Feed. A 01:30 Feed belongs to the night before.

- **Default 05:00.** The job is keeping the whole night on one side. Later than ~06:00 and a genuine 05:30 wake-for-the-day files under yesterday; earlier than ~04:00 and a 04:30 night feed opens a new day mid-night.
- **Changing it re-buckets the past, and the settings screen says so before saving.** Bucketing is derived at display time. Stamping a day onto each Entry at write time would freeze history against a setting that exists to be a lens, and would put two incompatible day definitions inside one stats view.
- It has **a second job** and earns it: deep night runs until the Day Start, so no `Night Start` setting has to exist (§8.1).

### 7.2 Nap vs Night Sleep

`CONTEXT.md` originally claimed nap-vs-night follows from the Day Start, but **a single hour cannot classify both ends of a night** — a 20:00 Sleep is after the Day Start and no rule over one boundary separates it from a 14:00 nap.

**The Night Sleep is the one that crosses the Day Start; every other Sleep is a Nap.** It matches how people talk ("she slept through" means through the boundary) and avoids a Night Start setting nobody wants to configure. **The accepted cost**: a 19:00 bedtime that collapses at 23:00 is recorded as a Nap.

### 7.3 Instants and zones

[ADR-0010](../../docs/adr/0010-instants-are-stored-the-zone-is-a-lens.md), [Timezones and travel](issues/17-timezones-and-travel.md).

**What is stored**: `Occurred At` is a **UTC instant plus the IANA zone id** the recording Device was in — `Europe/Berlin`, never `+02:00`. A numeric offset is a dead number: it renders one wall time back and cannot tell you what `05:00` means in that place on any other date, so it can never re-derive a Day Start. **A zone id regenerates the offset; an offset never regenerates the zone.**

The **Recording Zone** is set at creation from the creating Device and **a Revision never rewrites it** — Oma correcting a German Feed from Bucharest does not restamp it with Romania.

**Nothing in v1 reads it.** That is deliberate and is the whole justification: it is *unrecoverable if not captured*, so it is written down even though the v1 lens ignores it — the same argument that pulled Milestones into v1. It is what lets the travel refinement arrive later without a migration over every Entry ever logged.

**What is rendered**: **one configured Household Zone, and it is the single lens** for bucketing, the timeline, stats and export.

- **One value, not a history.** Changing it re-buckets the past and the settings screen says so — identical to the Day Start change it sits beside. The Day Start *hour* is untouched: 05:00 stays 05:00.
- **Suggested, never applied.** A Parent's Device reporting a different zone **on every sync for 48 hours** prompts once, dismissibly, and never again for that zone. A layover must not move a Household.
- **First boot**: the claiming Device's zone.
- **Rejected**: printing each Entry's clock face in its own Recording Zone while bucketing by the Household Zone. Printed times inside one day group stop being monotonic — `20:00` then `03:00` in the same bucket.

**Travel** therefore has an explicit answer: the family in Boston for two weeks either changes the Household Zone on arrival — prompted, re-bucketing history, changing it back on return — or accepts days cut at 23:00 local. **The grandparent abroad reads the Household's days**, because she is reading about a Baby who lives in Germany.

### 7.4 The hour travels; the zone does not

The two consumers of "a local hour" **diverge, deliberately**.

**Appearance always reads the Device's own clock.** It answers *is it dark in the room I am standing in*, and only that Device knows; it must also resolve before first paint with no replica necessarily synced. Coupling it to the Household Zone would give Oma in Bucharest a **white screen in a dark bedroom at 23:30** because it is 22:30 at home — precisely the failure [ADR-0008](../../docs/adr/0008-appearance-follows-the-clock.md) exists to prevent.

So the Household's Day Start is read as **a number, not an instant**, by the appearance resolver: `05:00` is where deep night ends on *whatever* local clock the Device has. **Bucketing uses the same hour resolved in the Household Zone.** One setting, two consumers, and which is which is stated rather than left to serve both quietly.

### 7.5 DST

- **Resolving the Day Start** when its nominal hour is skipped → the instant the clock jumps to. When it happens twice → **the first** occurrence. Deterministic, and the boundary stays monotone.
- **Every duration is elapsed real time, never a wall-clock subtraction.** A Sleep from 23:00 to 07:00 across spring-forward is **7 hours**, because the Baby slept 7 hours. Same for `since last feed`, the Feed Interval and the Wake Window.

With a 05:00 Day Start and transitions at 02:00/03:00 this rule almost never fires. It exists so the behaviour is defined rather than accidental when a Household sets Day Start to 03:00.

### 7.6 The invariant

> **Anything used for ordering, merging, the cursor, or a duration is an instant. Local wall time is a display-time projection and never enters a comparison.**

Stated as a rule rather than a reassurance because it is the one thing a future implementer could break silently — the bug would appear twice a year and on every flight.

---

## 8. UI

### 8.1 Visual direction — D1 "Instrument"

[Visual design direction](issues/11-visual-design-direction.md), ratified 2026-08-16. Tokens: [`design/tokens.css`](design/tokens.css). Resolver: [`design/appearance.js`](design/appearance.js).

**Colour belongs to actions, not to categories.** One hue, and it is the accent. Entry types are told apart by **glyph and label**; the type tokens exist (`--t-feed`, `--t-sleep`, `--t-nappy`, `--t-meal`, `--t-measure`, `--t-milestone`) but **every one resolves to `--ink-2`**, so the rule is enforced by the token layer rather than by memory. A seventh entry type therefore costs one glyph and nothing else.

- **The hero figure is loud through size at weight 300, not through boldness.** 3rem of light-weight tabular figures reads as an instrument; 3rem of bold reads as shouting.
- **Overdue is the number adopting the brand colour.** With one hue there is no second escalation state available, which makes *the app does not nag* structurally impossible rather than merely intended.
- **Glyphs** are a stroke-1.7 geometric family, legible at 19px in a dark room. The Milestone glyph is **a flag** — literally the marker on a milestone, and nothing else in the set of seven is that shape. (Star reads as *favourite*; sparkle blurs at stroke 1.7; footprint is organic in a geometric family; trophy imports a competitive tone.)

**The appearance follows the clock** — [ADR-0008](../../docs/adr/0008-appearance-follows-the-clock.md). Not a toggle, and not `prefers-color-scheme`:

| Local wall clock | Appearance |
|---|---|
| 23:00 → Day Start | **deep night** |
| Day Start → 07:00 | night |
| 07:00 → 19:00 | day — **unless** the phone says dark |
| 19:00 → 23:00 | night |

**The clock can only ever make it darker, never lighter.** A phone set permanently to dark — for light sensitivity, migraine or preference — keeps a dark app at noon; a phone set to light is still dark at 22:00. After 19:00 there is no light mode at all.

- **Deep night is a quieter register, not a dimmer.** Peak luminance is capped — the brightest ink sits at `oklch(0.78 …)`, not 1.0 — while contrast against the ground stays above 10:1. **Shadows are dropped entirely**; on a near-black ground a shadow is only noise.
- **The manual override has three settings, not four**: *Automatic* (default), *Always day*, *Always night*. No *Always deep night* — it is a concession to a moment, not a taste.
- **This costs the no-JS theming the CSS research prized.** A clock cannot be read from CSS, so `appearance.js` runs **inline in `<head>` and blocks first paint**. It is the only script allowed to; a resolver that runs after paint produces exactly the white flash the rule exists to prevent.

### 8.2 How much of Pico survives

Answered by evidence: the prototype themes the **real Pico v2**, and every control on the Settings screen is Pico as shipped.

- **63 of Pico's 149 tokens are mapped.** The other 86 — invalid-field colours, spinner, tooltips, accordions, progress, text selection, and the select/date/time icon data URIs — track `:root[data-theme]` for free, which is why the resolver writes **`data-theme` alongside `data-appearance`**.
- **Import into `@layer framework`**, so nothing ever has to out-specify Pico. No `!important` outside the reduced-motion block, and Pico's own 20 `!important` declarations become irrelevant.
- **One line genuinely fights the framework**: `html { font-size: 16px }`. Pico scales the root to 131.25% on wide viewports — right for a document, wrong for an application.
- **Ours outright**: the segmented control (34 lines, costed at ~50), the bottom sheet, the FAB fan, the timeline row, the stat card and the tab bar. The override budget is spent on components Pico does not have, not on fighting the ones it does.
- **Pico's accepted risk held.** Nothing needed a component Pico lacks *and* could not be built in under 60 lines, so the **Open Props UI exit stays unused**. It remains the named exit if we ever need a component Pico lacks while upstream is still silent — Pico's last release was 2025-03-15. Do not fork.

### 8.3 Navigation and the three destinations

**Three destinations, and a bottom tab bar.** Timeline · Stats · Settings.

The tab bar does put a second control in the thumb zone, which is the trade the constraint warned about — but it is a wide, shallow strip under a **62px FAB at `bottom: 76px` with 14px of clear space**; the two are never mistaken for one another, and it is the only option that shows where you are without being opened. Header icons keep the whole bottom for the thumb but bury Stats behind a stretch; swipe has no chrome to discover and would collide with the filter.

### 8.4 The timeline — the primary screen

[Logging UX prototype](issues/08-logging-ux-prototype.md), variant D, ratified 2026-08-15.

**The timeline is the screen**, not a dashboard of tiles with the log demoted below the fold. Reverse-chronological, attribution on every row (`Oma · 14:05`), the Note behind an icon.

**The sticky header** carries the due information and stays visible while the timeline scrolls under it, because it is the number people check constantly:

- **Dominant**: `since last feed 2h10` / `next due in 50m`.
- **Quiet line**, swapping on state: `awake 1h20 · down after 1h30` when she is up, `asleep 1h05` while a Sleep runs — the Wake Window is simply **not shown when it cannot apply**. Nappy count stays on that line.
- **Empty state**: no Feed logged yet means no elapsed figure and no due figure. **Never compute a due instant from nothing.**
- **Overdue shifts colour once and never again.** The due line inverts to `50m overdue`. No second colour, no red at 2h, no badge — escalation is nagging with extra steps. Same for the Wake Window.
- **Past 24h, elapsed is replaced by the absolute time** (`last feed yesterday 14:05`). Beyond a day the figure has stopped being a number anyone reads.

**The feed clock does not pause for sleep.** `since last feed` keeps counting while a Sleep runs and still shifts colour past the Target. A Baby who has slept three hours still has not eaten for three hours — precisely the fact the app was opened for, and plenty of newborns are woken to feed.

### 8.5 Logging — the FAB fan

[Logging interactions](issues/16-logging-interactions.md).

**One FAB, bottom-right in thumb reach.** Tapping it **expands it in place into a stack of six direct actions**, expanding upward — one row per entry type: **Pee & poop · Sleep · Feed · Tummy time · Measurement · Milestone**. Six rows is also a ceiling the fan has now hit twice; a seventh entry type needs a different shape, not a seventh row.

- **A nappy is one form** ([ADR-0028](../../docs/adr/0028-a-nappy-is-one-form.md)) — and the type is named **Pee & Poop**, after what it holds rather than what caught it ([ticket 26](issues/26-one-type-for-nappy-potty-toilet.md)); the stored discriminator stays `nappy` and so does `nappies.csv`, because a UI name is not a column. The form reverses the straight-from-the-fan nappy of [Logging interactions](issues/16-logging-interactions.md). Pee and Poop are two toggles on it rather than two rows, because they are two facts about one nappy and two rows wrote two Entries — a change that held both was logged twice, inflating the day's count. The form is also the only place the **consistency** can be typed; it had been in the payload and all three locales since v1 with no input anywhere. Neither fact is prefilled and Save stays disabled until the nappy says what it held. **Where it landed** — nappy / potty / toilet — is the one prefilled field, opening on a **Device Setting** the way the Feeding default does ([issue 21](issues/21-feeding-defaults.md), [ticket 26](issues/26-one-type-for-nappy-potty-toilet.md)): a receptacle is a fact about a phase, not about this event, and a household in training states it once instead of tapping it forty times a week. It is nullable and never backfilled — a row from before the field says nothing, and nothing reads that silence as a nappy — and it shows on the timeline's meta line only when it is *not* the nappy. Cost, paid deliberately: the app's most frequent action no longer has its shortest path.
- **Feeds, Nappies, Measurements and Milestones open a sheet**, because they carry real data. Sleep, *She's awake* and starting tummy time open the one-field time sheet; *Off her tummy* writes straight through (§3.7).
- **Undo, not confirm — decided explicitly.** Corrections are already first-class: any Member may fix any Member's Entry and the history stays visible. A confirm step taxes every nappy every night to prevent a mistake that is cheap to correct.
- **Rejected**: a dedicated nappy button (a permanent second control beside a scrolling timeline, with poop behind a 400ms long-press nobody finds at 3am), and putting nappies inside the sheet.
- **Measurement holds the second-to-last slot and is just as rare as Milestone**, which is why frequency is not the fan's admission test and Milestone earned its row.

**While a Sleep runs the fan reflows** — there is no ambiguous "Feed" item:

- **She's awake** ends the Sleep, and the fan **reflows in place** to the awake set, so wake-then-feed is one FAB open and three taps rather than two trips.
- **Feed while asleep** logs the Feed and leaves the Sleep running.
- **Rejected**: a third combined "She woke to feed" item — fewest taps, but three near-synonymous labels in one fan is the same 3am discrimination problem that killed the long-press.
- **Picking Food inside the asleep sheet switches her to awake.** Solids and sleep are mutually exclusive, so the switch *is* the statement: the sheet becomes the ordinary feed sheet and a quiet inline line reads *"marked awake from 14:05"*. No modal, no confirm — it is a real write so it is visible, and undo covers it. The Sleep ends at the Meal's Occurred At as one ordinary revision with **no lasting linkage**; later corrections to either are independent. **Guard**: only when that Occurred At falls inside the running Sleep. A back-dated Meal predating the Sleep is "she ate, then went down" — leave the Sleep alone.

**Sleep Feed needs no schema.** It is *derived* from the overlap, which also covers the manual path where a corrected Feed lands inside a Sleep without passing through the fan. `since last feed` **does** reset on a Sleep Feed, because a real Feed was logged; awake time stays "time not covered by a Sleep", so a Sleep Feed does not make her awake.

**One feed at a time** ([ADR-0019](../../docs/adr/0019-a-new-feed-ends-the-running-one.md)). A new feeding — Feed or Meal — ends a running Feed at the new one's Occurred At: the formula after the breast stops the breast timer, because a Baby eats one thing at a time. Same shape as the awake switch: one ordinary revision, attributed to the Member who logged the new feeding, no lasting linkage, and the sheet says so with the same quiet inline line (*"ends the running feed at 14:05"*). **Guard**: only when the new Occurred At falls inside the running Feed — a back-dated feeding predating it is a separate, earlier feed and leaves it alone. **Not a merge**: both rows and both volumes stay (ADR-0014).

### 8.6 The stale-Sleep banner

**A banner in the timeline at the threshold** (§6.6), offering *She woke at…* / *Still asleep* / *Delete*. The timeline stays usable behind it.

- **The app never acts on its own.** Auto-close was rejected: ending a Sleep at a guess would preserve more records, but every revision is attributed to a Member and an app-authored revision is a concept the model should not gain for this.
- **Rejected**: a modal blocking the timeline until answered — hostile at exactly the moment it fires, and it punishes the person who opens the app rather than the one who forgot to press stop.
- **It prompts, and it stops asking.** *Still asleep* restarts the clock so the threshold does not fire again immediately; the Sleep stays running because it is genuine.
- **The picker defaults to her usual wake time, not to now.** "Now" is the honest we-know-nothing answer and is almost always wrong — she woke hours ago, which is why the banner appeared.
- The banner **belongs to the live header's world**, so it is absent while the filter header is up and returns when the filter clears.

### 8.7 Filtering — which is also history

[Timeline filtering](issues/19-timeline-filtering.md), variant A, ratified 2026-08-17.

**The filter takes the header's place.** D1 spends its only hue on actions, so "this timeline is filtered" had to be said without colour — and the winning answer says it with the largest element on the screen: **the live hero figure is gone and inverted ink stands where it was.** Same screen, same FAB, no mode.

The trap this solves is that a filtered timeline *looks like* an unfiltered one, and you log a Feed against what you thought was today. A standing bar under an unchanged live header (variant B) is not enough at 3am; a separate find surface (variant C) pays a mode for safety that A gets from contrast.

**What follows from choosing A:**

- **The sticky header does not survive filtering.** The live elapsed-vs-target figures are about *now* and there is no version of them that is correct in a historical view.
- **The Food detail view is a pre-filtered timeline, not a screen.** Settings → Foods → *Broccoli* enters the ordinary filtered state with `food = Broccoli`. No second surface, no second row template, and the reaction notes come with the rows because they *are* the rows.
- **Milestone is an ordinary facet**, and that is enough to answer "when was her first tooth". A Milestone row reads fine beside timed ones: an em dash where the clock time would be, at the head of its day.

**Two rules on top:**

- **Logging clears the filter.** The FAB is the one control that can write a row the current filter would hide, and a write with no visible row is how you log a nappy twice at 3am. The Entry lands, the filter drops, and you are back on today's log with the toast and Undo. The cost is accepted — an accidental FAB tap destroys the lookup, which is cheap to redo. **Stopping or correcting a row you are already looking at does not clear the filter**; that write is visible by definition.
- **A filter is a lookup, not a setting.** It survives a trip to Stats or Settings — the inverted header makes coming back legible, and the Food route *enters* the filter from Settings. **It never survives a cold start.** Nothing the app remembers overnight can surprise you at 3am.

**Five facets, all in v1:**

| Facet | Shape |
|---|---|
| Entry type | Chips. **Breast and Bottle collapse into one Feeds chip** — nobody at 3am thinks "breast OR bottle". |
| Food | Picked from the catalogue |
| Member | Who logged it |
| Free text | Substring match over Notes **plus the rendered detail of a row** — Food names, a Milestone Name, who logged it — with the hit highlighted |
| Date period | **Three preset chips**: Anytime / Last 7 days / Last 30 days. **No date picker in v1.** |

Free text is a substring scan over the local replica, **not an index**: the whole log is already on the Device, and a month is ~240 entries.

---

## 9. Read-side and lifecycle

### 9.1 Stats — the shape of a day, and then the trend

[Stats and CSV export](issues/10-stats-and-export.md), [The day grid](issues/28-the-day-grid.md).

The home screen already answers *when did she last eat*; the timeline already answers *what happened yesterday*. Two questions are left, and the screen answers them in this order down one scroll: **what does her day look like** (the grid) and **is this getting better** (the cards). The paediatrician's "how much is she taking?" falls out of the second for free.

**Ticket 28 overturns two of this section's rules**, both stated where they stood: stats is no longer a trend screen *and only that*, and earlier periods are navigable. Everything else below is unchanged.

**Per Baby**, with the selector appearing only when a second Baby exists.

**Four cards. A card appears only when its entry type has data in the window** — which makes age-appropriateness free: a newborn's screen has no Solids card, an older Baby's Feeds card quietly stops being the headline. No age logic, no settings, no empty states.

1. **Sleep** — total per day, split Night Sleep vs Naps (computable only because §7.2 settled which is which). Longest stretch as the secondary number.
2. **Feeds** — count per day, with total volume as a secondary number **only when bottles exist**. Volume cannot be the primary bar: a breastfed Baby has no millilitres. The volume is the recorded **Intake** ([ADR-0018](../../docs/adr/0018-a-bottle-records-the-intake.md)).
3. **Nappies** — count per day, split pee/poop.
4. **Solids** — Meals per day, with "3 new Foods this week" as the secondary, derived from first exposure.

**The rule is: cards appear for entry types that have a rate.** Restated from "that have data" because of Milestones — a Milestone card would read "1 this week, ▼2 vs last week", which is noise in a good week and quietly bleak in a normal one, and a normal week is zero. That collides with the same screen's refusal to report decline when nothing is wrong. **Four cards stand; Milestones get no card.**

**The window: eight bars, seven of which count.**

- **A rolling seven days, with no controls at all.** Each bar is a day, so daily-and-weekly is one view rather than a switcher. Rolling rather than calendar also dodges an i18n trap: calendar weeks start Monday in DE and RO, and a stats screen that disagrees with itself across languages is an endless bug.
- **Today is drawn as an eighth, visibly in-progress bar, and is excluded from the delta**, which compares the seven complete days against the seven before. Including a half-finished day would tell you *every single morning* that things are getting worse.
- **A running Sleep counts up to now**, so the bar grows live. One rule covers both cases: **show the truth so far, keep it out of the comparison.** Everything the delta is computed from is visible on screen.
- ~~**No navigation to earlier weeks in v1.**~~ **Overturned by [ticket 28](issues/28-the-day-grid.md).** A grid you cannot step is a grid you can only ever check once. `‹ ›` steps a week or a day, forward is capped at today, and a *Today* button appears once the window has left it. **The window is never remembered across a cold start** — the screen always opens on today, the same rule §8.7 gives the filter. The cards keep their fixed rolling window whatever the grid is showing; they are not a view of it. What v3 still owns is *aggregating* over a period longer than a day.

**Computed client-side, nothing cached.** A year is ~7,300 entries and under 2 MB, which folds in milliseconds. Day Start re-bucketing follows for free.

**Bars are hand-rolled, no charting dependency.** Eight bars with no axes, tooltips or zoom is not a charting problem. **Every card states its numbers as text with the bars as the secondary read** — at 3am a shape you have to interpret is worse than a sentence, and it is the accessible version for free.

**The day grid — above the cards, and the reason this screen is no longer *a trend screen and only that*.** [Ticket 28](issues/28-the-day-grid.md). An hour axis down the side, one column per day, every Entry drawn in the slot it happened in and wearing its type's hue. **Week** is seven columns; **Day** is one, with the blocks labelled and tappable into the entry sheet. Also hand-rolled, also client-side over the replica.

- **A column is a day bucket, not a calendar day** — Day Start to Day Start, so the grid can never disagree with the cards, the timeline or the export about which day an Entry belongs to. It also makes DST free: a column is its two instants and a block is its share of the span between them, so a 23-hour day is a shorter column with one tick fewer and the axis labels simply skip the hour the day skipped (§7.4, [ADR-0010](../../docs/adr/0010-instants-are-stored-the-zone-is-a-lens.md)).
- **Drawing overlaps, counting attributes.** A card gives a session to the bucket it *began* in; the grid draws time rather than counting days, so a session appears in **every** column it touches, clipped flat at the edge. The one place in the app that does not use start-bucket attribution, deliberately.
- **Every Entry takes the whole column, and layer order does the rest** — Sleep underneath, sessions with a duration over it, instants over both. A Sleep Feed overlaps its Sleep by definition (§3.4), and a full-width Feed drawn across a full-width Sleep says *inside* far more plainly than a narrow column drawn beside it; a ring in the ground colour keeps the upper layers reading as objects lying on a Sleep rather than as slices cut out of it. Two genuinely-overlapping foreground sessions still split lanes, per cluster.
- **Instants are a tick, not a block.** Pee & poop, Meals, Measurements and Milestones have one time and no duration, so a minimum-height block would be the grid lying about a length they do not have. They are full width like everything else; two too close to share the trailing edge pack against it rather than spreading across the column, and neither is ever nudged off the time it happened at.
- **A Combined Feed is drawn as the one sitting it was.** Two Feeds close together are one answer to *has she eaten*, so the grid draws one block stating both sources' values — `Breast · Left + Bottle · Formula · 90 ml` — with one tap target per source and a seam at the handover. **Where the sources match, they are one figure instead**: a sitting that needed a second bottle of the same formula reads `Bottle · Formula · 140 ml`, with no seam and no plus, because a reader does not want an addition to do. Consecutive runs only, and a bottle whose contents nobody recorded is never assumed to match another. **The kind is stated once per stretch of it** — `Bottle · Breast milk · 60 ml + Formula · 80 ml`, not the word twice — except where a run has nothing else to call itself by, which is the same unrecorded-contents case again. Nothing is merged or stored — the rows stay two rows, both tappable, both in the column's linear read at their own times with their own figures. **The grouping rule is the cards' own**, the 15-minute feed round above, imported rather than restated: a grid that grouped feeds differently from the card beneath it would be the screen disagreeing with itself. Grouped over the whole log rather than per column, so a sitting that straddles a Day Start is the same sitting on both sides of it.
- **Colour is the scanning channel and never the identifying one.** A legend names every hue with its glyph and its word — and doubles as a type filter, showing only facets with data in the window. Every week column also carries a visually-hidden ordered list of its Entries, with times and durations, so the whole grid reads linearly. **The accent appears exactly once on this screen: the now line.**

### 9.2 Export

[ADR-0007](../../docs/adr/0007-export-is-an-escape-hatch.md). **It is an escape hatch, not a backup.** The data is yours because this is self-hosted. It is explicitly **not re-importable**; the real backup is the SQLite file on the volume.

- **A zip of one CSV per entry type, plus reference tables**: `sleeps`, `breast_feeds`, `bottle_feeds`, `meals` + `meal_foods`, `nappies`, `measurements`, `milestones`, `tummy_times`, and `babies`, `members`, `foods`, `targets`, `revisions`, `household`. The decisive argument is not sparse columns — it is that **a Meal holds several Foods and therefore does not fit one row**. Both escapes are wrong: repeating the Meal across N rows corrupts every count in the file, and a list in one cell is no longer CSV. Cost: one ~8 KB zip library in the browser.
- **Everything, always, no options.** One button, all Babies, all time, whole Household. A filtered export is not an escape hatch, and `baby_id` is there for anyone who wants one Baby. **This is the rare feature whose correct UI is zero UI.**
- **Produced in the browser** from the local replica as a `Blob`. Works offline, needs no endpoint and no auth path, and at 2 MB a year the server's only advantage never gets cashed in. It also keeps the export honest: what comes out is exactly what your Device holds.
- **The edit history comes out, stratified.** Each entry file carries current values plus `logged_by`, `logged_at`, `edited_by`, `edited_at`, `deleted_at`; the full chain lives in `revisions.csv`. **Soft-deleted entries are included and flagged** — an export that silently drops rows the app still holds is lying about being complete.
- **Stable English headers and enum values, whatever the UI language.** Localised headers would make the file unparseable by anything, including future-you.
- **Timestamps go out as one ISO-8601 column carrying its offset** (`2026-08-16T02:14:00+02:00`) **plus an `occurred_at_zone` column** with the IANA id, since an offset cannot regenerate a zone. **No local-wall-time-only column, ever.**
- **`household.csv` carries the Household Zone and the Day Start hour**, because a day bucket is derived and never stored — an export carrying entries but not the lens exports numbers whose meaning is gone.
- **UTF-8 with a BOM**, or Excel mangles German umlauts and Romanian diacritics. Standard comma delimiter, safe only because canonical units are integer ml, g and mm — there are no decimals to collide with the DE/RO decimal comma.

### 9.3 PWA: shell, install, update

[ADR-0012](../../docs/adr/0012-the-app-is-a-precached-shell.md), [PWA update strategy](issues/20-pwa-update-strategy.md).

**The shell.** One prerendered shell, cache-first for every navigation, everything drawn client-side from the replica. It makes the shell and its hashed chunks **one atomic versioned unit**, which *deletes* the old-page-404s-on-a-new-chunk-name bug rather than mitigating it, and it puts the inline appearance resolver in exactly one file.

- **`background_color` and `theme_color` take the deep-night ground permanently.** The OS launch screen paints before any of our code exists, and its colour comes from a static JSON file that cannot read a clock. A dark launch at midday is a non-event; a white one at 3am is the exact failure ADR-0008 was written to prevent. The resolver writes `<meta name="theme-color">` at runtime so the status bar still follows the clock.
- **`display: standalone`**, which keeps the OS clock visible — worth having in an app about elapsed time.
- **Claim is an ordinary route in the same shell**, and **the worker registers only after a Claim succeeds** — then `persist()`, then the initial sync. A Device becomes offline-capable at the moment it becomes a Device.

**Updates.**

- **Detection piggybacks on sync; nothing else polls.** The sync response carries the protocol version, app version and git SHA; a difference calls `registration.update()`. One unconditional check on cold launch covers the Device that has been offline a week. **No interval timer** — a second clock waking the radio to ask what the sync loop already asks is pure battery on a phone idle twenty hours a day.
- **The new worker installs, waits, and takes over only at a moment indistinguishable from a cold launch** — a real cold start, or a return from background beyond 30 minutes.
- **A running Live Session defers the reload**, which closes the hole the 30-minute rule opens: a Sleep runs, the phone is in a pocket for three hours, and the return from background is exactly the 3am moment the design protects. A Sleep running all night means the update lands after she stops it in the morning. **The deadlock is already solved**: a Stale Session stops counting as running (§6.6). No new state, no new threshold.
- **The timer needs no protection.** A Live Session is a row with no end and the elapsed figure is derived from its start instant on every paint, so nothing about it lives in memory. A reload cannot blink it or reset it. **What needed protecting was the tap, not the number.**
- **There is no progress UI, because there is no moment to show** — the worker finishes precaching before it enters `waiting`.
- **Rejected**: auto-reload on detection (costs a tap at 3am), a prompt for ordinary versions (nagging, and there is nothing to decide), any interval check, waiting for the outbox to drain (deadlocks the forced case by construction), SSR with network-first HTML caching (a second source of truth, stale the moment the Device is offline).

**Being stuck, in both directions.**

- **Client behind**: a protocol bump stops pushes and shows a passive banner — *"This device needs to update before it can send"* with an **Update now** button. Everything else stays live: the FAB, the fan, corrections, and **pulls**, because a bump is about writes that would be wrong, not reads. The timeline stays fresh while the outbox grows — the least alarming version of stuck. **Update now reloads immediately, Live Session or not** — the rule is *never reload a screen nobody asked to reload*, and they asked.
- **Client ahead**, which arrives by design because rollback is real: the client refuses to push when its own version is higher. Same banner, **different words, and the words carry the weight** — it says the **server** is running an older version, because this is an operator's problem and a banner implying otherwise sends a grandparent hunting through Settings for a fix that does not exist. **Cheap now, impossible to retrofit onto a fleet already stuck.**
- **Settings shows one version line, splitting into two only when client and server disagree.** One line is what AGPL §13 needs and what a bug report needs; the disagreement is the single most useful fact in any bug report this project will receive.

**Install — once, passively, and not cosmetic.** An uninstalled tab holding an undrained outbox is a data-loss risk.

- **A dismissible banner after the Device has claimed *and* logged its first Entry**, so a grandparent's first screen is not a request. `beforeinstallprompt` on Android; on iOS, which has no such event, the Share glyph and "Add to Home Screen" as an instruction.
- **`navigator.storage.persist()` fires unconditionally after the Claim regardless** — one line, and the actual mitigation.
- **Settings owns it permanently; the banner is only a nudge.** A one-shot banner is a door that closes for everyone who dismisses reflexively, so an *Install on this device* row lives in Settings whenever the app is not running installed, and disappears once it is. The row must handle **not having a `beforeinstallprompt` in hand** — the event does not survive a reload — by falling back to the instruction rather than rendering a dead button.
- **Ignored and dismissed differ**: the banner persists until explicitly dismissed or installed, because one that retires itself leaves the Member who kept meaning to get round to it with no trace of what they saw.

### 9.4 Device Settings

A **Device Setting** belongs to one Device alone and **never enters the sync log**. This is a carve-out on "one log for everything" (§5.1) and it is load-bearing: without it, mum dismissing the install banner hides it on Oma's phone, where the app is not installed and the risk is real.

Four instances in v1, which is what made it a category rather than an exception:

| Setting | Why it is per Device |
|---|---|
| Appearance override (*Automatic* / *Always day* / *Always night*) | How dark the screen is depends on the room this phone is in |
| Install banner dismissal | Depends on this phone not having been installed |
| Language preference | Per Member, mirrored into a cookie and a synchronous rune for first paint |
| Feeding default (*Breast* / *Bottle · breast milk* / *Bottle · formula*) | How feeds usually happen on this phone: mum breastfeeds, Oma bottles. Stated in Settings, never learned from the log; choosing differently in the sheet is session-local |

v2 push preferences will be the fifth. The test is whether the setting answers a question about *this phone* rather than about the Household.

### 9.5 i18n

[i18n approach](issues/04-i18n-approach.md). **Paraglide JS 2**, catalogues as plain `messages/{en,de,ro}.json` in git. No account, no translation SaaS — it is also the SvelteKit team's own add-on (`npx sv add paraglide`).

- **Offline is a consequence of the architecture, not a feature we configure.** Messages compile to ESM at build time, Vite bundles them into app chunks, and the service worker already precaches those via `cache.addAll(build)`. No loader, no runtime fetch, no cache key to invent.
- **Romanian plurals are handled properly**: selection is `new Intl.PluralRules(locale, options).select(n)` with per-locale category sets, so `ro.json` declares `one`/`few`/`other` while en/de declare two. (Verified: RO gives `20 → other`, `1.5 → few`, `101 → few`.)
- **Ship all three locales.** The bundle-size-vs-offline-switching tension is illusory: switching offline can only ever be served from the precache, so a per-locale bundle would have to precache the others anyway. Paraglide tree-shakes per *message*, which is the right granularity.
- **The switch**: the preference lives in the account record (already replicated locally), mirrored into a synchronous `$state` rune that a `custom-account` strategy reads. **It must be synchronous** — `getLocale()` silently skips promise-returning custom strategies. A cookie mirror keeps the first paint correct. Switching writes the record, updates cookie and rune, calls `setLocale(next, { reload: false })`, and re-renders via one root `{#key}`. **Deliberately not the default reload**: offline, a reload is answered from cache, and a cached document has the old language baked into its markup.
- **Rejected**: `sveltekit-i18n` (no plural modifier at all — it cannot spell Romanian correctly), `svelte-i18n` (its own SvelteKit guide mutates a process-global store in `hooks.server.ts`, a cross-request language leak that in a Household app renders one Member's page in another's language), `typesafe-i18n` (its positional syntax reads three slots as zero|one|other, so the obvious Romanian spelling silently renders "2 de minute").
- **Formatting** uses `Intl.RelativeTimeFormat`, `Intl.DateTimeFormat` and `Intl.NumberFormat` throughout. Metric only.

---

## 10. The decision record

Thirteen ADRs, in [`docs/adr/`](../../docs/adr/). Read these before changing anything structural.

| | Decision |
|---|---|
| [0001](../../docs/adr/0001-single-entries-table.md) | One `entries` table with a JSON payload |
| [0002](../../docs/adr/0002-append-only-revisions.md) | Entries keep append-only revisions and are never hard-deleted |
| [0003](../../docs/adr/0003-revisions-are-the-sync-unit.md) | Sync moves immutable revisions, not rows |
| [0004](../../docs/adr/0004-cursor-is-not-the-merge-key.md) | The pull cursor is never the merge key |
| [0005](../../docs/adr/0005-claim-links-instead-of-passwords.md) | Access is granted by one-time Claim Links, not passwords |
| [0006](../../docs/adr/0006-targets-are-stated-not-learned.md) | A Target is a number the parent states; the app only computes against it |
| [0007](../../docs/adr/0007-export-is-an-escape-hatch.md) | The Export is an escape hatch, not a backup |
| [0008](../../docs/adr/0008-appearance-follows-the-clock.md) | The appearance follows the clock, and the clock can only make it darker |
| [0009](../../docs/adr/0009-one-household-per-deployment.md) | One Household per deployment, and the deployment is a stranger's |
| [0010](../../docs/adr/0010-instants-are-stored-the-zone-is-a-lens.md) | Instants are stored, the zone is a lens, and the hour travels |
| [0011](../../docs/adr/0011-milestone-names-are-written-not-chosen.md) | A Milestone Name is written, not chosen |
| [0012](../../docs/adr/0012-the-app-is-a-precached-shell.md) | The app is a precached shell, and the server renders no UI |
| [0013](../../docs/adr/0013-the-replica-is-a-cache-the-outbox-is-data.md) | The replica is a cache; the outbox is data |

---

## 11. Open questions

Nothing architectural. What survives is genuinely later work, and each is pinned enough that it arrives without a migration.

**v2 push notifications.** Delivery only. iOS delivers web push **only to installed PWAs**, so v1's install nudge is the precondition for v2 on an iPhone and the feasibility question is *how many Devices actually installed*, not whether the platform allows it. Still open: permission prompt placement, and what a notification does when the Device has been offline for a day.

**v3 growth charts.** Data source, licensing and rendering for WHO percentile curves. Untouched by this map.

**v3 monthly/yearly aggregates.** *Browsing* history is answered — the timeline filters, with three preset date chips. What v3 owns is **aggregating** over a period, and it inherits a decision it may not want: the timeline's period is a preset, and a year view probably needs a real range. The four cards and the today-is-excluded-from-the-delta rule are the v1 shape it either extends or breaks from deliberately.

**v3 travel rendering.** Storage is done — the Recording Zone is captured from v1. What is open is **presentation**: day buckets that span two zones, and whether printed times inside one bucket can stop being monotonic without becoming unreadable. That objection is what killed the naive version.

**v2 Device PIN / biometric lock.** [Accounts](issues/07-accounts-and-invites.md) raised the stakes rather than changed the decision.

### Named exits

Three decisions carry a documented escape route. None is expected; all are cheap because they were chosen for it.

| If | Then |
|---|---|
| More than one Household per Device, or multi-tab/retry bugs we cannot close in a week, or a cold sync stops fitting in seconds | **RxDB** on the same server endpoints — a client-side change, not a rewrite |
| UI reactivity turns out to decide the store | **TinyBase** (watch the `better-sqlite3` persister gap, §4.2) |
| We need a component Pico lacks *and* upstream is still silent | **Open Props UI** — move, do not fork |
| "No Postgres" ever becomes negotiable | Reopen the engine decision; **Zero** becomes a serious contender |
