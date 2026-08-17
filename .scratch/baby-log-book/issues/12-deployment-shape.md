# Deployment shape: one container on your server

Type: grilling
Status: resolved
Blocked by: 03

## Question

What exactly does deploying and running this look like on your server?

Partly a decision, partly facts only you have about how your server is set up. HITL.

### Decisions to reach

- **Image build** — multi-stage Dockerfile for SvelteKit `adapter-node`, plus whatever the SQLite driver research implies about native modules and base image.
- **Volume layout** — where the DB file lives, WAL sidecar files, file permissions, and what else needs to persist.
- **Migrations on boot** — run automatically at start. What happens on failure: refuse to start, or start read-only?
- **TLS and reverse proxy** — what is already in front of things on your server (Traefik, Caddy, nginx?), and what the container must expose to fit in.
- **Configuration and secrets** — session signing key, first-owner bootstrap, base URL. Environment variables, and what happens if the signing key changes.
- **Backups** — a SQLite file that must not be lost. Volume snapshot, `sqlite3 .backup` on a schedule, or something else. Also: how a restore is tested, because an untested backup is not a backup. The CSV export and every device's local replica are secondary safety nets, not the plan.
- **Updates** — how a new version is rolled out, and what happens to a device mid-sync during a restart.
- **Healthcheck** — what "healthy" means for this app.

### Carried forward from [Accounts, households and invites](07-accounts-and-invites.md)

That ticket put three requirements on the container. They are facts to design around here, not decisions to re-make:

- **The image needs a CLI entrypoint** — list Members, and mint a 15-minute Rescue Link — reachable by `docker exec`. It is the only way back in when the sole Owner loses their phone, so it must work with the app running and without the app running.
- **The app prints a claim link to stdout at boot when the household is empty.** Whatever the logging setup is, that line has to be readable via `docker logs`.
- **The server is on the public internet, not a VPN**, and the only credential is a cookie. So TLS is mandatory rather than optional, and the reverse-proxy question below now also owns rate limiting on the claim endpoint. Note for **Configuration and secrets**: rotating the session signing key signs out every Device at once, and recovery from that is one Rescue Link per person.

## Answer

**One proxy-agnostic, multi-arch image published for strangers to pull — and every deployment concern the operator might get wrong moved into the app.** [ADR-0009](../../docs/adr/0009-one-household-per-deployment.md).

### The fact that overturns this ticket's premise

The ticket was written as *your* server — "partly facts only you have about how your server is set up". It isn't. **This is a distributable self-hosted product under AGPL**, with a possible hosted version much later. Every question here changed character: there is no "what's already in front of things", because the answer has to be *all of them*, and there is no "document it and I'll remember", because the operator is a stranger with no support channel who will discover a misconfiguration as data loss weeks later.

So the governing rule became: **anything the deployment needs done correctly, the app does — not the proxy, not the runbook.**

### The container

- **One HTTP port on the internal network, no host port published.** No TLS, no proxy config, no Traefik labels shipped. nginx, Caddy and Traefik are equally supported and none is configured by us.
- **`ORIGIN` is required and the container refuses to boot without it.** The app cannot discover its own public URL, and it needs one: a Claim Link is an absolute URL sent over WhatsApp, so a wrong origin mints dead invites *silently*. Boot failure is the only failure mode cheap enough for a stranger to diagnose. Everything derives from it — the cookie gets `Secure` iff `ORIGIN` is `https`, so `http://localhost:3000` still works with no dev-only flag.
- **`TRUST_PROXY` defaults off.** Behind an unknown proxy topology an untrusted `X-Forwarded-For` is a forged client IP walking straight through the rate limit.
- **Multi-arch: `linux/amd64` + `linux/arm64`.** Self-hosters run ARM NASes and Raspberry Pis, better-sqlite3 already ships `linuxmusl-arm64`, so it costs a build matrix now and would be expensive to retrofit later.
- **Version and git SHA baked into the image and shown in the UI**, beside a source link — this is how AGPL §13 gets satisfied for every operator automatically, rather than every self-hoster being non-compliant by default. It doubles as the first question in every bug report.

### State

