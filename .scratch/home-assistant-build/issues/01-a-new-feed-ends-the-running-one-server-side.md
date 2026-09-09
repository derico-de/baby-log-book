# 01 — A new Feed ends the running one, in the push transaction

**What to build:** *A Baby eats one thing at a time* is enforced today in the feed sheet, which means it is enforced for one writer. Two Devices that each start a Feed while partitioned already reach the hole, and a Hub writing a plain creation would too. Move the rule into the push transaction, where Session Merge and the past-bottle close already live, so the server holds it for every writer.

This ticket has nothing to do with Home Assistant by itself — it is a real multi-device fix that ships on its own merits, and it is what later lets a Hub write a plain creation and get the rule for free.

Spec §5.3. Decided in [ADR-0034](../../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md), which amends [ADR-0019](../../../docs/adr/0019-a-new-feed-ends-the-running-one.md).

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] A pushed feeding whose Occurred At falls **inside** a running Feed ends that Feed at the new feeding's Occurred At.
- [x] The guard is unchanged: a back-dated feeding predating the running Feed leaves it alone — she ate, then the current feed began.
- [x] The end revision is attributed to **the Member who logged the new feeding**, not to the server. (Unlike the past-bottle close, whose end the app authors.)
- [x] The rule runs inside the same transaction as the batch.
- [x] Both rows survive with their millilitres — this is an end, not a merge, and [ADR-0014](../../../docs/adr/0014-only-sleeps-merge.md) stands. Nothing is tombstoned and no volume silently leaves the day.
- [x] **The offline-second-Device test**: two Devices each start a Feed while partitioned, both push, and the result is the one ADR-0014 and ADR-0019 jointly describe.
- [x] The client-side guard **stays** — the feed sheet's inline "ends the running feed at 14:05" line is real copy about a real write, and must still show. The server becomes the authority; the sheet keeps the preview.
- [x] A line under `## [Unreleased]` in `CHANGELOG.md`, same commit.
