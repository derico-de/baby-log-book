# Timeline filtering and food history

Type: prototype
Status: resolved
Blocked by: 08, 10

## Question

"When did she eat broccoli?" and "when was her first tooth?" are queries over the log, not aggregates. [Stats and CSV export](10-stats-and-export.md) ruled they belong to the timeline rather than a stats tab — **the timeline already is the history; what it lacks is a filter.** What does that filter look like?

Filtering returns the answer *with its context* — the reaction note on the Meal line, what else she ate that day — which a bare results list strips out. That is the reason for the placement, and it constrains the design: the result of a filter should still read as a timeline.

### Decisions to reach

- **What can be filtered on.** Entry type is the obvious axis. Food is the one the requirement came from. Member ("what did Oma log?"), date range, and free-text search over Notes are candidates — which of them earn v1?
- **How the filter is entered and, more importantly, exited.** A filtered timeline that looks like an unfiltered one is a trap at 3am — you would log a feed against what you thought was today. What makes the filtered state unmistakable, and does the FAB stay live while it is on?
- **The Food detail view.** Reachable from the Food catalogue: first exposure (derived, never stored — see [Domain model](05-domain-model.md)) plus every Meal containing that Food, with its reaction notes. Is this a separate screen or just a pre-filtered timeline?
- **Does filtering touch the sticky header?** The header carries live elapsed-vs-target figures that are about *now*. In a filtered or historical view they are either wrong or irrelevant.
- **Milestones need no dedicated surface** — they are ordinary entries and are already in the timeline. Confirm that filtering by type is enough to make "when was her first tooth" answerable, or say what else is needed.

