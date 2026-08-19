# Isolation hardening and the hosted trust boundary (Stage 1)

Type: grilling
Status: closed
Assignee: MrTango

## Question

Which cross-household isolation gaps must Stage 1 fix, which globals are acceptable to keep, and what supersedes ADR-0009's one-household stance and ADR-0005's trust assumption?

Settled context (codebase survey 2026-08-18): the schema is fully household-scoped; the runtime leaks would only bite once Household #2 exists.

To decide:

- **Must-fix list** (presumed all in): push accepts client-supplied `entity_id`s with no household check and `materialise()` upserts without a household predicate — a Parent of A could write into B's rows, including bare `UPDATE households`; `getMember`/`revokeMember` are global by id (cross-household member revocation via push); `revisionExists` is global while merge/bottle revision ids are deterministic strings (`merge:…`, `bottle-past:…`) in a shared namespace; `theHousehold()` LIMIT-1 at 4 request-handler call sites (`api/session`, `sync/push` target-zone seeding, `api/claim` ×2).
- **Acceptable-global candidates** — decide keep-or-fix for Stage 1: the SSE live wake set (carries no data; unscoped wake = wasted polls across households), the IP-keyed in-memory rate limiter, the whole-file nightly backup.
- **ADR-0009 supersession**: the new stance — one deployment, many Households, still one container/one SQLite file — recorded as a new ADR.
- **ADR-0005 trust assumption**: "shell access = full Household access" was accepted for self-hosting; hosting friends' Households makes the operator a data processor in spirit even in the free pilot. Decide what, if anything, changes in Stage 1 (likely: acknowledge and document, not encrypt) and what the friends should be told.
- **Testing bar**: what isolation guarantees the Stage-1 spec demands tests for (e.g. a two-household fixture where every push/pull/claim path is tried cross-household).

Resolution feeds the Stage-1 spec.

## Resolution (2026-08-19)

Grilled with MrTango; all recommendations accepted.

- **Must-fix list confirmed, all four in:** foreign-`entity_id` writes via push (the `materialise` upserts carry no household predicate, including the bare `UPDATE households … WHERE id = ?`), global `getMember`/`revokeMember`, global `revisionExists` (silent accept-as-replay of a foreign id = data loss for the pusher plus an existence oracle), `theHousehold()` LIMIT-1 at its 4 call sites (`api/session`, push target-zone seeding, `api/claim` ×2). The survey found nothing to add: `countActiveParents`, `mergedIntoMap`, `liveSessions`, `pullRevisions`, `getEntry` already take `householdId`, and `revisionsOf` inside `materialise` is already scoped — the leak is in the upserts, not the folds.
- **Enforcement shape: ownership guard, no migration.** Ids stay globally unique and client-minted. The server refuses any revision id or entity id that already lives in another Household, with a generic reason — the oracle is accepted, since all it reveals is that a random UUID exists. The upserts additionally get a belt-and-braces household predicate. `household`-kind revisions ignore the client's `entity_id` entirely: the session's Household is the only one they can mean. Composite `(household_id, id)` uniqueness was considered and declined — a primary-key migration plus a same-id-twice invariant for no real gain.
- **SSE live wake set: scoped** by Household, so the superseding ADR can state "every runtime structure is household-keyed" without a reasoned-about exception.
- **Rate limiter: keep** as-is — IP-keyed, it defends endpoints, not tenants. **Backup: keep** whole-file; the spec records the operator fact that a whole-file restore rolls back every pilot Household at once. Per-household backup/restore stays in the paid-service fog.
- **ADR-0009 supersession:** written as [ADR-0020 "One deployment hosts many Households…"](../../../docs/adr/0020-one-deployment-many-households.md), superseding **only the tenancy stance**; 0009's other consequences (required `ORIGIN`, opt-in `TRUST_PROXY`, signing key in the volume, migration backups, multi-arch, AGPL banner) still govern, and 0009 carries a superseded-on-this-point note.
- **ADR-0005 trust boundary: acknowledge, don't encrypt.** No technical change in Stage 1 — the operator can read, rescue-link into, and delete any Household. The standing disclosure is one plain sentence when the Founding Link is handed over, in spirit: *"It runs on my server, so technically I can see everything you log — same trust as sending it to me directly."* The stance is recorded as a consequence of ADR-0020.
- **Testing bar: the two-household fixture.** Two populated Households, every boundary attacked from the wrong side: push with a foreign `entity_id` for every revision kind (including `household`-kind naming the other Household), replay of a foreign revision id, the deterministic `merge:`/`bottle-past:` id shapes across Households, pull returning only own revisions, last-Parent protection counting only own Parents, `revokeMember` and rescue-mint scoped, claim links landing only in the minting Household — plus the Founding-Link paths (CLI mint founds a new Household; boot founds #1). Standing rule for AGENTS.md: any new store function takes `householdId` or justifies why not.
