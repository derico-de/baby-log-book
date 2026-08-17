# Stats and CSV export

Type: grilling
Status: resolved
Blocked by: 05

## Question

What does the stats view show in v1, and what exactly comes out of the CSV export?

Both are read-side concerns over the full local replica, which is why they share a ticket.

### Stats decisions

- **Which numbers?** Candidates: feed count and total volume per day, sleep total and longest stretch, night vs day sleep split, nappy counts by type, time between feeds.
- **Which granularities in v1?** Daily and weekly were the working assumption; monthly and yearly are v3.
- **Computed where?** Client-side over the local replica means stats work offline and need no endpoint. Confirm, and check it holds for a year of data on an old phone.
- **Charts or numbers?** A sparkline or bar per day is cheap; real charting is a dependency and a v3 concern (growth curves).
- **Partial days** — today is incomplete and an open sleep session has no end yet. How do they count?
- **The day boundary** — inherits whatever the domain model decided about which day a 01:30 feed belongs to.

### Export decisions

- **Shape** — one wide CSV, or one file per entry type in a zip? Entry types have genuinely different columns.
- **Columns** — including who logged it, when it was edited, and the raw timestamps.
- **Headers** — localised to the user's language, or stable English for machine readability? These conflict; pick one and say why.
- **Scope** — whole household, or per baby and date range?
- **How it is produced** — from the local replica in the browser, or a server endpoint. The former works offline; the latter is easier to get right for large exports.

## Answer

Two read-side surfaces that turned out to want opposite things, plus a scope change: **Milestones come into the model**, and the ticket's own framing of "stats" gets narrowed.

One decision earned a record — [ADR-0007](../../../docs/adr/0007-export-is-an-escape-hatch.md).

### Stats is a trend screen, and only a trend screen

The home screen already answers *when did she last eat*; the timeline already answers *what happened yesterday*. The only question left for a stats screen is **is this getting better** — reassurance, not reporting and not handover. That framing did most of the work below, and the paediatrician's question ("how much is she taking?") falls out of a trend screen for free, so it needs no second surface of its own.

**The screen is per Baby**, with the selector appearing only when a second Baby exists — the same treatment multi-baby gets everywhere.

**Four cards, and a card appears only when that entry type has data in the window:**

1. **Sleep** — total per day, split Night Sleep vs Naps, which is computable only because [Schedules](09-schedules-v1.md) settled that the Night Sleep is the one crossing the Day Start. Longest stretch as the secondary number.
2. **Feeds** — count per day, with total volume as a secondary number **only when bottles exist**. Volume cannot be the primary bar: a breastfed Baby has no millilitres, so a volume chart is empty for a large fraction of users.
3. **Nappies** — count per day, split pee/poop.
4. **Solids** — Meals per day, with "3 new Foods this week" as the secondary number, derived from first exposure.

Data-presence gating means a newborn's screen has no Solids card and an older Baby's Feeds card quietly stops being the headline — **no age logic, no settings, no empty states**. **Milestones get no card**; they are not a trend.

**Dropped from the ticket's candidate list.** *Time between feeds* is `24h ÷ feed count` and the live version already sits in the header. *Growth* is the v3 chart ticket, not a v1 card.

### The window: eight bars, seven of which count

**A rolling seven days, with no controls at all.** Each bar is a day, so "daily and weekly granularity" is one view rather than a switcher — a Day view would be a single bar, which is the timeline with arithmetic on top. Rolling rather than calendar also dodges a genuine i18n trap: calendar weeks start Monday in DE and RO, and a stats screen that disagrees with itself across languages is an endless bug.

**Today is drawn as an eighth, visibly in-progress bar, and is excluded from the delta**, which compares the seven complete days against the seven before them. Including a half-finished day in the comparison would tell you every single morning that things are getting worse — the exact opposite of what the screen is for. Everything the delta is computed from is visible on screen.

**A running Sleep counts up to now**, so the bar grows live. Ignoring it would show a Baby napping right now as having slept less than she has, and the figure would jump when someone finally pressed stop. One rule covers both cases: *show the truth so far, keep it out of the comparison.*

**No navigation to earlier weeks in v1.** Browsing history is the v3 monthly/yearly question, and inventing that navigation now means inventing it twice.

### Computed client-side, nothing cached

Every figure is a fold over the local replica, recomputed when the screen opens — the same shape as the header's due figures. A year is roughly 7,300 entries and under 2 MB, which folds in milliseconds, so there is no performance argument for either a server endpoint or a materialised `daily_totals` table. That table is also the thing [ADR-0006](../../../docs/adr/0006-targets-are-stated-not-learned.md) already refused: **nothing is ever materialised.** If it ever does get slow, the fix is an in-memory memo keyed on the last revision seq — still not a stored table.

