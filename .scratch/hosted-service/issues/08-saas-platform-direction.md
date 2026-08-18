# Platform direction for the paid service

Type: grilling
Status: open

## Question

At direction level: what does the paid hosted service run on when it outgrows the pilot — "PostgreSQL & co" as assumed, or something else?

Settled context: the pilot stays on the current single-container SQLite deployment. The prior effort recorded two reversal exits worth re-reading here: `.scratch/baby-log-book/spec.md` ("switch to RxDB if we ever need more than one Household replicated per Device"; "'No Postgres' ever becomes negotiable → reopen the engine decision; Zero becomes a serious contender").

To decide (direction, not design):

- Scaling model: one big multi-tenant Postgres vs many small SQLite files (one per Household — the schema already permits it, `ORIGIN` is the main coupling) vs staying on one SQLite until it actually hurts. What user count makes the pilot architecture insufficient, honestly?
- Whether the sync protocol (append-only revision log, seq cursor relying on SQLite's serialised writers) survives a Postgres move, and what it would cost.
- Hosting direction: DE/EU provider candidates (Hetzner et al.) consistent with the GDPR positioning — named, not contracted.
- What this implies for the pilot→paid migration path (graduates that fog patch on resolution).
