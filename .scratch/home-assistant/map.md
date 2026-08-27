# Home Assistant — wayfinder map

Label: `wayfinder:map`

## Destination

A **locked spec plus ADRs** for the Home Assistant integration — the server's derived read, the write path a Hub uses, the entity model, auth and re-auth against a public origin, repo and versioning — at `.scratch/home-assistant/spec.md`, complete enough that agents build **both halves mostly AFK**: the server half in this repo, the Python custom integration in its own. Building is a separate effort past this map.

## Notes

- Domain: this repo; vocabulary is [`CONTEXT.md`](../../CONTEXT.md) — issue titles, spec and UI copy follow it word for word. **Hub** is proposed but not yet in the glossary (lazy rule, `docs/agents/domain.md`); [The Hub in the members list](issues/05-the-hub-in-the-members-list.md) decides when it enters.
- Skills every session should consult: `/grilling` and `/domain-modeling` for HITL tickets; `/research` for research tickets.
- **Standing constraints** — settled while charting, do not re-litigate without saying so:
  - **[ADR-0034](../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md) is the floor.** Hub-as-Device, own Caregiver Member, one derived read shipping no rows, one write path, no CORS, no action API. A ticket that contradicts it surfaces a superseding ADR, never a quiet drift. [Ticket 29](../baby-log-book/issues/29-home-assistant-integration.md) of the first map is the long-form background.
  - **Read *and* write in v1.** *Start feeding* was the ask; the write tail (ADR-0019 into `push()`, bounded outbox, clock offset) ships with it, not in a second map.
  - **Home Assistant is the automation engine.** The deployment never wakes a Hub; a **Notice** stays a phone thing. The Hub gets due *instants* as sensors and the Household writes its own automations. [What a Hub does with a Notice](issues/03-what-a-hub-does-with-a-notice.md) writes this down as an ADR.
  - **The integration lives in its own repo**, HACS-installable, its own release cadence, with an explicit version handshake against the server. Core submission is out of scope.
  - **The custom Lit card is out of scope.** Entities plus stock tile cards are the destination; the card is a later effort, designed against a real wall.
  - **The spec carries HA idioms explicitly** (config flow, re-auth, `DataUpdateCoordinator`, repair issues) because the Python agent cannot lean on this repo's conventions — underwritten by [What a custom integration must be](issues/02-what-a-custom-integration-must-be.md).
- **Charting finding, for [The wire contract](issues/09-the-wire-contract.md):** ADR-0034's cursor-as-ETag only holds if the payload is a pure function of the log — but `headerState()` returns `elapsedMs`/`overdue`, functions of `now`; a Feed goes overdue with no new revision. The fix is now decided at the Notice level: [ADR-0036](../../docs/adr/0036-the-deployment-never-wakes-a-hub.md) commits the wire to **instants only** (the Hub derives elapsed and overdue itself, which is also what `device_class: timestamp` wants); [The wire contract](issues/09-the-wire-contract.md) inherits it rather than re-deciding.
- **Charting finding, for [Re-binding a Hub that lost its session](issues/04-re-binding-a-hub.md):** Rescue Links are CLI-only (`babylog rescue`, `docker exec`), so ticket 29's re-auth story reaches self-hosters only. A hosted family's workaround — a fresh Invite — claims a *second* Member and leaves a dead *Home Assistant* in the list forever.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [A Home Assistant in the dev env](issues/01-ha-in-the-dev-env.md) — HA core 2026.8.3 runs via root-level `compose.ha.yaml` (self-contained, nothing leaks into production compose), config bind-mounted at `ha/config/`; UI on sandbox-local 8123 (`HA_PORT=5173` borrows the forwarded port to show a human), the app reachable from inside as `http://host.docker.internal:5173`; German dev user in place and a timestamp tile really renders „In 39 Minuten".
- [What a custom integration must be in 2026](issues/02-what-a-custom-integration-must-be.md) — conventions verified against HA 2026.8.3, findings at [`research/ha-integration-conventions.md`](research/ha-integration-conventions.md): instants-only, SSE-wake-plus-poll and repairs-for-Lapsed are HA's own idioms too; unique_id = Household/Member id, re-auth = fresh Claim Link; ship `translations/{en,de,fr}.json` directly (never `strings.json` refs); version handshake in code à la Mealie + `hacs.json → homeassistant`; test via `pytest-homeassistant-custom-component`, no live HA needed; quality scale is a checklist, `dynamic-devices` answers "Baby added later".
- [What a Hub does with a Notice](issues/03-what-a-hub-does-with-a-notice.md) — [ADR-0036](../../docs/adr/0036-the-deployment-never-wakes-a-hub.md): the deployment never wakes a Hub; instants only cross the wire (the Bottle Chime's ten minutes and both Notice Offsets stay delivery concepts — HA's `time` trigger does negative offsets natively); `until` dissolves into coordinator unavailability; the spec gets the one family-facing sentence, the README gets two or three copy-paste automations.
- [Re-binding a Hub that lost its session](issues/04-re-binding-a-hub.md) — [ADR-0037](../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md): the Rescue Link moves into Settings (any Member for themselves, a Parent for any Member), one 60-minute TTL everywhere, pending rescues visible and revocable beside pending Invites, claims never touch old sessions (a rescue is *add* as much as *recover* — it was already the second-device path); Removal burns pending rescues; sole-Parent lost phone stays the operator's terminal by construction; per-Device session revoke noted as a missing feature this map does not build.

## Not yet specified

- **Testing the Python half** — the harness is settled by the research (`pytest-homeassistant-custom-component`, no live HA instance required, `integration_blueprint`'s CI plus a pytest job); what remains — the new repo's CI wiring, and whether the dev-env HA container plays any part in it (the research says the case is thin) — waits on [One repo or two](issues/08-one-repo-or-two.md).
- **Entity names in the three languages** — mechanics settled by the research (`translations/{en,de,fr}.json` shipped directly, `translation_key` per entity, names freeze into the registry in the backend language at creation); the actual names per entity wait on [The entity model](issues/06-the-entity-model.md).
- **The README a stranger follows** — install, claim, revoke, plus the two or three copy-paste automation examples ADR-0036 committed to (chime before bottle end, announce a Feed due); spec-assembly territory.

## Out of scope

- **The custom Lit card** — polish, not capability; designed after real entities exist on a real wall panel. A later effort.
- **Home Assistant core submission** — the quality-scale ladder, brands repo and review queue beyond what HACS itself demands.
- **Other hub ecosystems** — HomeKit, Google Home, an MQTT bridge (already ruled out in [ticket 29](../baby-log-book/issues/29-home-assistant-integration.md) with reasons).
- **Building either half** — happens after the map, from the spec.
