# Logging interactions: what the FAB opens, and stale sleep recovery

Type: prototype
Status: resolved
Blocked by: 08

## Question

Two interaction questions the chosen layout left open.

### 1. What is one tap away?

[The logging prototype](08-logging-ux-prototype.md) settled on a timeline with a single FAB. That's good for reading the log and worse for the highest-frequency, lowest-information action: a nappy. In the rejected split-thumb variant a nappy was **one tap with an undo toast** — no confirm step, a wrong tap corrected rather than prevented. Behind a FAB it becomes tap, choose, confirm.

- Does the FAB open a sheet where nappies log **instantly on tap** (undo toast, no confirm), while feeds — which carry real data — get the full sheet?
- Or does the FAB expand into a small radial/row of direct actions, with the sheet only for feeds and measurements?
- Is a long-press or a swipe on the FAB worth it, or is that a gesture nobody discovers at 3am?
- Undo toast versus confirm step, decided explicitly: confirm prevents errors and costs a tap every single time; undo costs nothing normally and requires you to notice the mistake.

### 2. Recovering a Stale Session

A Sleep nobody stopped. Its end is the whole point, so a sleep still running after nine hours has destroyed the record it existed to make. The prototype offers three responses — *She woke at…*, *Still asleep*, *Delete* — as a banner, but which behaviour is right is not decided:

- **When does the app intervene?** A fixed threshold, or something derived from the baby's usual sleeps?
- **Does it ever act on its own** — auto-closing at a threshold and asking forgiveness — or only ever prompt?
- **What does "She woke at…" open?** A time picker defaulting to when, exactly?
- **Where does the prompt live** — a banner in the timeline, or something more insistent?
- Note the asymmetry from the domain model: a Feed left running needs no recovery at all. Only sleeps get this treatment, and the UI should not imply otherwise.

### Deliverable

Extend the existing prototype rather than starting a new one, then record the verdict here.

## Asset

The existing prototype, extended in place: [`prototypes/logging-screen.html`](../prototypes/logging-screen.html), republished to the same URL ticket 08 uses — <https://claude.ai/code/artifact/7a11190e-e5dc-43bd-b568-a6083c901f09>.

Variant D is now the fixed stage, with the two questions on their own axes so they can be judged independently:

- `?fab=` — **F1** one sheet, tiered · **F2** fan of direct actions · **F3** nappy has its own button (← → to cycle)
- `?stale=` — **S1** passive banner · **S2** auto-close, ask forgiveness · **S3** interception on open (↑ ↓ to cycle)

Proto-bar controls for the sub-questions the ticket names explicitly: **Confirm instead of undo** puts a confirm step in front of every instant nappy so the per-tap tax can be felt rather than argued about; **Threshold** switches between a fixed 5h and 1.5× her usual sleep; **Forgotten feed** injects a 6h-old running feed to verify the asymmetry — a feed left running must show as a live session and get no recovery treatment at all.

Awaiting the verdict — this is a HITL ticket and the answer is the dev's to give.

## Answer

**F2 — the FAB expands into a fan of direct actions. S1 — the passive banner: the app prompts, and never acts on its own.** Both are now the prototype defaults.

### 1. What is one tap away

Tapping the FAB expands it in place into a stack of direct actions in thumb reach — Pee, Poop, Sleep (or "She's awake" when one is running), Feed, Measurement. Nappies log straight from the fan with **no sheet and no confirm**; only feeds and measurements open the sheet, because only they carry real data.

- **The cost of D's FAB is paid back without new furniture.** A nappy is two taps, but the second is a large target and no sheet ever renders. The fan hangs off the same FAB people already found, so nothing new has to be discovered.
- **Rejected F3** — the dedicated nappy button bought the last tap with a permanent second control beside a scrolling timeline, and hid poop behind a 400ms long-press. That is exactly the gesture the ticket suspected nobody finds at 3am, and the button invites misfires while scrolling.
- **Rejected F1** — putting nappies inside the sheet works, but renders sheet chrome for the app's most frequent and least informative action, and cannot surface a running sleep the way the fan does.
- **Undo, not confirm** — decided explicitly. Corrections are already first-class in this domain: any Member may fix any Member's entry and the history stays visible. A confirm step taxes every nappy every night to prevent a mistake that is cheap to correct. The prototype's "Confirm instead of undo" toggle exists to make that trade feel real rather than theoretical.

### 2. Recovering a Stale Session

A banner in the timeline at the threshold, offering *She woke at…* / *Still asleep* / *Delete*. The timeline stays usable behind it.

- **The app never writes data nobody entered.** This is the substantive half of the decision, and it rejects S2's auto-close. Ending a sleep at a guess would have preserved more records, but under [ADR-0002](../../docs/adr/0002-append-only-revisions.md) every revision is attributed to a Member, and an app-authored revision is a concept the model does not have and should not gain for this. **Precedent worth carrying**: it points the same way as the open question in [Bottle freshness](15-bottle-freshness.md) — the app reports, the parent judges.
- **Rejected S3** — a modal that blocks the timeline until answered is hostile at exactly the moment it fires, which is the middle of the night, and it punishes the person who opens the app rather than the one who forgot to press stop.
- **It prompts, and it stops asking.** *Still asleep* restarts the clock so the threshold does not fire again immediately; the sleep stays running because it is genuine.

### Settled while resolving, flagged for reversal

Two sub-questions the ticket listed were still open after F2/S1 won, and are decided here rather than left dangling:

- **The picker defaults to her usual wake time, not to now.** "Now" is the honest "we know nothing" answer and is almost always wrong — she woke hours ago, which is why the banner appeared. Defaulting to the usual wake time makes the common case one tap. This was S3's one genuinely good idea and it is portable, so it came across.
- **Threshold**: left as the prototype's switch between a fixed 5h and 1.5× her usual sleep. Not settled here — it belongs with the rest of the target/schedule modelling in [Schedules in v1](09-schedules-v1.md), which is where "her usual" gets defined at all.

### Asymmetry confirmed

The "Forgotten feed" toggle injects a 6h-old running feed. It renders as an ordinary live session with a Stop button and draws no banner, no prompt and no threshold. Only sleeps get recovery, and the UI does not imply otherwise.
