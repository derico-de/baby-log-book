# Payment provider research: EU/Wero-ready vs Stripe

Researched: 2026-08-18. For a ~3 €/month / 28 €/year consumer subscription, solo operator in Germany.

## Wero status as of August 2026 (the part that changed since 2024)

- Wero launched P2P in 2024 (DE/FR/BE, 43M+ registered users after 12 months). ([EPI](https://epicompany.eu/media-insights/wero-successfully-positioned-itself-on-payments/))
- **E-commerce is live in Germany**: EPI unveiled the e-commerce solution with first German merchants, and PAYONE has started a **nationwide German rollout** of Wero acceptance. ([EPI: first merchants in Germany](https://epicompany.eu/media-insights/wero-announces-first-merchants-in-germany/), [PAYONE press](https://www.payone.com/DE-en/about-us/press/wero-e-commerce-acceptance), [EPI: PAYONE rollout](https://epicompany.eu/media-insights/payone-start-nationwide-rollout-wero-ecommerce-2))
- 2026 roadmap: e-commerce launches in Belgium, France (broad rollout: Air France, E.Leclerc, Orange/Sosh, Veepee …), Luxembourg, Netherlands (iDEAL migrates into Wero). ([EPI](https://epicompany.eu/media-insights/ideal-to-phase-into-wero), [Banking.Vision overview](https://banking.vision/en/development-wero-2025-2026/))
- **Recurring/subscription payments via Wero are announced but NOT live** — EPI lists "recurring subscription management" and instalments as future value-added services. Today Wero e-commerce = one-off instant A2A payments. ([wero-wallet.eu merchant page](https://wero-wallet.eu/e-m-commerce), [EPI](https://epicompany.eu/media-insights/wero-announces-first-merchants-in-germany/))
- PSPs/acquirers on board: PAYONE, Worldline, Nexi, Unzer, PPRO, VR Payment, Deutsche Bank, **Stripe**, and Worldpay/Global Payments (Principal Member). ([Worldpay press](https://www.worldpay.com/en/press-releases/worldpay-now-gp-joins-epi-to-enable-wero-payments-for-merchants))
- **Mollie is an EPI Principal Member**; Wero available to Mollie merchants in **Germany and Belgium in H1 2026** (i.e. now), France/Luxembourg after, enabled via the normal Mollie dashboard. ([Mollie news](https://www.mollie.com/news/mollie-epi-principal-member-wero))
- **Stripe already ships Wero** as a payment method: redirect/QR flow, min €0.50, refunds up to 730 days — but **payment mode only** (no subscription/setup mode). There is a documented bridge: a €0.01 iDEAL|Wero payment (refunded) can bootstrap a **SEPA Direct Debit mandate** for subscriptions. ([Stripe Wero docs](https://docs.stripe.com/payments/wero), [iDEAL|Wero → SEPA DD](https://docs.stripe.com/payments/ideal/set-up-payment))

Bottom line: the "European Wero path" and the "Stripe fallback" have converged — both Mollie and Stripe are Wero PSPs today, and *nobody* can run a recurring charge over Wero yet.

## Comparison table

Fees are the providers' published standard rates; effective % shown for our two price points.

| | **Mollie** | **Stripe** | **Adyen** | **Paddle (MoR)** | **Lemon Squeezy / Stripe Managed Payments (MoR)** |
|---|---|---|---|---|---|
| Recurring billing | Subscriptions API (interval, `times`, `startDate`); mandate auto-created from first payment ([docs](https://docs.mollie.com/reference/subscriptions-api), [recurring](https://docs.mollie.com/docs/recurring-payments)) | Stripe Billing: full stack — plans, proration, dunning/smart retries, customer portal ([billing](https://stripe.com/billing)) | Recurring via tokenization; you build the scheduler or use Adyen's subscriptions ([docs](https://docs.adyen.com/)) | Built-in subscriptions incl. trials, dunning ([paddle.com](https://www.paddle.com/)) | Built-in; LS is folded into **Stripe Managed Payments** (public preview Feb 2026) ([LS 2026 update](https://www.lemonsqueezy.com/blog/2026-update)) |
| Trials (first month free) | DIY: €0-amount first payment (card/PayPal) or €0.01+refund for mandate, then subscription with `startDate` +1 month ([docs](https://docs.mollie.com/docs/recurring-payments)) | Native `trial_period_days`, no card-upfront option supported | DIY | Native | Native |
| SEPA Direct Debit | Yes — core recurring method; ~0.9% + €0.25 ([pricing](https://www.mollie.com/pricing), [help](https://help.mollie.com/hc/en-us/articles/214071589-What-are-the-costs-for-a-Recurring-payment-)) | Yes — 0.8% + €0.25, capped €5 ([local methods pricing](https://stripe.com/pricing/local-payment-methods)) | Yes ([docs](https://docs.adyen.com/payment-methods/sepa-direct-debit)) | Yes (Paddle is the merchant) | Yes |
| EU VAT handling | **You** (OSS or Kleinunternehmer) | **You**; Stripe Tax computes it for +0.5%/txn ([tax pricing](https://stripe.com/tax/pricing)) | You | **Paddle is Merchant of Record** — collects & remits VAT ([paddle-101](https://www.paddle.com/paddle-101)) | **MoR** — VAT handled |
| Fee on a **3 €** charge | Card 1.8%+€0.25 → **€0.30 (10.1%)**; SEPA DD → **€0.28 (9.2%)** | Card 1.5%+€0.25 → **€0.30 (9.8%)**; SEPA DD → **€0.27 (9.1%)**; +0.7% Billing (~€0.02) ([DE pricing](https://stripe.com/en-de/pricing), [billing pricing](https://stripe.com/billing/pricing)) | Interchange++ (~€0.13 processing + method fee), **but monthly minimum invoice** ([pricing](https://www.adyen.com/pricing), [help](https://help.adyen.com/en_US/knowledge/finance/invoices/what-are-the-fees-on-my-invoice)) | 5% + $0.50 → **~€0.61 (~20%)** ([pricing](https://www.paddle.com/pricing)) | 5% + $0.50, +0.5% subscriptions → **~€0.63 (~21%)** |
| Fee on a **28 €** charge | Card → **€0.75 (2.7%)**; SEPA DD → **€0.50 (1.8%)** | Card → **€0.67 (2.4%)**; SEPA DD → **€0.47 (1.7%)**; +€0.20 Billing | Lowest raw %, irrelevant below the minimum invoice | **~€1.86 (~6.6%)** | **~€2.00 (~7%)** |
| Wero status | **Live for DE/BE merchants H1 2026**, dashboard toggle; EPI Principal Member ([news](https://www.mollie.com/news/mollie-epi-principal-member-wero)) | **Live** as one-off payment method; no subscription mode ([docs](https://docs.stripe.com/payments/wero)) | Not announced as Wero acquirer (competitors PAYONE/Worldline/Nexi are) | None announced | None announced |
| Solo-operator effort | Low: SMB-focused, fast onboarding, hosted checkout, no monthly fee, pay only for successful txns ([pricing](https://www.mollie.com/pricing)). But **no built-in dunning/trials/portal** — you write webhook logic | Low: fastest onboarding, hosted Checkout + Billing portal = least code for a full subscription lifecycle | **High: enterprise-oriented, sales contact, minimum invoice — not viable for this project** | Very low (they run checkout, tax, invoices) — at 2-3× the fees | Very low; product in migration/preview — platform risk |

Also checked: **Mangopay** — marketplace/platform-payments specialist (split payments, e-wallets), per-project pricing, no Wero announcement found; wrong shape for a simple consumer subscription. **PAYONE** — first German acquirer with nationwide Wero e-commerce ([press](https://www.payone.com/DE-en/about-us/press/wero-e-commerce-acceptance)), but a classic merchant-account acquirer; its subscription tooling and API DX are far behind Mollie/Stripe for a solo SaaS.

## The VAT question (does MoR earn its ~5%?)

Since 2025-01-01, §19 UStG raised the **Kleinunternehmer** thresholds to **€25,000 prior-year / €100,000 current-year** turnover, and the new **EU small-business scheme (§19a UStG / EU-KU)** extends the exemption to cross-border EU B2C sales up to €100,000 EU-wide (registration at BZSt + quarterly reports). ([IHK München](https://www.ihk-muenchen.de/ratgeber/steuern/steuerarten/umsatzsteuer/kleinunternehmerregelung/), [IHK Rhein-Neckar on EU-KU](https://www.ihk.de/rhein-neckar/recht/steuerrecht/umsatzsteuer-international/eu-kleinunternehmerregelung-6676918))

At 3 €/month, €25k/year ≈ **700 paying subscribers** — the VAT problem a MoR solves does not exist for this project's first years (confirm with tax advisor). Paying Paddle ~20% of a 3 € charge to remit VAT you don't owe is the wrong trade.

## Fees vs price point

A 3 € monthly charge loses **~9-10%** to any PSP's fixed fee (€0.25); the 28 € yearly charge loses **~1.7-2.7%**. **Defaulting to the yearly plan (or yearly-only) is the single biggest fee lever** — bigger than the choice between Mollie and Stripe. SEPA Direct Debit is the cheapest recurring rail at both providers and is the rail Wero users' mandates would bootstrap onto anyway.

## Recommended direction

**Start with Mollie** (satisfies the European preference at no real complexity cost), yearly-plan-first pricing:

- European (Dutch) PSP, EPI Principal Member; **Wero is already switchable-on for German merchants** in the dashboard — the credible Wero path the ticket asked for, live today for one-off payments (use it for the 28 €/year plan; monthly recurring stays on SEPA DD/cards until Wero recurring ships).
- Subscriptions API + hosted checkout + no monthly fee fits a solo operator; onboarding is SMB-grade KYC, minutes-to-days.
- Accepted DIY cost: first-month-free = mandate-first payment + `startDate` one month out; dunning = webhook-driven retry/notify logic (a few days of work, no moving parts you don't already run).
- VAT: operate as Kleinunternehmer (§19/§19a UStG) initially — no VAT, no OSS, no MoR needed.

**Named switch triggers:**

1. **→ Stripe** (Billing + Checkout + customer portal, Wero one-offs also available there): if Mollie's missing dunning/trial/portal tooling costs more than ~3 dev-days or failed-payment churn becomes visible, or if Mollie's German onboarding/feature gaps bite in practice. Stripe is fee-equivalent (±0.1 pp) and equally Wero-capable, just non-European.
2. **→ a Merchant of Record** (Paddle 5%+$0.50, or Stripe Managed Payments once GA): when revenue approaches the €25k/€100k Kleinunternehmer/EU-KU limits, or non-EU (UK/CH/US sales-tax) customers become material — that's when VAT/tax handling starts being worth ~4 extra points of fees.
3. **→ Wero recurring**: when EPI ships subscription payments (announced, no date), adopt via whichever of Mollie/Stripe exposes it first — no migration needed, both are Wero PSPs.

The pricing/packaging decision itself (monthly vs yearly-only) is taken in the pricing ticket; from a fee standpoint this research says: make yearly the default.
