# One entries table with a JSON payload

Every Entry — breast feed, bottle feed, meal, sleep, nappy, measurement — lives in a single `entries` table with a type discriminator, shared columns for the fields they all have (baby, occurred at, ended at, logged by, note, revision metadata, tombstone), and a JSON payload for the handful of fields specific to each type. We chose this over a table per type because sync is the dominant constraint: one table means one change feed, one tombstone rule and one conflict rule instead of six, and because statistics are computed client-side over each device's local replica, so the server gains almost nothing from having those fields as queryable columns.

## Consequences

- The database cannot enforce the shape of type-specific fields. Validation lives in application code, and a bug there writes malformed payloads that no constraint will catch.
- Anything that needs SQL-level querying of a type-specific field will be awkward. We are betting that stays rare, because reads happen against the local replica rather than the server.
- The Food catalogue is **not** an Entry — it is separate, mutable, household-scoped reference data, and it syncs alongside the entries table rather than inside it.
