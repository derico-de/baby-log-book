# 03 — A Member is marked as a person's or a Hub's

**What to build:** A Hub claims as its own Caregiver Member, so it appears in the members list like a person. The list should say what it is, so a Parent removing *Home Assistant* knows they are unplugging the hall panel and not removing Oma — and it should say so from a **stored fact, not a guess**. A name convention and a client self-declaration were both rejected as guesses.

This ticket is the fact and its rules, end to end but headless; the screens that show it are ticket 04.

Spec §5.1. Decided in [ADR-0038](../../../docs/adr/0038-a-hubs-member-is-marked-and-a-hub-stays-a-caregiver.md).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A Member carries a kind — a person's or a Hub's — defaulting to a person's, with a migration.
- [ ] The Parent states it **on the Invite**, and *for a Hub* **locks the role to Caregiver at mint time**.
- [ ] The Claim Link stores it beside the display name and role; the claim **stamps it onto the Member**.
- [ ] It **syncs outward with the member data exactly as `role` does** — the replicas must hear it or no screen can show it.
- [ ] **Server-stamped and immutable**: push validation never accepts the kind from any client. There is no toggle and no "hub became a person" history; a mis-marked Member is fixed by Remove and re-invite.
- [ ] **A Hub cannot be promoted to Parent** — a subject-based refusal in push, beside the last-Parent rule. Anything less quietly deletes ADR-0034's blast-radius argument.
- [ ] `babylog members` prints the kind on the status line.
- [ ] A line under `## [Unreleased]` in `CHANGELOG.md`, same commit.
