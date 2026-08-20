# Pilot → paid transition

Type: grilling
Status: resolved
Blocked by: 10

## Question

The platform direction collapsed the migration question to continuity — pilot Households already sit on the paid service's stack and server ([ADR-0021](../../../docs/adr/0021-the-paid-service-scales-by-files-not-by-postgres.md)) — so what remains is the **commercial** transition: what happens to the free pilot Households when billing arrives?

To decide:

- Do pilot friends stay free forever (grandfathered), convert onto the standard Trial, or get a distinct founder deal? The map's premise says the pilot is informal and free — does that promise survive launch?
- What the transition moment looks like from inside a pilot Household: does anything change in the app, is there a date, is there an announcement?
- Whether a pilot Household can decline the paid service and self-host instead — and if so, how their data leaves (the file-copy move ADR-0021 makes cheap, the CSV export, or both).
- Whether any of this needs to be said to the friends *now*, at pilot invitation time, to keep the later conversation honest.

Depends on the Trial/Plan semantics from [Trial and subscription lifecycle](10-trial-and-subscription-lifecycle.md).

## Answer

Pilot Households are **grandfathered free forever**, as **Guest Households** — a new glossary term ([ADR-0023](../../../docs/adr/0023-pilot-households-stay-free-as-guest-households.md)): hosted, Plan-less, by personal arrangement of the operator, never on Trial and never Lapsed. Billing therefore models three standings (Plan, Lapsed, Guest), and the state outlives the launch — the operator's own family plausibly lives in it too. The promise is **per-Household, not per-person**: Households founded during the pilot stay free; anything a pilot friend founds after launch is a standard paying affair.

**The transition moment is a non-event** inside a pilot Household — no in-app change, no date, no banner; just a personal thank-you message when billing launches. And because the decision is made now, the **invitation-time sentence is safe**: *"Free for you, forever — and your data is always yours to take and self-host."*

**Declining and leaving happens through an importable Export** ([ADR-0024](../../../docs/adr/0024-export-is-also-the-way-back-in.md)). Export loses its "way out, not a way back in" clause; **Import** founds a fresh Household in another deployment carrying every Baby, Entry, Food, Milestone, the settings and Member attribution — at final state (the revision log stays behind; Import is not Restore), with access re-established via new Claim Links. This is the *only* customer-facing exit path, identical pre- and post-file-split, and doubles as the self-host onboarding story; ADR-0021's file-copy move is demoted to an internal ops tool. Building Import (a round-trip-complete Export format) is its own effort before billing launch — nothing for the pilot.

**Recorded trade-off:** forever-free friends give usability feedback, never pricing signal. Public-launch decisions must not read pilot feedback as pricing evidence.
