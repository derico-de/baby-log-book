# Sync moves immutable revisions, not rows

What travels between a device and the server is a stream of immutable revision records — each one naming the fields it changed and nothing else — rather than the current state of an Entry. Current state is a fold over that log, materialised on both sides. We chose this over shipping rows because it makes sync **insert-only**: two inserts cannot conflict, so conflict resolution stops being a property of the transport and becomes a deterministic function every replica computes identically, independent of the order things arrived in. Last-write-wins is applied **per field**, so a corrected bottle volume and a note added on another phone both survive. The same log carries every syncable change — Entries, the Food catalogue, Babies, Members, and Household settings such as the Day Start — under a kind discriminator, so there is one feed, one cursor, one fold and one tombstone rule rather than two mechanisms to keep honest.

## Consequences

- A stale client cannot silently clobber a field it has never heard of, because a revision only ever carries the fields it changed. The usual "old writer drops new data" bug does not exist here.
- Both client and server maintain a materialised current-state table beside the log. That derived state must be rebuildable from the log alone, or the property above is lost.
- A collection nested inside a payload — the Foods on a Meal — is treated as a **single field**. Two devices editing the same Meal's food list concurrently will lose one list, recoverably, as a revision. Accepted deliberately: a meal is fed and logged by one person, and the alternative is a second merge model with tombstones inside a payload.
- Storage is larger than a row-per-entry design by the size of the history. At a few thousand entries a year this is irrelevant.
