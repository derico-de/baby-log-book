# 27 — The fan is out of room

Type: grilling
Status: **resolved 2026-08-27** — shipped: the fan curves around the FAB, Pico's dead margin is gone, six rows became eight, and the rule is stated in [ADR-0035](../../../docs/adr/0035-a-fan-row-is-a-form-not-an-entry-type.md).

## Question

The FAB fan is a vertical stack of full-width pills, tuned for one-thumb 3am logging ([issue 16](16-logging-interactions.md)). It is now **six rows**, which is roughly where it stops working:

| Rows | Expanded height | Notes |
|---|---|---|
| 6 | ~455px | today: Nappy · Sleep · Feed · Tummy time · Measurement · Milestone |
| 7 | ~510px | tummy time before [ADR-0028](../../../docs/adr/0028-a-nappy-is-one-form.md) folded the nappy rows |
| 7 + two sub-lines | ~560px | while a Sleep runs — most of a small phone's viewport |
| 10 | ~700px | not a thing that fits on a phone |

(54px pills, 8px gaps, a ~92px offset above the FAB.)

Two entry types have been added in a fortnight. Health events, medication, temperature, pumping, bath — any of them is a seventh row, and **the next one decides this by force if we do not decide it on purpose.**

## The trap we already walked into

[ADR-0028](../../../docs/adr/0028-a-nappy-is-one-form.md) records it: the first answer tried was a **level down** — the Nappy row reflowing the fan in place to *Pee · Poop · Back*. It bought two rows and cost a tap on the most frequent action in the app, and it did not survive the week, because the thing that actually justified touching nappies was a data problem (two rows wrote two Entries), not a height problem.

**The lesson for this ticket: a level down is not capacity, it is a tax.** Any answer that makes the common actions deeper is buying room with the one currency this fan exists to protect.

## Candidates

### A. Two-column grid (recommended, the structural answer)

The stack becomes a 2-wide grid of tiles — glyph above label, ~76px square-ish.

- **8 tiles ≈ 330px. 12 tiles ≈ 495px.** Roughly double the capacity at the same height, and *no action gets deeper*: everything stays one tap from the FAB.
- Thumb reach across the bottom third of a phone is fine; the row nearest the FAB is still nearest.
- Costs: sub-lines go (*ends the sleep*, *the sleep keeps running*) or move under the label as one small line, and the reflow states — *She's awake*, *Off her tummy* — need a tile shape that can carry a second line. Labels get shorter. The fan stops being a menu and becomes a pad, which is a real visual departure from D1's instrument feel and wants a prototype before it is ratified.

### B. A "More" tile, opening a full grid sheet (recommended, the overflow answer)

The fan carries the frequent handful; everything else lives one tap deeper in a sheet that can hold any number of tiles.

- **Unbounded capacity**, no learned order, no hidden gesture, and the tax lands only on the rare things — which is the opposite of the trap above.
- Pairs with A rather than competing: a 2×4 grid plus *More* covers seven frequent types and an open-ended tail.
- Costs: one more surface to design, and a rule for what earns a fan slot — which the project has ducked twice ([issue 18](18-milestones-entry-type.md) admitted frequency is *not* the admission test, but only because there was room).

### C. Move the rare types out of the fan entirely

Measurement is monthly; Milestone is a handful of times a year. Both are logged in daylight, at leisure. They sit in the fan because in [issue 18](18-milestones-entry-type.md) *"v1 has exactly three destinations, and inventing a baby-profile screen for a monthly action is far more furniture than one row"*.

- **Frees two rows today**, for the price of the screen that argument refused. With eight-plus types the furniture may now be cheaper than the crowding.
- Costs: a fourth destination, and the argument has to be re-made rather than reversed quietly.

### D. Contextual rows

The fan already does this — *She's awake* replaces *Sleep*, *Off her tummy* replaces *Tummy time*. Extend it: no Tummy time while a Sleep runs, no Feed row while one is running, and so on.

- Free, uses machinery that exists, and each rule is defensible on its own.
- Costs: a fan whose contents move for reasons the user has to model. Muscle memory is the whole point of a 3am control, and this is the option most likely to erode it quietly. Worth one or two rules, not a strategy.

### E. Frequency-ordered or configurable fan

Order by what this Household logs, or let a Parent choose the rows in Settings.

- **Learned ordering is out of character**: this app states rather than learns ([ADR-0006](../../../docs/adr/0006-targets-are-stated-not-learned.md)), and a menu that reorders itself is the exact opposite of muscle memory.
- **Configurable** is defensible and belongs to a later version — it is a settings surface, a Household-or-Device question, and a fan that differs between Oma's phone and mum's.

## Recommendation

**A + B**: a two-column grid that holds seven or eight tiles, with a *More* tile opening the rest. It doubles capacity without deepening a single common action, and it gives every future entry type a home without another conversation like this one. **C** is the cheap immediate relief if a seventh type lands before the grid is built.

