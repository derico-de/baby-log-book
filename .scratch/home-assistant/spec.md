# Home Assistant integration — Specification

**Status**: locked. This is the destination artefact of the [Home Assistant map](map.md) — twelve tickets, six ADRs and a conventions research file, assembled into one document. Nothing architectural in here is still open.

**Who this is for**: two build agents who were in none of those sessions. One builds the **server half** in this repo and has this repo's habits, its `CONTEXT.md` and its ADRs to lean on. The other builds the **integration half** in `baby-log-book-homeassistant` and has none of that — it is a Python custom integration written against Home Assistant's conventions, not this repo's, so everything it needs is stated here explicitly rather than left to house style.

## How to read it

Four artefacts, and they do different jobs. Do not duplicate between them.

| Artefact | Holds |
|---|---|
| [`CONTEXT.md`](../../CONTEXT.md) | The **vocabulary**. Every capitalised term below is defined there, **Hub** included. |
| [`docs/adr/`](../../docs/adr/) | The **decisions** that were expensive to reach and are costly to revisit — each with its consequences. Six govern this spec: [0034](../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md), [0036](../../docs/adr/0036-the-deployment-never-wakes-a-hub.md), [0037](../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md), [0038](../../docs/adr/0038-a-hubs-member-is-marked-and-a-hub-stays-a-caregiver.md), [0039](../../docs/adr/0039-the-integration-gates-on-the-server-release.md), and [0019](../../docs/adr/0019-a-new-feed-ends-the-running-one.md) as ADR-0034 amends it. |
| [`research/ha-integration-conventions.md`](research/ha-integration-conventions.md) | **What Home Assistant expects in 2026**, verified against HA 2026.8.3 on a real instance. The Python half's reference for every idiom this spec names but does not re-teach. |
| This spec | The **shape of the thing**: the wire, the entities, the actions, the failure taxonomy, the packaging, and who bumps what. |

