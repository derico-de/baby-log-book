# PWA install and update strategy

Type: grilling
Status: resolved
Blocked by: 06, 11, 12

## Question

An operator pulls a new image tag. Every installed PWA in the Household is now running last week's code against this week's server. How does a Device get the new version, and what does the user see while that happens?

Graduated from the map's fog by [Deployment shape](12-deployment-shape.md), which was the prerequisite: the server side is now settled, so what remains is entirely client-side.

### Already pinned — design around these, don't re-decide

- **[Sync protocol](06-sync-protocol.md)**: a protocol-version bump stops pushes, keeps logging locally, shows "update needed" and triggers the update. The outbox is never discarded. An open session is an ordinary row and survives.
- **[Visual design direction](11-visual-design-direction.md)**: the app shell must carry an **inline, paint-blocking** appearance resolver, so whatever the service worker precaches has to include it in the shell's own HTML rather than as a separate request.
- **[Deployment shape](12-deployment-shape.md)**: the running app already knows its own version and git SHA, so a Device can compare rather than guess.

### Decisions to reach

- **How a new version arrives** — auto-reload on detection, a prompt the user dismisses, or silently on next cold launch. This app is opened one-handed at 3am to press one button; an unexpected reload mid-tap is worse here than in most apps.
- **What happens to a Live Session during an update.** It survives as a row, but the *timer on screen* is what the user is watching. Does the running timer visibly blink, reset, or continue?
- **What happens to an unsynced outbox during an update.** Not discarded, per the sync ticket — but does an update wait for the outbox to drain, or proceed and carry it across?
- **The forced case.** A protocol-version bump makes the old client unable to push. What does the user see, and can they still *log* while stuck? (The sync ticket says yes — confirm what that screen actually is.)
- **Caching strategy** — what the service worker precaches versus fetches, given the shell must inline the appearance resolver.
- **Install prompt** — whether the app ever asks to be installed, and where. Relevant because iOS gives no `beforeinstallprompt` at all, and an uninstalled iOS Safari tab is a materially worse experience for a 3am app.
- **How a Device detects a new version at all** — service worker update check on launch, on focus, on an interval, or piggybacked on a sync response.

## Answer

**The app never reloads a screen nobody asked it to reload** — the mirror of [Logging interactions](16-logging-interactions.md)'s *the app never writes data nobody entered*, and the rule the whole ticket falls out of. A routine update shows no prompt, no toast and no badge; the only case that surfaces UI is the one where the Device is genuinely stuck.

The other half of the answer is that the ticket's own framing question — *what does the user see while that happens?* — turns out to have no answer. Nothing is downloaded at reload, because the service worker finishes precaching before it enters `waiting`. There is no moment to show.

### How a version arrives

- **Detection piggybacks on sync, and nothing else polls.** The sync response already rides a protocol version ([Sync protocol](06-sync-protocol.md)) and the running app already knows its version and git SHA ([Deployment shape](12-deployment-shape.md)), so the response carries both and a difference calls `registration.update()`. One unconditional check on cold launch covers the Device that has been offline a week and has no sync to ride. No `version.pollInterval` and no interval timer: a second clock waking the radio to ask a question the sync loop already asks is pure battery on a phone idle for twenty hours a day.
- **The new worker installs, waits, and takes over only at a moment indistinguishable from a cold launch** — a real cold start, or a return from background beyond 30 minutes. Auto-reload on detection was rejected outright: this app is opened one-handed at 3am to press one button, and a reload mid-tap costs a tap that a Baby's Sleep depends on. A prompt was rejected for the same reason the overdue figure shifts colour rather than nagging.
- **A running [Live Session](../../CONTEXT.md) defers the reload**, which closes the hole the 30-minute rule opens: a Sleep runs, the phone is in a pocket for three hours, and the return from background is exactly the 3am moment the design exists to protect. A Sleep running all night means the update lands after she stops it in the morning. The deadlock is already solved elsewhere — a **Stale Session** stops counting as running, per [Schedules in v1](09-schedules-v1.md)'s age-banded ceiling — so a timer nobody ever stopped cannot block updates forever. No new state and no new threshold.
- **The timer itself needs no protection.** A Live Session is a row with no end and the elapsed figure is derived from its start instant on every paint, so nothing about it lives in memory. A reload cannot blink it or reset it. What needed protecting was the tap, not the number.

### Being stuck, in both directions

- **Forced case**: a protocol bump stops pushes and shows a passive banner — *"This device needs to update before it can send"* with an **Update now** button. Everything else stays live: the FAB, the fan, corrections, and **pulls**, because a bump is about writes that would be wrong, not reads. The timeline stays fresh while the outbox grows, which is the least alarming version of stuck. Tapping **Update now** reloads immediately, Live Session or not — the rule is *never reload a screen nobody asked to reload*, and they asked.
- **The mirror case ships in v1 too.** [Deployment shape](12-deployment-shape.md) made rollback real by taking a backup before every migration, so a Device running *ahead* of the server arrives by design rather than by accident. The protocol check is symmetric: the client refuses to push when its own version is higher, on the same reasoning in reverse. Same banner, different words, and the words carry the weight — it says the **server** is running an older version, because this is an operator's problem and a banner that implies otherwise sends a grandparent hunting through Settings for a fix that does not exist. Cheap now, impossible to retrofit onto a fleet already stuck.
- **Settings shows one version line, splitting into two only when client and server disagree.** One line is what AGPL §13 needs and what a bug report needs; the disagreement is the single most useful fact in any bug report this project will receive, and the one a self-hoster is least equipped to work out unaided.

