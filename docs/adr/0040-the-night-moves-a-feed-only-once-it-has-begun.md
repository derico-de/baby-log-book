# The Night moves a Feed only once it has begun

[ADR-0032](0032-the-night-period-ends-at-the-day-start.md) moves a Feed whose due instant falls inside the Night Period to the Day Start. It moved it too eagerly: fed at 18:33 on a three-and-a-half-hour interval with a Night stated at 21:00, the due lands at 22:03 — inside the Night — and the header spent the whole evening announcing a Feed due at 07:00 tomorrow. But the evening is still running, and there is a bedtime Feed to come before anybody sleeps. The morning is not the answer until the night is.

So the fold gains one more condition: a due instant inside the Night moves to the Day Start **only once that Night has begun**. Until the stated hour arrives, the interval stands exactly as stated — the header reads *due 22:03*, and the Feed Notice gives its head start for the bedtime Feed rather than staying silent until dawn. From the stated hour onward, the same due instant belongs to the morning, which is when a morning prediction starts making sense.

## Consequences

- **It is still one function.** `pastNight` in `$domain/time` gains a `now` and keeps both callers: the sticky header passes the paint's clock, the notifier its tick's. The two can only ever agree to within clock skew, which is already true of everything else they compute.
- **Which night, exactly.** The Night a due instant falls in began at the most recent stated hour at or before it — so a due past midnight belongs to the night that began the evening before, and an evening `now` is already inside it. The move is monotone: once a Night has begun it never un-begins, so a due never flips back off the morning.
- **The bedtime Feed gets its Notice.** Before this, a Feed Notice whose due fell inside the Night waited for the Day Start even while the family was up and the bedtime bottle unpoured. Now the head start fires in the evening whenever it lands before the stated hour; from that hour on the notifier is as silent as ADR-0032 made it, and no sleeping phone learns the difference.
- **Once the night begins, the app stops claiming.** A bedtime Feed that never gets logged does not sit overdue all night: at the stated hour its due instant becomes the morning's, which is the whole promise of ADR-0032, kept.
- **ADR-0032 stands otherwise.** Feeds only, one hour ending at the Day Start, nothing until a Parent states one — all of it unchanged. Only the sentence "it moves an instant, and only forward" grows a clause: *and only once the night has begun*.
