# 08 — One repo or two, and the version handshake

Type: grilling
Status: resolved
Blocked by: 02

## Question

Direction settled while charting: **the integration gets its own repo**, HACS-installable, its own release cadence — a public deployment already versions its API for phones, so the compatibility question exists either way; better explicit than hidden in a shared version number. Core submission is out of scope. What is left to decide, informed by [What a custom integration must be](02-what-a-custom-integration-must-be.md):

- **The name** — of the repo, the integration domain (`baby_log_book`?), and what HACS shows.
- **The version handshake** — how the integration learns the server is new enough: the version block every sync response carries, a capability field on the companion payload, or a claim-time check in the config flow. What each side does when the other is too old (repair issue? refuse setup?).
- **The release ritual** — this repo's rule is *keep the release number in sync with the container tags*; the integration repo needs its own written rule, and the spec records who bumps what when the wire contract changes.
- **What the AGPL means across the boundary** — the integration's licence, and whether any of this repo's code (types, the fold signatures) is shared or re-stated.
- **A compatibility statement a stranger can read**: "integration ≥ x needs server ≥ y", and where it lives.

## Answer

Recorded as [ADR-0039](../../../docs/adr/0039-the-integration-gates-on-the-server-release.md). The decisions:

- **Name**: repo `derico-de/baby-log-book-homeassistant` (sorts beside the server repo, self-explaining; the `hass-` prefix convention is fading). Integration domain `baby_log_book` — immutable once config entries exist. `manifest.json → name` and `hacs.json → name` both read **Baby Log Book**.
- **The version handshake gates on `app_version`**, not `protocol_version` (the phone wire, which the Hub doesn't speak — it would lie in both directions) and not a dedicated companion integer (a second machine version whose human mapping table would have to exist anyway). Each integration release bakes in `MIN_SERVER_VERSION`, compared with `awesomeversion` against the version block every response already carries — Mealie's pattern, per the [conventions research](../research/ha-integration-conventions.md).
- **Too old, each direction**: server too old → Mealie's dual gate (config-flow form error at claim, `ConfigEntryError` at every setup). Integration too old → repair issue *update the Baby Log Book integration*. The ordering rule makes the second rare: a companion-wire change lands server-side first, backward-compatibly; the integration release requiring it raises its floor; only a deliberate breaking server change may strand old integrations, flagged in the server's release notes.
- **Release ritual**: independent semver from `1.0.0`; invariant written into the integration repo's agent instructions: `manifest.json → version` = git tag = GitHub release, bumped together (HACS reads the latest release tag). `hacs.json → homeassistant` reviewed per release, bumped only when the code starts using a newer HA idiom.
- **License**: AGPL-3.0-or-later on both repos, same contributors header. No code is shared across the boundary — the spec re-states the wire shapes; Python implements them fresh.
- **Compatibility statement**: one table, "integration ≥ x needs server ≥ y", in the integration README only; the server README links to it once; runtime errors carry the concrete numbers.
