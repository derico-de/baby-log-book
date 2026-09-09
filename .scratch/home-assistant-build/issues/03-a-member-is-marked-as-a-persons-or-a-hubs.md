# 03 — A Member is marked as a person's or a Hub's

**What to build:** A Hub claims as its own Caregiver Member, so it appears in the members list like a person. The list should say what it is, so a Parent removing *Home Assistant* knows they are unplugging the hall panel and not removing Oma — and it should say so from a **stored fact, not a guess**. A name convention and a client self-declaration were both rejected as guesses.

This ticket is the fact and its rules, end to end but headless; the screens that show it are ticket 04.

Spec §5.1. Decided in [ADR-0038](../../../docs/adr/0038-a-hubs-member-is-marked-and-a-hub-stays-a-caregiver.md).

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] A Member carries a kind — a person's or a Hub's — defaulting to a person's, with a migration.
- [x] The Parent states it **on the Invite**, and *for a Hub* **locks the role to Caregiver at mint time**.
- [x] The Claim Link stores it beside the display name and role; the claim **stamps it onto the Member**.
- [x] It **syncs outward with the member data exactly as `role` does** — the replicas must hear it or no screen can show it.
- [x] **Server-stamped and immutable**: push validation never accepts the kind from any client. There is no toggle and no "hub became a person" history; a mis-marked Member is fixed by Remove and re-invite.
- [x] **A Hub cannot be promoted to Parent** — a subject-based refusal in push, beside the last-Parent rule. Anything less quietly deletes ADR-0034's blast-radius argument.
- [x] `babylog members` prints the kind on the status line.
- [x] A line under `## [Unreleased]` in `CHANGELOG.md`, same commit.

## Comments

**Built, headless.** Migration `0008-member-kind` adds `members.kind` (NOT NULL,
default `'person'`) and `claim_links.kind_for` (nullable — an Invite minted
before the choice says nothing, and silence reads as a person's).

Three notes on how it holds:

- **The mark rides the fold, exactly as `role` does.** `appendMemberRevision`
  puts `kind` in the creating revision, so `materialise()` and the replica's
  `apply.ts` both read it from the log — no side channel, and a Member whose
  creating revision predates the mark folds to a person's. That is also what
  makes it immutable in practice: no later revision may name it, so the fold can
  only ever return what the claim stamped.
- **Two refusals in `push()`, not one.** `refuseServerStamped` rejects any member
  revision carrying `kind` — rejected rather than silently dropped like an
  unknown field, because this one is known and it decides a blast radius — and
  `refuseHubParent` sits beside `refuseLastParent` as the second subject-based
  rule.
- **The role lock is at mint time.** `mintInvite` coerces the role to Caregiver
  when the Invite is for a Hub, so no link can carry a Hub Parent at all; the
  push refusal is the second line rather than the first.

The screens are ticket 04. `POST /api/invites` already accepts `kind_for`, and
`GET /api/invites` returns it on each pending row, so the form has both ends
waiting for it.
