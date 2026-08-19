# Household creation and the operator surface (Stage 1)

Type: grilling
Status: closed
Assignee: MrTango

## Question

How does the operator create Household #2..N on the pilot deployment, and what does the operator surface look like?

Settled context: Households are operator-created in Stage 1 (no public sign-up); today household creation is gated on a global zero-members check in boot, and a bootstrap claim joins the existing Household (`boot.ts`, `claims.ts`) — there is no code path to a second Household.

To decide:

- Creation mechanism: a `babylog` CLI command (matches the existing CLI: `bin/babylog.js` already does `rescue`, `members`) vs a minimal admin page. What arguments (name, Day Start, Household Zone) and what it returns (the first Invite/Claim Link for the first Parent).
- What happens to the boot-time bootstrap flow — does it become "create first household" only, or is it superseded entirely by the CLI?
- Operator visibility: does `babylog members` (currently listing every member across the file with no household column) grow household scoping? What minimal listing does the operator need (households, member counts, last activity)?
- Rescue Links across households: `babylog rescue` already copies the member's household — confirm it needs nothing more.
- One `ORIGIN` serves all households — confirm all pilot households live on one domain and no per-household URL is wanted in Stage 1.

Resolution feeds the Stage-1 spec.

## Resolution (2026-08-18)

Grilled with MrTango; all decisions below are settled.

- **Mechanism: CLI, no admin page.** `docker exec <container> babylog household "<label>"` — the no-HTTP-admin doctrine in `bin/babylog.js` stands.
- **Semantics: mint-a-link.** The command mints a **Founding Link** (bootstrap-kind Claim Link, `BOOTSTRAP_TTL_MS` = 7 days — long enough for WhatsApp delivery) and prints it. The Household row is created **at claim time**, exactly as first boot does today: the claimer becomes the first Parent and their Device's zone becomes the Household Zone. The operator configures nothing about the family's rhythm — the family does. An unclaimed link expires leaving no orphan row; re-running the command mints a fresh one. The claim path's current fallback ("household-kind link joins the existing Household") must change: a CLI-minted Founding Link **always founds a new Household**.
- **Label: required argument.** `babylog household "Anna & Tom"` — carried on the link and applied as the Household's initial name at claim (today `name` is always `''`). Solves the operator-listing problem; in-app renaming stays a possible later feature, not Stage 1. How the label rides on the `claim_links` row (it must not collide with the invite `display_name` semantics) is a spec/implementation detail.
- **Boot bootstrap: unchanged.** First boot with zero Members still prints a Founding Link for Household #1 — the self-hosting first-run story is untouched. The CLI is the path for Household #2..N.
- **Operator listing: both, cheaply.** New `babylog households` (name, id, member count, last activity — the "is anyone using this" pilot question); `babylog members` output gains Household grouping. No further operator tooling in Stage 1.
- **Rescue: Household-scoped, conflicts impossible by construction.** The lookup runs inside one named Household, never across the file. With more than one Household present, the Household name is required (`babylog rescue "Anna & Tom" "Mama"`); omitting it fails loudly and lists the Household names. With exactly one Household, `babylog rescue "Mama"` keeps working unchanged, so existing self-hoster docs stay true. The mint already copies the member's `household_id` and needs nothing more.
- **ORIGIN: one domain for all.** Every pilot Household lives on the existing domain; all Claim Links share the one `ORIGIN`. Per-household URLs are a paid-service question, out of Stage 1.
- **Glossary:** added **Founding Link** to `CONTEXT.md` (covers both the boot-printed link and the operator-minted one).
