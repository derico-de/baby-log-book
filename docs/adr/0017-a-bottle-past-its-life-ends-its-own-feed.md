# A bottle past its Life ends its own Feed

The server ends an open bottle Feed once its Bottle Life has run out: an app-attributed revision (`author_id` null, like a Session Merge) sets `ended_at` to the **due instant** — the Feed's start plus the duration the Household typed — never to the moment the server noticed. We chose this over ADR-0016's original position, which let the countdown run forever, because a bottle past its stated hour is a bottle nobody is going to offer again: the Feed has factually ended, and unlike a Sleep's end — which only a human knows — this end is computable, identically, on every device, from a synced Target. The stale-Sleep banner therefore stays a question the app asks; the bottle past its Life becomes a fact the app records.

This amends [ADR-0016](0016-the-bottle-life-is-a-target-not-a-verdict.md) (the row no longer counts past the hour indefinitely) and widens the one exception [ADR-0014](0014-only-sleeps-merge.md) carved out: app-authored revisions now exist in exactly two places — the Session Merge and this — and both record a consequence of something a human did enter, never an invention.

## Consequences

- **The end is a fact, not a guess.** `ended_at` is the due instant, so a bottle discovered hours later still closes at the right time, retroactively. There is still no function that stops a session at "now" on the app's authority.
- **It runs inside the push transaction and at the top of pull.** A bottle goes past by time passing alone, not by anyone writing, so the close also fires when somebody merely looks — a bottle started at night and never followed by another push does not stay open until morning. There is no timer; while nobody pushes or pulls, nothing happens, and nothing needs to.
- **Exactly once per Feed.** The revision id is deterministic (`bottle-past:<entry id>`), so replay is a no-op — and a Member who deliberately reopens the Feed by clearing its end is not fought: the app never re-closes it.
- **A Member's correction wins by ordinary last-write-wins.** Stating the real end afterwards is just a later revision; the app's stands only while nobody says better.
- **The client rule is untouched.** `mutate.ts` still contains no function that invents a value, and the server still stamps every client revision with the session's author — a client physically cannot author an app-attributed revision. The two app-authored writes both live server-side, in `sync.ts`.
- **The history says who did it.** The Entry's revision list shows the end as changed by *the app*, the same honest line a Session Merge leaves.
- **The vocabulary stays ADR-0016's.** The row says *past*, never *expired*: the close records that the Household's number ran out, not that the milk went bad.
