# What may a caregiver see?

Type: grilling
Status: resolved
Blocked by: 05

## Question

A caregiver's device must hold **only the data they are allowed to see**. What is that slice?

This narrows two earlier decisions and has to be settled before the sync protocol or the accounts model can be finalised.

### The tension it creates

Round 2 settled that every device replicates the household's **entire** log — that is what made sync simple ("give me everything since cursor X") and made stats and history work offline for free. Scoped replication breaks that: the server must now compute a per-member view, the change feed becomes per-member rather than per-household, and a permission change has to *retract* data already sitting on a device.

Round 3 also settled that caregivers can view everything and correct anything. Under that model there is no data a grandparent is not allowed to see — so this ticket first has to establish what the restricted thing actually is.

### Decisions to reach

- **What is restricted?** Candidates, and they are very different in cost:
  - **By baby** — a caregiver is attached to specific babies, not the household. Cheap, natural, and probably the common case for a childminder.
  - **By time window** — a caregiver sees the last N days, not the full history. Cheap to compute, but breaks offline stats for them.
  - **By entry type** — growth measurements or notes are parent-only. Middle cost.
  - **By authorship** — a caregiver sees only what they logged. Cheap, but almost certainly wrong: the whole point is knowing whether someone already fed the baby.
  - **Nothing is restricted** — caregivers genuinely see everything; the real requirement is only that access *stops* on revocation.
- **Does the restriction change what they can correct?** Round 3 said anyone may correct anything; that now means anything *visible*.
- **Change feed granularity** — per-member rather than per-household, and how a member's scope changing mid-stream is expressed to their device.
- **Retraction** — when scope narrows or access is revoked, the device must delete what it no longer may hold. That works on next contact. It does **not** work on a device that never comes back online, so scoping reduces the blast radius of revocation without eliminating it. Decide what we accept.
- **Cost check** — is per-baby scoping (much cheaper) enough to satisfy the requirement, or is finer granularity genuinely needed? Answer this before designing anything general.

## Answer

**Nothing is restricted. Every household member sees everything.**

There is no per-member visibility scoping, so replication stays uniform: a device holds a full local replica of the household log, and the change feed is per-household rather than per-member. The judgement is that within a single family household there is no data worth hiding from a grandparent, and the machinery to hide it would be the most expensive part of the sync layer.

**Revocation is a gate on future syncs, not a retraction.** A device can only ever hold data it fetched while online and logged in. Once access is revoked the server refuses further syncs, so the device's copy freezes at whatever it had. That copy is not recoverable or deletable by us, and this is accepted deliberately rather than mitigated.

Consequences for the rest of the map:

- The round-2 "entire log replicated locally" decision stands unchanged, and with it the simple "give me everything since cursor X" sync shape.
- The [sync protocol ticket](06-sync-protocol.md) needs no per-member change feed and no retraction mechanism.
- The [accounts ticket](07-accounts-and-invites.md) still owns revocation, but its scope shrinks to server-side session invalidation. The "revoked caregiver's local replica" question is settled here and does not need to be reopened there.
- Roles (owner vs caregiver) remain meaningful for *writes and management* — deleting, inviting, managing babies — not for reads.

