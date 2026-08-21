# A nappy is one form

The fan opened with Pee and Poop as two top-level rows — [issue 16](../../.scratch/baby-log-book/issues/16-logging-interactions.md)'s answer to the app's most frequent, least informative action: two taps, the second a large target, no sheet. **They are now two toggles on one Nappy form**, opened from a single Nappy row like every other entry type's row.

Two things were wrong with two rows, and only one of them was about height.

**A nappy that held both could not be said.** Pee and Poop are two facts about one nappy — the payload has stored both booleans since v1 — but two rows write two Entries, so the honest change was logged twice, as two nappies, inflating the day's count and the Nappies card with it. There was no third row for it and there should not have been: *both* is not a third kind of nappy.

**And the top level had run out of room.** With Tummy Time the fan reached seven rows, around 510px expanded and about 560px while a Sleep runs and two rows carry sub-lines, which is most of a small phone's viewport. One row per entry type takes it back to six and keeps it there.

The form is also the first place the **consistency** can be typed. It has been in the payload, the validator and all three locales since v1 with no input anywhere in the app — a field the model carried and the UI could not write.

## Consequences

- **A nappy costs a form, at 3am.** This is the real cost and it is paid deliberately: the shortest path in the app now belongs to a Feed and a Sleep rather than to a nappy. Mitigations are ordinary — the Nappy row is nearest the thumb, the two toggles are 54px pills, and the time comes prefilled — but the two-tap nappy is gone, and [issue 16](../../.scratch/baby-log-book/issues/16-logging-interactions.md)'s claim that frequency deserves the shortest path is what makes this a trade rather than a tidy-up.
- **§8.5's "no sheet chrome for a nappy" rule is reversed**, and the rest of that section stands: no confirm step beyond the form's own Save, and undo-not-confirm is gone with it — the form *is* the confirm, so the toast no longer carries an Undo the way the fan's straight-through nappy did.
- **Nothing is prefilled and Save is disabled until the nappy says what it held.** A ticked-by-default Pee would be the app writing a fact nobody entered, which is the one thing [`mutate.ts`](../../src/lib/client/mutate.ts) exists to refuse.
- **The entry sheet grew the same three fields.** A value the app can write but never correct would be the single exception to corrections being first-class ([ADR-0002](0002-append-only-revisions.md)), so pee, poop and consistency are editable on a nappy row, under the same rule the form saves by: unticking the poop takes its consistency with it.
- **An intermediate shape was tried and abandoned in the same session**: the Nappy row reflowing the fan in place to *Pee · Poop · Back*. It solved the height and nothing else — the both-in-one-nappy case stayed unsayable and the consistency stayed unreachable — so it did not survive contact with the actual question.
