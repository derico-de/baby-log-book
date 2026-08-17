# Domain model and entry taxonomy

Type: grilling
Status: resolved

## Question

What are the entities, and what exactly is an entry?

This is the spine of the map — most other tickets are blocked on it. Run `/grilling` and `/domain-modeling`; the output includes the repo's first `CONTEXT.md` glossary and an ADR for the modelling decision.

### Decisions to reach

- **Household, Baby, Member** — the container entities, and how a Member relates to a Household (roles: owner, caregiver).
- **One entry supertype or a table per type?** A single `entries` table with a discriminator and a JSON payload keeps sync trivially uniform; separate tables give real columns and real constraints. This choice ripples straight into the sync protocol and the CSV export.
- **Sessions vs point events.** Feeds and sleeps have a start, possibly an end, possibly still running. Nappies and measurements are instants. Is "has a duration and may be open" a property of one entry type, or a separate concept?
- **Feed subtypes** — breast (side, duration), bottle (ml), solids (food item, amount?). Are these one type with variants, or three types?
- **Nappies** — pee, poop, or both; is consistency or colour worth recording, or is that scope creep?
- **Measurements** — weight, height, and possibly head circumference (the paediatrician records it; the brief doesn't mention it).
- **Food catalogue** — household-built list of foods, with **first exposure** per baby and an optional free-text reaction note. How does a catalogue item relate to a solids entry?
- **Edit history** — corrections are visible ("edited by Papa, was 120ml"). Is that a generic revision trail on every entry, or a per-entry-type concern?
- **Soft delete** — required for sync (tombstones), and it interacts with the owner-only delete rule.
- **Which day does an entry belong to?** **Settled**: a **configured day-start time**, so a 01:30 feed belongs to the previous day. It is a fixed hour the user sets, not midnight and not derived from the first feed — which means no floating boundary, no fallback for feed-less days, and no retroactive re-bucketing when a forgotten early feed is added later. The setting itself lives in schedule settings and belongs to the [schedules ticket](09-schedules-v1.md); this ticket only needs the model to attribute an entry to a day using it.
- **Timezone and travel handling** may graduate out of this ticket into its own — what a stored timestamp is anchored to, and what a fixed local day-start time means after crossing timezones.

### Out of bounds

Health events, photos, and milestones are out of scope for this map — see the map's Out of scope section.

## Answer

The glossary is now at [`CONTEXT.md`](../../../CONTEXT.md); the two decisions worth their own record are [ADR-0001](../../../docs/adr/0001-single-entries-table.md) and [ADR-0002](../../../docs/adr/0002-append-only-revisions.md).

### The entry types

Six shapes: **breast feed**, **bottle feed**, **meal**, **sleep**, **nappy**, **measurement**.

- **Feed and Meal are separate concepts that share one timeline.** The machinery differs — a bottle has millilitres, a meal has Foods — but the parent's question is "has she eaten", so the home screen answers it from both. In the UI this is a single entry point with a Breast / Bottle / Food switch that reveals only the relevant fields.
- **Breast feed** records the side (left, right, both) and duration. Not per-side timers — too fiddly one-handed, and the data rarely gets used.
- **Bottle feed** records volume and what was in it.
- **Meal** holds several Foods, each with an optional reaction note. Coarse amounts (tasted / some / lots), never grams.
- **Sleep** records start and end and nothing else. Nap versus night follows from the Day Start rather than being stored.
- **Nappy** records pee / poop / both, with optional consistency. The single-tap path stays single-tap.
- **Measurement** covers weight, height and head circumference, all optional, entered together behind one action.
- **Every Entry takes an optional free-text Note**, behind an icon so it costs no space in the common path. It is the pressure valve that lets the rest of the model stay narrow.

### Feeds are anchored by their start, sleeps by their end

The asymmetry is the important finding of this ticket.

**Nothing downstream depends on when a Feed ended.** The interval to the next feed is measured from the previous feed's *start*, so a Feed's end is optional detail and a forgotten stop is harmless. **A Sleep's end is the whole point** — without it there is no duration, and sleep duration is most of what the stats exist to show.

That splits Stale Session handling in two: a Feed left running needs nothing, while a Sleep left running corrupts the data it was meant to capture, and needs recovery. See the [schedules ticket](09-schedules-v1.md) for the interval rule and the new [bottle freshness ticket](15-bottle-freshness.md) for the other thing a start time turns out to anchor.

### Representation

- **One `entries` table**, type discriminator, shared columns, JSON payload for type-specific fields — see ADR-0001. The Food catalogue is separate, mutable, household-scoped reference data that syncs alongside it.
- **Append-only revisions, permanent soft deletes** — see ADR-0002.
- **A Live Session is an Entry with no end time.** Not a separate concept, so a running timer syncs to everyone's device like any other row, and the duplicate-open-session merge rule is an ordinary rule about rows.
- **First exposure is derived**, not stored — the earliest Meal containing that Food for that Baby. A stored flag would drift the moment an entry is corrected, deleted, or a forgotten earlier meal is added, and it would lie about precisely the thing you'd consult it for. The reaction note is observed information and *is* stored, on the Food line within the Meal.
- **A Member may belong to several Households.** Cheap now, painful to retrofit, invisible until a grandparent has grandchildren in two families. The v1 UI assumes one and grows a switcher only when a second appears — the same treatment multi-baby got. This is not the multi-household *sharing* ruled out of scope, which was one Baby visible to two Households.
- **Canonical units** — millilitres, grams, millimetres — stored raw, formatted at display. Keeps unit handling out of the sync and stats paths.
