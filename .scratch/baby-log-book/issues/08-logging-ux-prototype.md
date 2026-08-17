# Prototype: the one-thumb logging screen

Type: prototype
Status: resolved
Blocked by: 05

## Question

What does the primary logging surface look and feel like, when the user is holding a baby in one arm at 3am in a dark room?

Use `/prototype` to build something rough and clickable, and `/impeccable` for the interaction thinking. This is about interaction and information architecture, not aesthetics — visual direction is a separate ticket.

### Already settled — the prototype builds on these, it does not revisit them

- **One feeding entry point with a Breast / Bottle / Food switch.** Picking the mode reveals only the fields that mode needs; solids carry more fields than the other two and must not make bottle logging heavier.
- **Notes live behind an icon**, on every entry type, so the free-text field never costs vertical space in the common path.
- **Measurements sit behind a single "Add measurement" action**, which then offers weight, height and head circumference together — they are usually entered in one go after a checkup.

### What the prototype must answer

- **What is on the home screen?** Time since last feed and last sleep are the most-read numbers in the app. What else earns a place?
- **Starting and stopping a live session** — how many taps, how big is the target, and how obvious is it that a timer is running? A running session has to be visible from anywhere in the app and from another family member's device.
- **The quick-log row** — nappies and bottle feeds are the highest-frequency, lowest-information actions. Can they be one tap plus one confirm?
- **Manual entry and correction** — always available, never in the way. Where does "actually that was 20 minutes ago" live?
- **Recovering a Stale Session** — a Sleep nobody stopped. Its end is the whole point, so a sleep still running after eight hours has quietly destroyed the record it existed to make. Does the app prompt on next open, auto-close at a threshold and ask you to confirm, or leave it alone? Note the asymmetry: a Feed left running needs no recovery at all, because nothing depends on its end.
- **The timeline** — today's entries with attribution ("Oma, 14:05"). How far back does the default view go, and how do you get to history?
- **Multi-baby** — the selector is hidden with one baby. Where does it appear when a second arrives, and does it change the whole screen or just the target of a log?
- **One-handed reachability** — everything frequent within thumb reach on a phone, and what that means on a tablet or a desktop browser where the same layout would look absurd.

### Deliverable

A clickable prototype linked from this ticket, plus a written summary of the decisions it settled and the ones it surfaced.

## Asset

Prototype: [`prototypes/logging-screen.html`](../prototypes/logging-screen.html) — published at <https://claude.ai/code/artifact/7a11190e-e5dc-43bd-b568-a6083c901f09> so it can be driven on a real phone, which is the only way this question can honestly be judged.

Three variants on `?variant=`, switchable from the floating bar or the ← → keys:

- **A — Status board**: three big numbers on top, timeline in the middle, fixed three-button action bar at the bottom. Primary affordance is the action bar.
- **B — Timeline first**: the log is the screen, with a slim sticky stats strip and a single FAB. Primary affordance is the FAB.
- **C — Split thumb**: one dominant number ("since last feed"), everything actionable in a chunky grid in the lower half, nappies logged in one tap with an undo toast rather than a confirm step.

Dark by default, with a light toggle in the prototype bar. A "Forgotten sleep" toggle injects a 9.5-hour open Sleep so the Stale Session recovery flow can be judged. State is in memory; refresh resets.

## Answer

**Variant D — B's structure with C's due information.** Live in the prototype as the default variant.

**Ratified by the dev on 2026-08-15** after driving the prototype. Variant D is the settled structure for the logging surface; later tickets build on it rather than reopening it.

### What's settled

- **The timeline is the screen.** Reverse-chronological, with attribution on every row ("Oma · 14:05") and the Note behind an icon. Not a dashboard of tiles with the log demoted below the fold.
- **One FAB** is the entry point to logging, bottom-right in thumb reach. No permanent action bar eating screen height.
- **The due information is promoted into a sticky header**: "since last feed" as the dominant number, "next due in 20m" beneath it, awake time and nappy count as a quiet second line. It stays visible while the timeline scrolls under it, because it is the number people check constantly.
- **Overdue is a colour shift on the same number**, not a separate alarm state. The app does not nag.
- Rejected: the three-tile status board (A) put the log too far down, and the split-thumb grid (C) bought one-tap logging by giving up the timeline entirely.

### What this leaves open

Choosing B's structure means logging is now **behind the FAB**, so a nappy costs more taps than it did in C, where it was a single tap with an undo toast. Whether that trade is acceptable — and how the Stale Session recovery should behave — moves to [Logging interactions](16-logging-interactions.md).