- **One named volume at `/data`**, DB at `/data/app.db` with its WAL/SHM sidecars beside it (not optional — SQLite creates them in that directory). Container runs as a non-root uid owning `/data`. The brief's "db inside the container" means *one process, one image*, not state in the container layer, which dies on every update.
- **The session signing key is generated on first boot into `/data/secret.key`, not an env var.** An env var invites the one accident that cannot be absorbed: a lost `.env` or a redeploy that forgets it signs out every Device at once, and recovery is one Rescue Link per person. In the volume, the key can only be lost by destroying the data it protects. Overridable by env for deliberate rotation.

### Migrations, updates and rollback

- **Migrations run on boot; a failure refuses to start, loudly.** Read-only sounds kinder and is a trap — every Device keeps logging into its local replica and queueing pushes that will never be accepted, so the failure stays silent for hours and then arrives as a pile of rejected writes. A container that won't start is visible in 30 seconds, and the per-migration transaction leaves a clean schema at the last good version.
- **Tags `:1`, `:1.4`, `:1.4.2`, `:latest`. Migrations are cumulative from any older version and never destructive within a major.** Operators skip versions and run unattended updaters like Watchtower; this is a contract, not a hope.
- **The app backs the DB up immediately before applying any migration.** This is what makes rollback real: stop, restore that file, run the old tag. Without it, "roll back to the previous tag" is a promise the schema quietly voided. Down-migrations are not written — reliable ones for data nobody can roll back are a promise we'd break. Rolling back across a major is documented as unsupported.
- **A restart mid-sync needs no handling** — already settled by [Sync protocol](06-sync-protocol.md): the log is insert-only and idempotent and the outbox is never discarded, so a Device just retries.

### Backups

- **Nightly online `.backup` into `/data/backups/app-YYYY-MM-DD.db`, keeping ~14**, so a host-level snapshot picks up a consistent file rather than a torn mid-write WAL. Whether the operator ships those off-box is theirs; making them *correct* is ours.
- **The app runs `PRAGMA integrity_check` on each backup the moment it writes it** and logs loudly on failure — a silently broken backup chain surfaces that night rather than on the worst day.
- **Restore is deliberately dumb and documented, with no CLI verb**: stop the container, replace `/data/app.db`, delete the stale `-wal`/`-shm`, start. A plain file copy is something an operator can do under stress at 3am; a bespoke command is one more thing to get wrong.

### Security surface

- **Rate limiting moved into the app** — in-memory, on the claim endpoint only, ~10 attempts per IP per hour and **5 per token before the token is burnt permanently**. The per-token limit is the one that matters, being the part an attacker cannot rotate around. In-memory is fine: one process, and a restart clearing counters is not a meaningful bypass.
- **The token carries 128 bits of randomness**, so rate limiting is a backstop rather than the defence.
- **This corrects [Accounts, households and invites](07-accounts-and-invites.md)**, which assigned rate limiting to the reverse proxy. With a proxy-agnostic image that is no longer available: half the operators would never configure it, and guessing a valid Claim Link token *is* the attack.

### Operator tooling

- **A separate entrypoint in the same image** — `docker exec <container> babylog members` / `babylog rescue <member>` — opening the SQLite file directly rather than talking to the running server. That is what makes "works without the app running" free, and WAL mode makes concurrent access from a second process fine. **No HTTP admin endpoint**: an admin route on a public-internet app is a door that only ever needs to exist for five minutes a year.
- **`GET /health` opens the DB and runs one trivial query, nothing more.** Not "did the last sync succeed" — a healthcheck that goes unhealthy because a *client* is misbehaving would restart-loop the container and make things worse. Generous `start-period` so boot migrations don't count as failure.

### Scope

- **One Household per deployment is the published contract** ([ADR-0009](../../docs/adr/0009-one-household-per-deployment.md)). It makes the self-hosted story honest, and a future hosted version is a different deployment mode rather than a schema tax every self-hoster pays for a product that may never exist. The door isn't nailed shut — every row already carries a Household boundary because [ADR-0001](../../docs/adr/0001-single-entries-table.md) needed one.
- **A hosted/cloud version is out of scope** for this map.

### Spin-off

The reframe re-aimed two already-resolved tickets at a new audience: the boot claim link and the Rescue Link CLI from [Accounts](07-accounts-and-invites.md) are now a **stranger's onboarding path**, not the author's private recovery hatch. The wording of both is a spec concern for [Assemble the spec](13-assemble-the-spec.md).

Graduated [PWA install and update strategy](20-pwa-update-strategy.md) out of the fog — it was explicitly waiting on this ticket.
