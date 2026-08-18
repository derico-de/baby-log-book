# A Bottle records what was offered and what came back

*Superseded by [ADR-0018](0018-a-bottle-records-the-intake.md): a Bottle now records the Intake as its one stored amount, and the leftover became a subtraction affordance that is never stored. The pair below survives only as the reading rule for entries written before the change.*

A Bottle Feed stores `volume_ml` — what went into the bottle — beside `leftover_ml`, what was still in it when she was done. What she drank is derived from the pair and never stored. We chose this over the obvious alternative — correcting `volume_ml` down to 150 once you see the 30 ml left — because the two numbers are different facts, arriving at different times, and only one of them is knowable while she is still drinking.

## Consequences

- **`leftover_ml` is nullable, and null is not zero.** Null means nobody said; zero means she finished it. They read identically in the volume figure, and they must: every Bottle logged before this field existed has null there, and treating that as "we don't know, so count nothing" would erase the app's entire feeding history from the stats.
- **The derived figure is clamped at zero, not validated.** `volume_ml` and `leftover_ml` are two fields under last-write-wins (spec §5.2), so two Members editing at once can leave a leftover larger than the volume. That is a visible, correctable inconsistency in the log; a negative feed is a number every downstream reader would have to defend against. `takenMl()` clamps and moves on.
- **Stats count what she drank.** A 180 ml bottle she left 30 ml of did not put 180 ml into her. The timeline agrees, reading `150 ml of 180` — and shows the bare figure when the two are equal, so the common case stays quiet.
- **The export carries `taken_ml` alongside both stored fields.** Derived data in an escape hatch is normally a smell, but [ADR-0007](0007-export-is-an-escape-hatch.md) says the file is for a person with a spreadsheet, and making them re-derive the app's own arithmetic is exactly the friction the export exists to avoid.
- **The leftover is entered where the fact appears — the Entry sheet.** It is the number you learn when the bottle comes back, so the row you open afterwards is its natural home. The logging sheet takes it too, for a bottle already finished before anyone logged it, but that is the secondary path.
- **A combined feed does not need this field to model it.** Breast milk then formula is two Bottle Feeds ([ADR-0014](0014-only-sleeps-merge.md)), each with its own contents and its own leftover. The leftover answers "how much of this bottle", never "which milk was left" — sequential contents in one bottle is a shape the model deliberately does not have.
