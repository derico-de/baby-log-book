# 05 — The Hub in the members list

Type: grilling
Status: open

## Question

Ticket 29's open calls 2 and 3. The Hub claims as its own Caregiver Member, so it appears in Settings and in `babylog members` like a person. Nothing breaks — the question is whether the screen should *say what it is*, so a Parent removing *Home Assistant* knows they are unplugging the hall panel and not removing Oma.

- Does the members list mark a Hub — and if so, from what fact? (Nothing in the schema says "this Member is a machine"; is that a flag on the Member, a convention on the display name, or nothing?)
- Can a Hub be promoted to Parent by the existing role toggle, and should it be possible? (`refuseByRole` is the blast-radius argument of [ADR-0034](../../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md); a promotable Hub quietly deletes it.)
- Does **Hub** enter the glossary now, and with what boundary — HA-specific or ADR-0034's "anything that watches from a wall"? The lazy rule (`docs/agents/domain.md`) held it back until code lands; this ticket decides when that moment is.
