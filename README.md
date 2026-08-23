# Baby Log Book

A shared log of a baby's day — feeds, sleeps, nappies, solids, measurements and
milestones — kept by the people who look after them, on phones that are often
offline. Self-hosted: one container, one volume, your data.

The design is written down before the code: the vocabulary in
[`CONTEXT.md`](CONTEXT.md), the decisions in [`docs/adr/`](docs/adr/),
and the shape of the thing in [`.scratch/baby-log-book/spec.md`](.scratch/baby-log-book/spec.md).
Read those before changing anything structural.

## What it does

- **Logging** all eight entry types, with live timers for feeds, sleeps and tummy time.
- **A timeline** as the primary screen, with attribution, revision history,
  correction and undo — and filtering across five facets, which is also the
  history surface.
- **Light schedules**: one target per activity per baby, elapsed-vs-target in a
  sticky header. Stated, never learned.
- **Stats**: a day grid — an hour axis with every entry drawn in its own slot
  and its own colour, in a week or a single-day view, steppable back through
  the log — over five trend cards on a rolling seven days plus today.
- **Export**: a zip of per-type CSVs. Everything, always.
- **Offline sync** with a full local replica, a durable outbox and silent
  conflict resolution.
- **Notifications, if a phone asks for them**: ten minutes before a started
  bottle's life runs out, so the rest of it can be offered while there is still
  time; when a feed is due; and when the wake window is up. Each is a target the
  household stated coming round, at an offset the household sets — never a
  number the app decided, and never while she is already feeding or already
  asleep. Off until switched on, per device, and it needs nothing configured —
  the signing key is generated in the volume on first boot.
- **Three languages** (English, German, Romanian), metric only.

## Running it

```sh
docker run -d --name baby-log-book \
  -e ORIGIN=https://log.example.com \
  -v baby-log-book-data:/data \
  --restart unless-stopped \
  ghcr.io/derico-de/baby-log-book:1
```

Then read the log:

```sh
docker logs baby-log-book
```

On an empty household the app prints a setup link. Open it on your phone: whoever
opens it becomes the household's first parent, and the link stops working once it
has been used. Restart the container to get a new one.

There is no public sign-up page. Everyone else gets in through an invite link a
parent creates in Settings, or through a rescue link you mint from the container.

A [`compose.yaml`](compose.yaml) example is included. The container publishes no
host port and ships no proxy configuration — put nginx, Caddy or Traefik in front
of it, whichever you already run. A full walkthrough — Compose plus a worked
Caddy and nginx configuration, including the SSE and `X-Forwarded-For` details
that bite — is in [`docs/deployment.md`](docs/deployment.md).

### Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `ORIGIN` | — | **Required.** The public URL Members open. Every Claim Link is built from it, so the container refuses to start without one. The session cookie gets `Secure` if and only if this is `https`, which is why `http://localhost:3000` works with no dev-only flag. |
| `DATA_DIR` | `/data` | Where the database, its backups, the session key and the push signing key live. |
| `TRUST_PROXY` | off | Trust `X-Forwarded-For` for the claim rate limit. Leave it off unless you know your proxy overwrites that header. |
| `PORT` | `3000` | The port inside the container. |
| `SESSION_SECRET` | — | Overrides the key in the volume. Only for a deliberate rotation: setting it signs out every device. |

### Updating

Tags are `:1`, `:1.4`, `:1.4.2` and `:latest`. Migrations are cumulative from any
older version and never destructive within a major, so skipping versions and
unattended updaters are both fine. A backup is taken immediately before any
migration runs, which is what makes rolling back to the previous tag real.

Rolling back across a major version is not supported: down-migrations are not
written.

### Backups

A nightly online backup lands in `/data/backups/app-YYYY-MM-DD.db` and about
fourteen are kept, so a host-level snapshot picks up a consistent file rather
than a torn mid-write WAL. `PRAGMA integrity_check` runs on each one the moment
it is written and logs loudly on failure. Shipping them off the box is your
business; making them correct is ours.

### Restoring

Deliberately dumb, and there is no CLI verb for it — a file copy is something you
can do under stress at 3am:

```sh
docker stop baby-log-book
# in the volume:
cp /data/backups/app-2026-08-17.db /data/app.db
rm -f /data/app.db-wal /data/app.db-shm     # stale sidecars must go
docker start baby-log-book
```

The backup is the whole file, so if you host more than one household, restoring
rolls **all** of them back to that night. There is no per-household restore.

### The operator tool

```sh
docker exec baby-log-book babylog households
docker exec baby-log-book babylog members
docker exec -e ORIGIN=https://log.example.com baby-log-book babylog rescue "Mama"
docker exec -e ORIGIN=https://log.example.com baby-log-book babylog household "Anna & Tom"
docker exec -it baby-log-book babylog delete "Anna & Tom"
docker exec baby-log-book babylog delete "Anna & Tom" <id>
```

