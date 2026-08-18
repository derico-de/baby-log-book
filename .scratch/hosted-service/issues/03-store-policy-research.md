# App-store policy: wrapped web app with external subscription payment

Type: research
Status: resolved

## Question

Do Apple App Store and Google Play rules (as of 2026, post-DMA) allow a webview-wrapped version of this app whose subscription is sold on our own website via our own PSP — and on what terms?

To research:

- Apple: current App Review guidelines on web-wrapper apps (4.2 minimum functionality) and on external purchases/anti-steering after the DMA and the US Epic rulings — what applies to an EU-based developer distributing in the EU? Commission rates on external-purchase links, Core Technology Fee status.
- Google Play: policy on apps whose functionality requires a subscription purchased outside Google Play Billing; EU alternative-billing programs and their fees.
- The reader-app / "account created elsewhere" carve-outs: can the wrapped app simply *not sell anything* (login only, purchase on the web) — the Netflix/Spotify pattern — and is that compliant for our category?
- Practical alternative: how far a PWA (installable, no store) gets us on iOS/Android in 2026, as the zero-policy-risk baseline.

Deliverable: a findings file stating which distribution/payment combinations are policy-safe, which are taxed, and which are forbidden — as input to the pricing/packaging decision.

## Answer

(Researched 2026-08-18; full findings with per-claim sources and dates in
[research/store-policies.md](../research/store-policies.md).)

- **Safe (0% fees):** (1) the installable PWA — zero policy exposure on both
  platforms; iOS home-screen web apps survived the EU DMA scare (removal reversed
  2024-03-01) and support push since iOS 16.4. (2) Store apps that are
  **login-only** with purchase on our website and *no* in-app price/CTA/link:
  explicitly allowed on Google Play ("consumption-only" apps, Payments policy
  FAQ); allowed on Apple via guideline **3.1.3(f)** (free companion to a paid
  web-based tool) — the reader-app rule 3.1.3(a) does *not* cover our category,
  and 3.1.3(f) carries moderate reviewer-interpretation risk, plus the usual
  4.2 minimum-functionality risk for a webview wrapper (mitigate with offline +
  push + native shell).
- **Taxed:** linking out from the store app to our checkout. Apple EU: today
  2% + 5-13% (+5% CTC on alt terms); from **2026-10-01** a flat **15%**
  (10% reduced) under the new single EU terms announced 2026-08. Google EEA:
  since **2026-06-30** roughly **10%** service fee for subscriptions via external
  links (no billing fee), plus 3% initial-acquisition fee under external-offers
  terms. Apple IAP / Play Billing: 30%/15% resp. 10%+5%.
- **Forbidden:** taking payment through our own PSP *inside* the app without the
  respective EU program/entitlement — on both stores.
- **Recommendation:** sell only on the web; ship login-only store apps; keep the
  PWA as fallback if Apple review balks. Add link-out entitlements only if
  conversion data later justifies paying 10-15%.
