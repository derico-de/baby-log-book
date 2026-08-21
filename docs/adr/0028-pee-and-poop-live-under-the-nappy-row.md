# Pee and Poop live under the Nappy row

The fan opened with Pee and Poop as two of its own top-level rows — [issue 16](../../.scratch/baby-log-book/issues/16-logging-interactions.md)'s answer to the app's most frequent, least informative action: two taps, the second a large target, no sheet. **They now sit one level down, behind a single Nappy row that reflows the fan in place to Pee · Poop · Back.** A nappy costs three taps instead of two.

What bought the tap is the top level: **one row per entry type**, and a stack that still fits a small phone. With Tummy Time the fan had reached seven rows — around 510px expanded, and about 560px while a Sleep runs and two rows carry sub-lines — which is most of a small phone's viewport, and the next entry type would have made the decision for us. Folding the two nappy rows into one takes it back to six.

The no-sheet rule is untouched, and that is the rule that mattered: no sheet chrome renders, nothing confirms, both targets stay full-width pills. Reflowing in place is the fan's own existing idiom — it is what *She's awake* does — so the nappy set is a level, not a second surface.

## Consequences

- **Three taps for the most frequent action, at 3am.** The real cost, paid deliberately. The mitigations are the ones the fan already had: the Nappy row is nearest the thumb, the sub-line reads *pee or poop* so the extra step is never a guess, and both targets below are the same 54px pills.
- **The fan grew navigation rows**, so `Action.t` is now optional: *Back* is the one row that is not an entry type and wears no hue. Rows that move within the fan — *Back*, *Nappy*, and *She's awake* for its own reason — leave it open; every row that writes closes it.
- **Pee-and-poop in one change is still not offered**, and the level now has room for it. Logging both today means two rows, which is two nappies where there was one. Worth its own ticket rather than a quiet addition here.
- **[Issue 16](../../.scratch/baby-log-book/issues/16-logging-interactions.md)'s two-tap claim is history.** Its argument — that frequency deserves the shortest path — is what makes this a trade rather than a tidy-up, and the trade is with the fan's height, not with sheet chrome.
