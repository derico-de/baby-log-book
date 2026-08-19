# Pricing, packaging and positioning

Type: grilling
Status: resolved
Blocked by: 01, 02, 03

## Question

Lock the offer: price (EUR), billing periods, trial, and the positioning line — turning the hypothesis "first month free, 3 €/month or 28 €/year" into a decision, informed by the competition research, the payment-provider comparison, and the store-policy findings.

To decide:

- Final monthly/yearly price in EUR, or yearly-only if per-transaction fees at 3 € argue for it.
- Trial mechanics at direction level: first month free vs feature-limited free tier vs time-limited full trial.
- Whether "open source, self-host for free, or pay us for convenience — GDPR, hosted in DE/EU" survives the competition findings as the positioning, and how it's phrased.
- Payment provider direction (from the ticket "Payment provider direction: EU/Wero-ready vs Stripe"): who we start with, what triggers a switch.
- Whether store policies (from the store-policy ticket) constrain the model — e.g. web-purchase-only with a login-only wrapped app.

## Answer

Decided 2026-08-19 in a grilling session; all seven questions settled as recommended.

1. **Price: 3 €/month or 28 €/year, yearly pre-selected at checkout.** The ~10% fixed-fee
   loss on a 3 € charge is consciously accepted as the cost of a visible low-commitment
   option — the monthly plan is a trust signal ("you can leave any month") more than a
   revenue line. Sitting at the low end of the market (half the cheapest mainstream yearly
   plan) is deliberate: "fair price" is part of the positioning, not underpricing to fix later.
2. **Billing unit: one Plan per Household, flat.** Unlimited Members and Devices — inviting
   grandma never costs anything. Matches the tenancy model (the Household is already the
   data boundary). Recorded in CONTEXT.md as **Plan**.
3. **Trial: first month free, full-featured, no payment method upfront.** Non-payers lapse;
   what lapse means (grace, read-only, deletion) is deliberately deferred to the
   subscription-lifecycle ticket. No permanent free tier — the free option in this model is
   self-hosting. Recorded in CONTEXT.md as **Trial**.
4. **No lifetime or one-off plan.** Hosting is a recurring cost; a lifetime promise on a
   hosted service is a liability a one-person operation shouldn't carry. Subscription-averse
   users have the self-host path.
5. **Positioning line locked:** *"Fully open source — self-host for free, or let us host it
   for you. Fair price, GDPR-first, your data stays in Germany."* Committed to **hosted in
   Germany** (not the softer "EU"): the sharper promise, cheap to keep with DE hosters, and
   it differentiates hardest against Napper and the US apps.
6. **Payment provider: Mollie, yearly-first** — confirming the research recommendation as
   the decision, with its named switch triggers (to Stripe if missing trial/dunning/portal
   tooling costs >~3 dev-days or hurts churn; to a merchant of record when nearing the
   Kleinunternehmer limits or non-EU sales grow; adopt Wero recurring via whichever PSP
   ships it first). Detail in [02-payment-provider-research.md](02-payment-provider-research.md).
7. **Distribution: sell only on the web (0% store fees).** PWA is the primary mobile
   install; a login-only wrapped store app comes later only if users demand it; in-app
   purchase link-out (taxed 10–15%) is ruled out. Detail in
   [03-store-policy-research.md](03-store-policy-research.md).
