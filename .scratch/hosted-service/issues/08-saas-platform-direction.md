# Platform direction for the paid service

Type: grilling
Status: resolved

## Question

At direction level: what does the paid hosted service run on when it outgrows the pilot — "PostgreSQL & co" as assumed, or something else?

Settled context: the pilot stays on the current single-container SQLite deployment. The prior effort recorded two reversal exits worth re-reading here: `.scratch/baby-log-book/spec.md` ("switch to RxDB if we ever need more than one Household replicated per Device"; "'No Postgres' ever becomes negotiable → reopen the engine decision; Zero becomes a serious contender").

To decide (direction, not design):

- Scaling model: one big multi-tenant Postgres vs many small SQLite files (one per Household — the schema already permits it, `ORIGIN` is the main coupling) vs staying on one SQLite until it actually hurts. What user count makes the pilot architecture insufficient, honestly?
- Whether the sync protocol (append-only revision log, seq cursor relying on SQLite's serialised writers) survives a Postgres move, and what it would cost.
- Hosting direction: DE/EU provider candidates (Hetzner et al.) consistent with the GDPR positioning — named, not contracted.
- What this implies for the pilot→paid migration path (graduates that fog patch on resolution).

## Answer

**SQLite all the way: stay on the pilot's single multi-tenant file until it actually hurts, and when it does, scale by one SQLite file per Household — not by Postgres.** Recorded as [ADR-0021](../../../docs/adr/0021-the-paid-service-scales-by-files-not-by-postgres.md).

### Scaling model

- **Planning envelope: hundreds of Households**, foreclosing nothing toward thousands. At 3 €/mo the realistic ceiling for an open-source-first product in this category is (b)-shaped, and (b) is fully servable by the SQLite family.
- **Honest capacity of the pilot architecture**: ~100 tiny revisions per Household per day → 1,000 Households ≈ 1.2 writes/second average against WAL-mode SQLite that absorbs hundreds, plus ~2–3k idle SSE connections one Node process holds fine. Throughput does not force an exit into the thousands of Households.
- **What actually presses is operational**: blast radius of one file, per-Household backup/restore/deletion/export (GDPR Art. 17/20), migration downtime hitting every tenant at once. The per-Household file split answers exactly that — delete = remove a file, backup = per file, moving a Household between deployments = file copy.
- The split is a **named exit, not scheduled work**; ADR-0020's `household_id`-on-every-row discipline is what keeps it a filtered copy.

### Sync protocol

**Survives untouched.** The seq-cursor invariant (seq = commit order) rests on SQLite serialising writers; per-file writers serialise per Household by construction. **The Postgres exit is reaffirmed, not softened**: if "no Postgres" ever becomes negotiable, we reopen the engine decision (Zero as front-runner) rather than porting the hand-rolled revision log — porting keeps the build cost while forfeiting the reasons the build won.

### Hosting

- **Hostsharing e.G.** — German cooperative hoster, the maintainer's hoster of choice; fits the locked "GDPR-first, hosted in Germany" positioning, AV-Vertrag with them covers the legal baseline's hosting requirement. Named, not contracted.
- **Shape: the maintainer's existing managed virtual server**, running the same published container every self-hoster pulls, scaled vertically. The hosted service dogfoods the open-source product; no Kubernetes, no separate platform.

### Pilot→paid implication

Pilot Households already sit on the target stack and server, so migration collapses to **continuity**: no data move, only a commercial transition when billing arrives. Graduated the fog patch as [Pilot → paid transition](11-pilot-to-paid-transition.md) (the commercial half, blocked by the lifecycle ticket); the platform-and-legal-blocked operations fog graduated as [Hosted-service operations](12-hosted-service-operations.md).
