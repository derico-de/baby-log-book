# 12 — CI for the integration repo

Type: grilling
Status: open

## Question

The test harness is settled by the [conventions research](../research/ha-integration-conventions.md) — `pytest-homeassistant-custom-component`, no live HA instance, `integration_blueprint`'s CI shape — and [One repo or two](08-one-repo-or-two.md) fixed the repo (`derico-de/baby-log-book-homeassistant`) and its release ritual (manifest = tag = release). What remains to decide for the new repo's CI:

- **Which jobs**: the pytest job; HACS validation (`hacs/action`); hassfest for custom repos (the research verified `quality_scale.yaml` is skipped — what does hassfest still buy?); anything enforcing the manifest = tag = release invariant at release time.
- **Whether the dev-env HA container plays any part** — the research calls the case thin; decide it and write it down so nobody re-litigates.
- **What the spec must record** so the Python agent scaffolds CI AFK: workflow files named, the release checklist, the pinned test dependency's update rhythm (it tracks HA weekly).