Prototype first, in the same way [issue 11](11-visual-design-direction.md) and [issue 19](19-timeline-filtering.md) were: the grid is a visual departure and the argument for it is about thumbs, not about pixels on a desk.

## Decisions to reach

1. Grid or stack — and if grid, what happens to the two reflow states that carry sub-lines.
2. **What earns a fan slot**, stated as a rule this time, since it now has to be applied rather than shrugged at.
3. Whether Measurement and Milestone leave the fan, and what they leave *for*.

## Answer

**The fan was not out of room, and two of this ticket's three premises were wrong.**

### The forcing function does not exist

*"Two entry types have been added in a fortnight, and the next one decides this by force"* — but the two that arrived netted **+1 row, not +2**, because [ADR-0028](../../../docs/adr/0028-a-nappy-is-one-form.md) removed one on the way in. And the queue is empty: health events, medication and temperature are all **Out of scope** on the map, and *pumping* and *bath* appear in no document in this repo. Nothing was pressing.

### A row is a form, not an entry type — [ADR-0035](../../../docs/adr/0035-a-fan-row-is-a-form-not-an-entry-type.md)

Decision **#2** was unanswerable as posed, which is why it went unanswered twice. `ENTRY_TYPES` has **eight** members and the fan has **six** rows: `breast_feed`, `bottle_feed` and `meal` sit behind the one *Feed* row, told apart by a segmented control inside one sheet. So the fan never was one row per type.

And it is the app's **only** create-from-nothing surface — every sheet is mounted in `src/routes/+page.svelte` and nothing else opens one, the two exceptions (*She's awake*, *Feed while asleep*) acting on a Sleep that already exists. Admission is therefore automatic and no admission test can exist. The rule that does work is the inverse obligation: **a new entry type must justify a new form before it may claim a row**, and folding into an existing form costs nothing. That is what makes *"the next type decides this by force"* false.

Decision **#3** falls out of it: **Measurement and Milestone stay.** A row leaves the fan only by being given another create surface, and there is none — [issue 18](18-milestones-entry-type.md)'s refusal to invent a baby-profile screen holds rather than being reversed quietly.

### Decision #1: neither the grid nor the *More* sheet — the fan curves

The recommendation was **A + B**, whose own stated cost was that *"the fan stops being a menu and becomes a pad."* It was not needed. The dev proposed the shape that was missing from the candidate list: **start the fan beside the button rather than above it, and round the whole thing.**

- **The arc.** The row nearest the thumb now sits *beside* the FAB and each row above swings back to the right edge along `cos(t·π/2)`, carried as a per-row `--dx` transform so the curve costs no layout. This reclaims the **74px** the stack spent clearing the button. A true circle (`sqrt(1 − t²)`) was tried and rejected: it leaves the top row snapping back 44px while its neighbours move 15, and the kink reads as a mistake.
- **The dead margin.** Measuring the shipped fan in Chrome showed a row pitch of **78px** where the CSS says 62. The extra 16px is Pico's default `button { margin-bottom }` — the trap `DESIGN.md` already warns about — which the fan had been paying six times over: **80px of dead space in the one control short of room**, more than the arc itself bought.
- **One width for all rows.** With auto widths both edges go ragged and six pills read as a scatter rather than a curve, so the fan is `align-items: stretch`. German's longest string (*der Schlaf läuft weiter*) makes a 250px pill, leaving the bottom row 18px clear of the screen edge; the `max-width` and ellipsis are a safety net nothing currently reaches.

**Six rows to eight**, with the pill, its label, its sub-line and its type colour untouched — which is more than the grid offered, at less cost.

### The ceiling, stated and tested

Measured in Chrome at **360×780** (Galaxy S22, installed — the dev's own phone, and the smallest the fan is known to work on): `.head` ends at y=194, the bottom row at y=704, so `n·54 + (n−1)·8 ≤ 510` gives **eight rows with 22px to spare**. Before the change it was six.

jsdom does no layout, so the assertion in `render.test.ts` is arithmetic over the fan's own constants — which is the point: it goes red when a **row** is added, not when a pixel moves. Three tests landed: the ceiling across all four reflow states, the arc's monotonicity and its clearance of the 62px button, and the retitled row test now stating the rule.

### Left standing, deliberately

- The **toast** sits at `--fab-bottom + 74px`, which is now the middle of the fan rather than its bottom edge. This is pre-existing overlap and it got *better*: the row it covers is no longer *Pee & poop*, the most frequent one.
- **Option E (configurable fan)** stays a later-version question, untouched.

### Verification

Full suite green (649 tests), `svelte-check` clean, and the geometry above confirmed on a throwaway production instance driven over CDP at 360×780 — measured, not computed, after the first computed pass got the header height wrong and invented an overlap that was not there.
