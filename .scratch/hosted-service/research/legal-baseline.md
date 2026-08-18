# Legal/GDPR/tax baseline: charging EU consumers for the hosted service from Germany

Researched 2026-08-18 against primary sources (statute texts, official guidance) where
reachable; the sandbox blocked direct fetches of gesetze-im-internet.de, so statute
content was verified via search excerpts of the official texts and IHK/BMF/EDPB pages.

**This is research for planning, not legal advice.** Before charging real customers,
have the checkout flow, AGB, Widerrufsbelehrung and privacy texts sanity-checked by a
lawyer or an IHK Existenzgründungsberatung (often free/cheap for members).

Scope: solo operator in Germany, hosted baby-log SaaS (Households, Babies,
feed/sleep/growth logs), paid subscription, EU consumer customers. The free friends
pilot is out of scope (informal, free).

---

## A. Blocks charging the first euro

These must exist before the first paid subscription is sold. Rough total if done
lean: **~2-4 focused days of work + ~100-200 € one-off + ~10-30 €/month** (address
service, if used).

### A1. Gewerbeanmeldung + steuerliche Erfassung

- Registering the trade is mandatory *before* starting commercial activity
  (§14 GewO); fine up to ~1.000 € if late. Cost ~20-65 € depending on municipality,
  often doable online.
- After that, the "Fragebogen zur steuerlichen Erfassung" via ELSTER gets you the
  Steuernummer you need on invoices — and this form is where you **elect or decline
  the Kleinunternehmerregelung** (see C2). IHK membership follows automatically
  (small/side businesses are often exempt from or reduced in dues).
- Effort: ~half a day, mostly waiting for the Finanzamt (Steuernummer can take weeks —
  start early).
- Sources: https://www.ihk.de/freiburg/recht/wirtschaftsrecht/gewerberecht/gewerbe-1333720 ,
  https://taxfix.de/ratgeber/selbststaendige/gewerbe-anmelden/

### A2. Impressum (§5 DDG) — and the private-address problem

- Commercial digital services must display, easily reachable and permanently
  available: full name (natural person, no pseudonym), a **ladungsfähige Anschrift**
  (address where legal documents can be served — a PO box is not enough), an e-mail
  address plus a second fast contact channel, and USt-IdNr if you have one. Violation
  is an Ordnungswidrigkeit (fines up to 50.000 €) and an Abmahnung magnet.
- **Private-address problem:** a solo Einzelunternehmer working from home would have
  to publish the home address. Recognized mitigations:
  - **c/o address / Impressum-Service** (~10-30 €/month): legally accepted *if* the
    address physically exists, mail is reliably received and forwarded, and the c/o
    line unambiguously identifies you. Established practice for exactly this case.
  - Coworking space / office address with a real mail arrangement.
  - What does *not* work: PO box, mailbox-only "virtual" addresses with no service
    of process, or omitting the address.
- Effort: 1-2 hours once the address question is settled.
- Sources: https://www.gesetze-im-internet.de/ddg/__5.html ,
  https://www.ihk.de/chemnitz/recht-und-steuern/rechtsinformationen/internetrecht/pflichtangaben-im-internet-die-impressumspflicht-4401580 ,
  https://www.e-recht24.de/impressum/8369-impressum-c-o-adresse.html ,
  https://impressum-privatschutz.de/c-o-adresse/

### A3. Privacy policy + controller role + Art. 9 consent flow

- **Role:** the operator is the **controller** (Verantwortlicher) for everything the
  hosted service processes — account data *and* Household/Baby log content. The
  parents using the app for their own family fall under the household exemption
  (Art. 2(2)(c) GDPR, Recital 18), so they are not controllers; that exemption never
  extends to the service provider. There is no realistic "we're just a processor for
  the parents" framing for a consumer SaaS.
  (EDPB Guidelines 07/2020 on controller/processor:
  https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_en )