The reasoning behind any line here lives on its ticket, linked inline. **When this spec and a ticket disagree, this spec wins** — later tickets corrected earlier ones, two ADRs landed after the tickets closed, and the corrections are folded in here. Three such corrections are called out where they bite: [§5.6](#56-the-conditional-contract), [§6.5](#65-devices-and-entities) and [§6.3](#63-the-failure-taxonomy).

A word on capitalisation: **Household**, **Baby**, **Member**, **Hub**, **Entry**, **Feed**, **Sleep**, **Target**, **Day Start**, **Night Period**, **Claim Link**, **Invite**, **Rescue Link** and their siblings are domain terms with exact meanings from `CONTEXT.md`. They are capitalised throughout, and they are not synonyms for the everyday words they resemble.

---

## 1. What it is

A **Hub** — a Home Assistant instance watching a Household from a screen on a wall — reads the Household's live state and writes a small set of Entries back, as an ordinary Member with an ordinary session.

It is not a second sync path. [ADR-0034](../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md) is the floor and every line below obeys it:

- **A Hub gets in exactly as a phone does** — it claims a Claim Link and holds a session. Nothing new is invented for authentication.
- **A Hub holds no replica.** It folds nothing and cannot answer *when did she last feed* from anything it has. It reads **one derived endpoint** that ships **no rows** — the app's own folds, run server-side.
- **A Hub writes down the one write path there is** — plain revisions to `POST /api/sync/push`, client-minted ids, insert-only, retry-safe.
- **A Hub is a Caregiver**, deliberately. That role is the blast radius for a credential sitting at rest on a box in a hall against a public origin.
- **No CORS, ever, and no cross-site cookie.** The Hub reads and writes server-to-server. Whatever it draws on a screen, it draws from itself.
- **No action API.** *Start a feed* means one thing in one place.

Two shapes follow from the product, not from the protocol:

**Home Assistant is the automation engine.** The deployment never wakes a Hub ([ADR-0036](../../docs/adr/0036-the-deployment-never-wakes-a-hub.md)). A **Notice** rides a Push Subscription a browser mints, and a Hub has no browser to mint one. What crosses the wire is **instants** — *feed due at*, *bottle life runs out at* — and the Household writes its own automation on top. The family-facing sentence, for the README and for anyone who asks why the wall panel does not beep:

> The app states when things are due; what your home does about it — a chime on the hall speaker, a light that warms, nothing at all — is an automation you write in Home Assistant, which is better at that than we will ever be.

**The wall reads a header, not a timeline.** Milestones, Measurements, Meals, per-Entry detail and Revision history are deliberately absent from both halves. A Hub answers *how is today going*; the phone answers everything else.

---

## 2. Scope

### v1 — what gets built

**Server half** (this repo):

- `GET /api/hub/state` — the one derived read, conditional from the first commit ([§5.5](#55-get-apihubstate), [§5.6](#56-the-conditional-contract)).
- `liveEntries()` in `store.ts` — the one new store function ([§5.4](#54-the-one-new-store-function)).
- [ADR-0019](../../docs/adr/0019-a-new-feed-ends-the-running-one.md) moved into the push transaction ([§5.3](#53-adr-0019-moves-into-the-push-transaction)).
- The **Hub mark** on a Member, stated on the Invite and stamped at claim ([§5.1](#51-the-hubs-member)).
- The **Rescue Link minted from Settings** ([§5.2](#52-the-rescue-link-in-settings)).
- The `402 lapsed` rows on the state read and on claim — contract only, until the hosted-service effort implements Lapsed ([§5.7](#57-the-error-contract)).

**Integration half** (`baby-log-book-homeassistant`):

- Config flow and re-auth against a pasted Claim Link ([§6.2](#62-the-config-flow)).
- A `DataUpdateCoordinator` on SSE-wake-plus-poll with jittered backoff ([§6.4](#64-the-coordinator)).
- Per-Baby devices carrying **sixteen** entities each, plus a Household device carrying **two** ([§6.5](#65-devices-and-entities)).
- Six buttons and two services per Baby, over a bounded, visible outbox ([§6.6](#66-the-action-surface)).
- Translations in en/de/ro, repair issues, HACS packaging, CI ([§6.7](#67-repair-issues)–[§6.10](#610-ci)).

### Non-goals

Carried from the map's **Out of scope**, and from the tickets that ruled each one out. These are decided, not deferred by omission:

- **No custom Lit card.** Entities plus stock tile cards are the destination. A card is polish, not capability, and wants designing against a real wall panel — a later effort.
- **No Home Assistant core submission.** The quality-scale ladder, the brands repo beyond what HACS itself demands, and the core review queue are all out. HACS-installable is the bar.
- **No other hub ecosystems** — no HomeKit, no Google Home, no MQTT bridge. Ruled out with reasons in [ticket 29](../baby-log-book/issues/29-home-assistant-integration.md) of the first map.
- **No Notice delivery to a Hub**, ever — [ADR-0036](../../docs/adr/0036-the-deployment-never-wakes-a-hub.md). Not the two Notice Offsets, not the Bottle Chime's ten minutes. Raw due instants only.
- **No per-Device session revoke.** Removing the Hub's Member unplugs the panel, which is the control this map needs; the general feature is real and missing and belongs to another effort ([ADR-0037](../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md)).
- **No shared code across the repo boundary.** This spec re-states the wire shapes; Python implements them fresh ([§7.4](#74-the-licence-across-the-boundary)).
- **Building either half is not this map.** This spec is the hand-off.

---

## 3. Vocabulary

**Hub** is in [`CONTEXT.md`](../../CONTEXT.md), entered when [The Hub in the members list](issues/05-the-hub-in-the-members-list.md) resolved, with ADR-0034's broad boundary: *anything that watches a Household from a screen on a wall.* Home Assistant is the first one, not the definition. `CONTEXT.md`'s **Member** entry owns the machine case.

Both halves speak the glossary word for word:

- The endpoint is `/api/hub/state`, **not** `/api/companion/state`. The API surface follows `CONTEXT.md` like every other surface. The word *companion* appears nowhere.
- Entity and service names in all three languages come from the app's own message files, not from fresh translation ([§6.8](#68-translations)).
- The integration's user-facing English says *Baby*, *Household*, *Member*, *Claim Link* — the same words the app says.
- **Hub** stays **Hub** in every UI language, in the app and in the integration alike ([ADR-0038](../../docs/adr/0038-a-hubs-member-is-marked-and-a-hub-stays-a-caregiver.md)).

---

## 4. The seam at a glance

```
   Home Assistant                            Baby Log Book server
   ─────────────                             ────────────────────
   config flow ──── POST /api/claim ───────► claims.ts  (Invite for a Hub,
        │                                     or Rescue Link → re-bind)
        │           session cookie
        ▼
   coordinator ◄─── GET /api/sync/live ───── SSE wake signal
        │      ──── GET /api/hub/state ────► headerState() + statsFor()
        │           If-None-Match / 304        over liveEntries()
        ▼
   16 entities per Baby, 2 on the Household
        │
   buttons + 2 services
        │
        └──────── POST /api/sync/push ─────► push()  — plain revisions,
                  bounded outbox              Session Merge, ADR-0019,
                                              closePastBottles
```

One session, two directions, nothing else. The Hub never calls `/api/sync/pull` and never receives a Revision.

---

## 5. The server half

Built in this repo, in this repo's house style, with this repo's tests. Everything here is new work except where noted.

### 5.1 The Hub's Member

A Hub claims as **its own Member** in the **Caregiver** role, so attribution stays honest — a button on a kitchen wall is pressed by whoever is standing at it, and *Home Assistant* is the true answer — and so removing it unplugs the hall panel without signing anyone's phone out.

**The list marks a Hub from a stored fact, not a guess** ([ADR-0038](../../docs/adr/0038-a-hubs-member-is-marked-and-a-hub-stays-a-caregiver.md)). A Member is marked at creation as a person's or a Hub's:

1. The Parent states it **on the Invite** — a *this is for a Hub* choice in the invite form, which also **locks the role to Caregiver at mint time**.
2. The Claim Link stores the mark beside the display name and role (`claim_links` gains a column alongside `role`).
3. The claim **stamps it onto the Member** (`members` gains a `kind` column, `'person' | 'hub'`, default `'person'`).
4. It **syncs outward with the member data exactly as `role` does** — the replicas must hear it or no screen can show it.

**Server-stamped, immutable.** Push validation never accepts the mark from any client — it belongs in `refuseByRole`'s neighbourhood as a field no revision may carry. There is no toggle and no "hub became a person" history. A mis-marked Member — a human claimed a Hub Invite in a browser — is fixed by Remove and re-invite.

**A Hub cannot be promoted to Parent.** A subject-based refusal in `push()`, beside the existing last-Parent rule (`refuseLastParent`): a revision setting `role: 'parent'` on a Member whose `kind` is `'hub'` is rejected. The UI hides the role toggle on Hub rows. Anything less quietly deletes ADR-0034's blast-radius argument, which is the reason the Caregiver role was chosen in the first place.

**Surfaces:**

- The members list in Settings reads `Home Assistant · Hub · Caregiver` — kind beside role, the same `·` suffix grammar the row already uses.
- The remove confirmation gains one Hub sentence: it unplugs the panel, it stops reading and writing at once, and its Entries remain.
- `babylog members` prints the kind on the status line.

### 5.2 The Rescue Link in Settings

`mintRescue` exists and the rescue **claim** path in `claims.ts` is already exactly right — it re-binds an existing Member and creates nothing. Only the minting surface is CLI-locked (`babylog rescue` under `docker exec`), which reaches self-hosters and nobody else. A Hub against a public origin makes re-binding routine, so the integration cannot ship a re-auth flow only self-hosters can complete.

[ADR-0037](../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md), in full:

- **The Rescue Link is mintable from Settings.** Any Member may mint one **for themselves**; a **Parent** may mint one for **any Member**. Self-rescue is no new power — it is *add my tablet*, which the Rescue Link was always also for. A Parent minting a link that binds a Device writing as another Member **is** new power, and it is named as such in the ADR and counterweighted by (4) below.
- **Old sessions are untouched on claim, always.** One link, one meaning: *bind this Member to another Device*, silent about the old ones. A rescue is *add* as much as *recover* — `CONTEXT.md`'s Device entry has no other link that binds to an existing Member — so an auto-revoke-on-claim would sign the phone out for adding the tablet.
- **One TTL, 60 minutes, everywhere — CLI included.** `RESCUE_TTL_MS` rises from 15 minutes (`claims.ts:38`). Fifteen was priced for an operator standing at a terminal; a Settings mint travels over WhatsApp to someone fumbling with a new phone. An Invite's TTL is unchanged at 7 days.
- **An unclaimed rescue is visible and revocable.** It joins the pending-Invites list, named for the Member it re-binds, revocable by any Parent, with `created_by` recorded.
- **Removal burns pending rescues** for the Removed Member. `revokeMember` already kills every session, so a stolen hub credential that self-rescues gains no persistence that removal does not end. ADR-0034's *cannot open the door to another Device* narrows to *another **Member***.

The sole-Parent-lost-phone case stays the operator's terminal **by construction** — no session exists to mint from. Nothing here reopens in the hosted-service map.

### 5.3 ADR-0019 moves into the push transaction

*A Baby eats one thing at a time* is enforced today in the feed sheet's Save and Start-timer paths, which means it is enforced **for one writer**. [ADR-0034](../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md) moves it into `push()`, where Session Merge and `closePastBottles` already live:

- **The guard is unchanged**: a new feeding ends the running Feed **only when the new feeding's Occurred At falls inside the running Feed**. A back-dated feeding predating it is a separate, earlier feed and leaves the running one alone.
- It runs inside the same transaction as the batch, alongside `closePastBottles(db, householdId, now)` at the end of `push()` (`sync.ts:311`).
- The end revision is attributed to **the Member who logged the new feeding**, as ADR-0019 already specifies — not to `'server'`, unlike the past-bottle close which the app authors.
- **It is a fix, not a concession.** Two phones starting a Feed already reach this hole; the client-side guard never covered it. Moving it server-side is what lets a Hub write a plain creation and get the rule for free. *A rule the server does not hold is a rule only the app has.*
- **The client-side guard stays**, because the inline line before saving (*"ends the running feed at 14:05"*) is real copy about a real write and must still be shown. The server becomes the authority; the sheet keeps the preview.

**Tests this must carry**: the offline-second-Device case — two Devices each start a Feed while partitioned, both push, and the result is the one ADR-0014 and ADR-0019 jointly describe (both rows survive, each earlier Feed carries the end it in fact had, nothing is tombstoned and no millilitres leave the day).

### 5.4 The one new store function

```ts
export function liveEntries(db: Db, householdId: string): Entry[]
```

All live Entries of the Household — **not** a `since`-bounded fetch, and this is deliberate. The folds' lookbacks are unbounded: `last_poop` and `last_feed` reach arbitrarily far back, `statsFor` wants fifteen day-buckets, and the ever-logged gate ([§5.5](#55-get-apihubstate)) wants the whole log. A floor would quietly break *she hasn't pooped since Tuesday*, which is exactly the kind of question a wall panel exists to answer.

A heavy year is tens of thousands of SQLite rows and folds in milliseconds, and the fold only runs on a content change or once at each boundary ([§5.6](#56-the-conditional-contract)). **Escape hatch recorded, not built**: if folding ever shows up in a profile, memoize the rendered payload keyed by the ETag.

**Both folds run unmodified.** `headerState()` and `statsFor()` are called exactly as the app calls them, the way `notify.ts` already calls them server-side. The wall cannot disagree with the app's own header, because it is the same fold.

### 5.5 `GET /api/hub/state`

No parameters and no ids: the session names the Household, and the payload carries every Baby. One schema whether the Household has one Baby or three.

The path is **release-coupled** — the integration hardcodes it — so it is final at the first integration release.

Epoch-milliseconds instants everywhere, one representation across the whole API. Field names are **byte-for-byte the entity `unique_id` keys** from [§6.5](#65-devices-and-entities), so payload→entity needs no translation table.

```jsonc
{
  // versionBlock(), verbatim — api.ts:33, the handshake block of ADR-0039
  "protocol_version": 2,
  "app_version": "1.25.0",
  "git_sha": "…",
  "source": "…",
  "server_time": 1724800000000,

  "cursor": 1234,                     // the same number the ETag folds in
  "household": {
    "id": "…",
    "name": "…",
    "day_reset_at": 1724821200000,    // today's Day Start instant, Household Zone
    "caregiving": true                // ADR-0041 — see below
  },
  "babies": [
    {
      "id": "…",
      "name": "Emma",                 // HA device name, as the Household spelled her

      // timestamps (7)
      "last_feed": 1724798000000,
      "feed_due": 1724805200000,
      "asleep_since": null,
      "awake_since": 1724795000000,
      "wake_window_up": 1724801000000,
      "bottle_runs_out": null,
      "last_poop": 1724790000000,

      // binaries (3)
      "asleep": false,
      "feeding": false,
      "bottle_open": false,

      // the running sessions' ids (3) — handles for the wall's end buttons
      "feed_entry_id": null,
      "sleep_entry_id": null,
      "tummy_entry_id": null,

      // totals (6) — sleep and tummy in minutes, floored server-side
      "feeds_today": 5,
      "sleep_today": 154,
      "tummy_today": 12,
      "pees_today": 4,
      "poops_today": 2,
      "milk_today": 240
    }
  ]
}
```

Field rules:

- **Inapplicable is `null`**, and the entity shows `unknown`. A cleared Target must never break a family's dashboard or automations.
- **`milk_today` and `tummy_today` are omitted, not null, until first use** — and the gate is **ever-logged**, a cheap predicate over the live entries the fold already fetched. It is *not* `statsFor`'s window-scoped `has*`: once a Household has tracked tummy time, *0 minutes today* is a true statement forever, and the payload must never drop a field it once carried. **The rule only adds**, on the wire as well as in the integration.
- **`day_reset_at` is Household-level.** Day Start is a Household setting, not a per-Baby one. It becomes every total's `last_reset`.
- **`caregiving` is Household-level**, the synced `household.caregiving` field (`types.ts:216`) passed straight through. See the correction note below.
- **`feeds_today` counts rounds, not rows** — `FEED_ROUND_GAP_MS`, fifteen minutes (`stats.ts:29`), so a breast feed and the formula topped up right after are one answer to *has she eaten*. This matches the app's own stats card.
- **`sleep_today` and `tummy_today` are whole minutes**, floored server-side from the fold's milliseconds. The honest unit for a wall.
- The Household device's `last_update` diagnostic needs **no field**: it is the coordinator's own *when did I last hear the server*.
- **The three `*_entry_id` fields name the sessions running right now**, and nothing else. They are `null` when nothing runs, and they are **handles, not log**: a wall's *End feed*, *She's awake* and *Off her tummy* write `ended_at` on a running Entry, and a revision addresses its entity by id ([§6.6](#66-the-action-surface)). See the correction note below.
- **Deliberately absent stays absent**: no Entries, no Meals, no Milestones, no Measurements, no ids of anything closed, deleted or historical, no Revision history.

> **Correction — `caregiving` is new here.** [ADR-0041](../../docs/adr/0041-caregiving-off-silences-the-caregivers-not-the-parents.md) landed on 2026-09-05, after every entity ticket closed, and its consequences claim *"A Hub goes quiet, and that is the point… A wall panel announcing a feed into an empty flat is the noise the switch exists to stop."* That sentence reasons about push delivery, and no Notice ever reaches a Hub ([ADR-0036](../../docs/adr/0036-the-deployment-never-wakes-a-hub.md)) — so there was nothing for the role filter to suppress, and the announcing is done by the family's own automation firing off a timestamp sensor. Without `caregiving` on the wire, a Household switches the cover off, every phone goes quiet as designed, and the hall panel announces the 02:00 feed into the empty flat: the one outcome ADR-0041 explicitly claims it prevents. The wire cost is one boolean on a field that already syncs. **The server does not withhold sensor values when Caregiving is off** — that would be the deployment reaching into the wall to switch it off, and it would make every derived total lie. The app states; the Household's automation decides, which is the split ADR-0041 actually chose. The README's announce automations carry the condition by default ([§8](#8-the-readme-a-stranger-follows)).

> **Correction — the three running-session ids are new here.** [Ticket 09](issues/09-the-wire-contract.md) wrote *no per-Entry ids* about the log, and [ticket 07](issues/07-the-action-surface.md) gave the wall three buttons that end a running session. The build found the two cannot both be true: `ended_at` is a field on an Entry, a revision addresses its entity **by id**, and there is no action API to resolve *the running Sleep* server-side ([ADR-0034](../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md): *no action API — start a feed means one thing in one place*). Without them the only endable session would be one this Hub itself started, so a Sleep begun on a phone could never be stopped at the wall — and *She's awake* is the button a passing parent presses most. The rejected alternative, letting the Hub read `/api/sync/pull`, would hand it a replica and delete ADR-0034's floor. The wire cost is three nullable strings; the tenancy cost is none, because the id a Hub sends back is a client-supplied id like the `baby_id` beside it and `entityBelongsElsewhere` is what makes it safe ([ADR-0020](../../docs/adr/0020-one-deployment-many-households.md)). Nothing closed, deleted or historical is named, so *how is today going* is still all the payload answers.

### 5.6 The conditional contract

The endpoint is conditional from the first commit. A phone disconnects; a Hub never does, and [ADR-0021](../../docs/adr/0021-the-paid-service-scales-by-files-not-by-postgres.md) plans hundreds of Households in one process holding idle SSE connections.

**The payload is a pure function of `(log, targets, settings, dayKey, nightBegun)`.** [ADR-0036](../../docs/adr/0036-the-deployment-never-wakes-a-hub.md) already removed `now` from the wire by shipping instants only — no `elapsedMs`, no `remainingMs`, no `overdue`; the Hub derives all three itself, exactly as `device_class: timestamp` wants and exactly as the phone ticks its timers with no traffic. What remains of `now` is **piecewise-constant with two known breakpoints per day**, and the honest ETag is the identity of that tuple:

**Strong ETag: `"<cursor>-<dayKey>-<nightBegun>"`**

| component | source | flips at |
|---|---|---|
| `cursor` | `currentCursor(db, householdId)` | every accepted revision |
| `dayKey` | `dayBucketOf(now, dayStart, zone)` — the app's own day-key function | the Day Start |
| `nightBegun` | `0` or `1` — whether the Night Period in force has begun | the stated Night Start |

- The **`dayKey`** closes the Day-Start hole: today's totals reset with no new revision, so without it a `304` would hold the Hub on yesterday's numbers. The ETag misses exactly once, refolds, and serves the new day.
- The **`nightBegun`** bit closes the Night-Start hole. See the correction below.
- The Hub **echoes the ETag verbatim in `If-None-Match` and never parses it** — stated as contract, so the format stays a server freedom and both of these components remain reversible.
- A match answers **`304` with an empty body**.

**Check order, per request** — this ordering is contract, not an implementation detail:

```
session → removed → lapsed → ETag → fetch → fold
```

A quiet night therefore costs `currentCursor()` plus a day-key and night-key computation, and never a fold.

> **Correction — the night key is new here.** [Ticket 09](issues/09-the-wire-contract.md) proved the payload pure over `(log, targets, settings, dayKey)` and built the ETag on exactly that basis. [ADR-0040](../../docs/adr/0040-the-night-moves-a-feed-only-once-it-has-begun.md) landed the next day — commit `b01b976`, after ticket 09's `76fd61b` — and gave `feedDueInstant` a `now`: a due instant inside the Night Period moves to the Day Start **only once that Night has begun** (`pastNight`, `time.ts:296-301`). So `feed_due` changes at the stated Night Start with **no new revision and no day-key change**, and a two-component ETag would leave the wall announcing *due 22:03* long after every phone in the house had moved on to the morning — the stale-answer failure ticket 09 exists to prevent, landing during waking hours rather than at 05:00. The dependence is monotone (ADR-0040: *once a Night has begun it never un-begins*), so one bit is enough. Cost: at most one extra miss per day — the bit flips true at the Night Start and back at the Day Start, where `dayKey` already forces a miss. A Household with no Night Period (`nightPeriodOf` returns `null`) pins the bit at `0` and sees no extra fold. **The rejected alternative** — ship `feed_due` un-shifted and let Python re-apply the night rule — would put a second implementation of ADR-0032 and ADR-0040 in another language, which is precisely what ADR-0034 refuses.

`statsFor` and `headerState` were both checked for other `now` dependencies at assembly time: `statsFor`'s `now` only picks the day bucket (`stats.ts:146`), and `headerState`'s only produces `elapsedMs`, `remainingMs`, `absolute` and `overdue` (`targets.ts:386-398`) — none of which reach the wire. `feed_due` is the only instant-valued output that moves with the clock.

### 5.7 The error contract

Every error body is `{ "code": …, …versionBlock() }` — exactly the existing `requireMember` shape (`api.ts:52`), so nothing new is invented.

| status | code | when | the integration's response |
|---|---|---|---|
| `401` | `unauthenticated` | the session proof is stale | re-auth flow → a fresh Claim Link |
| `403` | `removed` | the Member has been Removed | the config entry is dead: repair issue, stop polling |
| `402` | `lapsed` | the Household has Lapsed | repair issue *hosting is paused*; keep the entry, poll gently |

- **`lapsed` is checked before any fold** and **before the ETag check** ([ADR-0022](../../docs/adr/0022-a-lapsed-household-stops-syncing.md): no read-only tier by accident) — so a Lapsed Household cannot even learn *nothing changed*.
- The **status-level distinction** means the integration never parses a body to know which flow it is in.
- **`POST /api/claim` and the preview gain `402 { code: "lapsed" }` too, checked before the link is spent.** Letting the claim succeed would burn a one-shot link and mint a session into a Household that then 402s everything. This gates **all** claims, not just a Hub's — a phone claiming an Invite into a Lapsed Household is the same trap.
- **Lapsed is contract-only until the hosted-service effort implements it.** The code does not implement Lapsed yet. The contract names it now so the Python half handles it from day one and needs no later release to learn how.

### 5.8 Clock offset

`offset := server_time − local_now`, updated on **every non-304 response** — state reads and push responses alike — and applied to merge keys per [ADR-0034](../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md). A Hub that was cut off writes the same slightly-late revision a phone would, clamped and flagged rather than refused.

`304`s carry no clock channel, and that is safe by construction: the nightly Day-Start miss guarantees at least one `200` per day — far tighter than the push path's five-minute `SKEW_TOLERANCE_MS`.

### 5.9 Server-half build checklist

1. `members.kind` and `claim_links.kind_for` columns, migration, and the mark synced outward with the member data ([§5.1](#51-the-hubs-member)).
2. *This is for a Hub* on the invite form; role locked to Caregiver at mint.
3. `refuseByRole`-adjacent refusals: no client may set `kind`; no Hub may become a Parent.
4. Members list, remove confirmation, and `babylog members` show the kind.
5. `RESCUE_TTL_MS` → 60 minutes; Rescue Link minting in Settings (self for any Member, any Member for a Parent); pending rescues in the pending-Invites list, revocable, `created_by` recorded; Removal burns them ([§5.2](#52-the-rescue-link-in-settings)).
6. ADR-0019 into `push()`, with the offline-second-Device tests ([§5.3](#53-adr-0019-moves-into-the-push-transaction)).
7. `liveEntries()` in `store.ts` ([§5.4](#54-the-one-new-store-function)).
8. `GET /api/hub/state` with the payload, the three-component ETag and the check order ([§5.5](#55-get-apihubstate), [§5.6](#56-the-conditional-contract)).
9. `402 lapsed` on the state read, on `GET /api/claim` and on `POST /api/claim` ([§5.7](#57-the-error-contract)).
10. Server README links once to the integration's compatibility table ([§7.3](#73-the-compatibility-statement)).

Everything here follows this repo's ordinary rules — a CHANGELOG line per change, an ADR for anything expensive to reverse, tests rather than verification scripts.

---

## 6. The integration half

Built in `derico-de/baby-log-book-homeassistant`, a sibling checkout inside the same mount at [`../../../baby-log-book-homeassistant`](../../../baby-log-book-homeassistant). Its `AGENTS.md` restates the rules an AFK build must not violate.

This half has none of the server repo's habits to lean on, so the sections below name Home Assistant's idiom for every case. Where an idiom needs teaching rather than naming, [`research/ha-integration-conventions.md`](research/ha-integration-conventions.md) has it, verified against HA 2026.8.3 — that file is the reference, this spec is the decision.

### 6.1 Repo, domain and layout

- **Integration domain: `baby_log_book`.** Immutable once config entries exist anywhere.
- **`manifest.json → name` and `hacs.json → name` both read `Baby Log Book`** — that is what HACS shows and what the user sees.
- `integration_type: device`, `iot_class: local_push`, `config_flow: true`, `codeowners`, and `quality_scale` omitted (a custom integration is not on the ladder — see [§6.10](#610-ci)).
- No third-party runtime dependency beyond what HA ships: the client is `aiohttp` against three endpoints.

```
custom_components/baby_log_book/
  __init__.py          # async_setup (services), async_setup_entry (coordinator, platforms)
  api.py               # the three calls, the ETag cache, the clock offset
  coordinator.py       # SSE wake + poll fallback, backoff, the outbox
  config_flow.py       # claim, re-auth, the failure taxonomy
  sensor.py binary_sensor.py button.py
  repairs.py
  const.py             # DOMAIN, MIN_SERVER_VERSION, cadence constants
  services.yaml icons.json manifest.json
  translations/{en,de,ro}.json
hacs.json
.github/workflows/{ci.yml,release.yml}
```

### 6.2 The config flow

**One form field**: the pasted **Claim Link** URL — exactly what Settings mints and what WhatsApp carries. Nothing else is asked; the URL carries origin and token.

The flow parses origin + token, calls `GET /api/claim?t=…` (`previewLink` — **looking never spends the link**), shows what it found, then on confirm calls `POST /api/claim`.

**The preview answer carries the version block**, as every other answer this API gives does, so the handshake in [§7.1](#71-the-version-handshake) is settled *before* the link is spent — a server too old is a form error the user can act on, not a burnt link. It also makes one request do three jobs: reachability, *is this a Baby Log Book at all*, and the release number.

- **Every pre-claim failure is a form error**, so the user re-pastes rather than starting over.
- **Aborts are reserved for identity outcomes** — `already_configured` and `wrong_member`.
- **Initial setup accepts both kinds of link.** An Invite *for a Hub* creates the Member; a Rescue Link re-binds an existing one ([ADR-0037](../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md): a rescue is *add* as much as *recover*). **Kind is never enforced; identity is** — see the `wrong_member` row in [§6.3](#63-the-failure-taxonomy).
- **The re-auth step reuses the same field and the same error rows.** One code path, two entry points.
- **Config entry `unique_id` = the Household id.** One entry per Household per HA instance; a second wall panel is a second HA instance, not a second entry. `_abort_if_unique_id_configured()` does the work.
- The claimed **Member id** lives in `entry.data`, beside the origin and the session cookie.

**Where credentials live**: the session cookie in `entry.data`, as HA stores every credential — not in `.storage` by hand, not in a file.

### 6.3 The failure taxonomy

Every failure maps to **exactly one** HA idiom. The point of this table is that the Python half never invents a fourth.

**At claim time, in the flow** — all form errors unless marked **abort**:

| failure | detected by | key | message gist |
|---|---|---|---|
| link `expired` | preview / claim | `link_expired` | that link has expired — mint a fresh one in Settings |
| link `used` | preview / claim | `link_used` | already claimed — if that wasn't you, check pending links in Settings |
| link `burnt` | preview / claim | `link_burnt` | revoked — true for both a Parent's revoke and Removal burning rescues, and the flow needn't distinguish |
| link `unknown` | preview / claim | `link_unknown` | not a valid Claim Link |
| origin unreachable | DNS, timeout, refused | `cannot_connect` | HA's standard key |
| origin answers, not our API | preview 404 / non-JSON | `not_baby_log_book` | this address doesn't answer like a Baby Log Book server |
| `http://` against a public host | client-side URL check | `http_public_origin` | a public address must use HTTPS. **Private hosts are exempt** — loopback, RFC1918, `.local`, `.internal`, `.localhost`, and any **single-label** host — so self-hosters and the dev env stay unblocked. The flow checks, because the server cannot reliably see its own scheme behind a proxy |
| Lapsed Household | `402 lapsed` from preview or claim, **before the link is spent** | `hosting_paused` | hosting is paused; a Parent can resume it, then try again. A repair issue cannot be the surface — there is no entry yet |
| server too old | version block vs `MIN_SERVER_VERSION` | `server_too_old` | the claim-time half of ADR-0039's dual gate, with both concrete numbers |
| Household already configured | `unique_id` | **abort** `already_configured` | standard |
| claim yields a different Member (re-auth) | Member id compare, post-claim | **abort** `wrong_member` | the link was for *{name}*, not this panel's Member — mint a Rescue Link for the Hub's Member. The integration first calls `DELETE /api/session` to discard the mis-claimed session: the link is spent, because the preview is deliberately thin and carries no member id, so the mismatch is only visible after claiming — but nothing stays bound wrong |

> **Correction — two more private hosts.** The build added `.localhost` and **any single-label host** to the exempt list. `.localhost` is loopback by RFC 6761, so leaving it out was an oversight rather than a decision. A single-label name — `nas`, `planetmobile`, `babylog` — cannot be a public DNS name, and it is what a home network actually calls its machines; the enumerated list would have refused the commonest self-hosted address there is, which is the outcome the exemption exists to prevent. The gate still refuses plain `http://` to anything with a public-looking dotted name, which is the case it was written for.

> **Correction — the `link_expired` copy.** [Ticket 11](issues/11-the-config-flow-failure-taxonomy.md) worded this row *"Claim Links last 60 minutes"*. That is the **Rescue Link** TTL ([§5.2](#52-the-rescue-link-in-settings)); an **Invite** lasts 7 days (`INVITE_TTL_MS`, `claims.ts:37`), and the preview does not always tell the flow which kind it held. The message must not quote a duration.

**At setup and at runtime:**

| failure | HA idiom | notes |
|---|---|---|
| network error at setup | `ConfigEntryNotReady` | automatic via `async_config_entry_first_refresh()`; HA retries on its own schedule. **Never write a setup retry loop.** |
| network error / 5xx at runtime | `UpdateFailed` | entities go unavailable, cadence unchanged, logged **once per outage** and once on recovery (Silver rule `log-when-unavailable`) |
| `401 unauthenticated` | `ConfigEntryAuthFailed` → re-auth flow | asks for a Rescue Link a Parent mints from Settings — the same words as the lost phone |
| `403 removed` at runtime | repair issue + full stop — **never `ConfigEntryAuthFailed`** | a re-auth dialog would ask for a Rescue Link that cannot exist, because Removal burns them ([ADR-0037](../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md)). Non-fixable issue `member_removed`, severity **error**: a Parent sends a new Invite for a Hub and the integration is added again as a **new entry**, per ADR-0038's unplugged panel. The coordinator stops SSE, sets `update_interval = None`, and raises one `UpdateFailed` so entities go unavailable |
| `403 removed` at setup | `ConfigEntryError` | permanent, no retry |
| `402 lapsed` at runtime | repair issue + gentle poll | non-fixable issue `hosting_paused`, severity **warning** — a billing state, not a defect. `UpdateFailed` so entities go honestly unavailable ([ADR-0022](../../docs/adr/0022-a-lapsed-household-stops-syncing.md)'s full stop; a live-looking stale wall would be read-only sync by the back door). Drop SSE, which 402s too. Poll at the **5-minute floor**, not the 60-second outage cadence — nothing changes while Lapsed. On the first `200`: delete the issue (idempotent), restore SSE and normal cadence. Reactivation stays anticlimactic |
| `402 lapsed` at setup | `ConfigEntryError` + the same repair issue | keeps the entry; retry after reactivation is a reload |
| server rolls back below `MIN_SERVER_VERSION` mid-flight | **deliberately no runtime row** | an operator act, out of contract per ADR-0039. It surfaces as `UpdateFailed` until the next reload hits the setup gate. A per-response version check would be the fourth idiom this table exists to prevent |
| integration too old for the server | repair issue *update the Baby Log Book integration* | as [ADR-0039](../../docs/adr/0039-the-integration-gates-on-the-server-release.md) wrote it |

### 6.4 The coordinator

A `DataUpdateCoordinator` subclass overriding `_async_update_data()`, with `config_entry` passed **explicitly** to the constructor (the implicit `ContextVar` fallback is deprecated and being removed).

**SSE is the wake signal, poll is the fallback.** `GET /api/sync/live` is the existing SSE stream; on a `wake` event the coordinator calls `async_request_refresh()` — the "something changed" pattern, not the "push carries data" one, because the wake carries no payload. Each refresh is a **conditional** state read, so a wake caused by the Hub's own push costs a `304`.

**The cadence numbers are contract**, so the Python half implements them rather than inventing them:

| | value | why |
|---|---|---|
| wake debounce | ~1 s | a burst of revisions is one refresh |
| poll floor, SSE healthy | **5 min** | a safety net; nearly always `304` |
| poll, SSE down | **60 s** | the wall is the Household's live surface, and five stale minutes during an outage would be noticed |
| SSE reconnect backoff | exponential, **base 5 s, cap 5 min, full jitter** | a deploy must not bring the fleet back in one second |
| poll while Lapsed | 5 min | nothing changes while Lapsed |

The Withings pattern is the model: flip `update_interval` when the SSE listener connects and disconnects.

**The conditional read.** The client keeps the last ETag and sends it verbatim in `If-None-Match`. **It never parses the ETag** — the format is the server's freedom. A `304` means *nothing changed*: keep the previous data, and treat it as a successful update.

**The clock offset** is recomputed from `server_time` on **every non-304 response**, state reads and push responses alike, and applied to every merge key the Hub mints ([§5.8](#58-clock-offset)).

### 6.5 Devices and entities

**One HA device per Baby**, named as the Household spelled her, plus **one Household device** named for the Household. A Baby added after the config entry exists appears through the `dynamic-devices` idiom; a deleted Baby's device goes stale and removable.

`unique_id` scheme: `{baby_id}_{key}` per Baby entity, `{household_id}_{key}` on the Household device. **The `{key}` is byte-for-byte the payload field name** ([§5.5](#55-get-apihubstate)) — no translation table.

`_attr_has_entity_name = True` throughout, so HA composes *Emma Last feed* from the device name and the entity name. Names are **translated via `_attr_translation_key`**, never hardcoded English.

**Timestamp sensors (7 per Baby)** — `SensorDeviceClass.TIMESTAMP`, so `native_value` returns a timezone-aware `datetime` (`dt_util.utc_from_timestamp(ms / 1000)`) and the frontend renders it **relative, live-updating and localized** for free — *Vor 12 Minuten*, *In 3 Stunden*:

| key | carries | `unknown` when |
|---|---|---|
| `last_feed` | the latest live Feed's start | no Feed yet |
| `feed_due` | `feedDueInstant` — the one Night-Period-shifted due ([§5.6](#56-the-conditional-contract)) | no Feed Interval Target, or no Feed |
| `asleep_since` | the running Sleep's start | awake |
| `awake_since` | the last Sleep's end | asleep, or no Sleep yet |
| `wake_window_up` | the sleep due instant — deliberately **not** night-shifted | asleep, no Wake Window Target, or no Sleep |
| `bottle_runs_out` | the earliest open bottle's due instant | no bottle open — **never** for lack of a Target, since `bottleTargetOf` synthesizes one hour |
| `last_poop` | the all-time last poop, reaching past the Day Start on purpose | no poop yet |

**Binary sensors (3 per Baby)**: `asleep`, `feeding` (any live Feed), `bottle_open`. **No HA device class fits any of them** — do not force one; the translated names carry the meaning. These are the automation *conditions* where the timestamps are the *triggers*.

**Numeric sensors (6 per Baby)** — all `state_class: total` with `last_reset` set to the Day Start instant from `household.day_reset_at`, so HA's recorder graphs daily totals natively and the reset is **declared** rather than inferred. A sensor must **never** re-derive "today" from HA's local midnight; the Household's Day Start in the Household Zone is computed server-side and is the only answer.

- `feeds_today` — **rounds**, not rows
- `milk_today` — Intake ml (volume minus Leftover); **appears on first bottle**
- `sleep_today`, `tummy_today` — minutes, `device_class: duration`; `tummy_today` **appears on first use**
- `pees_today`, `poops_today` — counts

**Household device (2)**:

- `last_update` — a **diagnostic** timestamp (`EntityCategory.DIAGNOSTIC`): when the coordinator last heard the server. This is the staleness tell that entity availability cannot express — *connected but stale since 14:02*. It needs no payload field; it is the coordinator's own clock.
- `caregiving` — a binary sensor carrying `household.caregiving`. **New at assembly time**; the reasoning is in the correction note at [§5.5](#55-get-apihubstate). It is a read, not a capability: nothing about it gates a write, and no total is suppressed when it is off. It exists so a family's announce automation can hold its tongue while nobody is looking after her, which is what [ADR-0041](../../docs/adr/0041-caregiving-off-silences-the-caregivers-not-the-parents.md) says should happen.

**Existence rules.** Entities **exist with state `unknown`** when inapplicable — a cleared Target must never break a family's dashboard or automations. The one exception is the **appear-on-first-use** group, `milk_today` and `tummy_today`: the server omits the field until the Household has **ever** logged a bottle or tummy time, the integration creates entities from what the payload carries, and **nothing is ever removed once created**. The rule only adds.

**Deliberately absent**: Milestones, Measurements, Meals and Foods, per-Entry detail, Revision history. No night/nap split sensors in v1 — the fold's `SleepSecondary` could feed them later, but the wall answers *how much today*. No tummy-start timestamp and no tummy binary: the glossary itself rules it, since Tummy Time *answers how many minutes there were today, never when one began*.

### 6.6 The action surface

The write half. [ADR-0034](../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md) fixes the mechanism — plain revisions down `POST /api/sync/push`, client-minted ids, a bounded outbox — so what is decided here is the **surface**.

**Six buttons per Baby** (`ButtonEntity` on the Baby's device, pressable from stock tile cards):

| button | writes |
|---|---|
| *Sleep* | starts a Sleep |
| *She's awake* | ends the running Sleep |
| *Feed* | starts a **breast** Feed — the only Feed startable without arguments |
| *End feed* | writes `ended_at` on the live Feed |
| *Tummy time* | starts a Tummy Time stretch |
| *Off her tummy* | ends the running stretch |

**The three enders address the Entry the payload names** — `sleep_entry_id`, `feed_entry_id`, `tummy_entry_id` from [§5.5](#55-get-apihubstate). A press with no id is not possible: the same coordinator read that leaves the button available is the one that carried the id, and availability and the id go `null` together.

There is **no wake-and-feed compound write**: the fan's *Feed while asleep* row keeps the Sleep running (a Sleep Feed), so a wall's start-feed never touches a Sleep.

**Two services**, for the actions that take arguments:

- `baby_log_book.log_bottle_feed` — `volume_ml`, optional `contents`, optional `leftover_ml`
- `baby_log_book.log_nappy` — `pee`, `poop`, optional `where`, optional `consistency`

Both **target the Baby's HA device** — there is **never a raw `baby_id` field in the call schema**. The integration resolves device → `baby_id` through the device registry and passes it down the wire. Registered in **`async_setup`**, not `async_setup_entry`, so automations validate even when no entry is loaded (Bronze rule `action-setup`). `services.yaml` describes the target and the fields with selectors; **names and descriptions live in translations**, never in `services.yaml`.

The [ADR-0020](../../docs/adr/0020-one-deployment-many-households.md) sentence, carried verbatim into the build: **the `baby_id` the Hub sends is a client-supplied id, and the server's `entityBelongsElsewhere` is the only thing that makes it safe. The id is never a capability.**

**Deliberately absent**: Meals with Foods (a service argument would invite typo-Foods into the catalogue from automations), Milestones (unrepeatable — a mis-press writes *First steps* that never happened), Measurements, corrections, edits, deletes, notes, and any breast-`side` surface. **The phone owns `side`**; the wall's *Feed* button starts with the app's default. A family wanting a one-press bottle button gets a README script calling `log_bottle_feed` — the automation engine doing its job, not a gap.

**Availability mirrors the fan's reflow.** Buttons go `unavailable` from the same coordinator read that feeds the binaries: no *Sleep* while one runs, *Off her tummy* only while a stretch runs. This is **convenience, not enforcement** — the server never assumes the Hub filtered anything, and the race a stale read lets through lands on rules the server already holds (two started Sleeps reconcile via Session Merge; a second Feed ends the first via ADR-0019 in `push()`).

**The mis-press waits for a phone**, and the spec says so plainly. A wall has no toast and no undo window. The cost is bounded: reflow blocks the nonsense presses, Session Merge and ADR-0019 absorb the double-starts, and everything else is an ordinary Entry a phone edits. `refuseByRole` would in principle let the Hub delete within its own undo window; **no v1 surface offers it** — deliberately absent, not forgotten.

**The outbox is bounded and visible.** A press mints its revision id immediately and retries until it lands; push is insert-only, so a retry after a lost response is a no-op.

- Visible as a **diagnostic sensor `pending_writes`** on the Household device, beside `last_update` — the same staleness-tell family.
- Bound: **50 queued revisions.** At the bound a new press raises an error in the UI (HA's `action-exceptions` idiom) instead of queuing silently. A hub is not a phone: silently queuing feeds for six hours is worse than saying it did not send.
- **No repair issue for a backlog.** Repairs stay reserved for the Lapsed session and the two version cases; a non-empty outbox is visible state, not a condition needing repair.

### 6.7 Repair issues

Exactly three, and no more — each from the taxonomy in [§6.3](#63-the-failure-taxonomy):

| issue id | severity | fixable | raised when |
|---|---|---|---|
| `member_removed` | error | no | `403 removed` |
| `hosting_paused` | warning | no | `402 lapsed`, at setup or at runtime; deleted on the first `200` |
| `integration_outdated` | warning | no | the server reports a version this integration is too old for |

### 6.8 Translations

**Three languages: en, de and ro.**

> **Correction — the language set.** The map and the conventions research both said **en/de/fr**. There is no French anywhere in this product; the app's message files are `messages/{en,de,ro}.json`. [Ticket 06](issues/06-the-entity-model.md) caught it and corrected the map. Romanian, not French.

Ship `translations/{en,de,ro}.json` **directly** — never `strings.json` with references, which is a core-repo build step a custom integration does not have.

Entity names come **word for word from the app's own strings** (`type_*`, `header_*`, `stats_card_*`, `settings_*`) wherever one exists, so the wall and the phone say the same thing:

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
| `caregiving` | Caregiving | Betreuung | Îngrijirea |
| `pending_writes` | Pending writes | ⚠ Ausstehende Schreibvorgänge | ⚠ Scrieri în așteptare |

`⚠` marks a string coined for the integration, with no app string behind it. `caregiving` is **not** coined — it comes from `settings_caregiving_label` in all three files.

**The Romanian cells ship as coined**, with a native speaker's pass carried as a numbered pre-1.0.0 item ([§10](#10-pre-100-checklist)). Holding the language back would be worse than an imperfect string: a missing `ro.json` falls back to English for a Household that deliberately chose Romanian, which is a visibly broken wall rather than a slightly stilted one — and the fix is a one-file PR at any later point.

Also translated: every config-flow error key and abort reason from [§6.3](#63-the-failure-taxonomy), every repair issue's title and description, and the two services' names, descriptions and field labels.

### 6.9 Testing

`pytest-homeassistant-custom-component`, **no live Home Assistant instance**. The `aiohttp` calls are mocked; the HA side is real.

**The dev-env HA container has no part in CI.** Settled in [ticket 12](issues/12-ci-for-the-integration-repo.md); do not re-litigate. `compose.ha.yaml` in the server repo stays a human-eyeball surface for looking at entity models and config flows, exactly as `ha/README.md` says.

Coverage gate: **95 %** over `custom_components/baby_log_book`.

The cases that must be covered, because they are the ones this spec exists to pin: every row of both taxonomy tables in [§6.3](#63-the-failure-taxonomy); the `304` path leaving data intact; appear-on-first-use creating an entity and never removing it; the outbox bound raising rather than queuing; and the re-auth `wrong_member` abort calling `DELETE /api/session` first.

### 6.10 CI

**Two workflow files**, in the server repo's house style rather than `integration_blueprint`'s four-file split.

**`ci.yml`** — on push to `main`, on pull requests, and on a **weekly cron**. Three jobs, all hard gates:

| job | runs |
|---|---|
| `lint` | `ruff check`, `ruff format --check`, `mypy` in **strict** mode |
| `test` | `pytest --cov=custom_components/baby_log_book --cov-fail-under=95` |
| `validate` | `home-assistant/actions/hassfest` (no inputs) and `hacs/action` with `category: integration`, `ignore: brands` |

**`release.yml`** — on `v*.*.*` tags. One job: **refuse the release** when `manifest.json → version` ≠ the tag minus its `v`, then create the GitHub release with the body extracted from that version's `CHANGELOG.md` section.

- **manifest = tag = release is enforced, never stamped.** The blueprint rewrites the manifest version from the tag at release time, which leaves the version in the tree meaningless for anyone installing from the default branch. Here the human bumps the manifest in the release commit and CI refuses a tag that disagrees. The tree stays honest.
- **What hassfest still buys**, since `quality_scale.yaml` is skipped for custom integrations: the run is `INTEGRATION_PLUGINS` only — manifest, json, translations, services, icons, config_flow, requirements, dependencies, codeowners, integration_type. That subset is **exactly the set of files an AFK agent hand-writes and the pytest suite never reads**: the three translation files, `services.yaml` against the registered actions, `icons.json`, and the manifest keys HACS also demands. It stays.
- **`ignore: brands` is a dated debt**, not a permanent config line — *open the `home-assistant/brands` PR, then delete the ignore* is a numbered pre-1.0.0 item.
- **Release notes come from the changelog.** HACS shows the GitHub release body to anyone considering the update, so it is the one place a stranger reads what changed; deriving it from `CHANGELOG.md` means the two cannot drift.
- Actions pinned **by major tag** (`actions/checkout@v5`), as the server's `publish.yml` does, not SHA-pinned as the blueprint does. Dependabot keeps them current.
- Everything runs under **`uv`** with `pyproject.toml` — `uv run <tool>`, never a venv and never a global.

**One HA version is tested, and it is the floor.** A single pin of `pytest-homeassistant-custom-component` tracking latest stable HA; `hacs.json → homeassistant` moves forward with it **at each release**, not at each Dependabot bump. **Never claim a floor you do not test.** The alternatives were a two-entry matrix (double the dependency maintenance) or a lower, untested floor (a guess). HACS declining to offer the integration on an old HA is a clear message; a broken install is not.

Dependabot weekly on `pip` and `github-actions`: a red Dependabot PR **is** the alarm that HA broke us, and the weekly cron catches breakage that arrives without a dependency bump. **No HA-beta job** — a moving target trains you to ignore red, and a wall panel needs no month of warning.

---

## 7. The seam

Two repos, two release cadences, one wire. [ADR-0039](../../docs/adr/0039-the-integration-gates-on-the-server-release.md) governs everything in this section.

### 7.1 The version handshake

**The handshake gates on `app_version`** — the server's human release number, from the version block every response already carries (`versionBlock()`, `api.ts:33`).

Not `protocol_version`: that is the phone wire, which the Hub does not speak, so it would lie in both directions — unchanged when the Hub's contract breaks, changed when it did not. Not a dedicated companion integer either: a second machine version whose human mapping table would have to exist anyway.

Each integration release **bakes in a `MIN_SERVER_VERSION`** and compares with `awesomeversion`. Mealie's pattern, per the [conventions research](research/ha-integration-conventions.md).

**Too old, in each direction:**

- **Server too old** → the dual gate: a `server_too_old` **form error at claim time**, and `ConfigEntryError` at **every setup**. Both messages carry the two concrete numbers.
- **Integration too old** → a repair issue, *update the Baby Log Book integration*.

**The ordering rule makes the second case rare**: a Hub-wire change **lands server-side first, backward-compatibly**; the integration release that requires it raises its floor. Only a deliberate breaking server change may strand old integrations, and that is flagged in the server's release notes.

### 7.2 Who bumps what

**Independent semver from `1.0.0`.** The invariant, written into the integration repo's `AGENTS.md`:

> `manifest.json → version` = the git tag = the GitHub release. Bumped together, in one commit.

HACS reads the latest release tag, so a disagreement is not cosmetic. `release.yml` enforces it ([§6.10](#610-ci)).

`hacs.json → homeassistant` is reviewed **per release** and bumped only when the code starts using a newer HA idiom, or when the tested pin has moved ([§6.10](#610-ci)).

**The release checklist**, in order:

1. Rename `## [Unreleased]` in `CHANGELOG.md` to the version.
2. Bump `manifest.json → version` **in the same commit**.
3. Review `hacs.json → homeassistant` and the baked-in `MIN_SERVER_VERSION`.
4. Append the row to the compatibility table in the README.
5. Annotated tag `vX.Y.Z`.
6. Push `main` **and** the tag.
7. `release.yml` guards the invariant and publishes the notes.

### 7.3 The compatibility statement

**One table, in the integration's README only.** Three columns, because the HA floor moves per release too:

| Integration | Needs server | Needs Home Assistant |
|---|---|---|
| ≥ 1.0.0 | ≥ *x.y.z* | ≥ *a.b.c* |

The server's README links to it **once**. Runtime and claim-time errors carry the concrete numbers rather than pointing at the table.

### 7.4 The licence across the boundary

**AGPL-3.0-or-later on both repos**, same contributors header. **No code is shared** across the boundary: this spec re-states the wire shapes, and Python implements them fresh. There is no generated client, no vendored types, no submodule.

---

## 8. The README a stranger follows

The integration repo's `README.md`. Its job is that somebody who has never seen this project can get a wall panel working and then make it do something.

**1. What it is** — two sentences, and the one about the automation engine from [§1](#1-what-it-is).

**2. Install** — HACS custom repository, then the config flow.

**3. Claim** — a Parent opens Settings, sends an Invite **for a Hub**, and pastes the link into the config flow. One screenshot.

**4. Revoke** — remove the Hub's Member in Settings. It unplugs the panel, it stops reading and writing at once, and its Entries remain.

**5. Re-bind** — when the panel says it has been signed out, a Parent mints a **Rescue Link** in Settings and pastes it into the re-auth dialog. Same words as the lost phone.

**6. The dashboard** — a stock tile-card example, carrying the `name:` override at least once, because long compound names truncate on narrow tiles (*Emma Wachfenster vor…*):

```yaml
type: tile
entity: sensor.emma_wake_window_up
name: Wake window          # the device name already says "Emma"
```

**7. Two automations to copy** — the hand-off from [ADR-0036](../../docs/adr/0036-the-deployment-never-wakes-a-hub.md), so it does not read as a shrug. Both carry the Caregiving condition **by default**, which is how [ADR-0041](../../docs/adr/0041-caregiving-off-silences-the-caregivers-not-the-parents.md) reaches a wall ([§5.5](#55-get-apihubstate)):

```yaml
# Chime ten minutes before the bottle's life runs out.
# The ten minutes is yours here — the app never sends a lead time.
triggers:
  - trigger: time
    at:
      entity_id: sensor.emma_bottle_life_runs_out
      offset: "-00:10:00"
conditions:
  - condition: state
    entity_id: binary_sensor.home_caregiving
    state: "on"
actions:
  - action: media_player.play_media
    target: { entity_id: media_player.hall }
    data: { media_content_id: "media-source://…", media_content_type: music }
```

```yaml
# Announce when a feed comes due.
triggers:
  - trigger: time
    at: sensor.emma_feed_due
conditions:
  - condition: state
    entity_id: binary_sensor.home_caregiving
    state: "on"
actions:
  - action: tts.speak
    target: { entity_id: tts.piper }
    data: { media_player_entity_id: media_player.hall, message: "Emma is due a feed." }
```

A sentence beside them: *switch Caregiving off in the app while nobody is looking after her, and both of these go quiet.*

**8. A one-press bottle button** — the script example, which is how [§6.6](#66-the-action-surface) answers a family that wants a bottle logged without touching a phone:

```yaml
script:
  emma_120ml:
    alias: Emma — 120 ml
    sequence:
      - action: baby_log_book.log_bottle_feed
        target:
          device_id: !input emma_device      # the Baby's device, not a baby_id
        data:
          volume_ml: 120
```

**9. What it deliberately does not do** — the non-goals from [§2](#non-goals), in a short list, each with its one-line reason. A stranger should not have to open an ADR to learn there is no card.

**10. The compatibility table** ([§7.3](#73-the-compatibility-statement)).

**Blueprints are out of scope.** Copy-paste examples, not a blueprint library.

---

## 9. What is deliberately not decided here

Two contracts in this spec are **named but not yet implemented**, and both are honest about it:

- **Lapsed** (`402` on the state read and on both claim paths) lands with the **hosted-service effort**. The contract is named now so the Python half handles it from day one and needs no later release to learn how. The consequence for that effort is recorded on [ticket 11](issues/11-the-config-flow-failure-taxonomy.md): the `402` gate applies to **all** claims, not just a Hub's.
- **Per-Device session revoke** does not exist and is not built here ([ADR-0037](../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md)). Revoking a Hub means removing its Member, which is enough for this map. The general feature is real, missing, and someone else's effort.

---

## 10. Pre-1.0.0 checklist

Carried debts, each with an owner and none of them blocking the build:

1. **Open the `home-assistant/brands` PR**, then delete `ignore: brands` from `hacs/action` ([§6.10](#610-ci)).
2. **A native speaker's pass over the Romanian entity names** — the `⚠` cells in [§6.8](#68-translations). Ships coined; corrected by a one-file PR.
3. **The GitHub repo public**, with a description and topics — HACS requires all three.
4. **The verbatim AGPL-3.0 text** in `LICENSE`, in **both** repos. Both currently carry a maintainer's note where the licence text belongs; AGPL §14 wants the real thing before either is distributed. Inherited from the server repo, not introduced here.
5. **Push the integration repo.** It exists at [`../../../baby-log-book-homeassistant`](../../../baby-log-book-homeassistant) with `origin` set and one commit (`0cb3011`), unpushed — the sandbox has no route to GitHub, so the maintainer pushes from outside.

---

## 11. Decision index

Everything above traces to one of these. The ticket holds the reasoning; the ADR holds what was traded away.

| # | Ticket | What it settled |
|---|---|---|
| 01 | [A Home Assistant in the dev env](issues/01-ha-in-the-dev-env.md) | HA 2026.8.3 via `compose.ha.yaml`, config at `ha/config/`, the app reachable as `host.docker.internal:5173` |
| 02 | [What a custom integration must be in 2026](issues/02-what-a-custom-integration-must-be.md) | The conventions, verified — [`research/ha-integration-conventions.md`](research/ha-integration-conventions.md) |
| 03 | [What a Hub does with a Notice](issues/03-what-a-hub-does-with-a-notice.md) | [ADR-0036](../../docs/adr/0036-the-deployment-never-wakes-a-hub.md) — instants only, offsets never cross the wire, `until` dissolves |
| 04 | [Re-binding a Hub that lost its session](issues/04-re-binding-a-hub.md) | [ADR-0037](../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md) — Rescue Link from Settings, 60 min, claims never touch old sessions |
| 05 | [The Hub in the members list](issues/05-the-hub-in-the-members-list.md) | [ADR-0038](../../docs/adr/0038-a-hubs-member-is-marked-and-a-hub-stays-a-caregiver.md) — the mark, its immutability, no Hub Parent; **Hub** enters the glossary |
| 06 | [The entity model](issues/06-the-entity-model.md) | Sixteen entities per Baby, the existence rules, en/de/**ro** |
| 07 | [The action surface](issues/07-the-action-surface.md) | Six buttons, two device-targeted services, the bounded visible outbox, the mis-press |
| 08 | [One repo or two](issues/08-one-repo-or-two.md) | [ADR-0039](../../docs/adr/0039-the-integration-gates-on-the-server-release.md) — own repo, `baby_log_book`, `app_version` handshake, AGPL both sides |
| 09 | [The wire contract](issues/09-the-wire-contract.md) | `GET /api/hub/state`, the payload, the ETag, the error contract, the cadence |
| 10 | [Assemble the spec](issues/10-assemble-the-spec.md) | This document — and the three corrections it folds in |
| 11 | [The config-flow failure taxonomy](issues/11-the-config-flow-failure-taxonomy.md) | One HA idiom per failure, and never a fourth |
| 12 | [CI for the integration repo](issues/12-ci-for-the-integration-repo.md) | Two workflows, enforced manifest = tag = release, one tested HA floor |

**The three corrections this assembly made**, each because an ADR landed after the ticket that would have caught it:

1. **The ETag grows a night key** ([§5.6](#56-the-conditional-contract)) — [ADR-0040](../../docs/adr/0040-the-night-moves-a-feed-only-once-it-has-begun.md) put `now` back into `feed_due` the day after ticket 09 closed.
2. **`caregiving` joins the payload and the Household device** ([§5.5](#55-get-apihubstate), [§6.5](#65-devices-and-entities)) — [ADR-0041](../../docs/adr/0041-caregiving-off-silences-the-caregivers-not-the-parents.md) claims a Hub goes quiet, and without this it cannot.
3. **The `link_expired` copy stops quoting a duration** ([§6.3](#63-the-failure-taxonomy)) — 60 minutes is the Rescue TTL; an Invite lasts 7 days.
