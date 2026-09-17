# A delete asks, and nothing pops up

Deleting an Entry asks first — *"Delete Bottle?"*, Cancel or Delete — through one confirm dialog that every destructive act in the app shares: deleting an Entry from its sheet or the stale-Sleep banner, deleting a Baby, removing a Member or a Hub, signing out over an unsynced outbox. The toast is gone with it: no *"Nappy logged"*, no *"Sleep started"*, and no Undo.

This reverses the *undo, not confirm* rule of [spec §8.5](../../.scratch/baby-log-book/spec.md) for deletion, and drops the toast that rule was built on. Both halves fell for the same reason: the toast was noise. It sat over the FAB after every tap, stated what the timeline row already showed, and its Undo was a six-second target nobody hit on purpose — in practice a slip landed on it as often as a mistake did. Once the toast goes, delete has no undo, and a delete with no undo has to ask.

The ask is bought only where the rule was never measured: logging still confirms nothing. Every nappy, every night, is still one tap and a row.

## Consequences

- **One dialog, everywhere.** `ConfirmDialog.svelte` is the only confirm surface. Settings no longer uses the browser's `confirm()` for members and sign-out, and the Baby's inline typed-name panel is the same dialog with a typed field. A question looks the same wherever it is asked.
- **Centred, above whatever asked.** It may open over a sheet, and a sheet over a sheet reads as the same surface twice; it sits above the sheet's z-band with the ordinary scrim. Focus lands on Cancel, so Enter never deletes; Escape and the scrim cancel.
- **The confirming button is the accent one.** This app has one hue and no red (tokens); what makes the button safe is that it is never the one focus lands on.
- **No `app.toast`, no `undoDelete`.** `app.log` and `app.edit` take the action alone. A tombstone is still a revision and keeps its payload, so the history reads *deleted by Oma* — that is where a deletion remains visible.
- **ADR-0042's "Delete keeps no confirm" no longer holds**; its Save-asks-once rule is untouched.
- **The Caregiver's own-row window stays.** The server still lets a Member tombstone their own Entry for a few minutes after logging it (`UNDO_WINDOW_MS`); the phone now asks before it sends that tombstone.
- **A Hub asks nothing.** The wall never had a toast and has no delete surface; unchanged.
