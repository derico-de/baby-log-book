# Sync protocol and conflict semantics

Type: grilling
Status: resolved
Blocked by: 01, 05

## Question

What exactly does a sync look like, and what happens when two devices disagree?

Takes the engine recommendation from the local-first research and the entities from the domain model, and pins down the protocol. If the research recommended an off-the-shelf engine, this ticket becomes "what does that engine give us and what do we still have to decide" — the questions below don't disappear just because a library answers some of them.

### Decisions to reach

- **Change feed shape** — cursor or version per household? Monotonic counter, timestamp, or hybrid logical clock. Clock skew between a phone and the server is real.
- **Push semantics** — batched writes, idempotency on retry (client UUIDs make this cheap), what the server does with an entry it has already seen.
- **Conflict rule granularity** — last-write-wins per record, or per field? Two people editing different fields of the same entry is plausible; per-record LWW silently discards one of them.
- **The open-session merge rule** — two devices each started a sleep for the same baby while offline. Merge into one, keeping the earlier start. What about a session someone forgot to close and another device closed?
- **Tombstones** — how deletes propagate, and whether they are ever garbage collected.
- **Initial sync** — a new device pulls the whole household history. How is that bounded, and what does the UI show while it happens?
- **Does the user ever see a conflict?** Preference is no — reconcile silently and let the edit history carry the evidence. Confirm, and decide whether anything is loud enough to warrant a notice.
- **Auth on the sync endpoint** — and what a device does when its session has expired but it has unsynced local writes.

### Carried forward from [Local-first sync engine](01-local-first-sync-engine.md)

The engine question resolved to **build, not buy** — hand-rolled on Dexie, implementing RxDB's documented pull/push/checkpoint contract — so every question above is genuinely ours to answer. The research pre-empted three of them:

- **Change feed shape**: do *not* use wall-clock `updated_at` as the cursor. A row can commit after another yet carry an earlier timestamp; a client past that watermark never sees it, and the row is lost silently and permanently. Use a per-household counter bumped inside the write transaction, or an append-only `changes` table keyed by rowid.
- **Clock skew** is data corruption under LWW, not just odd ordering. Server-returned time plus a sanity window is the suggested mitigation — confirm it here.
- **Initial sync** is cheap by construction: the whole replica is single-digit MB, so "drop the local DB and re-pull" stays a valid recovery move. That is the reason the build option won, and it should shape the answer to the bounding question above.
- **The open-session merge** needs a `merged_into` redirect so the losing device's late "stop" lands on the surviving session.

## Answer

The protocol is an **append-only log of field-level revisions**, pulled by a server-assigned cursor and merged by a corrected client clock. Two decisions earned records: [ADR-0003](../../../docs/adr/0003-revisions-are-the-sync-unit.md) and [ADR-0004](../../../docs/adr/0004-cursor-is-not-the-merge-key.md).

### The shape

**Revisions are the sync unit, not rows.** A revision is immutable and names only the fields it changed; current state is a fold over the log, materialised on both sides. This makes sync **insert-only**, and that single property is what collapses the rest of the ticket: two inserts cannot conflict, so push is idempotent by construction rather than by implementation, replay is a no-op, and every replica converges without depending on arrival order. It also means a stale client physically cannot clobber a field it has never heard of.

**Last-write-wins is per field.** You fix the volume from 120 to 150 while Oma adds a note to the same feed; both survive. Per-entry LWW is only cheaper when you are overwriting rows, which we are not.

**One log for everything.** Entries, the Food catalogue, Babies, Members and Household settings — the Day Start above all — all travel as revisions under a kind discriminator. One feed, one cursor, one fold, one tombstone rule. Members carry id, display name and role; nothing authenticating ever syncs.

**Any collection nested in a payload is one field.** A Meal's Foods list is replaced wholesale by an edit, so two concurrent edits lose one list — recoverably, as a revision. Accepted deliberately rather than growing a second merge model with tombstones inside a payload.

### Ordering — the two clocks

