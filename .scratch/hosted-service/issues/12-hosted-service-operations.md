# Hosted-service operations

Type: grilling
Status: resolved

## Question

Running other people's Households on the maintainer's Hostsharing VM ([ADR-0021](../../../docs/adr/0021-the-paid-service-scales-by-files-not-by-postgres.md)) makes operations a product surface, not a private habit. At direction level, what does operating the hosted service entail while it still runs as one multi-tenant SQLite file?

To decide:

- **Per-Household restore before the file split exists**: the nightly whole-file backup rolls back every Household at once (ADR-0020 names this operator fact). Is "restore one Household" a promise the hosted service makes, and if so what honours it — revision-log replay, filtered copy from a backup file, or an honest "we don't, yet"?
- **Deletion and export on churn** — GDPR Art. 17/20 in practice: what happens to a Household's rows, its share of backups (14-day rotation), and its revision log when a customer leaves. The exit itself is settled — the importable Export ([ADR-0024](../../../docs/adr/0024-export-is-also-the-way-back-in.md)), with the file copy ops-internal — so what remains here is erasure mechanics.
- **Monitoring and alerting**: what the maintainer needs to notice before a customer does — disk, backup integrity-check failures, sync errors — and where it lands (mail? existing tooling on the VM?).
- **The support channel**: paying customers can't rely on "message the maintainer's phone" like the friends pilot does. What is promised, and where does it live?
- **The trust-boundary sentence for paying customers**: ADR-0020 answers the operator-can-see-everything fact with disclosure for friends and says a paid service owes a stronger answer. Decide what that answer is at direction level — better disclosure, procedural controls, or an encryption investigation ticket.

## Answer

**Per-Household restore is not promised.** Publicly, disaster recovery is whole-file (the documented stop-swap-start restore); per-Household point-in-time recovery is neither offered nor denied — internally there is a **best-effort runbook**: filter-copy one Household's rows from a nightly backup into a scratch deployment, then hand the family an Export from it. The revision log makes this genuinely feasible, so a flat "we don't" would waste it, while a public promise would price in engineering the eventual per-Household file split (ADR-0021) delivers for free.

**Erasure rides the backup rotation.** On the 90-day clock or an Art. 17 request, the Household's live rows are deleted immediately — every household-scoped table *and its revision log rows*; append-only is a property of a live Household, not a suicide pact. The rows then age out of the 14 rotating nightlies on their own: **"erasure completes within 14 days" is the stated window** in the privacy policy — standard, defensible practice. The erasure date is recorded, and the restore runbook includes "re-delete anything erased since that backup". No backup rewriting, no shortened rotation.

**Monitoring direction: silent failure is a bug.** Every condition the app can already detect — backup missing, integrity check failed — must reach the maintainer's inbox, not just the container log. Transport is deliberately small: a VM-side cron that checks `/data/backups` freshness/integrity results and disk headroom and mails on anomaly, plus one external uptime check on the public endpoint. No metrics stack until it earns its keep.

**Support is one email address.** The address the Impressum needs anyway, linked from the app and the website, with a single stated promise: an answer within 2 business days. It is also the auditable channel where erasure and export requests land. No public issue tracker (health data in public, wrong audience), no chat: the pilot's WhatsApp/Signal thread stays a Guest-Household courtesy, never a product surface.

**The trust answer for paying customers is [ADR-0025](../../../docs/adr/0025-the-paid-trust-answer-is-a-written-access-policy-not-encryption.md)**: plain disclosure in the privacy policy plus a short written operator access policy (access only for support/rescue on a Member's request, no browsing, access leaves a trace), versioned in the repo. Encryption is explicitly not promised and never gates billing; investigating it is its own future effort.

**Where it lives**: the operator runbook and monitoring checklist belong in the repo's docs — self-hosters inherit them, the dogfood principle — written as their own execution effort, not on this map. The customer-facing wording (support promise, erasure window, access policy) is input to the out-of-scope legal-execution effort; this ticket fixes only the direction.
