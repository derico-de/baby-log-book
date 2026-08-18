# Store policy research: wrapped web app + subscription sold on our own website

Researched 2026-08-18 for an EU-based developer distributing in the EU.
Context caveat: this landscape has changed roughly every 6-12 months since the DMA
took effect; **Apple announced yet another EU overhaul this month (Aug 2026,
effective 2026-10-01)** and Google restructured fees on 2026-06-30. Every claim
below is dated. Re-verify before implementation.

Method note: research was done via web search grounded in primary sources
(developer.apple.com, apple.com/newsroom, support.google.com, android-developers.googleblog.com);
direct page fetches were blocked in this sandbox, so exact contractual wording
should be re-read on the linked pages before signing anything.

---

## 1. Apple App Store (EU)

### 1a. Is a webview wrapper viable at all? — Yes, with real review risk

- Guideline **4.2 Minimum Functionality**: "Your app should include features,
  content, and UI that elevate it beyond a repackaged website. If your app is not
  particularly useful, unique, or 'app-like,' it doesn't belong on the App Store."
  A bare URL-loading wrapper is the #1 webview rejection; wrappers pass when they
  add native shell value: push notifications, offline handling, native
  navigation/tab bar, OS integration.
  Source: https://developer.apple.com/app-store/review/guidelines/ (guideline 4.2, as of 2026-08).
  Rejection-pattern corroboration: https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper (as of 2025).
- For this app (offline-capable Svelte PWA with local data), a Capacitor-style
  wrap that keeps offline logging working and adds native push would clear the
  usual 4.2 bar — but 4.2 outcomes are reviewer-dependent and rejections on first
  submission are common.

### 1b. Payment setups

**(a) Policy-safe, 0% fee — the login-only pattern (viable for this category):**

- Guideline **3.1.3(f) Free Standalone Apps**: "Free apps acting as a stand-alone
  companion to a paid web based tool (eg. VOIP, Cloud Storage, Email Services,
  Web Hosting) do not need to use in-app purchase, provided there is no purchasing
  inside the app, or calls to action for purchase outside of the app."
  Source: https://developer.apple.com/app-store/review/guidelines/ (as of 2026-08).
- This — not the Reader rule — is the correct hook for a baby-log SaaS.
  Guideline **3.1.3(a) Reader Apps** is limited to magazines/newspapers/books/
  audio/music/video/professional databases/VoIP/cloud storage/approved classroom
  tools; a baby tracker does not qualify. Guideline **3.1.3(b) Multiplatform
  Services** allows access to content bought elsewhere but **only if the same items
  are also offered as in-app purchase** — i.e. it does not give a no-IAP path.
  Source: https://developer.apple.com/app-store/review/guidelines/ (3.1.3(a),(b), as of 2026-08).
- Risk: some reviewers read 3.1.3(f)'s example list narrowly (VoIP/cloud
  storage/email/hosting) — documented reviewer-interpretation friction:
  https://developer.apple.com/forums/thread/781935 (as of 2025).
  Mitigation: app must show **no price, no upgrade CTA, no link to the pricing
  page** — pure login + use.
- No Apple fee applies: Apple's EU commissions attach to in-app transactions and
  to link-out/steered transactions under the entitlements; an app that sells
  nothing and steers nothing owes nothing (the per-install Core Technology Fee
  applied only to alternative-terms/large-scale developers and is being abolished —
  see below).

**(b) Allowed but taxed — selling or linking out from the app:**

- **As of 2026-08-18 (current, signed June 2025 terms):** App Store apps in the EU
  may "communicate and promote offers" and link out for purchase under the
  StoreKit External Purchase Link Entitlement (EU). Fees on linked-out
  transactions: **2% Initial Acquisition Fee** (new users, first 6 months) +
  **Store Services Fee Tier 1 = 5%** or **Tier 2 = 13%** (10% Small Business
  Program / subscriptions after year one), plus **5% Core Technology Commission**
  for developers on the Alternative Terms Addendum. Announced 2025-06-26.
  Sources: https://developer.apple.com/support/communication-and-promotion-of-offers-on-the-app-store-in-the-eu/ (as of 2026-08);
  https://developer.apple.com/help/app-store-connect/reference/store-services-tiers/ ;
  https://www.revenuecat.com/blog/growth/apple-eu-dma-update-june-2025/ (2025-06).
