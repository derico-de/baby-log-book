# Schedules in v1: targets and elapsed-vs-target

Type: grilling
Status: resolved
Blocked by: 05, 08

## Question

What is a "schedule" in v1, given that notifications are v2 and this must be useful with no push infrastructure at all?

### Decisions to reach

- **Interval or clock time?** "Every 3 hours" and "08:00, 11:00, 14:00" are different mental models. Newborns run on intervals; older babies drift toward fixed times. Support one, or both?
- **Which activities?** Feeds and sleeps, per the brief. Anything else worth a target?
- **Per baby, per household, or per age?** Are there sensible age-based defaults, or does the parent always set it?
- **What is shown** — elapsed since last, target, and something like "due in 20 min" or "40 min overdue". How does overdue read without being alarming? This app should not nag a tired parent.
- **What counts as "last"?** **Settled for feeds**: the interval to the next feed is measured from the previous feed's **start**, never its end. Still open for sleep — an open Sleep means the baby is asleep right now, so does the feed clock keep running, pause, or reset on wake?
- **Does a schedule ever create expected entries**, or is it purely a display-time computation over the log? Strong preference for the latter; confirm.
- **What v2 needs** — the notification layer will fire off these targets. Make sure the v1 model carries enough that v2 is additive rather than a rewrite.
- **The day-start time lives here.** Settled: the day boundary is a configured hour rather than midnight, and schedule settings is its home. Still to decide: its default, whether it is per household or per baby (a newborn and a three-year-old do not start their days together), and what happens to already-displayed stats when it changes — past days re-bucket, which is predictable but should be a deliberate choice rather than a surprise.

## Answer

A schedule in v1 is **one number per activity per Baby, and no machinery**. New glossary terms — [Target, Feed Interval, Wake Window, Nap, Night Sleep, Sleep Feed](../../../CONTEXT.md) — and one decision worth a record, [ADR-0006](../../../docs/adr/0006-targets-are-stated-not-learned.md).

### The model

- **Intervals only, with two different anchors.** The **Feed Interval** runs from the previous Feed's *start* (already settled by the domain model); the **Wake Window** runs from the last Sleep's *end*. The sleep target is not "she sleeps every 3h" — it is how long she stays comfortably awake, which is a different anchor, and getting that wrong would have made the sleep number useless. A Target stores a duration plus the anchor it measures from, so clock-time schedules ("nap at 12:30") can be added later as a second anchor kind; they are the older-baby model and do not earn their keep in v1.
- **Feeds and sleep only.** Nappies keep the plain count already in the sticky header and get no target — "no wet nappy in 6 hours" is a real signal but a health one, and it is the one target that would genuinely alarm. Nothing on measurements.
- **Targets are per Baby. Day Start is per Household.** Two babies of different ages share no interval, but they must share a day boundary, or "yesterday" means two things inside one Household and the timeline, the stats screen and the CSV export each need a per-baby lens.
- **Targets are stated, not learned** — see ADR-0006. Seeded once at Baby creation from an age table, never re-derived, never averaged from the log. Schedule settings renders the current band's typical value as a **static hint beside the field** (`typical at 3 months: 2h`), which needs no state, no dismissal flag to sync and never appears on the home screen.
- **Nothing is ever materialised.** No expected Entry is written; every due figure is a display-time fold over the log. This is the same principle ticket 16 set — *the app never writes data nobody entered* — and an expected-feed row would have to be swept up when the real feed landed and would pollute every stat that counts rows.

### The age table

Seeds only. Feed Interval: **3h** to 3 months, **3h30** to 6 months, **4h** to 12 months, **none** after — solids take over and a feed target stops meaning anything. Wake Window: **45m / 1h15 / 2h / 2h30 / 3h / 4h** across 0–1, 1–3, 3–6, 6–9, 9–12 and 12–18 months, **5h** beyond.

### What the header shows

Building on variant D's structure, which fixed the slots before the Wake Window existed.

- **Dominant**: `since last feed 2h10` / `next due in 50m`.
- **Quiet line**, swapping on state: `awake 1h20 · down after 1h30` when she is up, `asleep 1h05` while a Sleep runs — the Wake Window is simply not shown when it cannot apply. Nappy count stays on that line.
- **Empty state**: no Feed logged yet means no elapsed figure and no due figure. Never compute a due instant from nothing.
- **Overdue shifts colour once and never again.** The due line inverts to `50m overdue`. No second colour, no red at 2h, no badge — escalation is nagging with extra steps. Same treatment for the Wake Window, since knowing you have run past it is the whole point of having one.
- **Past 24h, elapsed is replaced by the absolute time** (`last feed yesterday 14:05`). Beyond a day the figure has stopped being a number anyone reads.

### The feed clock does not pause for sleep

`since last feed` keeps counting while a Sleep runs, and still shifts colour when it goes past the Target. A Baby who has slept three hours still has not eaten for three hours — precisely the fact the app was opened for, and plenty of newborns are woken to feed. Pausing would make the number lie in the one situation where it matters most.

