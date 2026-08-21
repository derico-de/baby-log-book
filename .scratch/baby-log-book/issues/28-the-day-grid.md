# 28 — The day grid: what her day actually looks like

Type: feature
Status: **resolved 2026-08-21** — shipped: a Week and a Day view over an hour axis, stepping periods, a legend that filters, and the five trend cards kept below it. Amended the same day after review: **every Entry takes the whole column**, and a **Combined Feed is drawn as the one sitting it was**.

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

### Every Entry takes the whole column; layering does the rest

The first build split a column into three tracks — a sleep ground, an inset one for feeds and tummy time, a rail on the right for the instants — so nothing could ever cover anything. **Reversed on review: every Entry is full width.** What the tracks were carrying is carried by layer order instead: Sleep underneath, sessions with a duration over it, instants over both.

The domain reading is better, not just the picture. A **Sleep Feed** overlaps its Sleep by definition (spec §3.4), and a full-width Feed drawn across a full-width Sleep says *inside* far more plainly than a narrow column drawn beside it — which is what the inset track actually looked like. A ring in the ground colour on the upper layers is what keeps them reading as objects lying on a Sleep rather than as slices cut out of it.

Costs, and what pays them:

- **A block's label can be crossed by an instant landing on the same minute.** Block labels keep a disc's width of clear space at the trailing edge, and a mark's text sits on a plate in the ground colour — invisible over empty grid, a chip over a block.
- **A short block cannot hold a line of type.** Under about 17px the label is dropped rather than clipped; a container query states it, so the number lives in one place and a browser without container queries shows the label rather than hiding it.
- **Two genuinely-overlapping foreground sessions** still split lanes, per cluster, so one busy afternoon never narrows the whole day.

Pee & poop, Meals, Measurements and Milestones have one time and no duration; giving them a minimum-height block would be the grid lying about a length they do not have, so they stay a 3px full-width tick in the week and a glyph disc with the Entry's name in the day. Two within half an hour still cannot share the same trailing edge, so a cluster **packs against that edge** rather than spreading across the column — a disc adrift in the middle of a Feed's label is worse than a tight row of discs. Their vertical position is never nudged: they sit at the time they happened.

### A Combined Feed is drawn as the one sitting it was

A **Combined Feed** is one sitting of milk from more than one source — pumped breast milk, then formula — logged as the several Feeds it was and never merged ([ADR-0019](../../../docs/adr/0019-a-new-feed-ends-the-running-one.md), CONTEXT.md). It follows from two Feeds close together and is never recorded as such, which is exactly what makes it a *drawing* question: two blocks a minute apart are one answer to *has she eaten*, and the grid should say so.

- **The rule is `stats.ts`'s, imported rather than restated.** The cards have counted feeds as rounds since [issue 10](10-stats-and-export.md) — 15 minutes, measured end-of-one to start-of-next. A grid that grouped differently from the card beneath it would be the screen disagreeing with itself.
- **Grouped over the whole log, not per column**, so a sitting that straddles a Day Start is the same sitting on both sides of it.
- **One envelope, both values**: `Breast · Left + Bottle · Formula · 90 ml`. The plus is doing real work — it says *and then*.
- **Unless it was the same milk twice, in which case it is one figure.** One bottle is one Feed, so a sitting that needed a second bottle of the same formula is a Combined Feed by the glossary — but a reader does not want `60 ml + 80 ml` and a subtraction in their head. Two Feeds in a sitting are one bigger feeding when their contents match (`feedContentKey()`, in the domain beside `intakeMl`), and then they read `Bottle · Formula · 140 ml` with no seam and no plus. A left breast twice is the same case with no figure: one left breast, said once. Runs are **consecutive**, never collected — formula, breast milk, formula is three things in the order they happened, not two things reordered. A bottle whose contents nobody recorded is its own run rather than a wildcard: the app does not know it was the same milk, and guessing is inventing data.
- **The kind is said once per stretch of it.** `Bottle · Breast milk · 60 ml + Bottle · Formula · 80 ml` says the word twice for no reason, and a grid block is the one place in this app where width is genuinely scarce: it becomes `Bottle · Breast milk · 60 ml + Formula · 80 ml`. A breast in between makes the next bottle say it again — it is the *neighbour* that licenses the shorthand, not the sitting. Withheld when the run has nothing else to call itself by: a bottle whose contents nobody recorded keeps the word, because a bare `120 ml` after another bottle reads as more of the same milk, which is exactly what nobody said. One builder produces both the full title and the shortened one, so the timeline row and the grid block cannot drift.
- **One tap target per source, at its own slice** — including inside a summed run. A sitting is one thing to read and two things to correct; a single button would have put the second bottle out of reach of the only screen that can open it. Nothing is merged, stored or written: this is entirely a reading rule.
- **The linear read still states every Feed the sitting was**, at its own time with its own figure — `Bottle · Formula · 60 ml · 11:18–11:27` then `… 80 ml · 11:32–11:44`. The sum is a convenience for the eye; the rows are the log, and the hidden list is the log.
- **A hairline seam at the handover, in the week view only.** There it is all there is to say a sitting had two sources; in the day view the label says it in words, and a line drawn at the handover cuts straight through them.
- Nothing else groups. A Feed never joins a Sleep or a tummy stretch, and Sleeps still never merge ([ADR-0014](../../../docs/adr/0014-only-sleeps-merge.md) is about storage; this is about drawing).

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
- **A mark's label can still cross a block's** when an instant lands inside one and the block's own label runs the full width. The plate keeps it readable; the two are not always on separate rows. The price of full width, paid knowingly.
- **Day-view blocks are below the 48px tap floor** when the Entry is short. Accepted on a read surface whose primary editing path is elsewhere; blocks render at their true height with a 5px floor and are never re-centred, so ordering and start times stay honest.
- **One hour gutter serves seven columns**, so on the two days a year one column is 23 or 25 hours long the *labels* can only be right for the length most of the week has. The hour **lines** are drawn per column from that column's own ticks, so the geometry never lies even on the day the labels do. A single-day view has one column and is exact.
- **Marks in a multi-lane cluster lose their word** and keep their disc; the accessible name keeps the sentence.

## What it cost the codebase

- `src/lib/domain/grid.ts` — pure, 24 tests. All the time maths, DST included. The renderer does no arithmetic.
- `src/lib/i18n/entry-label.ts` — `entryTitle()` and `GLYPH_OF`, **lifted out of `TimelineRow`** rather than copied into the grid. Two surfaces naming the same Entry two different ways is the inconsistent-vocabulary failure a product UI cannot afford; now "Bottle · Formula · 150 ml" is that Entry's name everywhere and a change to it is a change everywhere.
- One bug worth recording because it will happen again: **Pico ships its own `.grid` utility** that turns an element into an auto-fit column grid above 768px. Nothing in the app layer declared `display`, so on a tablet the whole screen inherited Pico's and laid the weekday strip and the hour body out as two half-width columns. The classes are `daygrid-*` now. Pico's 16px `button` bottom margin cost a header row three times over in the same session.
