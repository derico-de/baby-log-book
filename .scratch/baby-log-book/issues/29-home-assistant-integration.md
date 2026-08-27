# 29 — Home Assistant: a hub in the hall, against a public server

Type: feature
Status: **open 2026-08-27** — shape decided (**A**: a custom integration, entities first, card second). The server half is specified below; three calls at the bottom still want the maintainer.

## Question

The app is a phone in a pocket. A **Hub** is the other thing a household already has: a screen on the kitchen wall, a voice in the hall, an automation that dims the lights when she goes down. The ask is a Home Assistant card showing her stats and offering the actions the fan offers — *start feeding* first among them.

The deployment is **public**. Not a box on the same LAN as the hub: a server on the internet, one container serving many Households ([ADR-0020](../../../docs/adr/0020-one-deployment-many-households.md)), reached over HTTPS from a home network that is sometimes down.

So: **what does a Hub cost this architecture, and which of the four ways in survives a public origin?**

## What is not in question

- **The Hub is a Device, not a new auth model.** [ADR-0005](../../../docs/adr/0005-claim-links-instead-of-passwords.md) already grants access to a Device rather than to a Member in the abstract, and a Claim Link is the only way in. A hub claims one like a second phone. Nothing new is invented, and every existing revocation path — remove the Member, `babylog rescue`, the sessions list in Settings — works on it the day it ships.
- **One write path.** The Hub pushes revisions to `POST /api/sync/push` like every other Device. No action API, no second place where "start a feed" means something.
- **The app never reads the new endpoint.** The replica stays the app's only source, and the pull stays the only path by which rows arrive.
- **The Hub is not offline-first.** It is a mains-powered box with a browser-less runtime; it holds no replica and folds no log. That is the whole reason a derived read exists.

## The shape

### Auth: a Claim Link pasted into a config flow

The integration's config flow takes the base URL and a pasted Invite link, mints a `device_id`, and POSTs `/api/claim` with `{token, device_id, zone, display_name}` (`src/routes/api/claim/+server.ts`). It stores the returned `blb_session` cookie in the config entry. A 401 opens Home Assistant's re-auth flow, which asks for a **Rescue Link** — the same recovery the lost phone gets, with the same words.

Claim it as its **own Member**, named for the hub, in the **Caregiver** role. Two arguments, and the second is the one that matters on a public server:

- **Attribution stays honest.** Every Entry records the Member who logged it, and a button on a kitchen wall is pressed by whoever is standing at it. *Home Assistant* is the truthful answer; borrowing a person's name is the app claiming to know something it does not.
- **It is the revocation seam.** `revokeMember` (`src/lib/server/auth.ts`) kills that Device and drops its push subscriptions without signing anyone's phone out, so a hub that is sold, reset or suspected is one tap and no collateral.

The role bounds the blast radius, which is worth stating plainly because the credential now sits in plaintext in `/config/.storage` on a box in someone's hall. `refuseByRole` (`src/lib/server/sync.ts:127`) lets a Caregiver log and correct Entries and grow the Food catalogue. It refuses, for the stolen-hub case: deleting an Entry outside its own undo window, managing Members or Babies, changing Household settings, and changing Targets.

**Sessions still do not expire, and this is not the exception.** [ADR-0005](../../../docs/adr/0005-claim-links-instead-of-passwords.md)'s reason — a 90-day timer signs Oma out exactly when re-authenticating is hardest — does not describe a hub, and it is tempting to special-case one. Refused: an expiry that applies to some Devices and not others is a second auth model wearing the first one's clothes, and the control this project chose is revocation. If a hub session should ever die on a timer, that is a property of a *Device* and wants its own decision, not a flag on this one.

### Reads: one endpoint, and it computes nothing new

`GET /api/companion/state` — session-scoped, no ids from the client, returning for each live Baby:

- the **Live Sessions** with their start instants, so the hub ticks its own timers and needs no traffic to keep counting;
- everything the sticky header prints, from `headerState()` (`src/lib/domain/targets.ts:366`) — last Feed, elapsed, due instant, overdue, asleep/awake, today's pee and poop counts and the last poop, which reaches past the Day Start on purpose;
- today's totals from `statsFor()` (`src/lib/domain/stats.ts:123`);
- the version block every sync response already carries, whose `server_time` the hub tracks its clock offset against.

Both folds are pure functions over `{entries, targets, now, dayStart, zone, night, babyId}`, and the server already runs domain folds this way in `notify.ts`. The only new query is a windowed `entriesSince()` beside `noticeEntries()` in `store.ts`. **The card cannot disagree with the app's own header, because it is the same fold.**

It ships no revisions, so it is not a second sync path — it is the projection a client that cannot hold a replica needs, and its being the app's own projection is what keeps it from drifting into an API of its own.

### Writes: revisions, and the rule they need moves first

**Prerequisite, and it is a bug fix rather than a favour to Home Assistant.** [ADR-0019](../../../docs/adr/0019-a-new-feed-ends-the-running-one.md) — a Baby eats one thing at a time, so a new Feed ends the running one — is enforced *client-side*, in `FeedSheet.svelte:159` calling `endFeedForFeed`. Session Merge and the bottle past its Life are enforced inside the push transaction; this one is not. Any writer that is not that sheet leaves the previous Feed running, and today that already includes the case of two Devices starting a Feed while one of them is offline.

So **ADR-0019 moves into `push()`**, next to `planSessionMerges`, keeping its guard exactly: only when the new Feed's `occurred_at` falls inside the running one. Then the hub pushes a plain creation and the server does the rest, and there is one place to read the rule.

