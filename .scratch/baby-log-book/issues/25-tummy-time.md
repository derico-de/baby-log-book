# 25 — Tummy time as an entry type

Type: task
Status: **implemented 2026-08-21** — domain, fan, timeline, filter, stats, export, tokens, three locales, CONTEXT.md, spec §3.7 and [ADR-0027](../../../docs/adr/0027-tummy-time-ends-in-the-fan.md).

## Question

Track tummy time — the stretches a Baby spends on their front. Requested directly rather than reached by grilling, and the two open questions were the shape and the rescue.

## Answer

**An eighth Entry type and the fourth Live Session**, started from the fan with the same one-field time sheet a Sleep uses and stopped from the fan, the row, or the entry sheet. It cost one glyph, one hue, one fan row, one stats card and one export file — the price [ADR-0026](../../../docs/adr/0026-entry-types-get-their-own-colour.md) set for a new type, paid in full.

### The shape: a Sleep without the payload

Two ends and nothing else, so `TummyTimePayload` is empty and the timeline draws it from `SESSION_TYPES` membership alone. That membership question got its own predicate — `isSession()` — because three components were each naming the three session types inline, and the fourth type would have had to be added to all three by hand. It is now added in one place and reaches the *running* pill, the Stop button, the duration line, the finished row's `13:45 – 14:05` and the entry sheet's end field at once.

### The rescue: none, and it is the one cost

A Sleep's end is the whole point, so a stale one gets a banner. Tummy time's end is the whole point too — and it gets no banner anyway ([ADR-0027](../../../docs/adr/0027-tummy-time-ends-in-the-fan.md)). The stale-Sleep machinery is an age-seeded ceiling, a per-session device-local acknowledgement, a *Still asleep* clock reset and a surface at the top of the timeline, all aimed at hours in the dark with nobody watching. A stretch of tummy time is minutes, in daylight, with an adult standing over her. **The fan carries the end instead**: while a stretch runs the tummy row reflows to *Off her tummy* and ends it at the instant it is pressed — no sheet, because nobody discovers tummy time ended twenty minutes ago.

A forgotten stop therefore inflates the day's total and nothing corrects it. Accepted, recorded, and mitigated only by things that are visible: the running row, the fan statement and an editable end.

### No merge, no Target

Two open stretches are two people logging the same minutes, not a contradiction, so [ADR-0014](../../../docs/adr/0014-only-sleeps-merge.md) covers them unchanged — merging would tombstone one and delete minutes from the day, which is exactly the Feed failure that ADR refused. And there is no Target: tummy time is reported, never scheduled, so the live grid keeps its two columns and no age table seeds a number to measure a Baby against.

### The card and the hue

A duration card, last of five, with a **quarter-hour axis** — an hourly one would draw an honest day as a stub. Beside the daily total it states how many stretches today and the longest, because 30 minutes in one go is not 30 minutes in six. The hue is **moss 100°**, the last gap between the accent band's upper edge (70°) and meal green (150°); lightness and chroma are its siblings' exactly, which carries their verified contrast across. The glyph is the posture: floor line, arched body, head lifted clear — the only glyph in the set that draws a baby, which is what keeps it apart from the moon at 19px.
