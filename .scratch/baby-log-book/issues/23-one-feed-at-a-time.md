# One feed at a time

Type: task
Category: enhancement
Status: resolved

## Request (from the dev, 2026-08-18)

> starting a second feeding (formular after breast milk) should stop the first
> feeding. the child can only eat one thing at a time

## Decisions (2026-08-18)

- **A new feeding ends a running Feed at the new one's Occurred At** —
  [ADR-0019](../../../docs/adr/0019-a-new-feed-ends-the-running-one.md). One
  ordinary revision attributed to the Member who logged the new feeding, no
  lasting linkage. Applies to all three sheet modes (Breast, Bottle, Food) and
  to both Save and Start timer.
- **Same shape as the awake switch** (spec §8.5): a quiet inline line in the
  sheet (*"ends the running feed at 14:05"*) announces the write before it
  happens, and the same back-dating guard applies — a new feeding whose
  Occurred At predates the running Feed's start is a separate, earlier feed and
  leaves it alone.
- **Not a merge.** ADR-0014 stands: both rows and both volumes survive. The
  Combined Feed stays several Feeds; each earlier one now carries the end it
  had.

## Outcome

- `endFeedForFeed` in `src/lib/client/mutate.ts`, mirroring `markAwakeForMeal`
  including its guard.
- The feed sheet captures the running Feed before writing (so a new timer
  cannot end itself), ends it after logging, and shows the inline line via the
  new `sheet_ends_feed` message (en/de/ro).
- Component tests in `feed-sheet.test.ts`: bottle-after-breast ends the timer
  at the bottle's Occurred At, the back-dating guard leaves it alone, and a
  second timer ends the first while staying live itself.
