# 07 — The action surface

Type: grilling
Status: open
Blocked by: 02, 06

## Question

The write half: which of the fan's actions a wall offers, and what a mis-press costs. [ADR-0034](../../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md) fixes the mechanism — plain revisions down `POST /api/sync/push`, ADR-0019 moving into the transaction, bounded outbox, client-minted ids — so this ticket decides the *surface*:

- **Buttons** for the direct actions (start/end sleep, start breast feed…) and **services** for the ones with arguments (`log_bottle_feed` with volume and contents, `log_nappy` with pee/poop/where) — ticket 29's split; confirm it against the research's conventions and the entity model's devices.
- **Which actions are deliberately absent.** Milestones ("unrepeatable" cuts both ways — the case for and against a wall button), Measurements, Meals with Foods (a growing catalogue through a service argument?), corrections and edits (probably never — the phone's job).
- **The mis-press.** The app's undo window is a toast on the screen that pressed; a wall has no toast. Does a mis-press wait for a phone to correct it, and is that acceptable at v1? (Probably yes — say so.)
- **The bounded outbox made visible**: how HA states "3 presses not yet sent" — an entity, a repair issue, a log line? And where the bound sits before it refuses new presses.
- **`baby_id` in a service call** is a client-supplied id; `entityBelongsElsewhere` is what makes it safe ([ADR-0020](../../../docs/adr/0020-one-deployment-many-households.md)) — the spec must say the integration passes it and never trusts it for anything else.
