# Bottle freshness

Type: grilling
Status: closed — out of scope
Blocked by: 05

## Question

A bottle that has been started has a limited safe life. How does the app tell you whether the one on the table is still good?

New requirement — not in the original brief. It surfaced from the observation that a Feed's start time anchors more than just the next feed.

### Why this needs care

This is health-adjacent. The app would be telling a tired parent whether milk is safe to give a baby, and the real-world thresholds differ by what is in the bottle (infant formula, expressed breast milk, previously frozen, cow's milk), by whether it has been refrigerated, and by which health authority you ask — NHS, WHO, CDC and AAP do not all say the same thing. We should not invent numbers, and we should be careful about the difference between reporting elapsed time and issuing a verdict.

The bottle contents are already recorded on a bottle feed, so the model has what it needs to distinguish cases.

### Decisions to reach

- **How much does the app assert?** (a) Neutral elapsed time only — "started 1h20m ago" — leaving the judgement to the parent; (b) household-configurable thresholds with defaults from a named guideline, showing a state such as fresh / use soon / past it; (c) hard-coded thresholds. Leaning (b), with the source visible in settings, and phrasing that reports the household's own threshold rather than making a medical claim.
- ~~**When does the clock start?**~~ **Settled: out of scope.** The clock starts at the feed start. Preparation time is not modelled — a bottle prepared earlier than it was offered is the parent's judgement to make, not the app's. This means the indicator can read younger than the milk actually is, which is a deliberate limitation and should shape how assertive the display is allowed to be.
- **Which contents get a rule?** Formula, expressed breast milk, thawed breast milk, cow's milk — each has different guidance, and some may be better left with no indicator at all.
- **Where does it appear?** On the running feed, on the home screen, or only when you go looking.
- **What happens after the threshold?** Does it stop counting, change appearance, or say something.
- **The refrigeration question** — a bottle put back in the fridge and returned to later breaks any simple elapsed-time rule. Decide whether that case is modelled or explicitly ignored.

### Likely to split off

The actual threshold values must come from primary sources rather than memory. Expect a research ticket for the guideline numbers once the shape above is settled.

## Closed — out of scope

**The app does not track milk freshness. A Feed records when it started, and that is all a start time is for.**

Ruled out by the user during grilling, before the threshold numbers were researched. This is a scope call rather than a decision on the route, so it is recorded in the map's **Out of scope** section and not in Decisions so far.

### What the grilling had settled before the scope call

Kept for the record, because if freshness ever returns it returns as a fresh effort and this is the shape it had reached:

- **It would have been a third Target** — one stated number, elapsed-vs-target, nothing materialised, exactly like Feed Interval and Wake Window under [ADR-0006](../../../docs/adr/0006-targets-are-stated-not-learned.md). No new machinery, and no medical claim: the app counts against a number a Member typed.
- **No Bottle entity.** A Bottle with its own lifecycle — prepared, offered, refrigerated — would have made the clock exact, but it is a second thing to create and link one-handed at 3am, which fails the constraint that has decided every UI question on this map.
- **Which made the clock systematically optimistic.** Feed-anchored, it always reads *younger* than the milk really is and never older: the same bottle finished across two Feeds restarts at zero, and a fridge round-trip is not modelled. The error is always in the unsafe direction. That is the strongest argument the grilling produced, and it argues for the feature's absence as much as for its shape.
- **No new fields on a Bottle Feed**, and the indicator would have been neutral throughout — no warning colour, so [`design/tokens.css`](../design/tokens.css) keeps its one-hue discipline.

### What this closure does *not* touch

- **Feeds are still anchored by their start** ([Domain model](05-domain-model.md)). Nothing about that changes; freshness was one thing a start time was thought to anchor, and it turns out a start time anchors only the Feed Interval.
- **The precedent from [Logging interactions](16-logging-interactions.md)** — *the app reports, the parent judges* — is untouched and still stands on its own for stale sleeps. It no longer has a second application waiting on it.
- The `## Question` body above is left as written, including the already-settled preparation-time exclusion, so the reasoning is legible to anyone who reopens this.
