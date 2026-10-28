# The zone prompt comes on arrival, and a time field names its zone

[ADR-0010](0010-instants-are-stored-the-zone-is-a-lens.md) let a Device in a new zone suggest moving the Household Zone only after 48 hours of reporting it, so a layover would not move a Household. A family that flew from Bucharest to Rome lived those two days on the wrong clock, and never knew why. Every sheet prefilled Bucharest time, an hour ahead of the phone. They corrected it to the phone's time. That time was read in Bucharest, so the Feed started an hour in the past, and with a one-hour Bottle Life the next sync ended it ([ADR-0017](0017-a-bottle-past-its-life-ends-its-own-feed.md)). To them the app was simply wrong. The suggestion would have explained it, but it sat in Settings and ran only at a cold start.

The cost of a layover is one question answered "keep". The cost of waiting is every time typed in the meantime. So the suggestion now comes the moment a Parent's Device is in a zone that is not the Household Zone. It also comes when the app returns to the foreground, because a phone that slept through the flight never starts cold. It shows as a banner on the timeline, where the wrong times are.

## Consequences

- **Still suggested, never applied.** Moving the Household re-reads the whole past, so it stays a Parent's choice. Only Parents see the banner, because only a Parent can move it.
- **Keep is for good, move is not.** "Keep" silences that zone on this Device for good, as ADR-0010 said. "Move" silences nothing. The trip home asks about home, and the next trip asks again.
- **A time field names the zone it is read in** whenever the Device is elsewhere: *Time (Bucharest)*. A Member who keeps the Household Zone, or a Caregiver who cannot change it, still sees which clock a typed time is read on.
- **Entries logged before the move keep the instant they were given.** The app cannot tell a time typed in the wrong zone from one typed in the right one, and it never rewrites what nobody entered.
