# Assemble the Stage-1 spec

Type: task
Status: resolved
Blocked by: 05, 06

## Question

Write the implementable Stage-1 spec — multi-household pilot on the current deployment — from the resolutions of "Household creation and the operator surface" and "Isolation hardening and the hosted trust boundary": creation mechanism and operator surface, the must-fix isolation list with its testing bar, the superseding ADR(s), and explicit non-goals (no payment, no public sign-up, no new infra). Output: `spec.md` in this effort's directory, ready to implement from.

## Answer

Written: [`spec.md`](../spec.md) (2026-08-20), nine sections, implementable as written. It folds the two resolutions without restating them — the decision record in §9 points back at the tickets and ADRs.

Notable calls made while assembling (all downstream of the resolutions, none new at direction level):

- **The founding label gets its own column** — migration `0002-founding-label` adds nullable `claim_links.household_label`, rather than reusing `display_name` (whose semantics are "the Member name an Invite carries" — the collision ticket 05 warned about). `household_label IS NULL` doubles as the boot-minted/operator-minted discriminator, which is what lets boot's re-mint supersede only its own pending link while an operator-minted Founding Link survives restarts.
- **A bootstrap claim always founds** — the `existing ?? randomUUID` fallback in `claim()` goes, along with the `theHousehold()` fallbacks on the invite and rescue paths (those link kinds always carry `household_id`; a row without one is `invalid`).
- **`household_exists` is dropped from the claim GET** — no client reads it, and under always-founds the preview no longer depends on what exists.
- **The disclosure sentence prints beside the link** in `babylog household` output, so handing it over is the default rather than a thing to remember.
- **No protocol bump** — the ownership guard only widens use of the existing `rejected[]` channel with one generic reason string.
- The testing bar (§8) enumerates the two-household fixture attack list from ticket 06 plus the Founding-Link and rescue-scoping paths, and the spec carries the AGENTS.md standing rule (new store functions take `householdId` or justify why not) as an implementation deliverable.
