# Assemble the spec and ADRs

Type: task
Status: resolved
Blocked by: 05, 06, 07, 08, 09, 10, 11, 12, 14, 16, 17, 18, 19, 20

## Question

Nothing left to decide — this ticket writes the destination artefact.

Gather every resolved ticket on this map into `.scratch/baby-log-book/spec.md`, with the architectural decisions extracted as ADRs under `docs/adr/` and the vocabulary consolidated in `CONTEXT.md`.

### What the spec must contain

- Feature scope with the v1 / v2 / v3 line drawn explicitly, so the implementation effort knows what it is and is not building.
- The domain model, in the glossary's vocabulary.
- Stack, storage, and deployment decisions with their reasoning.
- Offline and sync semantics, including the conflict and merge rules.
- Auth, roles, and the invite flow.
- UI direction with the design tokens.
- Open questions that survived the map, and anything explicitly ruled out of scope.

### Done when

Someone who wasn't in any of these sessions can read the spec and slice it into implementation tickets without needing to reopen a decision.

## Answer

The spec is at [`spec.md`](../spec.md). Eleven sections over the three artefacts it does *not* duplicate: [`CONTEXT.md`](../../../CONTEXT.md) holds the vocabulary, [`docs/adr/`](../../../docs/adr/) holds the thirteen decisions, and the spec holds the shape.

### What assembling it actually did

Mostly folding, not writing — the ADRs and the glossary were already written by the tickets that produced them, so this ticket's real work was **reconciling the corrections later tickets made to earlier ones** and stating which version wins. The spec says so explicitly at the top: where it and a ticket disagree, the spec is the corrected reading. The four that mattered:

- **Session Merge is per kind** ([Schedules](09-schedules-v1.md) correcting [Sync protocol](06-sync-protocol.md)) — folded into §5.3 with the Sleep Feed reasoning attached, so nobody re-derives the kind-agnostic version.
- **Rate limiting is in the app, not the proxy** ([Deployment shape](12-deployment-shape.md) correcting [Accounts](07-accounts-and-invites.md)) — §4.4 states the corrected version and names what it corrected.
- **A stats card appears for entry types that have a *rate***, not merely data ([Milestones](18-milestones-entry-type.md) correcting [Stats](10-stats-and-export.md)) — §9.1 carries the restated rule and why four cards stand.
- **A Member belongs to exactly one Household in v1** ([Accounts](07-accounts-and-invites.md) narrowing [Domain model](05-domain-model.md)) — §3.1 states the narrowing and the instruction that follows from it: build the schema so a second is not a migration, do not build the switcher.

### The five rules, promoted

The map's decisions kept arriving at the same shape from different directions, so the spec opens by naming them as invariants rather than leaving them distributed across twenty tickets: *the app never writes data nobody entered* · *never hides data somebody just entered* · *never reloads a screen nobody asked it to reload* · *does not nag* · *anything ordered, merged or measured is an instant*. Each already had a ticket that derived it and at least one other that confirmed it. A change that breaks one of them is a change to the architecture, and that is now legible on page one instead of on page nine of a ticket.

### Two loose ends closed rather than reported

- **[Deployment shape](12-deployment-shape.md) handed this ticket a wording concern** — the boot claim link and the `babylog rescue` output are a stranger's onboarding path, not the author's recovery hatch. §6.1 carries it as an explicit spec note with what each must say, since both are read by someone with no runbook and, in the rescue case, no phone.
- **[Milestones](18-milestones-entry-type.md) left a follow-through** — `design/tokens.css` was to gain `--t-milestone`. It had not. Added, resolving to `--ink-2` like its six siblings, so the seventh entry type is genuinely free in the token layer rather than only in the argument.

### What was checked and needed nothing

`CONTEXT.md` is complete against every ticket that amended it — Nap/Night Sleep/Sleep Feed from [Schedules](09-schedules-v1.md), Household Zone/Recording Zone from [Timezones](17-timezones-and-travel.md), Milestone/Milestone Name from [Milestones](18-milestones-entry-type.md), Device Setting from [PWA](20-pwa-update-strategy.md), Session Merge amended per kind. No gaps, so it is left untouched.

### Done when

Met. §2 draws the v1/v2/v3 line, §11 lists what survives — four later-version questions and the v2 PIN, none architectural — plus the four **named exits** the map's research decisions carry (RxDB, TinyBase, Open Props UI, and reopening the engine question if "no Postgres" becomes negotiable). Every "we rejected X because Y" is kept with its reason, because the reasons are what stop an implementer re-deciding in the dark.
