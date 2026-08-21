# 28 — The day grid: what her day actually looks like

Type: feature
Status: **resolved 2026-08-21** — shipped: a Week and a Day view over an hour axis, stepping periods, a legend that filters, and the five trend cards kept below it.

## Question

Stats was five cards over a rolling seven days ([issue 10](10-stats-and-export.md), [spec §9.1](../spec.md)), and its whole argument was that the screen answers **one** question: *is this getting better*. Totals per day, a delta against the week before, and no navigation.

That leaves a question the app cannot answer anywhere: **when**. Not "how much did she sleep on Tuesday" — the card says that — but *whether the long sleep is drifting earlier three nights running*, whether the feeds cluster at teatime, what 3am looks like across a week. A total per day is exactly the projection that throws that away: 14h of sleep in one column and 14h in another are the same bar and can be two completely different days.

So: **can the log be drawn on a clock, and what does that cost the screen that already works?**

## What is not in question

- The **five cards stay**, unchanged, and stay on this screen. They answer a different question and the grid cannot answer it: a raw grid of blocks cannot tell you sleep is improving.
- **Rolling seven days, not a calendar week.** Calendar weeks start Monday in DE and RO, and a stats screen that disagrees with itself across languages is an endless bug — [issue 10](10-stats-and-export.md)'s argument, unchanged.
- **Client-side over the replica, nothing cached, no charting dependency.** Same reasoning as the bars: this is not a charting problem.
- **Colour never becomes the only channel.** [ADR-0026](../../../docs/adr/0026-entry-types-get-their-own-colour.md)'s guards hold, and this screen is the hardest test of them the app has.

## What was decided

### The column is a day bucket, not a calendar day

The axis runs **Day Start → Day Start** (05:00 by default), not midnight → midnight. Two reasons, one of which is free:

- It is the same day every other surface in this app means. The grid can never disagree with the stats, the timeline or the export about which day a Feed belongs to.
- **DST falls out.** A column is defined by its two instants and a block's position is its share of the span between them, so a 23-hour day is a shorter column with one tick fewer, and the wall hours stay what [ADR-0010](../../../docs/adr/0010-instants-are-stored-the-zone-is-a-lens.md) always said they were — a projection, printed on the axis, never compared with anything. The spring-forward day's axis simply reads `01, 03` and the autumn day's reads `02, 02`, which is what the day did.

Cost, accepted: a night Sleep still crosses a column edge, at 05:00 instead of at midnight. It is drawn in **both** columns it touches, clipped flat at the edge, and the accessible name says *continues*.

### Drawing overlaps, counting attributes

`stats.ts` gives a session to the bucket it *began* in, because "she slept eleven hours last night" belongs to the night it started. A grid draws time rather than counting days, so **a session appears in every column it overlaps**. This is the one place in the app that does not use start-bucket attribution, and it is deliberate; it is stated at the top of `grid.ts` so nobody has to rediscover why.

### Sleep is the ground layer

A **Sleep Feed** overlaps its Sleep by definition (spec §3.4), so any packing algorithm that treats the two as rivals for a lane draws the domain wrong — it would narrow both and say they compete. Instead Sleep takes the column as a ground layer and everything with a duration sits inset on top of it, which draws the Feed *inside* the Sleep, which is what it is. Two genuinely-overlapping foreground sessions still split lanes, per cluster, so one busy afternoon never narrows the whole day.

### Instants get a rail, not a block

Pee & poop, Meals, Measurements and Milestones have one time and no duration. Giving them a minimum-height block would be the grid lying about a length they do not have, so they get a rail down the right of each column: a 3px tick in the week, a glyph disc with the Entry's name in the day. In the day view two within half an hour take lanes side by side — **at their true times**, never nudged to a time they did not happen at.

### Two overturned rules from §9.1

1. **"No navigation to earlier weeks in v1."** Overturned. A grid you cannot step is a grid you can only ever check once. `‹ ›` steps a week or a day, forward is capped at today, and a **Today** button appears when the window has left it. Nothing is remembered across a cold start — the screen always opens on today, because nothing this app remembers overnight may surprise anyone at 3am ([issue 19](19-timeline-filtering.md)'s rule for the filter, applied here).
2. **"A trend screen and only that."** Overturned. It is a **pattern** screen and a **trend** screen, in that order down one scroll. No switcher between them: they are not alternatives.

This does not settle the v3 "monthly/yearly stats" question — it narrows it. Period *navigation* now exists and has a shape; what v3 still owns is aggregating over a period longer than a day.

### The legend is the colour key, and it filters

One row of type chips, showing only facets with something in the window — the same admission test the cards use, so nothing on the screen is an empty category. It is **the** answer to how a 46px column stays readable without colour being the only channel: the key names every hue with its glyph and its word.

Its chips are deliberately **quieter than the filter rail's**. There you press one chip and a solid fill is right; here all seven start pressed, and seven solid pills at once is the confetti [ADR-0026](../../../docs/adr/0026-entry-types-get-their-own-colour.md) was written against. So the hue lives in the glyph disc and the chip stays a tint.

### Accessibility

Colour is the **scanning** channel and never the identifying one:

- Every week column carries a visually-hidden ordered list of its Entries — "Sleep 22:40–06:10, 7h 30m · Bottle · Formula · 90 ml 02:15" — so the whole grid is readable linearly by anyone who cannot see an 11px block.
- Day-view blocks are buttons with the same sentence as their accessible name, and open the entry sheet — the same gesture as a timeline row.
- Hour labels are real text. The legend is the colour key. Today is marked with an ink underline, not with the accent.
- The **accent appears exactly once on this screen**: the now line, via `--live`. The brand hue means *the thing happening now*, here as on the home screen.

## Accepted costs

- **Week-view blocks are not individually tappable.** A 46px column cannot carry a 48px target; the day view and the timeline are where an Entry is opened.
- **Day-view blocks are below the 48px tap floor** when the Entry is short. Accepted on a read surface whose primary editing path is elsewhere; blocks render at their true height with a 5px floor and are never re-centred, so ordering and start times stay honest.
- **One hour gutter serves seven columns**, so on the two days a year one column is 23 or 25 hours long the *labels* can only be right for the length most of the week has. The hour **lines** are drawn per column from that column's own ticks, so the geometry never lies even on the day the labels do. A single-day view has one column and is exact.
- **Marks in a multi-lane cluster lose their word** and keep their disc; the accessible name keeps the sentence.

## What it cost the codebase

- `src/lib/domain/grid.ts` — pure, 24 tests. All the time maths, DST included. The renderer does no arithmetic.
- `src/lib/i18n/entry-label.ts` — `entryTitle()` and `GLYPH_OF`, **lifted out of `TimelineRow`** rather than copied into the grid. Two surfaces naming the same Entry two different ways is the inconsistent-vocabulary failure a product UI cannot afford; now "Bottle · Formula · 150 ml" is that Entry's name everywhere and a change to it is a change everywhere.
- One bug worth recording because it will happen again: **Pico ships its own `.grid` utility** that turns an element into an auto-fit column grid above 768px. Nothing in the app layer declared `display`, so on a tablet the whole screen inherited Pico's and laid the weekday strip and the hour body out as two half-width columns. The classes are `daygrid-*` now. Pico's 16px `button` bottom margin cost a header row three times over in the same session.