### The shell — [ADR-0012](../../docs/adr/0012-the-app-is-a-precached-shell.md)

Asking "what does the service worker precache" turned out to be asking **whether the server renders any UI at all**, and the answer is no. One prerendered shell, cache-first for every navigation, everything drawn client-side from the replica. SSR earns its keep on server-owned data and there is none here — the server may not hold the Entry a Member logged thirty seconds ago. It makes the shell and its hashed chunks one atomic versioned unit, which deletes the old-page-404s-on-a-new-chunk-name bug rather than mitigating it, and it puts [ADR-0008](../../docs/adr/0008-appearance-follows-the-clock.md)'s inline resolver in exactly one file.

This also exposed a hole in ADR-0008 that nothing else would have found: **the OS launch screen paints before any of our code exists**, and its colour comes from a static JSON file that cannot read a clock. `background_color` and `theme_color` take the deep-night ground permanently — a dark launch at midday is a non-event, a white one at 3am is the exact failure that ADR was written to prevent — while the resolver writes `<meta name="theme-color">` at runtime so the status bar still follows the clock. `display: standalone` keeps the OS clock visible, which is worth having in an app about elapsed time.

Claim is an ordinary route in the same shell, and **the worker registers only after a Claim succeeds** — then `persist()`, then the initial sync. A Device becomes offline-capable at the moment it becomes a Device.

### The outbox — [ADR-0013](../../docs/adr/0013-the-replica-is-a-cache-the-outbox-is-data.md)

**An update never waits for the outbox to drain**, because waiting deadlocks the exact case that most needs it — the protocol bump *is* "the outbox cannot drain until after the update". The carry-across is free; IndexedDB survives a worker update untouched. Underneath that sits the invariant worth more than the answer: **the replica is a cache and the outbox is data**. The replica can be dropped and re-pulled, which is why building the sync engine beat buying one; the outbox holds the only copy of an unsynced Entry. Its consequence is a hard contract — a new client must read an old client's outbox records — because otherwise an incompatible local schema meets the reset lever's non-empty-outbox refusal and the only way out is to destroy Entries a Member typed.

### Install

**Yes, once, passively, and it is not cosmetic** — an uninstalled tab holding an undrained outbox is a data-loss risk, not merely a worse experience. A dismissible banner after the Device has claimed *and* logged its first Entry, so a grandparent's first screen is not a request. `beforeinstallprompt` on Android; on iOS, which has no such event, the Share glyph and "Add to Home Screen" as an instruction. `navigator.storage.persist()` fires unconditionally after the Claim regardless — one line, and the actual mitigation.

**Settings owns it permanently; the banner is only a nudge toward it.** A one-shot banner is a door that closes for everyone who dismisses reflexively, so an *Install on this device* row lives in Settings whenever the app is not running installed, and disappears once it is. The row must handle having no `beforeinstallprompt` in hand — the event does not survive a reload — by falling back to the instruction rather than rendering a dead button. Ignored and dismissed differ: the banner persists until explicitly dismissed or installed, because one that retires itself leaves the Member who kept meaning to get round to it with no trace of what they saw.

Which surfaced the carve-out this ticket contributes to the model: **the dismissal is Device state, and Device state never enters the sync log.** [Sync protocol](06-sync-protocol.md) puts settings in the one log, so without the carve-out mum dismissing this hides it on Oma's phone, where the app is not installed and the risk is real. That is the third instance — appearance reads the Device's own clock ([ADR-0010](../../docs/adr/0010-instants-are-stored-the-zone-is-a-lens.md)), the v2 push preferences are pencilled in the same way — so it is a category, and **Device Setting** is now in [`CONTEXT.md`](../../CONTEXT.md).

One knock-on for the fog: **iOS delivers web push only to installed PWAs**, so this decision quietly determines whether v2 push is possible on an iPhone at all.

### Rejected

- **Auto-reload on detection** — costs a tap at 3am.
- **An update prompt for ordinary versions** — nagging, and there is nothing for the user to decide.
- **`version.pollInterval` or any interval check** — a second clock asking what the sync loop already asks.
- **Waiting for the outbox to drain** — deadlocks the forced case by construction.
- **SSR with network-first HTML caching** — a second source of truth, stale the moment the Device is offline.
- **A research ticket on WebKit's eviction policy** — it is the weakest fact here, but it cannot change the answer: we prompt for install on experience grounds regardless, and `persist()` is the mitigation whichever way the policy reads. A research ticket that cannot move a decision is not worth a session.
