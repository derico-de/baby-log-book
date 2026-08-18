# Payment provider direction: EU/Wero-ready vs Stripe

Type: research
Status: resolved

## Question

Which payment provider path should the hosted service take for a ~3 €/month / 28 €/year consumer subscription, preferring European providers with Wero support or a credible Wero roadmap — falling back to Stripe if the European options are too complicated for a one-person start?

To research:

- European PSPs with subscription/recurring support: Mollie, Adyen, Mangopay, PAYONE, and others surfaced — do any support Wero today or have announced plans? What is Wero's actual e-commerce/recurring-payment status in 2026 (it launched as P2P; where is merchant acceptance)?
- Subscription-management capability: recurring billing, trials (first month free), EU VAT handling (MOSS/OSS), SEPA direct debit, dunning — per candidate, vs Stripe Billing as the baseline.
- Fees at our price point (a 3 € transaction makes per-transaction minimum fees matter a lot; does yearly-only pricing dodge this?).
- Effort/complexity for a solo operator: onboarding (KYC), API quality, hosted checkout pages vs custom integration.

Deliverable: a findings file with a comparison table and a recommended direction (provider now + Wero path later, or Stripe now + named switch trigger). The decision itself is taken in the pricing/packaging ticket.

## Answer

Full findings: [research/payment-providers.md](../research/payment-providers.md) (researched 2026-08-18).

Recommendation: **start with Mollie**, yearly-plan-first. Mollie is a European PSP, EPI Principal
Member, and has Wero live for German merchants since H1 2026 as a dashboard toggle (one-off payments
only — Wero recurring is announced by EPI but not shipped anywhere yet, so monthly billing runs on
SEPA Direct Debit/cards). Mollie's Subscriptions API covers recurring; trials and dunning are DIY
webhook work (~days). Fees ≈ Stripe (card 1.8%+€0.25 vs 1.5%+€0.25; SEPA DD ~0.9%+€0.25 vs
0.8%+€0.25) — at 3 € any PSP eats ~10% in fixed fees, at 28 €/year only ~2%, so yearly-default is
the biggest fee lever. VAT: use Kleinunternehmer/EU-KU (§19/§19a UStG, €25k/€100k limits since
2025) — no OSS, so a Merchant of Record's ~5%+$0.50 isn't worth it now. Notably, Stripe also ships
Wero already, so the "European path vs Stripe fallback" has converged. Switch triggers: to Stripe if
Mollie's missing dunning/trial/portal tooling costs >~3 dev-days or hurts churn; to a MoR
(Paddle/Stripe Managed Payments) when nearing the €25k/€100k VAT limits or non-EU sales grow; adopt
Wero recurring via whichever PSP ships it first (no migration — both are Wero PSPs). Adyen ruled out
(enterprise minimum invoice); Mangopay wrong shape (marketplaces); PAYONE has Wero live in DE but
weak subscription tooling.
