# Timezones and travel

Type: grilling
Status: resolved
Blocked by: 05, 09

## Question

What is a stored timestamp anchored to, and what does a fixed local Day Start hour mean once a Household crosses timezones?

Graduated from the map's fog by [Schedules in v1](09-schedules-v1.md), which made the Day Start fully concrete — per Household, a fixed hour, applied as a display-time lens — and in doing so made this question sharp enough to state. The domain model deliberately deferred it.

### Decisions to reach

- **What does Occurred At store?** A UTC instant, a local wall time, or an instant plus the offset it was recorded at. The third is the only one that can render "she fed at 02:00" correctly *and* order the log correctly, at the cost of a wider column.
- **Whose zone is the Day Start's hour in?** A configured Household zone, or whatever zone each Device is currently in. These diverge the moment one Member travels.
- **Travel.** The family flies somewhere for two weeks. Do days re-bucket for everyone, only for the travellers, or not at all? The Day Start is deliberately per Household, so a split answer means "yesterday" fractures — which is the exact failure that decision existed to prevent.
- **The grandparent abroad.** A Member on a Device in another country reads the timeline. Do they see the Household's days or their own?
- **DST** — the hour that happens twice and the hour that never happens. What a Day Start landing in either does, and what it does to a Sleep that spans the change.
- **Does a zone change re-bucket history**, the way a Day Start change already does? And does the CSV export carry the zone, or does it export wall times that cannot be reconstructed?
- **[ADR-0004](../../../docs/adr/0004-cursor-is-not-the-merge-key.md) interaction.** The merge key is a corrected client clock, and the skew guard is one-sided. Confirm a device that changes zone is not read as skew.

### Input from [Visual design direction](11-visual-design-direction.md)

**Local time now has a second consumer, and it is the visible one.** [ADR-0008](../../../docs/adr/0008-appearance-follows-the-clock.md) drives the app's appearance off the Device's local wall clock — deep night from 23:00 until the [Day Start](../../../CONTEXT.md), no light mode after 19:00. Whatever this ticket decides a "local hour" means has to serve both bucketing and appearance.

The two fail differently, which may pull them apart:

- A Day Start in the wrong zone puts a feed in the wrong day — wrong, but quietly, and correctable later because bucketing is derived at display time.
- An appearance in the wrong zone means a **white screen in a dark bedroom in Bucharest**, immediately, at the one moment the app exists for. It is the more sensitive of the two consumers and cannot wait for a replica to sync — the resolver runs before first paint, off whatever the Device itself believes the hour is.
- So "the Household's zone wins" may be right for Day Start and wrong for appearance. If the answers diverge, say so explicitly rather than letting one setting quietly serve both.

## Answer

**An instant is the only thing the app ever compares; a zone is a lens applied at display time.** Everything below follows from that one line. New glossary terms — [Household Zone, Recording Zone](../../../CONTEXT.md) — amendments to **Day Start** and **Occurred At**, and one decision worth a record, [ADR-0010](../../../docs/adr/0010-instants-are-stored-the-zone-is-a-lens.md).

### What is stored

**`Occurred At` is a UTC instant plus the IANA zone id the recording Device was in** — `Europe/Berlin`, not `+02:00`. A numeric offset is a dead number: it renders one wall time back and cannot tell you what `05:00` means in that place on any other date, so it can never re-derive a Day Start. A zone id regenerates the offset; an offset never regenerates the zone.

The zone is set at creation from the creating Device and **a Revision never rewrites it** — Oma correcting a German Feed from Bucharest does not restamp it with Romania.

**Nothing in v1 reads it.** That is deliberate and is the whole justification: the Recording Zone is *unrecoverable if not captured*, so it is written down even though the v1 lens ignores it — the same argument that pulled Milestones into v1 in [Stats and CSV export](10-stats-and-export.md). It is what lets the travel refinement arrive later without a migration over every Entry ever logged.

### What is rendered