`rescue` mints a 15-minute link that signs a device back in **as an existing
person**, so everything they have already logged stays theirs. Use it when a
phone is lost and no parent is left to send an invite.

`delete` erases one household and everything it ever logged. It shows you what
it is about to destroy and then wants that household's id back before it does
anything — see [Deleting a household](#5-deleting-a-household).

Every command opens the SQLite file directly, so they work whether or not the app
is running. There is no HTTP admin endpoint: an admin route on a public-internet
app is a door that only ever needs to exist for five minutes a year.

### Hosting more than one household

One container can host several households — the same file, the same domain, one
per family ([ADR-0020](docs/adr/0020-one-deployment-many-households.md)). Nothing
changes for a single family: first boot still prints the link that sets up
household #1, and a deployment that never runs `babylog household` behaves
exactly as it always did.

#### 1. Mint the link

```sh
docker exec -e ORIGIN=https://log.example.com \
  baby-log-book babylog household "Anna & Tom"
```

With Compose, the service name replaces the container name:

```sh
docker compose exec -e ORIGIN=https://log.example.com \
  app babylog household "Anna & Tom"
```

`ORIGIN` has to be the value **the container itself runs with**, because the
claim link is an absolute URL built from it; point it somewhere else and you
hand out a link that will never be accepted. A container started with
`-e ORIGIN=…`, or a Compose `environment:` block, already carries that value
into `docker exec`, so spelling it out again is belt and braces — and the habit
that saves you on the day you run the command in a shell that has none, where it
refuses to print a link at all rather than printing a dead one.

The name is required (up to 200 characters) and is how the household shows up in
`babylog households`. It lands in two places at once: **your** label for them,
which nothing in the app can reach, and the household's own name, which their
parents can change from Settings and which rides along in the `household.csv` of
their export — so name it something you would not mind them reading.

It prints the link, when it expires, and the sentence to send with it:

```
This link sets up a new household called “Anna & Tom”.
Whoever opens it becomes its first parent, and the link stops
working once it has been used.

    https://log.example.com/claim?t=N3pErRmob6Ty4Xpay_qdlA

It expires on 2026-08-29 15:00 UTC. Run this command again for a fresh one;
links already sent keep working.

Send this sentence along with the link:

    It runs on my server, so technically I can see everything you log — same trust as sending it to me directly.
```

#### 2. Send it, disclosure and all

Send both parts. The sentence is not boilerplate: hosting somebody else's log
means you can read it, and they should hear that from you before they start
typing rather than work it out later.

The command **creates nothing but the link**. The household appears when
somebody claims it, so an unclaimed link expires leaving no empty household
behind — and running the command again mints a fresh, independent link rather
than burning one you have already sent. There is nothing to clean up if a family
never gets round to it.

#### 3. Check it landed

```sh
docker exec baby-log-book babylog households
```

```
  Anna & Tom
      1 member(s) · last activity 2026-08-21 18:05 UTC
      id 6f3a1c2e-...
```

If they later rename themselves in Settings, the listing keeps leading with your
label and prints theirs underneath:

```
  Anna & Tom
      the family calls it “Familie Hansen”
      1 member(s) · last activity 2026-08-21 18:05 UTC
      id 6f3a1c2e-...
```

Your own label is yours to change too, and every command below takes the id, your
label or the family's name — whichever one the mail in front of you happens to
quote:

```sh
docker exec baby-log-book babylog label "Anna & Tom" "The Hansens"
```

With exactly one household on the box, `babylog label "The Hansens"` names it
without naming it first — which is how the household founded by the first-boot
setup link, carrying no label at all, gets one. The id is always the last resort
and never moves: it is in every listing, and in the family's own export.

Whoever opened the link is that household's first parent, and **their** phone's
time zone became the household's — you configure nothing about a family's
rhythm, they do. They invite the rest of their household themselves, from
Settings. `babylog members` lists everyone grouped by household.

#### 4. Rescuing a phone, once there is more than one household

```sh
docker exec -e ORIGIN=https://log.example.com \
  baby-log-book babylog rescue "Anna & Tom" "Mama"
```

With two or more households the household comes first, as its own argument — two
people called "Mama" in two families are not ambiguous, because the search never
leaves the household you named. Leave it out and the command says so and lists
them. Name one that two households share and it refuses to guess, printing the
ids to choose between. With exactly one household, plain
`babylog rescue "Mama"` keeps working.

#### 5. Deleting a household

```sh
docker exec -it baby-log-book babylog delete "Anna & Tom"
```

For a family that has left, or one that has asked to be erased. It prints what
it is about to destroy and waits:

```
  About to delete The Hansens
      the family calls it “Familie Hansen”
      2 members · 1 baby · 4210 entries · 2 devices
      last activity 2026-08-21 18:05 UTC
      id 6f3a1c2e-9b17-4f2a-8a55-2b0d1c9e77aa

This deletes everything they have ever logged, along with everyone in
the household and every device signed in. It cannot be undone from
here, and their phones keep only what they already hold — they stop
syncing and nobody can sign in again.

If they want their data, have a parent export it from Settings first.

Type the id above to delete it, or press ctrl-c to stop.
>
```

Type the id and it deletes every entry, revision, baby, member, food, target,
device and pending link that household had, in one transaction, and reports what
went. Type anything else — including the household's name — and nothing is
deleted.

`docker exec` **without `-it`** has no terminal to answer on. That is not a dead
end: the id is on the screen, and passing it back as the last argument asks the
same question.

```sh
docker exec baby-log-book babylog delete "Anna & Tom" 6f3a1c2e-9b17-4f2a-8a55-2b0d1c9e77aa
```

Which is what the run without a terminal tells you to do, printing that exact
line. Either way the inventory comes first — nothing is deleted by a command
that has not already shown you what it would destroy — and an id belonging to
another household is refused rather than followed. There is no flag that skips
the question.

Two things it does not do. It takes no backup of its own: the rows stay in the
nightly backups until those age out, about two weeks, which is the erasure
window to quote to anyone who asked to be forgotten — and a copy made here would
quietly extend it. And it cannot fetch their data back for them, so if the family
wants their log, have a parent run the export in Settings **before** you run this.
Their phones keep whatever they already hold and simply stop syncing.

Deleting the last household on the box leaves an empty deployment, and the next
restart prints a fresh setup link exactly as a new one does.

#### What hosting for other people costs you

- **You can read everything.** Shell access is full access to every household on
  the box, which is why step 2 exists. The pilot answers this with disclosure,
  not encryption.
- **Backups are whole-file.** Restoring rolls *every* household back to that
  night; there is no per-household restore.
- **One domain, one link.** Every household lives on the same `ORIGIN`, and
  households cannot see each other: every query names the household it means,
  and a push that names another one is refused.

## Developing

```sh
corepack enable        # pnpm, at the version package.json pins
pnpm install
cp .env.example .env   # ORIGIN and DATA_DIR for the dev server
pnpm dev
```

The dev server listens on `0.0.0.0`, so a phone on the same network can open it
— which is the only way to test a PWA. `ORIGIN` has to be the address you type
into that phone, not localhost, because Claim Links are absolute URLs built from
it (`ORIGIN=http://powerman:5173`). Add the hostname to `VITE_ALLOWED_HOSTS` if
Vite refuses the request.

```sh
pnpm test          # domain, server, client and component suites
pnpm check         # svelte-check and TypeScript
pnpm build         # production build into ./build
```

`src/lib/paraglide/` holds the compiled messages and is generated, not committed.
Anything that runs Vite writes it — `dev`, `build`, `test` — so on a clone that
has never done any of those, `check` is the one command that has to follow a
`pnpm build`.

To run the shipped image from your own checkout — the real entrypoint, the
non-root user, the healthcheck, `babylog` — rather than the dev server:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

It builds instead of pulling, publishes the container on the port `ORIGIN` in
your `.env` already names, and keeps its database in a volume of its own. Not a
development loop: nothing hot-reloads and every change costs a rebuild.

### Releasing

`.github/workflows/publish.yml` builds the multi-arch image and pushes it to
`ghcr.io/derico-de/baby-log-book`. A push to `main` publishes `:edge`; a version
tag publishes `:1`, `:1.4`, `:1.4.2` and `:latest`. Nothing is published unless
`pnpm check` and `pnpm test` pass first.

```sh
# The version in package.json is baked into the UI, so it has to be bumped in
# the same commit the tag points at.
pnpm version 1.4.2 -m 'Release %s'
git push --follow-tags
```

The package is public and needs no secrets: the workflow pushes with the
built-in `GITHUB_TOKEN`. The very first release creates the package as private,
so flip it to public once under **Packages → baby-log-book → Package settings**.

The layers, and what each is allowed to know:

| Path | Holds |
| --- | --- |
| `src/lib/domain/` | Pure functions: the fold, time and the Day Start, targets, the stale-sleep rule, filtering, stats, the day grid's geometry, the CSV export. No I/O, no framework, fully tested. |
| `src/lib/server/` | SQLite, the boot-time migration runner, sessions and claim links, push/pull, backups. |
| `src/lib/client/` | The Dexie replica, the durable outbox, the sync loop, the write API, the PWA lifecycle. |
| `src/lib/components/`, `src/routes/` | The UI. Nothing here derives a domain figure by hand. |

Two invariants worth knowing before you touch anything:

- **Anything used for ordering, merging, the cursor or a duration is an instant.**
  Local wall time is a display-time projection and never enters a comparison.
- **The replica is a cache; the outbox is data.** Everything except the outbox can
  be dropped and re-pulled. A new client must be able to read an old client's
  outbox records.

## Licence

AGPL-3.0-or-later. The running app shows its version, its git SHA and a link to
this source, so every operator satisfies AGPL §13 automatically.
