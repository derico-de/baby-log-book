# 10 — Assemble the spec

Type: grilling
Status: resolved
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

## Answer

[`spec.md`](../spec.md) exists — 763 lines, eleven sections, every decision on this map
folded in and nothing architectural left open. **The map is closed.**

Structure: what it is and the six ADRs that floor it → scope and non-goals → vocabulary →
the seam at a glance → **the server half** (the Hub's Member, the Rescue Link in Settings,
ADR-0019 into `push()`, `liveEntries()`, `GET /api/hub/state`, the conditional contract,
the error contract, clock offset, a ten-item build checklist) → **the integration half**
(repo layout, config flow, the failure taxonomy as two paste-ready tables, the coordinator
with the cadence numbers as contract, devices and entities, the action surface, repairs,
translations, testing, CI) → **the seam** (handshake, who bumps what, the compatibility
table, the licence) → **the README a stranger follows**, with real YAML → what is named
but deliberately unimplemented → the pre-1.0.0 checklist → a decision index.

### Three corrections the assembly made

Assembly was not transcription: the server moved from 1.18 to **1.25.0** while this map ran,
and two ADRs landed *after* the tickets that would have caught them. Each correction is
written into the spec at the point where it bites, and flagged as a correction so nobody
re-derives the superseded version from a ticket:

1. **The ETag grows a third component** (spec §5.6). [ADR-0040](../../../docs/adr/0040-the-night-moves-a-feed-only-once-it-has-begun.md)
   landed the day after [ticket 09](09-the-wire-contract.md) closed — commit `b01b976`,
   after ticket 09's `76fd61b` — and gave `feedDueInstant` a `now`: a due inside the Night
   moves to the Day Start *only once that Night has begun* (`pastNight`, `time.ts:296-301`).
   So `feed_due` changes at the stated Night Start with **no revision and no day-key
   change**, and ticket 09's two-part ETag would have held the wall on *due 22:03* all
   night — the exact stale-answer failure that ticket exists to prevent, landing during
   waking hours instead of at 05:00. The ETag becomes **`"<cursor>-<dayKey>-<nightBegun>"`**.
   One bit suffices because ADR-0040's move is monotone; the cost is at most one extra miss
   per day, and none for a Household with no Night Period. `statsFor` and `headerState` were
   both re-checked for other `now` dependencies — `statsFor`'s only picks the day bucket,
   `headerState`'s only produces `elapsedMs`/`overdue`, which never reach the wire. `feed_due`
   was the only hole.
2. **`caregiving` joins the payload and the Household device** (spec §5.5, §6.5).
   [ADR-0041](../../../docs/adr/0041-caregiving-off-silences-the-caregivers-not-the-parents.md)
   (2026-09-05, after every entity ticket) claims in its consequences that *"a Hub goes
   quiet, and that is the point… a wall panel announcing a feed into an empty flat is the
   noise the switch exists to stop."* That sentence reasons about push delivery, and
   [ADR-0036](../../../docs/adr/0036-the-deployment-never-wakes-a-hub.md) means no Notice
   ever reaches a Hub — the announcing is the family's own automation firing off a timestamp
   sensor, and `caregiving` appeared nowhere on the wire. So the switch would have gone off,
   every phone would have gone quiet as designed, and the hall panel would have announced
   the 02:00 feed into the empty flat. One boolean on an already-synced field
   (`types.ts:216`), surfaced as a binary sensor, and the README's automations carry the
   condition by default. **The server does not withhold sensor values when Caregiving is
   off** — that would be the deployment reaching into the wall to switch it off, and every
   derived total would lie.
3. **The `link_expired` copy stops quoting a duration** (spec §6.3).
   [Ticket 11](11-the-config-flow-failure-taxonomy.md) wrote *"Claim Links last 60 minutes"*,
   but 60 minutes is the **Rescue** TTL ([ADR-0037](../../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md));
   an Invite lasts **7 days** (`INVITE_TTL_MS`, `claims.ts:37`), and the preview does not
   always tell the flow which kind it held.

### Decided this session

- **The Romanian entity names ship coined**, with the native pass as a numbered pre-1.0.0
  item. A missing `ro.json` falls back to English for a Household that deliberately chose
  Romanian — a visibly broken wall beats a slightly stilted one, and the fix is a one-file
  PR at any later point. `caregiving` needed no coining: `settings_caregiving_label` exists
  natively in all three message files.

### Verified while assembling, not assumed

- `FEED_ROUND_GAP_MS` is still 15 minutes (`stats.ts:29`), so ticket 06's *rounds, not rows*
  holds. `NAP_GAP_MS` (30 min, new in 1.24.0) changes nap **counting**, and no entity counts
  naps — `sleep_today` is total minutes, untouched.
- Nothing from ADR-0037/0038/0039 is built yet: no `members.kind` column, `RESCUE_TTL_MS`
  still 15 minutes. Expected — this map plans, it does not build — and the spec's §5.9
  checklist is written accordingly.
- ADR-0019 is still client-side only (`grid.ts`/`entries.ts` reference it; `push()` does
  not), so §5.3 is genuinely new work, and the client-side guard **stays** because the
  inline "ends the running feed at 14:05" line is real copy about a real write.
- `previewLink` returns `kind` and `display_name` but no member id (`claims.ts:188`),
  confirming ticket 11's thin-preview premise and the `wrong_member` abort's shape.
- All 29 outbound links and all in-document anchors resolve.

### Debt carried forward

The pre-1.0.0 list (spec §10) holds five items, none blocking the build: the brands PR, the
Romanian pass, the repo made public, **the verbatim AGPL-3.0 text missing from both repos'
`LICENSE`** (inherited from the server, wanted by AGPL §14 before distribution), and pushing
the integration repo from outside the sandbox.
