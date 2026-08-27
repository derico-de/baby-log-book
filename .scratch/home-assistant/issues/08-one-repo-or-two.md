# 08 — One repo or two, and the version handshake

Type: grilling
Status: open
Blocked by: 02

## Question

Direction settled while charting: **the integration gets its own repo**, HACS-installable, its own release cadence — a public deployment already versions its API for phones, so the compatibility question exists either way; better explicit than hidden in a shared version number. Core submission is out of scope. What is left to decide, informed by [What a custom integration must be](02-what-a-custom-integration-must-be.md):

- **The name** — of the repo, the integration domain (`baby_log_book`?), and what HACS shows.
- **The version handshake** — how the integration learns the server is new enough: the version block every sync response carries, a capability field on the companion payload, or a claim-time check in the config flow. What each side does when the other is too old (repair issue? refuse setup?).
- **The release ritual** — this repo's rule is *keep the release number in sync with the container tags*; the integration repo needs its own written rule, and the spec records who bumps what when the wire contract changes.
- **What the AGPL means across the boundary** — the integration's licence, and whether any of this repo's code (types, the fold signatures) is shared or re-stated.
- **A compatibility statement a stranger can read**: "integration ≥ x needs server ≥ y", and where it lives.
