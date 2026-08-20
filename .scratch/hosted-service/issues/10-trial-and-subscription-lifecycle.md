# Trial and subscription lifecycle (direction)

Type: grilling
Status: resolved
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

## Answer

Decided 2026-08-20 in a grilling session; two rounds, all thirteen questions settled as
recommended. New glossary terms: **Payer**, **Lapsed** ([CONTEXT.md](../../../CONTEXT.md));
lapse semantics recorded as [ADR-0022](../../../docs/adr/0022-a-lapsed-household-stops-syncing.md).

**The lapsed state: sync stops entirely — never read-only.** Pushes and pulls both
rejected; the app shows an honest "hosting is paused — your data is safe on this phone and
on the server; export or resume anytime." Read-only sync re-creates the outbox trap the
deployment-shape ticket already rejected once (ADR-0013: the outbox is data — Devices would
silently queue pushes nobody will accept), and softer options make lapsing free, which at
3 €/mo means nobody pays. Devices keep working offline regardless — the server only ever
controls sync. The one endpoint that keeps serving a Lapsed Household is Export.

**Grace: 14 days after Trial end** (full function, in-app banner) — no payment method
upfront was chosen to be low-pressure, and lapsing a newborn household at day 30 sharp
contradicts that. **Dunning: minimal** — one automatic retry ~5 days after a failed
SEPA/card charge, two reminder notices, lapse at ~day 14; one webhook handler and a daily
cron, no billing platform.

**Export is never payment-gated.** Works in every state up to the moment of deletion; lapse
messaging leads with it. Positioning ("the data belongs to the people who keep it") and
Art. 20 both demand it.

**Deletion: 90 days after lapse**, warned at lapse, day 60 and ~day 83 via the Payer's
email. Baby log data is Art. 9 health data — keeping it a year "in case they come back" is
a GDPR liability, not a kindness (storage limitation, Art. 5(1)(e)). Erasure on request
(Art. 17) works immediately in any payment state. After deletion, returning means starting
fresh or self-hosting from their Export.

**Cancellation: effective at period end, no refund of the remainder** for the initial term.
A renewed yearly term is monthly-terminable (§309 Nr. 9) with pro-rata refund on mid-year
exit (one Mollie refund API call). Cancelling during Trial just lets it lapse. A cancelled
Household walks the same lapse→deletion path (no grace — the paid-until date is the grace).

**Payer: new glossary term — the Parent whose email and payment method back the Plan.**
Parent only (billing is household management, which is the Parent role); email enters the
model here as a billing address, never a credential — the Claim-Link identity model is
untouched, all other Members stay email-free. Payer handover is just "another Parent enters
payment details" — replaces the old mandate, no blocking rules; if a revoked Payer's
mandate fails and nobody takes over, normal dunning handles it.

**Billing visibility: Parents only.** Trial countdown, dunning nags and lapse warnings
never reach Caregivers — grandma can't fix it and it reads as nagging. Once Lapsed,
everyone sees the neutral paused state, because sync visibly stopping in silence would look
like a bug.

**Widerruf: express consent to immediate performance at checkout (§356 Abs. 4), and as
policy a full refund on any withdrawal within 14 days of the first charge** — the consent
makes starting service lawful, the generosity makes the ceremony invisible at ≤28 € stakes.

**Renewal notice: one email to the Payer ~14 days before a yearly renewal charge** stating
amount, date and the cancel link — doubling as the SEPA pre-notification. Monthly Plans get
only the standard SEPA pre-notification.

**Reactivation: any Parent, any time before deletion, no back-billing.** Entering a payment
method makes them the Payer; sync resumes immediately. The paused weeks were the
consequence — charging for them would be indefensible.
