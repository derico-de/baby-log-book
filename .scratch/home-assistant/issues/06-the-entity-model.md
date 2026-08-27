# 06 — The entity model

Type: grilling
Status: open
Blocked by: 01, 02

## Question

The highest-leverage decision on the map: **get the entity model right and the dashboard is stock tile cards** — and every automation a family writes couples to it, so changing it later breaks other people's homes. Decided against the real instance from [A Home Assistant in the dev env](01-ha-in-the-dev-env.md) and the conventions from [What a custom integration must be](02-what-a-custom-integration-must-be.md); ticket 29's sketch is the starting point, not the answer.

Per Baby (an HA *device* per Baby, presumably):

- **Timestamp sensors** — last Feed, next Feed due, sleep start, awake since, wake window up, bottle life runs out. Which of these exist, which are `unknown` when no Target is stated, and whether the *due* ones carry the Night Period's redirect (they must — `feedDueInstant` already does).
- **Binary sensor** — asleep. Anything else (bottle open?)?
- **Numeric sensors** — today's feeds, millilitres, sleep hours, pees, poops, tummy minutes. "Today" is the Household's Day Start in the Household Zone, computed server-side — a sensor must never re-derive it from HA's local midnight.
- **What is deliberately absent** — Milestones, Measurements, per-Entry detail: the Hub reads a header, not a timeline.
- **Multi-Baby** — how entities group and name when the Household has two, and what happens when a Baby is added after the config entry exists.
- **Tummy Time's rule travels**: a Household that does not track it never sees it — does an entity model tolerate entities appearing on first use, or is that the same age-logic-free trick `statsFor` plays?
- **Naming and translations** in en/de/fr, per the research's conventions.

Look at it on the dev-env instance before closing: nine entities per Baby on a wall-panel dashboard, in German.