**One configured Household Zone, and it is the single lens** for bucketing, the timeline, stats and export. [Schedules in v1](09-schedules-v1.md) made Day Start per Household because otherwise *"yesterday" means two things inside one Household* — and that argument does not care whether the split comes from two babies or two zones. A per-Device or per-Entry lens reintroduces exactly the fracture that decision existed to prevent.

- **One value, not a history.** Changing it re-buckets the past, and the settings screen says so before saving — identical to the Day Start change it sits beside. The Day Start *hour* is untouched by a zone change; 05:00 stays 05:00.
- **Suggested, never applied.** An Owner's Device reporting a different zone **on every sync for 48 hours** prompts once, dismissibly, and never again for that zone. A layover must not move a Household, and the app does not nag.
- **First boot**: the claiming Device's zone, the same bootstrap shape the first Claim Link already has.
- **Rejected: printing each Entry's clock face in its own Recording Zone** while bucketing by the Household Zone. It sounds like the best of both and is not — printed times inside one day group stop being monotonic, `20:00` then `03:00` in the same bucket.

**Travel** therefore has an explicit answer: the family in Boston for two weeks either changes the Household Zone on arrival — prompted, re-bucketing history, changing it back on return — or accepts days cut at 23:00 local. **The grandparent abroad** reads the Household's days, because she is reading about a Baby who lives in Germany.

### The hour travels; the zone does not

The two consumers of "a local hour" **diverge, deliberately** — [ADR-0008](../../../docs/adr/0008-appearance-follows-the-clock.md)'s open question, answered.

**Appearance always reads the Device's own clock.** It answers *is it dark in the room I am standing in*, and only that Device knows; it must also resolve before first paint with no replica necessarily synced. Coupling it to the Household Zone would give Oma in Bucharest a **white screen in a dark bedroom at 23:30** because it is 22:30 at home — precisely the failure ADR-0008 exists to prevent.

So the Household's Day Start is read as **a number, not an instant**, by the appearance resolver: `05:00` is where deep night ends on *whatever* local clock the Device has. Bucketing uses the same hour resolved *in the Household Zone*. One setting, two consumers, and it is now stated which is which rather than left to serve both quietly.

### DST

- **Resolving the Day Start** when its nominal hour is skipped → the instant the clock jumps to; when it happens twice → the **first** occurrence. Deterministic, and the boundary stays monotone.
- **Every duration is elapsed real time, never a wall-clock subtraction.** A Sleep from 23:00 to 07:00 across spring-forward is **7 hours**, because the Baby slept 7 hours. Same for `since last feed`, the Feed Interval and the Wake Window.

With a 05:00 Day Start and transitions at 02:00/03:00 the resolution rule almost never fires. It exists so the behaviour is defined rather than accidental when a Household sets Day Start to 03:00.

### The invariant, and [ADR-0004](../../../docs/adr/0004-cursor-is-not-the-merge-key.md)

**A zone change does not read as clock skew.** The merge key is an instant; `Date.now()` does not move when a phone changes zone, and a DST transition does not move it either. The one-sided sanity window fires on a wrong *clock*, never on a zone.

What keeps that true is worth stating as a rule rather than a reassurance, because it is the one thing a future implementer could break silently — the bug would appear twice a year and on every flight:

> **Anything used for ordering, merging, the cursor, or a duration is an instant. Local wall time is a display-time projection and never enters a comparison.**

### Export

[ADR-0007](../../../docs/adr/0007-export-is-an-escape-hatch.md) fixed the Export as everything, raw, no options, a zip of per-type CSVs. Timestamps go out as **one ISO-8601 column carrying its offset** (`2026-08-16T02:14:00+02:00`) — unambiguous and still human-readable — **plus an `occurred_at_zone` column** with the IANA id, since an offset cannot regenerate a zone. No local-wall-time-only column, ever.

Beyond the columns: **a day bucket is derived, never stored**, so an export carrying entries but not the lens exports numbers whose meaning is gone. The zip gains a small **`household.csv`** with the Household Zone and the Day Start hour, so whoever opens it in five years can re-cut the days the way the app did.