- **Art. 9 special-category data — assume YES.** "Data concerning health"
  (Art. 4(15)) is interpreted broadly by the EDPB and CJEU; feed amounts, sleep
  patterns, growth/weight curves of a baby reveal information about physical health
  status. Plan on Art. 9 applying rather than litigating the edge. Consequence: you
  need an Art. 9(2)(a) basis — **explicit consent**, given by the holders of parental
  responsibility on behalf of the baby (the data subject), as a separate, specific,
  unbundled act in the signup/household-creation flow ("I consent to the processing of
  my child's health-related data (feeding, sleep, growth) to provide this service"),
  logged and revocable.
  Sources: https://gdprhub.eu/Article_9_GDPR ,
  https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-is-special-category-data/
- **Children's data:** Art. 8 GDPR (consent age 16 in Germany) governs services
  offered *directly to a child* — this service is offered to parents, so Art. 8's
  age-verification machinery doesn't bite. But Recital 38's heightened-care standard
  does: no advertising/profiling use of baby data, data minimization, and clear
  parental-consent wording.
  Sources: https://dsgvo-gesetz.de/art-8-dsgvo/ , https://dsgvo-gesetz.de/erwaegungsgruende/nr-38/
- **Privacy policy (Art. 13):** must name you as controller (with address — same
  mitigation as A2 applies), purposes, legal bases (Art. 6(1)(b) for the contract,
  Art. 9(2)(a) for baby data), recipients/processors (hoster, PSP), retention,
  data-subject rights, right to withdraw consent, supervisory-authority complaint
  right.
- Effort: ~1 day (policy text + consent checkbox + consent logging). Generators help
  but the Art. 9 part needs hand-writing.

### A4. AV-Vertrag (Art. 28 DPA) with the hosting provider

- Hosting personal data on rented infrastructure is Auftragsverarbeitung; a DPA is
  mandatory (Art. 28(3) GDPR). Hetzner (and every serious German/EU hoster) offers a
  standard AVV concluded online in minutes, free.
- Do the same for any other processor touching personal data (e-mail delivery,
  error tracking, PSP).
- Effort: <1 hour. Cost: 0 €.
- Sources: https://docs.hetzner.com/de/general/general-terms-and-conditions/data-privacy-faq/ ,
  https://www.hetzner.com/AV/DPA_de.pdf

### A5. Checkout compliance: button label, pre-contract info, Widerruf

- **Button labeling (§312j Abs. 3 BGB):** the final order button must read
  "zahlungspflichtig bestellen" or an equally unambiguous wording ("kostenpflichtig
  abonnieren" is accepted; "Jetzt Mitglied werden" was struck down). Sanction is
  brutal and self-executing: **no contract comes into existence** (§312j Abs. 4), so a
  mislabeled button means every charge is refundable.
  Directly before the button: essential characteristics, total price, subscription
  term/renewal (§312j Abs. 2 with Art. 246a EGBGB).
  Sources: https://www.gesetze-im-internet.de/bgb/__312j.html ,
  https://www.cr-online.de/blog/2025/02/14/die-button-loesung-im-online-handel-aktuelle-anforderungen-und-rechtliche-vorgaben/
- **Widerrufsrecht:** consumers get 14 days' withdrawal from contract conclusion.
  A subscription to a hosted app is a **digital service (§356 Abs. 4 BGB)**. Waiver
  mechanics if you want to grant access immediately:
  1. proper Widerrufsbelehrung + model withdrawal form before ordering;
  2. the consumer's **express consent** that you start performing before the 14 days
     expire;
  3. the consumer's **confirmed acknowledgment** that the right lapses on full
     performance;
  4. a §312f BGB contract confirmation on a durable medium (e-mail) that includes
     that consent/acknowledgment.
  Without a proper Belehrung the right doesn't lapse at all. For an ongoing
  subscription the right realistically stays alive during the first 14 days; if the
  user withdraws after service began with their consent, pro-rata Wertersatz is owed
  (§357a BGB). Practical lean option: just eat the risk of the odd 14-day refund, or
  offer a free trial ≥14 days so the paid contract starts after the withdrawal window
  matters less.
  Sources: https://www.gesetze-im-internet.de/bgb/__356.html ,
  https://www.it-recht-kanzlei.de/widerrufsrecht-digitale-inhalte-dienstleistungen-2022.html
- **Auto-renewal (§309 Nr. 9 BGB, since 1.3.2022):** an AGB auto-renewal clause is
  only valid if the renewed contract runs **indefinitely and is terminable at any time
  with at most one month's notice**; initial fixed term max 2 years, notice for the
  initial term max 1 month. Simplest compliant shape: monthly (or yearly with
  monthly-terminable renewal) subscription.
  Sources: https://www.bmjv.de/SharedDocs/Meldungen/DE/2022/0228_faire_Verbrauchervertraege.html ,
  https://www.lieb-online.com/aktuelles/gesetzesaenderung-des-309-nr-9-bgb-neue-regeln-zur-kuendigung-und-vertragsverlaengerung-in-b2c-dauerschuldverhaeltnissen/
- Effort: ~1 day for the flow + texts (Belehrung from the official model), assuming
  the PSP/billing tool renders the checkout.

### A6. Kündigungsbutton (§312k BGB)

- Any website through which consumers can conclude paid continuing-obligation
  contracts must carry a permanently available, easily findable button labeled
  **"Verträge hier kündigen"** (or equally unambiguous), reachable **without login**,
  leading directly to a confirmation page where the consumer identifies themselves and
  the contract, with a confirmation button **"jetzt kündigen"**. BGH (16.7.2026): the
  confirmation page may contain nothing beyond the form and the button — no retention
  offers. Cancellation must be confirmable immediately in text form.
- Sanction: without a compliant button the consumer may terminate **at any time
  without notice period**; also an Abmahnung risk.
- Effort: ~half a day to build (public page + form + confirmation e-mail).
- Sources: https://lexetius.com/BGB/312k ,
  https://www.twobirds.com/de/insights/2025/germany/kündigungsbutton-nach-§-312k-bgb-–-eine-rechtsprechungsübersicht ,
  https://itmr-legal.de/blog/anforderungen-kuendigungsbutton

### A7. Tax election made (not necessarily VAT charged)

- You must have decided Kleinunternehmer vs. Regelbesteuerung (see C2) before the
  first invoice, because it determines whether invoices show VAT and what the invoice
  footer must say ("Gemäß §19 UStG wird keine Umsatzsteuer berechnet"). The decision
  itself is a checkbox in A1's Fragebogen — zero extra cost, but it blocks invoicing.

---

## B. Required, but can trail slightly (days/weeks, not months)

### B1. Verzeichnis von Verarbeitungstätigkeiten (Art. 30 GDPR)

- The <250-employee exemption (Art. 30(5)) does **not** apply here: processing is not
  occasional and involves Art. 9 special categories. So the record is required — but
  it's an internal document nobody sees until a DPA asks. One page per processing
  activity (accounts, household logs, billing, mail).
- Effort: 2-4 hours. Templates from state DPAs exist.
- Sources: https://dsgvo-gesetz.de/art-30-dsgvo/ ,
  https://www.datenschutzzentrum.de/uploads/dsgvo/Hinweise-zum-Verzeichnis-von-Verarbeitungstaetigkeiten.pdf

### B2. DPIA threshold assessment (Art. 35) — and the DPO question

- Health data of children processed by an app is the kind of processing that can
  trigger a Datenschutz-Folgenabschätzung (DSK "Muss-Liste" includes health-app
  scenarios; "large scale" is arguable for a small service). Minimum: **document a
  threshold assessment** now; do a full DPIA if/when scale grows.
- Caveat to verify with a lawyer/DPA: §38 Abs. 1 S. 2 BDSG requires appointing a
  Datenschutzbeauftragter *regardless of headcount* where DPIA-mandatory processing
  occurs. If the DPIA is triggered, an external DPO (~50-150 €/month) may be too.
  This is the single most consequential open legal question found.
- Effort: half a day for the threshold doc; external advice ~200-500 € one-off.

### B3. Data-subject rights plumbing

- Export exists already. Still missing/verify: **self-service account + household
  deletion** (Art. 17), rectification (editing logs presumably covers it), consent
  withdrawal that actually stops Art. 9 processing (practically: deletes/ends the
  service), and a documented retention/backup deletion concept.
- Effort: mostly product work; the deletion path is the real item, ~1-2 days.

### B4. TOMs + TDDDG basics

- Documented technical/organizational measures (encryption at rest/in transit,
  access control, backups) — 2-3 hours to write down what's already done.
- §25 TDDDG cookie consent: if the app uses only technically necessary
  cookies/storage (session, prefs) **no banner is needed**. Keep it that way.

### B5. BFSG (accessibility) — exemption to document

- The Barrierefreiheitsstärkungsgesetz applies to consumer e-commerce services since
  28.6.2025, but **Kleinstunternehmen (<10 employees and ≤2 M€ turnover) providing
  services are exempt**. Document reliance on the exemption; the obligation kicks in
  if the business ever outgrows it.
- Sources: https://www.bundesfachstelle-barrierefreiheit.de/DE/Fachwissen/Produkte-und-Dienstleistungen/Barrierefreiheitsstaerkungsgesetz/FAQ/faq_node ,
  https://www.ihk.de/koeln/hauptnavigation/recht-steuern/barrierefreiheit/haeufig-gestellte-fragen-zum-bfsg-6458586

### B6. Threshold monitoring (tax)

- Track: 25.000/100.000 € Kleinunternehmer limits (exceeding 100 k€ in-year kills the
  exemption *immediately*, from that transaction on) and the **10.000 € EU-wide
  cross-border B2C digital-services threshold** (§3a Abs. 5 UStG) that moves the place
  of supply to the customer's country. A spreadsheet suffices at this size.

---

## C. Direction-level choices

### C1. Einzelunternehmer vs. UG (haftungsbeschränkt)

- **Einzelunternehmer** (recommendation for the start): zero founding cost beyond A1,
  no Handelsregister, no notary, simple EÜR accounting, Kleinunternehmerregelung
  available — but unlimited personal liability and your own name+address in the
  Impressum.
- **UG:** ~300-500 € founding (notary + register) with Musterprotokoll, ongoing costs
  (Handelsregister, Jahresabschluss/Bilanz, likely Steuerberater ~1-2 k€/year),
  liability capped — but a UG still needs a real Geschäftsanschrift in the Impressum,
  so it does *not* solve the address problem by itself.
- Direction: start as Einzelunternehmer; revisit UG when revenue or perceived
  liability (health-adjacent data!) justifies ~2 k€/year of structure. A decent
  Betriebshaftpflicht/Cyber insurance is the cheaper liability lever meanwhile.

### C2. Kleinunternehmerregelung vs. Regelbesteuerung + OSS

- **Kleinunternehmer (§19 UStG, since 1.1.2025):** exempt if prior-year turnover
  ≤ 25.000 € **and** current-year ≤ 100.000 €. No VAT on invoices, no
  Voranmeldungen, no Vorsteuerabzug. Fits the launch phase perfectly.
  Sources: https://www.ihk.de/stuttgart/fuer-unternehmen/recht-und-steuern/steuerrecht/umsatzsteuer-national/kleinunternehmerregelung-in-der-umsatzsteuer-1843632 ,
  https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-03-18-sonderregelung-kleinunternehmer.pdf
- **The EU wrinkle:** German KU status only covers supplies taxed *in Germany*. B2C
  digital services to other EU countries stay German-taxed while EU-wide cross-border
  revenue ≤ 10.000 €/year; above that, the customer's country taxes, and you'd need
  **OSS** (register at BZSt, quarterly returns, charge each country's VAT) — or the
  new **EU small-business scheme (§19a UStG, since 2025)**: exemption in other member
  states too, if EU-wide turnover ≤ 100.000 €, via registration at the BZSt
  (Kleinunternehmer-IdNr) and quarterly reports.
  Sources: https://www.ihk.de/stuttgart/fuer-unternehmen/recht-und-steuern/steuerrecht/umsatzsteuer-verbrauchssteuer/umsatzsteuer-international/dienstleistungen/abrechnung-elektronischer-dienstleistungen-5165062 ,
  https://www.nwb.de/rechnungswesen/neuregelungen-fuer-kleinunternehmer-ab-2025
- Direction: elect Kleinunternehmer; below 10 k€ EU cross-border nothing else is
  needed; when EU sales grow, register §19a (cheap) before OSS (bookkeeping-heavy).

### C3. Merchant of record vs. PSP (sidesteps most of C2)

- **PSP (Stripe, Mollie, ...):** you remain the seller; all of A5-A7 and C2 are on
  you. Fees ~1.5-3 %.
- **Merchant of record (Paddle, Lemon Squeezy, Polar, ...):** the MoR is the legal
  seller — it charges, collects and remits VAT in every country, handles OSS-type
  compliance and chargebacks. Fees ~5 % + fixed. For a solo operator selling EU-wide
  this deletes the entire VAT/OSS topic (and much checkout-compliance risk moves to
  the MoR's flow) at the price of ~2-3 percentage points and less control. Note: the
  German consumer-facing duties tied to *your website* (Impressum, privacy, §312k
  button reachable from your site, GDPR controller role for the app data) do **not**
  move to the MoR.
- Direction: ties into the payment-provider ticket; if launch is Kleinunternehmer +
  mostly German customers, a PSP is fine and cheaper; if EU-wide from day one, MoR
  buys real simplicity.
  Sources: https://www.rebounce.dev/blog/stripe-vs-lemon-squeezy-vs-paddle ,
  https://www.artisangrowthstrategies.com/blog/paddle-vs-stripe-vs-lemon-squeezy-2026

---

## Effort summary

| Item | Blocks 1st € | Time | Money |
|---|---|---|---|
| Gewerbeanmeldung + steuerl. Erfassung | yes | 0.5 d (+ Amt latency) | 20-65 € |
| Impressum + address mitigation | yes | 2 h | 0-30 €/mo |
| Privacy policy + Art. 9 consent flow | yes | 1 d | 0 € |
| AV-Vertrag hoster (+PSP, mail) | yes | 1 h | 0 € |
| Checkout: §312j button, Widerruf, §309-clean AGB | yes | 1 d | 0 € (lawyer check 300-800 € optional) |
| Kündigungsbutton §312k | yes | 0.5 d | 0 € |
| VVT (Art. 30) | trail | 3 h | 0 € |
| DPIA threshold doc (+ DPO question) | trail | 0.5 d | 0-500 € advice |
| Deletion self-service + retention | trail | 1-2 d | 0 € |
| TOMs doc | trail | 3 h | 0 € |
| BFSG exemption note | trail | 0.5 h | 0 € |
