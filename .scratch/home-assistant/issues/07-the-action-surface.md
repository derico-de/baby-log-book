# 07 — The action surface

Type: grilling
Status: resolved
Blocked by: 02, 06

## Question

The write half: which of the fan's actions a wall offers, and what a mis-press costs. [ADR-0034](../../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md) fixes the mechanism — plain revisions down `POST /api/sync/push`, ADR-0019 moving into the transaction, bounded outbox, client-minted ids — so this ticket decides the *surface*:

- **Buttons** for the direct actions (start/end sleep, start breast feed…) and **services** for the ones with arguments (`log_bottle_feed` with volume and contents, `log_nappy` with pee/poop/where) — ticket 29's split; confirm it against the research's conventions and the entity model's devices.
- **Which actions are deliberately absent.** Milestones ("unrepeatable" cuts both ways — the case for and against a wall button), Measurements, Meals with Foods (a growing catalogue through a service argument?), corrections and edits (probably never — the phone's job).
- **The mis-press.** The app's undo window is a toast on the screen that pressed; a wall has no toast. Does a mis-press wait for a phone to correct it, and is that acceptable at v1? (Probably yes — say so.)
- **The bounded outbox made visible**: how HA states "3 presses not yet sent" — an entity, a repair issue, a log line? And where the bound sits before it refuses new presses.
- **`baby_id` in a service call** is a client-supplied id; `entityBelongsElsewhere` is what makes it safe ([ADR-0020](../../../docs/adr/0020-one-deployment-many-households.md)) — the spec must say the integration passes it and never trusts it for anything else.

## Answer

Grilled 2026-08-28, all recommendations taken. One charting assumption dissolved on the way in: the fan's *Feed while asleep* row **keeps the sleep running** (a Sleep Feed, `messages/en.json: fan_feed_asleep_sub`) — so a wall's start-feed never touches a Sleep and no wake-and-feed compound write exists.

### Buttons (entities on each Baby's device, pressable from stock tile cards)

- *Sleep* (start) / *She's awake* (end) — the fan's direct pair
- *Feed* (starts a breast Feed) / end feed — breast is the only Feed startable without arguments; end writes `ended_at` on the live Feed
- *Tummy time* / *Off her tummy*

### Services (the argumented actions)

- `log_bottle_feed` — `volume_ml`, optional `contents`, optional `leftover_ml`
- `log_nappy` — `pee`, `poop`, optional `where`, optional `consistency`

Both **target the Baby's HA device** — never a raw `baby_id` field in the call schema. The integration resolves device → `baby_id` and passes it down the wire; the spec carries the ADR-0020 sentence verbatim: the server's `entityBelongsElsewhere` is the only thing that makes it safe, the id is never a capability.

### Deliberately absent

Meals with Foods (a service argument would invite typo-Foods into the catalogue from automations), Milestones (unrepeatable — a mis-press writes "First steps" that never happened), Measurements, corrections/edits/deletes, notes, and any breast-`side` surface — **the phone owns `side`**; the wall's *Feed* button starts with the app's default (`both`, `entries.ts:214`). Families wanting a one-press bottle button get a README script calling `log_bottle_feed` — the automation engine doing its job, not a gap.

### Availability mirrors the fan's reflow

Buttons go `unavailable` from the same coordinator read that feeds the binaries — no *Sleep* while one runs, *Off her tummy* only while a stretch runs. **Convenience, not enforcement**: the server never assumes the Hub filtered anything. The race a stale read lets through lands on rules the server already holds — two started Sleeps reconcile via Session Merge, a second Feed ends the first via ADR-0019 in `push()`.

### The mis-press

Waits for a phone, and the spec says so in one plain sentence. The cost is bounded: reflow blocks the nonsense presses, Session Merge and ADR-0019 absorb the double-starts, everything else is an ordinary Entry a phone edits. `refuseByRole` would let the Hub delete within its own undo window, but no v1 surface offers it — deliberately absent, not forgotten.

### The bounded outbox, visible

A diagnostic sensor `pending_writes` on the Household device, beside *Last update* — the same staleness-tell family. Bound: **50 queued revisions**; at the bound a new press raises an error in the UI (HA's `action-exceptions` idiom) instead of queuing silently. No repair issue for a backlog — repairs stay reserved for the Lapsed session, per the conventions research; a non-empty outbox is visible state, not a condition needing repair.

No ADR: the surface composes existing rules (ADR-0019, ADR-0020, ADR-0034) rather than trading anything new away — like the entity model, this is spec content.