The cursor and the merge key are different things and conflating either into the other loses data. Full reasoning in [ADR-0004](../../../docs/adr/0004-cursor-is-not-the-merge-key.md); in short:

- **Cursor**: monotonic `seq` on the revision log, assigned inside the write transaction. SQLite serialises writers, so sequence order is commit order and the wall-clock-watermark trap closes by construction rather than by discipline.
- **Merge key**: the writing device's clock corrected by its observed server offset, ties broken lexicographically by `device_id`. Server arrival order is *not* usable — a phone offline for three days would beat yesterday's correction simply by landing later.
- **Skew guard is one-sided.** Past timestamps are always legitimate. More than ~5 minutes in the future, after correction, is clamped to server receipt time and flagged on the revision — never rejected, because refusing to record a night feed is worse than recording it slightly late.

### Session merge

Any two open sessions **of the same kind** for the same Baby are a contradiction — a Baby cannot be asleep twice — so **no time-window heuristic is needed**. Earliest start wins; the loser gets a tombstone plus `merged_into` pointing at the survivor, followed transitively, so a late "stop" pressed on the losing device lands on the right session. Runs server-side inside the push transaction, idempotently, and applies to Feeds on the same grounds.

**Amended by [Schedules in v1](09-schedules-v1.md) — the merge is per kind.** As first written, "any two open sessions for the same Baby" read as kind-agnostic, which would tombstone one of them the moment a Baby fed at the breast or from a bottle without waking. That is a [Sleep Feed](../../../CONTEXT.md), a normal and deliberate thing, so an open Feed alongside an open Sleep must both survive. Only Sleep-with-Sleep and Feed-with-Feed merge.

This respects the precedent set in [Logging interactions](16-logging-interactions.md): reconciling two sessions a human did start is not the same as inventing one. **Synthesising an end time for a session nobody stopped stays forbidden** — a forgotten Sleep still gets the passive banner, never an auto-close. The merge appends a revision attributed to **the app rather than a Member**, so the history shows honestly that no person did it. Now in the glossary as [Session Merge](../../../CONTEXT.md).

### Push, pull and liveness

- **Push**: batches of up to ~200 revisions, applied in one all-or-nothing transaction; the response returns the new cursor and the server's own time so the client can update its offset.
- **Liveness**: the running timer needs no traffic at all — it ticks client-side from the start time — so only start and stop events must propagate. An SSE channel carries a **bare wake-up signal and never data**, keeping exactly one path by which rows arrive, with a ~30s foreground poll as fallback when the connection drops.
- **Initial sync**: the ordinary paged pull from cursor 0. No bootstrap path, no snapshot subsystem. The timeline fills as pages land behind a quiet "catching up" line, and **logging is never blocked** — writes go to the outbox regardless.
- **Reset lever**: the "drop it and re-pull" move that made building beat buying is an actual button in settings. It refuses while the outbox is non-empty, and fires automatically when the version check reports an incompatible local schema.

### Tombstones, conflicts, stale clients

- **Tombstones** keep the full payload, permanently, with no garbage collection — so a mistaken 3am delete is undoable on every device, not just the one it happened on.
- **The user never sees a conflict.** No dialog, nothing that interrupts. The evidence lives in the entry's own Revision history and in the app-attributed line left by a Session Merge. If a case ever proves loud enough to warrant a notice, it arrives as a new ticket rather than a flag on this design.
- **Protocol version** rides on every sync response. Additive payload changes do not bump it; changes that would make an old client write something wrong do. On a bump the client stops pushing, keeps logging locally, shows "update needed" and triggers the PWA update — **the outbox is never discarded** and flushes once the update lands.

### Boundary with [Accounts, households and invites](07-accounts-and-invites.md)

That ticket owns how a device proves who it is. This one owns only what sync does when the proof is stale: local writes are never blocked and local data is never wiped on a 401. The outbox is durable, the UI shows a passive "signed out — 14 entries waiting" line, and re-authenticating flushes it. Explicit sign-out with a non-empty outbox warns before clearing anything.