### Nap versus night, from one boundary

`CONTEXT.md` claimed nap-vs-night *follows from the Day Start*, but a single hour cannot classify both ends of a night — a 20:00 Sleep is after the Day Start, and no rule over one boundary separates it from a 14:00 nap. **The Night Sleep is the one that crosses the Day Start; every other Sleep is a Nap.** It matches how people talk — "she slept through" means through the boundary — and it avoids a **Night Start** setting nobody wants to configure. The cost is one accepted misfiling: a 19:00 bedtime that collapses at 23:00 is recorded as a Nap.

### Day Start

- **Default 05:00.** The job is keeping the whole night on one side of the boundary. Later than about 06:00 and a genuine 05:30 wake-for-the-day is filed under yesterday; earlier than about 04:00 and a 04:30 night feed opens a new day mid-night.
- **Changing it re-buckets the past, and the settings screen says so before saving.** Bucketing is derived at display time; stamping a day onto each Entry at write time would freeze history against a setting that exists to be a lens, and would put two incompatible day definitions inside one stats view.

### Stale Session: the threshold ticket 16 parked here

ADR-0006 kills *1.5× her usual*, and no flat number works either — 5h fires at 1am on every real night sleep of a six-month-old, and at 20:00 you cannot yet tell a forgotten evening nap from bedtime without the Night Start setting we just refused.

**Reframed instead.** Ticket 08 already makes a running session visible from anywhere on every Member's device — *that* is the primary defence and it works continuously. The banner is only the backstop for when nobody noticed, and a backstop can afford to be late. What it cannot afford is crying wolf nightly.

- **A hidden, age-banded ceiling**, not editable and never shown: **8h** under 3 months, **11h** at 3–6 months, **13h** after. These are "no baby sleeps this long" figures, not averages, so a celebrated first 8-hour night draws nothing.
- **Plus one sound contradiction: a Meal.** You cannot spoon solids into a sleeping Baby. It catches the forgotten afternoon nap of an older baby the same day, which is exactly the gap a 13h ceiling leaves.

**Rejected: a Feed as the contradiction signal**, which is where this ticket first went. A Feed overlapping a Sleep is a [Sleep Feed](../../../CONTEXT.md) — breast or bottle taken without waking — and it is normal, deliberate and nightly. Triggering on it would have fired a false banner on the single most common night pattern in the app. Nappies are excluded too: changing a sleeping baby is routine.

### Sleep Feed, and what the fan does about it

The correction above turned out to reach the logging surface. **While a Sleep runs there is no ambiguous "Feed" in the FAB fan** — extending the state-swap ticket 16 already has, where *Sleep* becomes *She's awake*.

- **She's awake** ends the Sleep, and the fan **reflows in place** to the awake set, so wake-then-feed is one FAB open and three taps rather than two separate trips.
- **Feed while asleep** logs the Feed and leaves the Sleep running.
- **Rejected: a third combined "She woke to feed" item.** Fewest taps, but three near-synonymous labels in one fan is the same 3am discrimination problem that got the long-press thrown out.
- **Picking Food inside the asleep sheet switches her to awake.** Solids and sleep are mutually exclusive, so the switch *is* the statement: the sheet becomes the ordinary feed sheet and a quiet inline line reads *"marked awake from 14:05"*. No modal, no confirm — it is a real write so it is visible, and undo covers it. The Sleep ends at the Meal's Occurred At as one ordinary revision with **no lasting linkage**; later corrections to either are independent. **Guard**: only when that Occurred At falls inside the running Sleep. A back-dated Meal predating the Sleep is "she ate, then went down" — leave the Sleep alone.
- This makes the Meal contradiction above a genuine backstop: caught at log time through the fan, so the banner fires only for meals entered manually after the fact.

**No schema change for any of it.** A Sleep Feed is *derived* from the overlap, the way first exposure is derived — which also covers the manual path, where a corrected Feed can land inside a Sleep without passing through the fan. `since last feed` does reset on a Sleep Feed, because a real Feed was logged, and awake time stays "time not covered by a Sleep", so a Sleep Feed does not make her awake.

### Correction to a resolved ticket

[Sync protocol](06-sync-protocol.md) read "any two open sessions for the same Baby are a contradiction", and `CONTEXT.md` defined Session Merge the same kind-agnostic way. Taken literally, a Sleep Feed would tombstone one of the two sessions. The trailing clause showed per-kind was the intent, but the wording did not say so. **Both amended: the merge is per kind**, with sleep feeding recorded as the reason so nobody re-derives the loose version.

### What v2 inherits

**No schema.** A duration plus an anchor is enough to compute a due instant, and ADR-0003 already syncs Targets as revisions so every Device computes the *same* instant without coordinating. Two constraints instead: the due-instant computation lives in **one shared module** the header calls, so the future notifier calls the same function rather than reimplementing it; and notification preferences will be **Device-scoped**, which needs no v1 work but does mean not hanging a `notify` flag off Member now. The Meal contradiction and the age-banded ceiling hand v2 its forgotten-sleep notification for free.
