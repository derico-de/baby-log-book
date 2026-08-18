# Household creation and the operator surface (Stage 1)

Type: grilling
Status: open
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
