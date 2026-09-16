# The Night moves a Feed only once the bedtime Feed is behind her

[ADR-0040](0040-the-night-moves-a-feed-only-once-it-has-begun.md) held a Feed's interval until the stated hour arrived, and from that hour on moved every due inside the Night to the Day Start. That was still one condition short: fed at 18:35 on three and a half hours with a Night stated at 21:00, the due lands at 22:05 — and at 21:00 the header switched to *due 06:00* while she had not had her bedtime Feed. The evening still had a Feed in it, and the app had just stopped announcing it.

The night begins somewhere inside that interval, and the question is which of its two Feeds is the bedtime one — the last Feed, or the one due next. The answer is the one nearer the stated hour. Fed at 18:35, the hour is two and a half hours after the last Feed and an hour before the due: the due is the bedtime Feed, and it stands. Fed at 20:45, the hour is fifteen minutes after the last Feed and three hours before the due: the last Feed *was* the bedtime one, and the due at 00:15 is the morning's. A tie reads as the last Feed being the bedtime one — a Household whose bedtime Feed is at 19:30 is not fed again at 22:30.

## Consequences

- **Still one function, one Feed question in front of it.** `pastNight` in `$domain/time` keeps moving instants exactly as [ADR-0032](0032-the-night-period-ends-at-the-day-start.md) and ADR-0040 said. Whether the bedtime Feed is behind her is the Feed's own question, so `feedDueInstant` asks it first — of the anchor and the due, which `pastNight` never sees — and the header, the notifier and the Hub still share the one answer.
- **A bedtime Feed that never gets logged now sits overdue.** ADR-0040 promised the opposite, and gives it up: the app reports the log, and a log whose last Feed is the afternoon's says she has not been fed since. Once the bedtime Feed is logged, its own due is inside the Night and moves to the morning, which is where ADR-0040's promise holds.
- **The Notice follows.** The head start for a bedtime Feed fires whether the stated hour has passed or not, because the due it takes its head start from has not moved.
- **Nothing else moves.** Only once the night has begun, only Feeds, one hour ending at the Day Start, nothing until a Parent states one — all unchanged. ADR-0032's sentence grows one more clause: *and only once the bedtime Feed is behind her*.
