# Isolation hardening and the hosted trust boundary (Stage 1)

Type: grilling
Status: open
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