After that, *start feeding* from a hub is one POST carrying one revision — the same fields `logBottleFeed` writes.

### Entities, then a card

Per Baby: timestamp sensors for last Feed, next Feed due and sleep start (`device_class: timestamp`, so Home Assistant renders *2h ago* and *in 40 min* natively, in the user's language, with no code of ours); a binary sensor for asleep; numeric sensors for today's feeds, millilitres, sleep hours and nappies. Buttons for the fan's direct actions; services for the ones that take arguments — `log_bottle_feed` with volume and contents, `log_nappy` with pee, poop and where.

**Get the entity model right and the dashboard is stock tile cards.** A custom Lit card carrying `DESIGN.md`'s tokens is phase two and buys polish, not capability — and entities buy something a card never could: automations, voice, and a wall panel someone else designs.

## What the public origin changes

- **A hub is a permanently connected client, which a phone is not.** [ADR-0021](../../../docs/adr/0021-the-paid-service-scales-by-files-not-by-postgres.md) plans hundreds of Households on one file and one process holding idle SSE connections. So: refresh from `/api/sync/live` and poll only as a fallback, and **make the state endpoint conditional** — return the Household's `currentCursor()` and answer `If-None-Match` with a `304`. A quiet night then costs one cursor lookup per poll instead of a stats fold over a week of entries. Built in from the first commit, not added when it hurts.
- **Reconnect with backoff *and jitter*.** The SSE endpoint already sends `retry: 5000`, a 25s keepalive and `x-accel-buffering: no`, which is what survives nginx buffering and a CDN's idle timeout. What it cannot do is stop every hub in the fleet returning in the same second after a deploy.
- **The lapse gate has to be decided now.** [ADR-0022](../../../docs/adr/0022-a-lapsed-household-stops-syncing.md): a Lapsed Household is refused both pushes and pulls, and Export is its one live endpoint — there is **no read-only tier**. A companion endpoint added without that in mind quietly becomes one. It answers `{code: 'lapsed'}` alongside `unauthenticated` and `removed`, and the integration raises a Home Assistant repair issue saying *hosting is paused*, because the ADR's own reasoning applies to a wall panel as much as to a phone: sync stopping in silence reads as a bug.
- **A bounded outbox on the hub, which the protocol gives away for free.** Home internet goes down and deploys restart the server, so a press that cannot reach the origin must not evaporate. Push is insert-only with client-minted ids, so replay is a no-op by construction and `revisionExists` short-circuits a retry to *accepted* — mint the revision id when the button is pressed and retry until it lands. **Bounded and visible**: a hub silently queuing feeds for six hours is worse than one that says it did not send.
- **Track the clock offset.** Revisions minted while the origin is unreachable carry the hub's clock, and the server clamps and flags a merge key more than `SKEW_TOLERANCE_MS` in the future rather than rejecting it. The `server_time` in every response is what the app's own `mergeAt()` corrects against; the hub does the same.
- **`baby_id` from a hub is a client-supplied id.** The action path passes one, and push's `entityBelongsElsewhere` guard is what makes that safe ([ADR-0020](../../../docs/adr/0020-one-deployment-many-households.md)). The read endpoint takes no ids at all.

## Ruled out, with reasons

- **A Lovelace card calling the app directly from the browser.** Guaranteed cross-origin now, so it needs CORS *and* `SameSite=None; Secure` — turning a deliberately same-origin app into a cross-origin API, and weakening every Household's posture to serve one hub. Everything routes through the integration, server-side. This is the argument that decides shape A rather than a footnote on it.
- **The PWA in an `iframe` card.** Same cookie rule, one line of config, and it renders signed out. It also buys no entities, so it is not even the cheap version of the feature.
- **An MQTT bridge.** Entities for free with no Python, but it adds a broker and a whole configuration surface to an app that is one container and one volume, and it puts a second delivery path beside the SSE one that already exists.
- **A YAML-only build as the destination** — `rest` + `rest_command` + a markdown card. Unaffected by the origin question, since both run inside Home Assistant rather than in the browser, so it stays available as a **half-day spike to prove the payload shape before any Python exists**. It is not the ship: no config flow, no re-auth, no repair issues, and a session cookie in `secrets.yaml`.

## Open calls

1. **Which repo.** HACS needs its own, which means a second release cadence against *keep the release number in sync with the container tags*. The alternative is a subdirectory here that HACS cannot install from.
2. **Does the hub's Member appear in Settings like a person?** It shows up in the members list and in `babylog members` today. Nothing stops that; the question is whether the Settings screen should say what it is, so a Parent removing *Home Assistant* knows they are unplugging the hall panel and not removing Oma.
3. **Does the glossary gain a term?** **Hub** is proposed as one — it sits beside **Device** in *Getting in*, and it is the noun the rest of this ticket leans on. Held back deliberately until the code lands, per the lazy rule in `docs/agents/domain.md`.

## Work

| | |
|---|---|
| Move ADR-0019 into the push transaction, with tests for the offline-second-Device case | ~0.5 d |
| `entriesSince()`, `GET /api/companion/state`, the cursor/`304` path, the `lapsed` contract, tests | ~1.5 d |
| Integration: config flow, re-auth, SSE coordinator with jitter, entities, services, bounded outbox | ~2–3 d |
| Custom card | ~2 d |
| Docs, HACS packaging, the README section a stranger follows | ~1 d |

Decided in [ADR-0034](../../../docs/adr/0034-a-hub-is-a-device-and-its-reads-are-derived.md).
