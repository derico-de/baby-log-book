# Legal/GDPR baseline for a paid SaaS from Germany

Type: research
Status: resolved

## Question

What is *minimally required*, legally, to charge European consumers a subscription for this hosted service from Germany? A checklist with effort estimates, not legal execution.

To research:

- **Impressum** (§5 DDG) and what it forces a solo operator to publish (private address problem, and known mitigations).
- **Privacy policy / GDPR**: controller vs processor role for hosted Households, records of processing, AV-Vertrag (DPA) with the hosting provider, data of *children* (Babies' health-adjacent data — does logging feeds/sleep/growth trigger Art. 9 special-category or heightened-care considerations?), export/deletion rights (we already have Export; what's missing?).
- **Consumer contract law**: Widerrufsrecht (14-day withdrawal) for digital subscriptions, the German "Kündigungsbutton" (§312k BGB), auto-renewal notice rules, button-labeling ("zahlungspflichtig bestellen").
- **Tax**: Kleinunternehmerregelung thresholds vs VAT registration, OSS for EU-wide B2C digital services, whether the PSP handles VAT (merchant-of-record vs PSP distinction — ties into the payment-provider research).
- **Business form**: what running this as Einzelunternehmer implies vs founding a UG, at direction level only.

Deliverable: a findings file with the checklist, what each item costs (time/money), and which items block *charging the first euro* vs which can trail. The friends pilot is explicitly out: informal and free.

## Answer

Full checklist with effort/cost estimates and sources: [research/legal-baseline.md](../research/legal-baseline.md). Research for planning, not legal advice.

What blocks charging the first euro (~2-4 days of work, ~100-200 € one-off, optional ~10-30 €/mo address service):

- **Gewerbeanmeldung + steuerliche Erfassung** (§14 GewO; Steuernummer needed for invoices — Amt latency, start early). The Kleinunternehmer election happens here.
- **Impressum** (§5 DDG) with a ladungsfähige Anschrift — home-address problem is solvable via a c/o Impressum-Service (~10-30 €/mo); PO boxes don't work.
- **Privacy policy + explicit Art. 9 consent flow** — baby feed/sleep/growth data should be treated as health data (broad EDPB/CJEU reading), so parents must give explicit, unbundled, logged consent for the child; operator is the controller, full stop.
- **AV-Vertrag** with the hoster (Hetzner: online, free, minutes) and other processors.
- **Checkout compliance**: "zahlungspflichtig bestellen" button (§312j — mislabeling means *no contract*), Widerrufsbelehrung + express-consent/acknowledgment waiver mechanics (§356 Abs. 4, §312f), auto-renewal only as indefinitely-running + monthly-terminable (§309 Nr. 9).
- **Kündigungsbutton** (§312k): "Verträge hier kündigen", reachable without login, bare confirmation page (BGH 2026) — else customers can cancel anytime without notice.

Can trail: VVT (Art. 30 — the small-company exemption does NOT apply because of Art. 9 data), DPIA threshold doc (open question: DPIA would drag in a DPO via §38 BDSG — verify with counsel), self-service deletion, TOMs, BFSG microenterprise-exemption note. Direction calls: start Einzelunternehmer + Kleinunternehmer (25k/100k since 2025; watch the 10k EU cross-border threshold, then §19a or OSS); a merchant of record (Paddle etc., ~5%) deletes the whole VAT topic but not the German website duties.
