# Entries keep append-only revisions and are never hard-deleted

Correcting an Entry appends a new revision rather than overwriting it, so every previous value is retained and the UI can show "edited by Papa, was 120ml". Deletes are soft and permanent — a tombstone hides the Entry but never purges it. We chose this because the data is tiny and irreplaceable, because sync needs tombstones regardless, and because the most likely deletion is a mistake made at 3am.

## Consequences

- Last-write-wins conflict resolution stops being lossy. When sync discards a change, the discarded version survives as a revision instead of vanishing, so a bad merge is recoverable rather than silent.
- Storage grows monotonically. At household scale — a few thousand entries a year — this is irrelevant, and no purge job is justified.
