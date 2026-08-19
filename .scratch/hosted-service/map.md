# Hosted Service — wayfinder map

Label: wayfinder:map

## Destination

An implementable **Stage-1 spec** — multi-household pilot on the current single deployment (operator-created Households, free, same SQLite database, friends invited for feedback) — **plus locked direction decisions for the paid hosted service**: pricing/packaging validated against competition, payment-provider direction (EU/Wero-ready vs Stripe), SaaS-stage platform direction (Postgres & co vs current stack), and the legal/GDPR checklist for charging from Germany. The map is done when Stage-1 implementation can start from the spec and nothing about the hosted-service direction is left undecided at direction level.

## Notes

- Domain: this repo's baby-log app; vocabulary is CONTEXT.md (Household, Member, Claim Link…) — UI copy and specs follow it word for word.
- Skills every session should consult: /grilling and /domain-modeling for HITL tickets; /research for AFK research tickets.
- Positioning premise (user-stated): fully open source and free to self-host, plus a hosted convenience service at a fair price; GDPR-clean, hosted in DE/EU.
- Pricing hypothesis to validate, not a decision: first month free, then 3 €/month or 28 €/year (EUR, not USD).
- The friends pilot is informal and free — no legal ceremony, no payment.
- Governing prior decision: ADR-0009 (one Household per deployment) — deliberately left the door open; Stage 1 walks through it and needs a superseding ADR.
- Codebase facts (surveyed 2026-08-18): schema is fully household-scoped (indexed `household_id` on all data tables); runtime is single-household. Known gaps: `theHousehold()` LIMIT-1 singleton at 4 call sites; household creation gated on global zero-members check (no path to Household #2); push accepts unscoped client `entity_id`s; `getMember`/`revokeMember`/`revisionExists` are global; shared revision-id namespace; global SSE wake set and rate limiter; whole-file backup; single `ORIGIN` builds all claim links; ADR-0005's "shell access = full Household access" trust assumption stops holding once other people's households are hosted.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [App-store policy: wrapped web app with external subscription payment](issues/03-store-policy-research.md) — sell only on the web at 0% (login-only store apps per Apple 3.1.3(f) / Play "consumption-only", PWA as fallback); in-app link-out is taxed ~10-15% in the EU; own-PSP checkout inside the app is forbidden.
- [Competition research: baby-tracker market](issues/01-competition-research.md) — 3 €/mo / 28 €/yr sits low-end (mainstream: $5-15/mo, $60-120/yr) and a free first month beats the standard 7-day trial; "open source + paid EU-hosted, GDPR-first" is effectively unoccupied (only zero-traction baybay runs the model, with no EU/GDPR promise).
- [Legal/GDPR baseline for a paid SaaS from Germany](issues/04-legal-baseline-research.md) — charging the first euro takes ~2-4 days / ~100-200 €: Gewerbeanmeldung, Impressum (c/o service solves the home-address problem), privacy policy with explicit Art. 9 consent (baby feed/sleep/growth = health data, operator is controller), AV-Vertrag with the hoster, checkout compliance (§312j button, Widerruf waiver, §309 renewal), Kündigungsbutton; start Einzelunternehmer + Kleinunternehmer, or a merchant of record (~5%) to delete the VAT topic.
- [Payment provider direction: EU/Wero-ready vs Stripe](issues/02-payment-provider-research.md) — start with Mollie, yearly-plan-first (Wero live for DE merchants as one-off; recurring runs on SEPA DD/cards until Wero recurring ships anywhere; a 3 € charge loses ~10% to fixed fees vs ~2% at 28 €/yr); skip merchant-of-record while Kleinunternehmer; named switch triggers to Stripe / MoR recorded in the ticket.
- [Household creation and the operator surface (Stage 1)](issues/05-household-creation-and-operator-surface.md) — CLI only: `babylog household "<label>"` mints a 7-day **Founding Link** (new glossary term) and the claim founds the Household, first Parent and zone from the claimer; boot bootstrap unchanged for Household #1; new `babylog households` listing + household-grouped `members`; rescue becomes Household-scoped once a second Household exists; one ORIGIN serves all pilot Households.
- [Isolation hardening and the hosted trust boundary (Stage 1)](issues/06-isolation-hardening-and-trust-boundary.md) — all four leaks must-fix via an ownership guard, no migration (foreign ids refused generically; `household`-kind revisions use the session's Household); SSE wake set gets household-scoped, rate limiter and whole-file backup stay; ADR-0020 supersedes only ADR-0009's tenancy stance; trust boundary acknowledged not encrypted (one honest sentence to the friends); the two-household attack fixture is the testing bar, plus an AGENTS.md rule that new store functions take `householdId`.

## Not yet specified

- **Public sign-up and onboarding** for the paid service — how a stranger creates a Household, trial start, abuse defence, whether email enters the model. Waits on pilot feedback and the pricing/packaging decision.
- **Pilot → paid-service migration path** — whether pilot Households move onto the future platform and how. Waits on the platform-direction decision.
- **Hosted-service operations** — per-household backups/restore, monitoring, support channel, deletion/export on churn (GDPR Art. 17/20 in practice). Waits on the platform direction and legal baseline.
- **Feedback loop for the pilot** — how friends report feedback (in-app? issue tracker? chat). Sharpen once the Stage-1 spec exists.
- **DPIA/DPO question** — the legal baseline flags that a DPIA obligation could drag in a mandatory DPO via §38 BDSG; needs verification with counsel before launch, alongside legal execution.
- **Trial and subscription lifecycle** at direction level beyond pricing (what happens when payment lapses — read-only? export-only? grace period). Waits on pricing/packaging and legal baseline.

## Out of scope

- **App-store webview wrapper** (build and store submission) — doesn't gate any decision on this map; only the store-policy *research* is in scope because its answer feeds the payment direction.
- **Payment integration spec/implementation** (webhooks, dunning, VAT calculation flows) — its own effort once the SaaS build starts; this map decides provider direction only.
- **Legal execution** — writing the Impressum/privacy policy, registrations, contracts; this map only records what is minimally required.
- **Stage-1 implementation itself** — happens after the map, from the spec.
- **Rehearsing SaaS hosting during the pilot** — the pilot runs on the existing self-hosted deployment; new infra is a later effort.