- **From 2026-10-01 (announced 2026-08, after agreement with the European
  Commission):** every EU developer moves to a **single set of business terms**.
  The Initial Acquisition Fee and Store Services Fee are **eliminated**. App Store
  apps that **link out to complete purchases pay a 15% commission (10% reduced
  rate for qualifying programs**, e.g. small business / long-term subscriptions).
  The Core Technology Fee is replaced by a **5% Core Technology Commission on
  digital transactions in apps distributed outside the App Store** (alt
  marketplaces / web distribution). IAP may now be offered alongside alternative
  payments in the same app.
  Sources: https://www.apple.com/newsroom/2026/08/apple-announces-changes-for-apps-in-the-european-union/ (2026-08);
  https://developer.apple.com/news/?id=awedznci (2026-08);
  https://developer.apple.com/support/dma-and-apps-in-the-eu/ (as of 2026-08).
- Using Apple IAP instead: standard 30% / 15% (Small Business Program, and
  subscriptions after year one) — the simple but most expensive route.

**(c) Forbidden:**

- Taking payment in-app through your own PSP checkout **inside the webview
  without any entitlement/authorization** — violates 3.1.1 (as of 2026-08;
  in the EU, alternative in-app payments require the relevant EU addendum).
- Steering/CTAs to web purchase from an app relying on 3.1.3(f) — the no-fee
  status is conditional on total silence about purchasing.
- Note (out of scope for EU, ticket asked): on the **US storefront** since the
  2025-04-30 Epic v. Apple contempt ruling, apps may link out with **no Apple
  commission** — US only, does not help an EU distribution decision.
  Source: https://www.revenuecat.com/blog/engineering/app-to-web-purchase-guidelines (as of 2026).

## 2. Google Play (EEA)

### 2a. Is a webview wrapper viable? — Yes, if you own the site and add app value

- Play's **minimum functionality / webview-spam** policies remove apps that are
  bare webviews "submitted with a primary purpose of driving traffic rather than
  providing engaging app experiences," and forbid wrapping a website **you do not
  own** (affiliate spam). Wrapping your own SaaS with offline handling and push is
  the accepted pattern; domain ownership must be verifiable.
  Sources: https://android-developers.googleblog.com/2020/10/developer-tips-and-guides-common-policy.html (still-current policy framing);
  minimum-quality bar tightened 2024-08-31 (broken/low-utility apps removed).
- Google is in practice more permissive than Apple's 4.2 for own-site wrappers.

### 2b. Payment setups

**(a) Policy-safe, 0% fee — "consumption-only" app (Netflix pattern), explicitly allowed:**

- Google's Payments policy FAQ states any app may be **consumption-only** even if
  part of a paid service — "a user could log in when the app opens and access
  content paid for somewhere else." Condition: nothing purchasable in the app and
  the app must not **lead users** to an outside payment method (no links, no
  pricing CTAs) unless enrolled in an EEA program.
  Sources: https://support.google.com/googleplay/android-developer/answer/10281818 (Payments policy, as of 2026-08);
  https://android-developers.googleblog.com/2020/09/commerce-update-faqs.html (2020-09, unchanged in substance).
- Unlike Apple, this is written policy, not a category carve-out — it applies to
  our category with essentially zero interpretation risk.

**(b) Allowed but taxed — linking out / alternative billing in the EEA:**

- **EEA external offers program** (DMA compliance, program updated 2025): apps may
  link users out to buy digital items on your site. Fees after the 2025 update:
  **3% initial acquisition fee** (first 6 months from install) + **Tier 1 service
  fee 10% (required)** + optional Tier 2 (~3-10% more for full Play services).
  Sources: https://support.google.com/googleplay/android-developer/answer/16505463 (Changes to the external offers program for users in the EEA, as of 2026-08);
  https://support.google.com/googleplay/android-developer/answer/14372887 (enrollment).
