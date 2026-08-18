# A new Feed ends the running one

A Baby eats one thing at a time, so logging a new feeding — a Feed or a Meal — while a Feed is still running ends the running Feed at the new one's Occurred At. The formula after the breast stops the breast timer. It is one ordinary revision attributed to the Member who logged the new feeding, with no lasting linkage: later corrections to either row are independent. The feed sheet says so before saving with the same quiet inline line the awake switch uses (*"ends the running feed at 14:05"*), because it is a real write and real writes are visible.

## Consequences

- **This is an end, not a merge — [ADR-0014](0014-only-sleeps-merge.md) stands.** Both rows survive with their millilitres; a Combined Feed is still logged as the several Feeds it was, only now each earlier Feed carries the end it in fact had. The failure ADR-0014 refused — a tombstoned bottle whose volume silently leaves the day — cannot happen here, because nothing is hidden.
- **"The app never writes data nobody entered" holds.** The end instant is the new feeding's Occurred At, which a Member entered, and the revision is attributed to that Member — unlike the bottle past its Life, whose end the server authors ([ADR-0017](0017-a-bottle-past-its-life-ends-its-own-feed.md)).
- **The guard is the Meal-awake guard, one concept over.** Only when the new feeding's Occurred At falls inside the running Feed. A back-dated feeding predating it is a separate, earlier feed — she ate, then the current feed began — and leaves the running one alone. When the guard fails, the inline line does not show either, because no write will happen.
- **Ending a bottle Feed stops its Bottle Life countdown**, which is exactly the one meaning a Feed's end carries ([ADR-0016](0016-the-bottle-life-is-a-target-not-a-verdict.md)): that bottle is not going to be offered again — the next thing already is.
- **Client-side, at the point of logging.** It lives in the feed sheet's Save and Start timer, not on the server. Two Members logging concurrently on two Devices can still leave two open Feeds, and that stays visible on the timeline rather than silently reconciled — the same posture ADR-0014 took.
- **A stale breast Feed becomes self-limiting.** It was already harmless (its end carries no meaning); now the next logged feeding closes it, so it no longer runs for hours as a timer nobody reads.
