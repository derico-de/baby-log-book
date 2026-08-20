# Baby Log Book

A shared log of a baby's day — feeds, sleeps, nappies, solids, measurements and
milestones — kept by the people who look after them, on phones that are often
offline. Self-hosted: one container, one volume, your data.

The design is written down before the code: the vocabulary in
[`CONTEXT.md`](CONTEXT.md), the thirteen decisions in [`docs/adr/`](docs/adr/),
and the shape of the thing in [`.scratch/baby-log-book/spec.md`](.scratch/baby-log-book/spec.md).
Read those before changing anything structural.

## What it does

- **Logging** all seven entry types, with live timers for feeds and sleeps.
- **A timeline** as the primary screen, with attribution, revision history,
  correction and undo — and filtering across five facets, which is also the
  history surface.
- **Light schedules**: one target per activity per baby, elapsed-vs-target in a
  sticky header. Stated, never learned.
- **Stats**: four trend cards over a rolling seven days plus today.
- **Export**: a zip of per-type CSVs. Everything, always.
- **Offline sync** with a full local replica, a durable outbox and silent
  conflict resolution.
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
| `DATA_DIR` | `/data` | Where the database, its backups and the session key live. |
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

### The operator tool

```sh
docker exec baby-log-book babylog members
docker exec -e ORIGIN=https://log.example.com baby-log-book babylog rescue "Mama"
```

`rescue` mints a 15-minute link that signs a device back in **as an existing
person**, so everything they have already logged stays theirs. Use it when a
phone is lost and no parent is left to send an invite.

Both commands open the SQLite file directly, so they work whether or not the app
is running. There is no HTTP admin endpoint: an admin route on a public-internet
app is a door that only ever needs to exist for five minutes a year.

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
| `src/lib/domain/` | Pure functions: the fold, time and the Day Start, targets, the stale-sleep rule, filtering, stats, the CSV export. No I/O, no framework, fully tested. |
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
