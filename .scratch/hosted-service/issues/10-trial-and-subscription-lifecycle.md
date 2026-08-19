# Trial and subscription lifecycle (direction)

Type: grilling
Status: open
Blocked by: 04, 07

## Question

At direction level: what happens to a Household when its Trial ends without payment, and
when a paid Plan lapses (failed SEPA/card charge, cancellation via the Kündigungsbutton)?

Settled context: Trial is first-month-free with no payment method upfront, Plan is flat per
Household, Mollie's dunning is DIY webhook work (payment research), and the legal baseline
records the §309 renewal and Kündigungsbutton constraints plus GDPR Art. 17/20 obligations.

To decide:

- Grace period after a failed charge or trial end — how long, and what the Household sees.
- The lapsed state: read-only? export-only? invisible? How long before deletion, and how
  that squares with GDPR Art. 17 (erasure) and the positioning promise that the data
  belongs to the family.
- Whether Export stays available regardless of payment state (the positioning suggests it
  must).
- Dunning direction: how many retries/reminders, over what period — sized for DIY webhooks
  on Mollie, not a full billing platform.
- What §309 auto-renewal notice rules and the Kündigungsbutton imply for the cancellation
  flow, at direction level.