Day Start re-bucketing follows for free: bucketing is a display-time lens, so changing the Day Start re-buckets the stats screen exactly as it re-buckets the timeline.

**Bars are hand-rolled, with no charting dependency.** Eight bars with no axes, tooltips or zoom is not a charting problem, and the [CSS decision](02-css-framework.md) already committed to owning our tokens rather than importing someone's visual language. **Every card states its numbers as text, with the bars as the secondary read** — at 3am a shape you have to interpret is worse than a sentence, and it is the accessible version for free.

### Export is an escape hatch, not a backup

The export exists because this is self-hosted and the data is yours: complete, raw, nothing summarised away. It is explicitly **not** a re-importable backup — see [ADR-0007](../../../docs/adr/0007-export-is-an-escape-hatch.md). The real backup is the SQLite file on the volume.

- **A zip of one CSV per entry type, plus the reference tables**: `sleeps`, `breast_feeds`, `bottle_feeds`, `meals` + `meal_foods`, `nappies`, `measurements`, `milestones`, and `babies`, `members`, `foods`, `targets`, `revisions`. The decisive argument is not sparse columns — it is that **a Meal holds several Foods and therefore does not fit one row**. The two escapes are both wrong: repeating the Meal across N rows corrupts every count in the file, and stuffing a list into one cell is no longer CSV. Cost is one ~8 KB zip library in the browser.
- **Everything, always, no options.** One button, all Babies, all time, whole Household. A filtered export is not an escape hatch, the `baby_id` column is there for anyone who wants one Baby, and this is the rare feature whose correct UI is zero UI.
- **Produced in the browser** from the local replica, as a `Blob`. Works offline, needs no endpoint and no auth path, and at 2 MB a year the server's only advantage — no memory ceiling — never gets cashed in. It also keeps the export honest: what comes out is exactly what your Device holds.
- **The edit history comes out, stratified.** Each entry file carries current values plus `logged_by`, `logged_at`, `edited_by`, `edited_at`, `deleted_at`; the full chain lives in a separate `revisions.csv`. **Soft-deleted entries are included and flagged** — [deletes are permanent soft deletes](../../../docs/adr/0002-append-only-revisions.md), and an export that silently drops rows the app still holds is lying about being complete.
- **Stable English headers and enum values, whatever the UI language.** Localised headers would make the file unparseable by anything, including future-you. Timestamps are **ISO 8601 with offset**. Two practical details: **UTF-8 with a BOM**, or Excel mangles German umlauts and Romanian diacritics; and the standard comma delimiter, which is safe only because [canonical units](05-domain-model.md) are integer ml, g and mm — there are no decimals to collide with the DE/RO decimal comma.

### Scope change: Milestones are in, photos stay out

The map ruled out *"photos, milestones, diary entries — this is a log, not a baby book"*, bundling three things that are not alike. Photos are an attachment story — storage, sync payload size, thumbnails — and diary entries are prose. **A Milestone is neither: it is a point in time with a label, which is exactly what an Entry already is**, so it costs nothing new in sync, revisions or export beyond another discriminator value in the one [`entries` table](../../../docs/adr/0001-single-entries-table.md).

**v1, not v2, and the reason is that milestones are unrepeatable.** A missed feed total is noise; a first tooth that happened while the app could not record it is gone for good. Every month v1 runs without them loses some.

The boundary is restated so the door stays shut: **a Milestone is one line of text at a point in time — no photo, no attachment, no prose.** Photos and diary entries remain out of scope. The model change is [Milestones as an entry type](18-milestones-entry-type.md); the map's out-of-scope line is split accordingly.

### History is filtering, not a stats tab

"When did she eat broccoli" and "when was her first tooth" are **queries over the log**, not aggregates, and putting them behind a *Stats* label is how that screen becomes the place everything hard to position ends up. **The timeline already is the history; what it lacks is a filter.** Filtering also returns the answer *with its context* — the reaction note on the Meal line, and what else she ate that day — which a bare results list strips out. Milestones then need no dedicated surface at all, because they are ordinary entries already in the timeline. Spun out as [Timeline filtering and food history](19-timeline-filtering.md), which also picks up a Food detail view showing first exposure plus every Meal containing that Food.

### One consequence handed to another ticket

[Ticket 08](08-logging-ux-prototype.md) settled that *the timeline is the screen*. This ticket adds a second destination, and export and schedule settings need homes too, so **v1 has three: timeline, stats, settings.** The count is settled here; the mechanism — tab bar, header icon, swipe — is a visual/IA question recorded as an input on [Visual design direction](11-visual-design-direction.md), with one constraint: whatever the nav is, it must not compete with the FAB for the thumb.
