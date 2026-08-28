# 06 — The entity model

Type: grilling
Status: resolved
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

## Answer

Grilled 2026-08-27/28, all recommendations taken; staged on the dev instance and looked at ([`assets/06-wandpanel-de.png`](../assets/06-wandpanel-de.png)).

### Devices

One HA **device per Baby**, named as the Household spelled her, plus one **Household device** (named for the Household) — topology (b). A Baby added after the config entry exists appears via the `dynamic-devices` idiom; a deleted Baby's device goes stale-and-removable. `unique_id` scheme: `{baby_id}_{key}` per entity, `{household_id}_last_update` on the Household device.

### Sixteen entities per Baby, one on the Household

**Timestamp sensors (7)** — `device_class: timestamp`, so relative rendering is HA's, live and localized:

| key | carries | unknown when |
|---|---|---|
| `last_feed` | latest live Feed's start (`feed.lastAt`) | no Feed yet |
| `feed_due` | `feedDueInstant` — the one Night-Period-shifted due | no Feed Interval Target, or no Feed |
| `asleep_since` | running Sleep's start | awake |
| `awake_since` | last Sleep's end | asleep, or no Sleep yet |
| `wake_window_up` | sleep due instant (deliberately *not* night-shifted, `targets.ts:107`) | asleep, no Wake Window Target, or no Sleep |
| `bottle_runs_out` | earliest open bottle's due instant (`anchorEntry`, `targets.ts:132`) | no bottle open — **never** for lack of a Target (`bottleTargetOf` synthesizes 1 h, `targets.ts:170`) |
| `last_poop` | all-time last poop — reaches past the Day Start on purpose | no poop yet |

**Binary sensors (3)**: `asleep`, `feeding` (any live Feed), `bottle_open`. No HA device class fits any of them; translated names carry the meaning. They are the automation *conditions* where the timestamps are the *triggers*.

**Numeric sensors (6)** — all `state_class: total` with `last_reset` = the Day Start instant in the Household Zone (computed server-side, never HA's midnight), so HA's recorder graphs daily totals natively and the reset is declared:

- `feeds_today` — **rounds**, not rows (15-minute gap merges a Combined Feed, `stats.ts:29` — matches the app's stats card)
- `milk_today` — Intake ml (volume minus Leftover); *appears on first bottle*
- `sleep_today`, `tummy_today` — minutes, `device_class: duration` (the fold's ms, floored to the honest unit; cards format)
- `pees_today`, `poops_today` — counts

**Household device (1)**: `last_update` — diagnostic timestamp (`EntityCategory.DIAGNOSTIC`), when the coordinator last heard the server. The staleness tell that entity availability cannot express ("connected but stale since 14:02").

### Existence rules

Entities **exist with state `unknown`** when inapplicable — a cleared Target must never break a family's dashboard or automations. The one exception is the **appear-on-first-use group**: `tummy_today` (and any future tummy entity) and `milk_today` follow the payload — the server omits the field until the Household has ever logged Tummy Time / a bottle (the same `has*` gating `statsFor` plays, `stats.ts:286-345`), the integration creates entities from what the payload carries, and nothing is ever removed once created. The rule only adds.

### Deliberately absent

Milestones, Measurements, Meals/Foods, per-Entry detail — the Hub reads a header, not a timeline (writes are ticket 07's question). No night/nap split sensors in v1 (the fold's `SleepSecondary` could feed them later; the wall answers "how much today"). No tummy-start timestamp and no tummy binary — the glossary itself rules it: Tummy Time "answers how many minutes there were today, never when one began".

### Languages and names

**The language set is en/de/ro, not en/de/fr** — the app's message files are `messages/{en,de,ro}.json`; there is no French anywhere in the app. The map and the conventions research said fr; corrected on the map. Names word-for-word from the glossary and the app's own strings (`type_*`, `header_*`, `stats_card_*`); HA composes "Emma …" in front via `has_entity_name`:

| key | en | de | ro |
|---|---|---|---|
| `last_feed` | Last feed | Letzte Mahlzeit | Ultima masă |
| `feed_due` | Feed due | Mahlzeit fällig | ⚠ Masa următoare |
| `asleep_since` | Asleep since | Schläft seit | ⚠ Doarme de la |
| `awake_since` | Awake since | Wach seit | ⚠ Trează de la |
| `wake_window_up` | Wake window up | ⚠ Wachfenster vorbei | ⚠ Fereastra de veghe expiră |
| `bottle_runs_out` | Bottle life runs out | ⚠ Fläschchen läuft ab | ⚠ Biberonul expiră |
| `last_poop` | Last poop | Letztes Kaka | Ultimul caca |
| `asleep` | Asleep | Schläft | Doarme |
| `feeding` | Feeding | Trinkt | Mănâncă |
| `bottle_open` | Bottle open | ⚠ Fläschchen offen | ⚠ Biberon deschis |
| `feeds_today` | Feeds today | Mahlzeiten heute | Mese azi |
| `milk_today` | Milk today | ⚠ Milch heute | ⚠ Lapte azi |
| `sleep_today` | Sleep today | Schlaf heute | Somn azi |
| `pees_today` | Pees today | Pipi heute | Pipi azi |
| `poops_today` | Poops today | Kaka heute | Caca azi |
| `tummy_today` | Tummy time today | Bauchzeit heute | Timp pe burtică azi |
| `last_update` | Last update | Zuletzt aktualisiert | Ultima actualizare |

⚠ = coined here (no app string exists); the ro cells want a native speaker's pass before the integration's `translations/ro.json` ships — spec-assembly carries the flag.

### Seen on the dev instance

The seventeen entities live as German template mocks in `ha/config/configuration.yaml` (replacing the smoke-test sensor, as its comment promised), on a stock-tile **Wandpanel** dashboard (`/baby-wandpanel`, sections: Mahlzeit / Schlaf / Pipi & Kaka / Heute) — [`assets/06-wandpanel-de.png`](../assets/06-wandpanel-de.png). Relative German rendering ("Vor 12 Minuten", "In 3 Stunden") and `Unbekannt` for the sleeping dash all come free. One observed wrinkle: long compound names truncate on narrow tiles ("Emma Wachfenster vor…") — stock tile cards accept a per-card `name:` override, so this is a dashboard-authoring concern, not a naming mistake; the README's example dashboard should show the override once.
