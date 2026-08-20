# Hosted-service operations

Type: grilling
Status: open

## Question

Running other people's Households on the maintainer's Hostsharing VM ([ADR-0021](../../../docs/adr/0021-the-paid-service-scales-by-files-not-by-postgres.md)) makes operations a product surface, not a private habit. At direction level, what does operating the hosted service entail while it still runs as one multi-tenant SQLite file?

To decide:

- **Per-Household restore before the file split exists**: the nightly whole-file backup rolls back every Household at once (ADR-0020 names this operator fact). Is "restore one Household" a promise the hosted service makes, and if so what honours it — revision-log replay, filtered copy from a backup file, or an honest "we don't, yet"?
- **Deletion and export on churn** — GDPR Art. 17/20 in practice: what happens to a Household's rows, its share of backups (14-day rotation), and its revision log when a customer leaves; how the CSV export and the future file-copy move divide this work.
- **Monitoring and alerting**: what the maintainer needs to notice before a customer does — disk, backup integrity-check failures, sync errors — and where it lands (mail? existing tooling on the VM?).
- **The support channel**: paying customers can't rely on "message the maintainer's phone" like the friends pilot does. What is promised, and where does it live?
- **The trust-boundary sentence for paying customers**: ADR-0020 answers the operator-can-see-everything fact with disclosure for friends and says a paid service owes a stronger answer. Decide what that answer is at direction level — better disclosure, procedural controls, or an encryption investigation ticket.
