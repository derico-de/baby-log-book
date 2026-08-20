# Export is also the way back in — Import founds a Household, the file copy stays internal

The glossary used to declare Export "a way out, not a way back in". That stance is reversed: **Import** founds a fresh Household in another deployment from an Export, and this round trip is the one supported way a Household leaves the hosted service — for a pilot friend declining the paid service, for a paying customer moving to self-hosting, or for anyone starting over after deletion ([ADR-0022](0022-a-lapsed-household-stops-syncing.md) already promised "self-host from the Export"; this makes it literally true). The alternative exit was [ADR-0021](0021-the-paid-service-scales-by-files-not-by-postgres.md)'s file-copy move, but that is only cheap once the per-Household file split has happened, was never practical to hand to a customer, and would make the exit story depend on server-side scaling milestones. The Export round trip works identically pre- and post-split, doubles as the general self-host onboarding story, and keeps a single exit path to document and test.

What travels is the family's data at full fidelity and final state: every Baby, Entry, Food, Milestone, the Household's settings, and who logged what. What stays behind is plumbing and access: the revision log (a corrected Entry arrives as its final self, deletions leave nothing), Devices, and Claim Links — Members are re-created without Devices and everyone re-enters through fresh Claim Links in the new deployment.

## Consequences

- **Import is not Restore.** The new Household begins a fresh sync history; earlier versions of corrected Entries and tombstones do not travel. Anyone needing point-in-time recovery is in backup territory, an operator concern.
- **The Export format must become round-trip-complete.** Settings, Foods, Milestone attribution — everything Import needs must be in the Export, which is a format change with its own build effort before billing launch. Nothing about it is needed for the pilot.
- **ADR-0021's file-copy move is demoted to an internal tool.** "A Household moves between deployments as a file copy" remains true for the operator (scaling, rescue, the eventual file split) but is never a customer-facing promise.
- **The glossary changes.** Export loses its one-way clause; Import enters CONTEXT.md as its own term.
