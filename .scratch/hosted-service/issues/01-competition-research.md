# Competition research: baby-tracker market

Type: research
Status: resolved

## Question

What does the baby-tracker competition look like, answered on three axes:

1. **Pricing** — what do subscription baby trackers actually charge (monthly/yearly, trial length, lifetime offers)? Does "first month free, 3 €/month or 28 €/year" sit low, mid, or high in the market?
2. **Open-source + hosted** — does anyone else offer a fully open-source, self-hostable baby tracker *with* an optional paid hosted service (our positioning)? Known open-source players (e.g. Baby Buddy) and how they handle hosting.
3. **Privacy posture** — GDPR/EU-hosting claims (or their absence) of the major players: Huckleberry, Baby Tracker, Napper, Glow Baby, and whatever else the research surfaces. Where is their data hosted, what do their privacy policies admit?

Deliverable: a findings file with a comparison table (app, price, model, open-source?, hosting/GDPR posture) and a short read on whether our pricing hypothesis and privacy positioning hold up.

## Answer

Full findings with comparison table and per-claim sources: [research/competition.md](../research/competition.md)

1. **Pricing: "first month free, 3 €/month or 28 €/year" sits at the low end.** Mainstream
   subscription trackers charge $5–15/mo and $60–120/yr (Huckleberry Plus $68.88/yr, Premium
   $119.88/yr; Napper ~$59.99/yr; Glow Premium $59.99/yr; Baby Daybook and Baby Connect $4.99/mo).
   28 €/yr is roughly half the cheapest mainstream yearly plan, and a first month free beats the
   market-standard 7-day trial. Only one-time-purchase apps (~$5 once) and free self-hosting are cheaper.
2. **Positioning: "open source + paid EU-hosted convenience, GDPR-first" is effectively unoccupied.**
   Huckleberry, Glow and Baby Connect are closed-source with US processing (Huckleberry transfers EEA
   data to the US under SCCs; Glow settled with the California AG in 2020 over security failures).
   Napper is EU-based but closed-source and reserves cross-border transfers. Baby Buddy is open source
   but offers no hosted service. One asterisk: **baybay** (MIT + $7/mo hosted) runs the same business
   model, but it is a zero-traction micro-project with no EU/GDPR positioning — the explicit
   GDPR-first, EU-hosted promise is the part nobody makes.
