# Prototype: visual design direction

Type: prototype
Status: resolved
Blocked by: 02, 08

## Question

What does this app look like?

Takes the framework recommendation from the CSS research and the interaction model from the logging prototype, and settles the visual language. Use `/impeccable`.

### Decisions to reach

- **Dark mode is the primary theme, not an afterthought.** The app's signature moment is a dark room at 3am. Does it get a dedicated night appearance beyond a colour inversion — dimmer, warmer, less contrast?
- **Design tokens** — the full set as custom properties: colour, type scale, spacing, radii, elevation. This is the artefact the build actually consumes.
- **Colour** — entry types want to be distinguishable at a glance in a timeline. How many colours can carry meaning before it turns into confetti, and does it survive a colour-vision deficiency?
- **Typography** — numbers dominate this UI (times, durations, millilitres). Tabular figures, and a type scale that makes "2h 40m" the loudest thing on the screen.
- **Density** — a timeline of 20 entries a day on a phone, versus the same on a desktop browser.
- **How much of the framework survives** — which parts we use as shipped, which we override, and where our tokens plug in.

### Deliverable

A styled prototype linked from this ticket, plus the token set written down in a form the implementation can lift directly.

### Input from [Stats and CSV export](10-stats-and-export.md)

- **v1 has three destinations, not one.** [Ticket 08](08-logging-ux-prototype.md) settled that *the timeline is the screen*; stats, and the settings that house the export and the schedule Targets, are now two more. The count is settled — the mechanism (bottom tab bar, header icon, swipe) is this ticket's to decide, under one constraint: **whatever the nav is, it must not compete with the FAB for the thumb.**
- **The stats screen needs tokens for a bar chart** — eight bars per card, one visibly in-progress, drawn by hand with no charting dependency. Bars are the secondary read; every card states its numbers as text.

## Answer

**D1 — Instrument, with a bottom tab bar.** Ratified by the dev on 2026-08-16 after driving the prototype. Both are now the prototype's defaults.

Assets: the [prototype](https://claude.ai/code/artifact/8d2f7632-bdb5-4c5d-894f-028517aac47c) (all three directions, kept for the record), the lift-ready [`design/tokens.css`](../design/tokens.css), the [`design/appearance.js`](../design/appearance.js) resolver, and [ADR-0008](../../../docs/adr/0008-appearance-follows-the-clock.md).

### The direction

Three directions were built over the settled structure, disagreeing on one question: **how much work does colour do, and how much does type do?** D2 *Ledger* gave everything to type — mono time gutter, hairlines, no panels, twice the density. D3 *Signal* made colour the taxonomy, five entry-type colours carried into the stats bars.

**D1 wins with the position that colour belongs to actions, not to categories.** One hue, and it is the accent. Entry types are told apart by glyph and label; the type tokens exist (`--t-feed`, `--t-sleep`, …) but every one of them resolves to `--ink-2`, so the rule is enforced by the token layer rather than by memory. The hero figure is loud through **size at weight 300**, not through boldness — 3rem of light-weight tabular figures reads as an instrument, and 3rem of bold reads as shouting.

**Overdue is the number adopting the brand colour.** With one hue there is no second escalation state available, which turns ticket 08's *the app does not nag* from an intention into something the palette makes impossible.

### Why not the other two

- **D3 died of its own success.** Its taxonomy was built on lightness differences, not hue alone, so it survives `?cvd=deut` — but only because every row also carries a glyph. Once the glyph is doing the identification, the colour is decoration. Two further costs sealed it: a seventh entry type ([Milestones](18-milestones-entry-type.md)) has nowhere to go in a five-colour system, and reserving a neutral accent so actions do not read as a sixth category leaves the FAB as a near-white slab in a dark room.
- **D2 is the better desktop and the worse bedroom.** Its density is real and it is the only direction that changes character at width. But its structural accent is an ink-blue, and blue is precisely the wrong physiology for an unlit room — it has to desaturate toward neutral at 3am, which is to say the direction loses its identity in the single moment the app exists for. Its time gutter is worth stealing if the desktop timeline ever needs one.

### The appearance follows the clock

The ticket asked whether night deserves a dedicated appearance beyond an inversion. **Yes — and the answer arrived with a correction to the question.** Three appearances stay, but they are driven by the **local wall clock**, not by a toggle and not by `prefers-color-scheme`:

| | |
|---|---|
| 23:00 → [Day Start](../../../CONTEXT.md) | deep night |
| Day Start → 07:00 | night |
| 07:00 → 19:00 | day, **unless** the phone says dark |
| 19:00 → 23:00 | night |

**The clock can only ever make it darker, never lighter.** A phone set permanently to dark mode — for light sensitivity, migraine, or preference — keeps a dark app at noon; a phone set to light mode is still dark at 22:00. After 19:00 there is no light mode at all.

- **Day Start earns a second job** and no `Night Start` setting appears. The Household has already said when its night ends; deep night simply runs until that hour. Same refusal [Schedules in v1](09-schedules-v1.md) made.
- **Deep night is a quieter register, not a dimmer.** Peak luminance is capped — the brightest ink sits at `oklch(0.78 …)`, not at 1.0 — while contrast against the ground stays above 10:1. Shadows are dropped entirely; on a near-black ground a shadow is only noise.
- **The manual override has three settings, not four**: *Automatic* (default), *Always day*, *Always night*. No *Always deep night* — it is a concession to a moment, not a taste.
- **This costs the no-JavaScript theming the CSS research prized.** A clock cannot be read from CSS, so `appearance.js` must run inline in `<head>` and block first paint. It is the only script allowed to — a resolver that runs after paint produces exactly the white flash the rule exists to prevent.

### Nav: the bottom tab bar, and the constraint it was tested against

Three destinations, and the FAB moves to `bottom: 76px` to clear the bar. The tab bar does put a second control in the thumb zone, which is the trade the constraint warned about — but it is a wide, shallow strip under a 62px FAB with 14px of clear space, the two are never mistaken for one another, and it is the only option that shows where you are without being opened. Header icons keep the whole bottom for the thumb but bury Stats behind a stretch; swipe has no chrome to discover and would collide with whatever [Timeline filtering](19-timeline-filtering.md) wants from a horizontal gesture.

### How much of the framework survives

Answered by evidence rather than assertion: the prototype themes the **real Pico v2**, 81 KB of it inlined, and every control on the Settings screen is Pico as shipped.

- **63 of Pico's 149 tokens are mapped.** The other 86 — invalid-field colours, the spinner, tooltips, accordions, progress, text selection, and the select/date/time icon data URIs — track `:root[data-theme]` for free, which is why the resolver writes `data-theme` alongside `data-appearance`.
- **Importing into `@layer framework` means nothing ever has to out-specify Pico.** No `!important` outside the reduced-motion block.
- **One line genuinely fights the framework**: `html { font-size: 16px }`. Pico scales the root to 131.25% on wide viewports, which is right for a document and wrong for an application.
- **The segmented control the research costed at ~50 lines came in at 34.** The bottom sheet, the FAB fan, the timeline row, the stat card and the tab bar are ours outright — as expected, the override budget is spent on components Pico does not have rather than on fighting the ones it does.
- **Both of the research's accepted risks held.** Nothing needed a component Pico lacks *and* could not be built in under 60 lines, so the Open Props UI exit stays unused.