Use `/prototype`; `/impeccable` for the interaction thinking. The existing [logging prototype](https://claude.ai/code/artifact/7a11190e-e5dc-43bd-b568-a6083c901f09) is the surface being extended.

### Input from [Visual design direction](11-visual-design-direction.md)

- **The surface is now styled**, so build on the [visual-direction prototype](https://claude.ai/code/artifact/8d2f7632-bdb5-4c5d-894f-028517aac47c) at `?dir=d1&nav=tabs` and [`design/tokens.css`](../design/tokens.css) rather than on the neutral one.
- **Filtering cannot be signalled with colour.** D1 spends its only hue on actions, and entry types deliberately carry no colour at all — so "this timeline is filtered" has to be said with type, chrome, or a persistent bar. The trap this ticket already worries about is therefore *harder* to avoid than it looks, and worth prototyping first rather than last.
- **A horizontal swipe is available.** Bottom tabs won the nav decision, which means swipe was not spent on switching screens and is free for a filter gesture — but it was rejected there partly for being undiscoverable at 3am, and that objection does not weaken here.
- **Two of the three destinations are fixed furniture.** The tab bar is always visible, so a filtered timeline still has to coexist with it and with the FAB at `bottom: 76px`.

### Input from [Milestones as an entry type](18-milestones-entry-type.md)

**A seventh entry type now reaches the timeline, and it arrives with two constraints rather than two questions.**

- **A Milestone row shows no clock time.** Milestones are noticed rather than witnessed — "sometime last week" is normal — and rather than storing a date, [ADR-0010](../../../docs/adr/0010-instants-are-stored-the-zone-is-a-lens.md)'s pattern was applied instead: store the instant, drop the precision at display.
- **A back-dated Milestone is anchored to the Day Start of its date**, so it sits at the head of its day. This exists precisely because the row carries no visible time to explain its position among timed entries.

Still this ticket's call: whether Milestone is a filter facet of its own, and how a row with no time reads beside rows that have one.

## Answer

**The filter takes the header's place.** Variant A, ratified by the dev on 2026-08-17.

Assets: [prototype](https://claude.ai/code/artifact/bc155120-87ce-433a-bb17-964394c79f81), source at [`prototypes/timeline-filter.src.html`](../prototypes/timeline-filter.src.html). Three variants were built on the real D1 surface — actual Pico, [`design/tokens.css`](../design/tokens.css), bottom tabs, the FAB fan — over a month of seeded log, so "when did she eat broccoli" had a real answer to return: three Meals, weeks apart, each carrying a reaction note.

### The signal is contrast, because it cannot be colour

D1 spends its only hue on actions ([Visual design direction](11-visual-design-direction.md)), so "this timeline is filtered" had to be said with type or chrome. Three answers were built:

- **A — inverted header.** The filter *replaces* the live block. The hero figure — the loudest thing on the screen — is gone, and inverted ink stands where it was. Same screen, same FAB, no mode.
- **B — chip rail.** Filtering as a view state, not a mode: a permanent rail under a header that stays live, signalled only by a standing bar and an indent rule. Built deliberately weak, to test whether the 3am trap is real.
- **C — find surface.** A separate surface pushed over the app: no FAB, no tab bar, no live figures. Mis-logging structurally impossible, at the cost of a mode and a way back.

**A won.** The displaced hero is what does the work: the trap this ticket named is that a filtered timeline *looks like* an unfiltered one, and A makes them differ in the largest element on the screen rather than in a strip you have to read. B was rejected — a standing bar under an unchanged live header is not enough at 3am. C was rejected as paying a mode for safety that A gets from contrast.

### What A settles by being chosen

- **The sticky header does not survive filtering.** The live elapsed-vs-target figures are about *now*, and there is no version of them that is correct in a historical view — so they go, and the filter stands in their place. This was the ticket's open question about the header, and choosing A answers it.
- **The Food detail view is a pre-filtered timeline, not a screen.** Settings → Foods → *Broccoli* enters the ordinary filtered state with `food = Broccoli`. There is no second surface to build, no second row template, and the reaction notes come with the rows because they *are* the rows. First exposure stays derived, never stored ([Domain model](05-domain-model.md)).
- **Milestone is a facet like any other type**, and that is enough to answer "when was her first tooth" — confirmed against the prototype. A Milestone row reads fine beside timed ones: it shows an em dash where the clock time would be, and sits at the head of its day. Nothing further is needed, and [Milestones as an entry type](18-milestones-entry-type.md)'s handoff is closed.

### The two rules decided on top of A

A is the only variant that keeps the FAB live, so choosing it left the ticket's hardest question open rather than closing it. Both rules are now live in the prototype.

- **Logging clears the filter.** The FAB is the one control that can write a row the current filter would hide, and a write with no row is how you log a nappy twice at 3am. So the entry lands, the filter drops, and you are back on today's log with the toast and Undo. This keeps [Logging interactions](16-logging-interactions.md)'s *undo over confirm* rather than adding a confirm, and it extends *the app never writes data nobody entered* to its mirror image: **the app never hides data somebody just entered.** The cost is accepted — an accidental FAB tap destroys the lookup, which is cheap to redo.
- **A filter is a lookup, not a setting.** It survives a trip to Stats or Settings — the inverted header makes coming back legible, and the Food catalogue route *enters* the filter from Settings, so clearing on tab change would break it. It never survives a cold start. Nothing the app remembers overnight can surprise you at 3am.

Two derivations follow rather than being separate decisions:

- **Stopping or correcting a row you are already looking at does not clear the filter.** That write is visible by definition; only the FAB needs rescuing from.
- **The stale-sleep banner belongs to the live header's world**, so it is absent while the filter header is up and returns with Clear. (Asserted, not prototyped — the banner was not ported into this prototype.)

### Facets: all five earn v1

Entry type, Food, Member, free text over Notes, and a date period — the period was built marked *candidate* and survived. It is **three preset chips** (Anytime / Last 7 days / Last 30 days), not an arbitrary from–to range; no date picker is in v1. Type facets collapse Breast and Bottle into one **Feeds** chip, because nobody at 3am thinks "breast OR bottle".

Free text searches Notes plus the rendered detail of a row — food names, a Milestone Name, who logged it — and highlights the hit. It is a substring match over the local replica, not an index: the whole log is already on the device ([Local-first sync engine](01-local-first-sync-engine.md)), and a month of log is 240 entries.

### No ADR

Everything here is UI-level and lives on this ticket, as with [the logging prototype](08-logging-ux-prototype.md) and [Logging interactions](16-logging-interactions.md). Nothing in the domain language changes either — a filter is a view concern, not a term, so [`CONTEXT.md`](../../../CONTEXT.md) is untouched.
