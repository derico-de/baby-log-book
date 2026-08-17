# The pull cursor is never the merge key

Two different orderings are in play and they must never be conflated. The **cursor** — how a device asks for what it has not yet seen — is a monotonic sequence assigned by the server inside the write transaction; SQLite serialises writers, so sequence order is commit order by construction. The **merge key** — which of two competing values for a field is "last" — is the writing device's wall clock, corrected by the offset it observed against the server on its last sync, with ties broken lexicographically by device id so every replica reaches the same answer. Server sequence is deliberately *not* the merge key: a phone that was offline for three days syncs afterwards, and under arrival-order merging its stale edit would beat a correction made yesterday purely because it landed later.

The classic trap this closes is the mirror image: a wall clock must never be the cursor. Under concurrent transactions a row can commit after another yet carry an earlier timestamp, and a client whose watermark has passed that timestamp will never see it — the row is lost silently and permanently.

## Consequences

- Clock skew is a data-integrity concern, not a cosmetic one: a phone an hour fast wins every conflict for an hour. Every sync response returns the server's time so the client can maintain its offset.
- The sanity window on timestamps is **one-sided**. A write stamped three days ago is legitimate — that phone was in a pram. A write stamped tomorrow is skew, and is clamped to server receipt time and flagged on the revision rather than rejected, because refusing to record a night feed is a worse failure than recording it slightly late.
- Both orderings must be present on every revision. Dropping either one to save a column reintroduces one of the two failures above.
