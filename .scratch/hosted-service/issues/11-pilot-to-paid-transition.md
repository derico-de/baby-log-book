# Pilot → paid transition

Type: grilling
Status: open
Blocked by: 10

## Question

The platform direction collapsed the migration question to continuity — pilot Households already sit on the paid service's stack and server ([ADR-0021](../../../docs/adr/0021-the-paid-service-scales-by-files-not-by-postgres.md)) — so what remains is the **commercial** transition: what happens to the free pilot Households when billing arrives?

To decide:

- Do pilot friends stay free forever (grandfathered), convert onto the standard Trial, or get a distinct founder deal? The map's premise says the pilot is informal and free — does that promise survive launch?
- What the transition moment looks like from inside a pilot Household: does anything change in the app, is there a date, is there an announcement?
- Whether a pilot Household can decline the paid service and self-host instead — and if so, how their data leaves (the file-copy move ADR-0021 makes cheap, the CSV export, or both).
- Whether any of this needs to be said to the friends *now*, at pilot invitation time, to keep the later conversation honest.

Depends on the Trial/Plan semantics from [Trial and subscription lifecycle](10-trial-and-subscription-lifecycle.md).
