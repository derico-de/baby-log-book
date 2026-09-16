# A correction to an old row asks once

The entry edit sheet's Save needs a **second press** when the row it is editing sits more than two hours behind now: the first press states which row this is — *"This entry is from 13 Sep 08:20. Change it?"* — and the second writes. Nothing else in the app gains a confirm step, and a correction to anything from the last two hours is untouched.

This is a deliberate exception to [spec §8.5](../../.scratch/baby-log-book/spec.md)'s *undo, not confirm*, and the exception holds because both halves of that rule fail here:

- **There is no undo on a correction.** The fan's writes are covered by the toast; a correction lands as a revision, and the only way back is another correction. The history keeps the evidence, but the wrong figure is what stats, targets and the export read in the meantime.
- **The gesture is not the one the rule was measured for.** *Undo, not confirm* was costed against logging — every nappy, every night, at 3am. This is not logging: a row is opened by tapping it, the timeline is the screen the app opens on, and a thumb landing on a scrolling list hits whatever was under it. Correcting last Tuesday's feed is rare enough that one extra tap costs nothing, and mis-tapping it is common enough to be worth the tap.

Two hours is the width of "what is still happening" — the stretch in which a Feed, a nappy or a Sleep is still the thing you are in the middle of, and the stretch every everyday correction falls inside.

The row's age is read from the latest instant it states, `ended_at ?? occurred_at`, so a Sleep that ran through the night and ended twenty minutes ago is this morning's row and asks nothing. A Session still open hours later is read from its start and does ask: the rows the fan and the stale banner speak for never come through this sheet, so an old open Session is one nobody stopped.

## Consequences

- **Delete keeps no confirm.** A deletion is a tombstone with an Undo in its toast, which is the rule working as written — the undo exists, so the confirm is not bought.
- **The question is the Save button, not a dialog.** No second sheet, no scrim over a scrim: the label becomes *Change it* and one line above the actions names the row's date and time. *Amended 2026-09-16: the line is a panel — the accent's soft tint, the clock glyph, bold — and scrolls into view. One line in the warn colour was overlooked beside a Save in the same hue, and a question nobody reads is no confirm step at all; the shape is unchanged, one press asks and the next writes.* A Milestone is named by date alone, because its clock time is dropped at display (spec §3.6) and the question must not state a precision the app hides everywhere else.
- **The second press writes what the inputs say then**, not what they said when the question appeared. The form stays live behind the question, so the draft is read once, at the write.
- **Age is read on open and does not change while the sheet stands.** A row that crosses the two-hour line between opening the sheet and pressing Save keeps the gesture it opened with.
- **Nothing is stored and nothing syncs.** This is a client-side rule over an Entry and the clock, so a Hub, the server and the export are all unaffected.
