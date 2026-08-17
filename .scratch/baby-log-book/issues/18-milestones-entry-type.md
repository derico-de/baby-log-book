# Milestones as an entry type

Type: grilling
Status: resolved
Blocked by: 05

## Question

A Milestone is a seventh entry type — first smile, first tooth, crawled, first word, first step. What exactly is it, and what stops it becoming a baby book?

Brought into scope by [Stats and CSV export](10-stats-and-export.md), which split the map's old *"photos, milestones, diary entries"* out-of-scope line: photos are an attachment story and diary entries are prose, but **a Milestone is a point in time with a label, which is what an [Entry](../../../CONTEXT.md) already is.** It is in v1 rather than v2 because milestones are unrepeatable — a first tooth that happened while the app could not record it is gone.

The boundary already set, and not up for re-litigation here: **one line of text at a point in time. No photo, no attachment, no prose.**

### Decisions to reach

- **The name.** A starter list plus free text was the working assumption. Which names are in the list, and is the list localised (EN/DE/RO) or free text in the Member's own words? A localised list and a free-text field storing whatever was typed are two different data shapes — a stored key versus a stored string — and CSV export, filtering and any future "first tooth at 7 months" figure all depend on which.
- **Is a Milestone occurrence-unique?** "First tooth" happens once; "new word" and "new tooth" happen repeatedly. Does the model care, or is uniqueness the parent's business the way [first exposure](05-domain-model.md) is derived rather than enforced?
- **Occurred At precision.** Milestones are frequently noticed rather than witnessed — "sometime last week". Does a Milestone carry a date rather than a timestamp, and if so, does that break the one-`entries`-table shape?
- **Where it is logged.** [Ticket 16](16-logging-interactions.md) settled the FAB fan, which is tuned for one-thumb 3am logging. A Milestone is logged in daylight, at leisure, and is not urgent — does it earn a place in the fan, or is it entered from somewhere calmer?
- **What CONTEXT.md gains.** A **Milestone** entry, and whatever the naming decision adds.

### Not in scope for this ticket

Photos and diary entries remain out of scope on the map. Milestone-specific presentation in the timeline belongs to [Timeline filtering and food history](19-timeline-filtering.md) and [Visual design direction](11-visual-design-direction.md).

### Input from [Visual design direction](11-visual-design-direction.md)

**A seventh entry type is free.** D1 was chosen partly *because* of this ticket: the two rejected directions both carried a colour-per-type taxonomy, and neither had room for a seventh colour. The settled direction identifies entry types by **glyph and label, never by colour** — the `--t-*` tokens all resolve to `--ink-2` — so a Milestone costs one glyph and nothing else. There is no palette to renegotiate and no argument from the visual system about whether Milestones belong.

The one thing it does need: a glyph that reads at 19px, in the same stroke-1.7 geometric family as the other six, and distinguishable from them in a dark room. That is a constraint on the naming decision only insofar as the concept has to be drawable.

## Answer

A Milestone is the **seventh entry type**, and it costs almost nothing: one row in the fan, one glyph, one string. Everything that could have made it expensive — a localised name taxonomy, a second catalogue entity, a date-only column, a stats card — was considered and rejected, each for a reason already load-bearing somewhere else on this map. Glossary entries for **Milestone** and **Milestone Name** are in [`CONTEXT.md`](../../../CONTEXT.md); the naming decision is [ADR-0011](../../../docs/adr/0011-milestone-names-are-written-not-chosen.md).

### The name is written, not chosen

**A free-text string, stored as typed, in a combobox suggested from the names this Household has already used** — plus ten localised starter suggestions that are UI text and nothing more.

The ticket asked for a stored key versus a stored string. The answer is the string, and the argument that settled it is that **a Milestone Name is structurally a [Food](05-domain-model.md)**: a name someone typed, reusable, household-grown, and nobody ever proposed a localised carrot. Food's combobox behaviour comes across whole — type it, pick it if it exists, create it if it doesn't.

**What does not come across is the catalogue.** This is the one place Milestone and Food genuinely differ, and it is worth stating because the codebase will show one with a catalogue and one without. A Food repeats *constantly* — "carrot" lands in forty Meals — and that reuse is both what pays for a mutable entity and what makes its identity load-bearing, since first exposure is derived by matching that Food across Meals. **A Milestone name repeats once per Baby, if that.** You type "first tooth" one time. So the suggestion list is **derived from the Milestones themselves**, not stored: it cannot drift, which is ticket 05's exact argument for deriving first exposure rather than flagging it. Correct a typo on the entry and the bad suggestion goes with it; a catalogue would have kept the orphan.

Accepted cost: **a mixed-language Household stores mixed-language names**, since presets freeze into whichever language picked them. Inherited from Food rather than invented, and recorded in the ADR.

