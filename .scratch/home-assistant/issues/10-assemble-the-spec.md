# 10 — Assemble the spec

Type: grilling
Status: open
Blocked by: 03, 04, 05, 06, 07, 08, 09, 11, 12

## Question

Fold every decision on this map into `.scratch/home-assistant/spec.md` — implementable as written, both halves, mostly AFK:

- **The server half** (this repo): ADR-0019 into `push()` with the offline-second-Device tests, `entriesSince()`, the companion endpoint per [The wire contract](09-the-wire-contract.md), the lapse gate, the re-binding path from [Re-binding a Hub that lost its session](04-re-binding-a-hub.md), whatever [The Hub in the members list](05-the-hub-in-the-members-list.md) decided Settings shows.
- **The integration half** (the new repo): config flow and re-auth, coordinator with SSE + jittered fallback, the entity model, the action surface with its bounded outbox, translations, repair issues, HACS packaging — written against the conventions research, precise enough for an agent with no access to this repo's habits.
- **The seam**: the version handshake, the compatibility statement, who bumps what.
- **The README a stranger follows** (graduated from the map's fog when
  [CI for the integration repo](12-ci-for-the-integration-repo.md) resolved): install, claim,
  revoke; the two or three copy-paste automations [ADR-0036](../../../docs/adr/0036-the-deployment-never-wakes-a-hub.md)
  committed to (chime before bottle end, announce a Feed due); one tile-card `name:` override
  example (long German names truncate on narrow tiles); a script example giving a one-press
  bottle button via `log_bottle_feed`, from [The action surface](07-the-action-surface.md); and
  the three-column compatibility table — integration / needs server / needs Home Assistant.
- **Explicit non-goals**, carried from the map's Out of scope: no card, no core submission, no other ecosystems, no Notice delivery to Hubs (link the ADR from [What a Hub does with a Notice](03-what-a-hub-does-with-a-notice.md)).
- Check every glossary term against `CONTEXT.md`; if **Hub** entered it, the spec speaks it — if not, the spec says why not yet.

Closing this ticket closes the map: the destination is the spec existing with nothing architectural undecided.