- **From 2026-06-30** (announced 2026-06-24): Google decoupled fees in US/UK/EEA.
  **Service fee = 10%** on the first $1M/year **and on all auto-renewing
  subscriptions** (up to 20% only for non-subscription IAP above $1M); a **5%
  billing fee applies only if you use Google Play Billing** — transactions through
  alternative billing or external web links pay **no billing fee**. Net for a
  subscription app linking out in the EEA: **~10%** to Google.
  Sources: https://android-developers.googleblog.com/2026/06/play-expanded-billing.html (2026-06-24);
  https://support.google.com/googleplay/android-developer/answer/16954621 (lower service fees, as of 2026-08).
- **EEA alternative billing in-app** (user-choice/alt-billing-only, since 2022):
  service fee reduced by ~3-4 points when Google Play Billing is not used —
  superseded in attractiveness by the 2026-06-30 structure.
  Source: https://support.google.com/googleplay/android-developer/answer/12348241 (as of 2026-08).

**(c) Forbidden:**

- Selling digital goods consumed in the app through your own checkout (in the
  webview or otherwise) **without** enrolling in an EEA program — Payments policy
  requires Play Billing for in-app digital purchases and bans links/language
  leading to other payment methods outside the programs.
  Source: https://support.google.com/googleplay/android-developer/answer/10281818 (as of 2026-08).

## 3. PWA baseline (no store at all) — zero policy risk

- **iOS/EU status:** Home-screen web apps **remain available in the EU**, running
  on WebKit. Apple proposed removing them in the iOS 17.4 beta (2024-02) and
  **reversed on 2024-03-01**; the reversal still stands as of 2026-08. (Beware:
  several 2026 blog posts still repeat the withdrawn removal — they are wrong.)
  Sources: https://developer.apple.com/support/dma-and-apps-in-the-eu/ (as of 2026-08);
  https://techcrunch.com/2024/03/01/apple-reverses-decision-about-blocking-web-apps-on-iphones-in-the-eu/ (2024-03-01).
- **iOS capabilities 2026:** web push + badging for home-screen web apps since
  iOS 16.4 (2023-03); Declarative Web Push since Safari 18.4; with iOS 26 (2025),
  sites added to the Home Screen open as standalone web apps by default.
  Gaps vs native: no `beforeinstallprompt` (install is a manual
  Share → Add to Home Screen, a real conversion cliff), no store discovery,
  push only after the user installs.
  Source: https://www.mobiloud.com/blog/progressive-web-apps-ios (as of 2026, corroborating WebKit release notes).
- **Android:** first-class PWA support — Chrome install prompts, WebAPK (real
  launcher icon, app switcher), full push/background sync. Functionally close to
  a store app minus Play discovery.
- **Payments in a PWA:** completely outside both stores' jurisdiction — any PSP,
  0% platform fee, no review. This is the zero-policy-risk baseline the ticket
  asked for, and since the app is already an installable SvelteKit PWA, it is
  also the zero-additional-work baseline.

## 4. Verdict matrix

| Setup | Apple EU | Google Play EEA |
|---|---|---|
| PWA, no store | Safe, 0% (install friction on iOS) | Safe, 0% |
| Store app, login-only, purchase on web, no CTA | Safe under 3.1.3(f), 0% — moderate reviewer-interpretation risk + 4.2 wrapper risk | Explicitly safe ("consumption-only"), 0% — must own the wrapped domain |
| Store app + link-out to own checkout | Taxed: today 2%+5-13% (+5% CTC on alt terms); from 2026-10-01 flat 15% (10% reduced) | Taxed: ~10% service fee for subscriptions (post-2026-06-30), no billing fee; 3% IA fee under pre-existing external-offers terms |
| Own PSP checkout inside the app, no program/entitlement | Forbidden (3.1.1) | Forbidden (Payments policy) |
| Native IAP / Play Billing | 30%/15% | 10% (subs) + 5% billing fee |

**Recommended for pricing/packaging:** sell only on the web via our PSP; ship the
store apps login-only under Apple 3.1.3(f) / Google consumption-only (0% fees,
compliant); keep the installable PWA as the fallback if Apple's 4.2 or 3.1.3(f)
review goes badly. Only add link-out entitlements later if web-signup conversion
data justifies paying 10-15%.
