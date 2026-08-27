# 05 — The Hub in the members list

Type: grilling
Status: resolved

## Question

Ticket 29's open calls 2 and 3. The Hub claims as its own Caregiver Member, so it appears in Settings and in `babylog members` like a person. Nothing breaks — the question is whether the screen should *say what it is*, so a Parent removing *Home Assistant* knows they are unplugging the hall panel and not removing Oma.

- Does the members list mark a Hub — and if so, from what fact? (Nothing in the schema says "this Member is a machine"; is that a flag on the Member, a convention on the display name, or nothing?)
- Can a Hub be promoted to Parent by the existing role toggle, and should it be possible? (`refuseByRole` is the blast-radius argument of [ADR-0034](../../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md); a promotable Hub quietly deletes it.)
- Does **Hub** enter the glossary now, and with what boundary — HA-specific or ADR-0034's "anything that watches from a wall"? The lazy rule (`docs/agents/domain.md`) held it back until code lands; this ticket decides when that moment is.

## Answer

[ADR-0038](../../../docs/adr/0038-a-hubs-member-is-marked-and-a-hub-stays-a-caregiver.md), grilled 2026-08-27:

- **The list marks a Hub from a stored fact, not a guess.** A Member is marked at creation as a person's or a Hub's. The Parent states it on the Invite (*this is for a Hub*, which also locks the role to Caregiver at mint time); the Claim Link stores it beside name and role; the claim stamps it onto the Member. It syncs outward with the member data like `role` does — the replicas must hear it or no screen can show it. Name-convention and client-self-declaration were both rejected as guesses.
- **Server-stamped, immutable.** Push validation never accepts the mark from any client; there is no toggle and no "hub became a person" history. Mis-marked (a human claimed a hub Invite in a browser) = Remove and re-invite.
- **A Hub cannot be promoted to Parent.** A subject-based refusal in push beside the last-Parent rule; the UI hides the role toggle on Hub rows. Anything less quietly deletes ADR-0034's blast-radius argument.
- **Surfaces:** members list reads `Home Assistant · Hub · Caregiver` (kind beside role, same `·` suffix grammar); the remove confirm gains one Hub sentence (unplugs the panel, stops reading and writing at once, its Entries remain); `babylog members` prints the kind on the status line. *Hub* stays *Hub* in every UI language.
- **Hub entered the glossary now**, with ADR-0034's broad boundary (anything that watches from a wall), and CONTEXT.md's Member entry now owns the machine case. The lazy rule's "moment" was this ticket: four ADRs and the coming spec lean on the term.
