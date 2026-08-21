# 27 — The fan is out of room

Type: grilling
Status: open

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