### It stays an instant, and the display drops the precision

Milestones are noticed rather than witnessed — "sometime last week" is the normal case — which is the ticket's argument for a date rather than a timestamp. **Rejected.** A date-only field would be the only value in the system that is not an instant, breaking [ADR-0010](../../../docs/adr/0010-instants-are-stored-the-zone-is-a-lens.md)'s invariant, and it would need its own bucketing rule, its own export shape and its own column outside the shared `occurred_at` — so it would also break the one-`entries`-table shape the ticket worried about.

Instead the precision is dropped **where ADR-0010 says to drop it, at display**: the timeline renders a Milestone with **no clock time**. Which leaves the question of what instant a back-dated Milestone actually gets, since the timeline is time-ordered and the row lands somewhere:

- **Dated today** → the moment of logging.
- **Back-dated** → the **Day Start** of that date, so it sits at the head of its day.

A bare "now" projected onto last Tuesday would wedge the row between two feeds for a reason nobody can see, since there is no time on it to explain the position. A two-branch picker default has precedent — [ticket 16](16-logging-interactions.md)'s picker defaults to her usual wake time rather than to now.

### It earns a slot in the fan

**Appended after Measurement**, making six.

The instinct was to keep it out: the fan is tuned for 3am one-thumb frequency and a Milestone is logged in daylight a handful of times a year. **That argument is already dead** — Measurement holds the last slot and is just as rare, so frequency is not the fan's admission test. And the alternatives are worse: v1 has exactly three destinations ([ticket 11](11-visual-design-direction.md)), Settings is not content, and inventing a baby-profile screen for a monthly action is far more furniture than one row. The fan expands upward, so a sixth row at the far end costs Pee and Poop nothing.

### It keeps the Note

Every Entry takes one — ticket 05 calls it "the pressure valve that lets the rest of the model stay narrow" — and on the one type whose stated boundary is *no prose*, a second free-text field looks like the crack. It stays anyway, because **the boundary is held by what is absent**: no photo, no attachment, no rich text, no dedicated milestone screen, no sharing. Amputating a field all six siblings have would make Milestone the sole special case in a model that deliberately has none. What does the enforcing is the input control: **a single-line field, not a textarea.**

### Uniqueness: the model does not care

"First tooth" happens once, "new word" and "new tooth" repeat by design, and **the model cannot tell them apart** without a per-name flag — which is the stored key rejected above. So enforcement or even a soft warning would be right on the firsts and wrong on every repeat, nagging someone at the moment they log a happy thing. Derivable by exact string match if anything ever wants it; enforced by nothing. Same posture as first exposure.

### The starter suggestions

Ten, in rough chronological order, translated 3×, pure UI text:

> First smile · First laugh · Rolled over · Sat up unaided · First tooth · Started crawling · Pulled to stand · First steps · First word · Waved

Two deliberate omissions. **"Slept through the night" is out** — the app holds every Sleep, so it would be a hand-typed claim sitting beside the real data that either confirms or contradicts it. And **no ages are attached and the list is not filtered by the Baby's age**, though the birth date is right there: the ordering is a convenience, and the moment it reads "crawling: 7–10 months" a logging app has become a developmental schedule that tells a parent their nine-month-old is late. Cheapest thing in the ticket to revise.

### Consequences for settled tickets

- **[Stats and CSV export](10-stats-and-export.md) — no Milestone card, which is a real carve-out.** Read mechanically, that ticket's rule (*a card appears when its entry type has data*) grows a fifth card. But the stats screen's unit of meaning is a **rate** — feeds per day, hours slept — and a milestone has no rate. The card would read "1 this week, ▼2 vs last week", which is noise in a good week and quietly bleak in a normal one, and a normal week is zero. That collides with the same ticket's reason for excluding today from the delta: it refused to let the screen report decline when nothing is wrong. **The rule is restated as: cards appear for entry types that have a rate.** Four cards stand. The CSV export gains a seventh per-type file, which falls out of the zip shape unchanged.
- **[Visual design direction](11-visual-design-direction.md) — the glyph is a flag.** With every `--t-*` token resolving to `--ink-2`, the silhouette does all the work and there is no colour to lean on. A flag is literally the marker on a milestone, survives 19px in a dark room as a line and a triangle, and nothing else in the set of seven is that shape. Star reads as *favourite* or *rating*, sparkle blurs at stroke 1.7, footprint is organic in a geometric family, trophy imports a competitive tone this app should not have. **Follow-through for the spec:** `design/tokens.css` gains `--t-milestone`, resolving to `--ink-2` like its six siblings.
- **[Timeline filtering and food history](19-timeline-filtering.md)** inherits two constraints rather than questions: a Milestone row shows **no clock time**, and a back-dated one sits at its day's head. Whether Milestones are a filter facet of their own is still that ticket's call.

