# Competition research: baby-tracker market

Researched 2026-08-18. All prices as published on the vendors' own pages on that date; most players
publish USD only — noted per row. Every claim links to the source that owns it.

Method note: research ran inside a sandboxed environment where only a few hosts were directly
fetchable (github.com worked; vendor sites did not), so vendor pages were read through search-engine
extraction of the primary URLs cited below. Prices marked (USD) were published in USD; none of the
mainstream players publish a EUR price list on the open web — app-store prices are localized at
checkout.

## Comparison table

| App | Price monthly | Price yearly | Trial | Open source? | Self-hostable? | Hosted service? | Data hosting / GDPR posture |
|---|---|---|---|---|---|---|---|
| **Huckleberry** (Huckleberry Labs, US) | Plus $11.99, Premium $14.99 (USD) | Plus $68.88, Premium $119.88 (USD) | Free tier (basic logging) | No | No | Yes (the product) | US company; service operated from the US, EEA/UK data transferred to the US under SCCs; no EU-residency option. [pricing](https://huckleberrycare.com/pricing), [privacy policy](https://huckleberrycare.com/privacy-policy) |
| **Napper** (Napper AB, Stockholm) | Monthly + quarterly plans (IAPs $9.99–69.99) | ~$59.99 (USD, "60% discount" anchor) | 7-day free trial | No | No | Yes (the product) | EU (Swedish) company, GDPR-native by default — but policy admits processing/storage/transfer outside the user's country under EC standard contractual clauses; no "data stays in the EU" promise. [pricing](https://napper.app/en/pricing/), [privacy](https://napper.app/privacy/), [terms](https://napper.app/terms-of-service/), [Play listing](https://play.google.com/store/apps/details?id=com.napper) |
| **Glow Baby** (Glow Inc., San Francisco) | ($4.99/mo effective) | $59.99; $29.99/quarter; $99.99 lifetime (USD, covers all 4 Glow apps) | Free tier | No | No | Yes (the product) | US company, US processing. 2020 landmark settlement with the California AG: $250,000 penalty over "serious basic security failures" in handling sensitive health data. [pricing (support page)](https://support.glowing.com/hc/en-us/articles/115000246907-How-much-does-Glow-Premium-cost), [CA AG press release](https://oag.ca.gov/news/press-releases/attorney-general-becerra-announces-landmark-settlement-against-glow-inc-%E2%80%93) |
| **Baby Tracker – Newborn Log** (Nighp Software, US) | — (no subscription) | — | Free version (ads on Android) | No | No | Optional sync via Nighp's server, iCloud or Dropbox | Pro version ~$4.99 one-time. Collects personal data (baby name, email, all records, photos) only when its own sync server is used; ad-tech SDKs collect device IDs and coarse location in the free app. No EU-hosting claims. [App Store](https://apps.apple.com/us/app/baby-tracker-newborn-log/id779656557), [Pro](https://apps.apple.com/us/app/baby-tracker-pro-newborn-log/id845657206), [privacy policy](https://nighp.com/babytracker/babytracker_pp.html) |
| **Baby Daybook** (Drilly Apps, Lithuania) | $4.99 (USD) | Lifetime $34.99; IAPs $1.99–49.99 | 7-day Premium trial | No | No | Yes (the product) | EU (Lithuanian) company; billed via app stores; no explicit EU-data-residency marketing found. [premium page](https://babydaybook.app/premium/), [terms](https://babydaybook.app/terms-of-service/), [Play listing](https://play.google.com/store/apps/details?id=com.drillyapps.babydaybook) |
| **Baby Connect** (Seacloud, US) | Family $4.99, Professional $14.99 (USD) | Monthly or annual billing | 7-day free trial | No | No | Yes (the product) | US product, moved from one-time purchase to subscription in 2021; no EU-hosting posture found. [Play listing](https://play.google.com/store/apps/details?id=com.seacloud.bc), [subscription change announcement](https://babyconnect.wordpress.com/2021/02/05/important-change-to-baby-connect/) |
| **Baby Buddy** (open-source project) | free | free | n/a | Yes (BSD-2-Clause, 2.9k stars, active) | Yes (Docker, Home Assistant addon, Heroku, Cloud Run) | **No official hosted service** — demo instance only; third parties like PikaPods sell generic managed hosting from ~$1.80–2.50/mo with EU (Germany) data residency | Hosting posture is whatever the self-hoster chooses; PikaPods stores account data in Germany, never transferred out of the EEA, and lets you pick EU/US jurisdiction. [repo](https://github.com/babybuddy/babybuddy), [PikaPods](https://www.pikapods.com/), [PikaPods privacy](https://www.pikapods.com/privacy) |
| **baybay** (micro-project) | Hosted plan $7/mo (USD) | — | — | Yes (MIT, full app in repo, no open-core split) | Yes (PHP 8.2 + SQLite, no Docker) | **Yes** — $7/mo "same application" convenience hosting | No GDPR/EU-hosting claims found on site or repo. Tracks feeds + sleep only. Very small project: 0 stars, 3 commits. [site](https://baybay.baby/), [repo](https://github.com/webdevday/baybay) |

Other names that surfaced but were left shallow: Pebbi (paid, closed), Nara Baby (free tier, closed), Talli, Sprout — none open source, none with EU-hosting marketing found.

## Verdict

### (a) Does "first month free, 3 €/month or 28 €/year" sit low, mid, or high?

**Low end of the subscription market — clearly.** The venture-backed trackers charge 4–15 USD/month
and 60–120 USD/year: Huckleberry Plus is $68.88/yr and Premium $119.88/yr
([source](https://huckleberrycare.com/pricing)); Napper anchors at ~$59.99/yr
([source](https://adapty.io/paywall-library/napper-baby-sleep-tracker/)); Glow Premium is $59.99/yr
([source](https://support.glowing.com/hc/en-us/articles/115000246907-How-much-does-Glow-Premium-cost));
Baby Daybook and Baby Connect sit at $4.99/mo. At 28 €/year the hypothesis is roughly **half the
cheapest mainstream yearly plan and a quarter of Huckleberry Premium**, while 3 €/mo undercuts every
subscription competitor's monthly price. The only things cheaper are one-time-purchase apps
(Nighp's Baby Tracker Pro, ~$5 once), free self-hosting (Baby Buddy), and raw PikaPods hosting
(~2 €/mo) — none of which are managed products with support. A first *month* free is also more
generous than the market's standard 7-day trial (Napper, Baby Daybook, Baby Connect). The pricing
leaves headroom; the risk is anchoring low, not high.

### (b) Is "open source + paid EU-hosted convenience, GDPR-first" an unoccupied position?

**Effectively yes — with one asterisk.** No major player occupies it: Huckleberry, Glow and Baby
Connect are closed-source US products processing data in the US (Huckleberry explicitly transfers
EEA data to the US under SCCs; Glow carries a 2020 California AG privacy settlement). Napper is the
privacy-strongest incumbent — an EU (Swedish) company — but it is closed-source and its own policy
reserves the right to move data outside the user's country. Baby Buddy owns the open-source flank
but deliberately offers **no hosted service**; the closest assembly is "Baby Buddy on PikaPods"
(EU data residency, ~2 €/mo) which is a DIY stack, not a product. The asterisk is **baybay**: the
identical business model (MIT-licensed app + $7/mo hosted convenience), but it is a feeds-and-sleep
micro-project with zero traction and no EU/GDPR positioning. Conclusion: nobody currently combines
open source, an official hosted plan, **and** an explicit EU-hosting/GDPR-first promise — that
triple is unoccupied, and the GDPR-first promise is the part no competitor (including baybay) makes.
