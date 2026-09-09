# 12 — CI for the integration repo

Type: grilling
Status: resolved

## Question

The test harness is settled by the [conventions research](../research/ha-integration-conventions.md) — `pytest-homeassistant-custom-component`, no live HA instance, `integration_blueprint`'s CI shape — and [One repo or two](08-one-repo-or-two.md) fixed the repo (`derico-de/baby-log-book-homeassistant`) and its release ritual (manifest = tag = release). What remains to decide for the new repo's CI:

- **Which jobs**: the pytest job; HACS validation (`hacs/action`); hassfest for custom repos (the research verified `quality_scale.yaml` is skipped — what does hassfest still buy?); anything enforcing the manifest = tag = release invariant at release time.
- **Whether the dev-env HA container plays any part** — the research calls the case thin; decide it and write it down so nobody re-litigates.
- **What the spec must record** so the Python agent scaffolds CI AFK: workflow files named, the release checklist, the pinned test dependency's update rhythm (it tracks HA weekly).

## Answer

No ADR — CI mechanics, spec content composing [ADR-0039](../../../docs/adr/0039-the-integration-gates-on-the-server-release.md).

**Two workflow files, this repo's house style, not the blueprint's four-file
split.** `integration_blueprint` splits `lint` / `tests` / `validate`; the server
repo runs one heavily-commented workflow where a test job gates the release. The
integration follows the house:

- **`ci.yml`** — on push to `main`, on pull requests, and on a **weekly** cron.
  Jobs: `lint` (`ruff check`, `ruff format --check`, `mypy` in strict mode),
  `test` (`pytest` with `--cov=custom_components/baby_log_book
  --cov-fail-under=95`), `validate` (hassfest + `hacs/action`). All hard gates.
- **`release.yml`** — on `v*.*.*` tags. One job: refuse the release when
  `manifest.json → version` ≠ the tag minus its `v`, then create the GitHub
  release with the body extracted from the `CHANGELOG.md` section for that
  version.

Actions are pinned by major tag (`actions/checkout@v5`) as in the server's
`publish.yml`, not SHA-pinned as the blueprint does; Dependabot keeps them
current. Everything runs under **`uv`** with `pyproject.toml` — `uv run <tool>`,
never a venv or a global.

**What hassfest still buys** — the ticket's open question, verified against core
`dev` (`script/hassfest/__main__.py`): for a custom integration the run is
`INTEGRATION_PLUGINS` only — **manifest, json, translations, services, icons,
config_flow, requirements, dependencies, codeowners, integration_type,
quality_scale** (and the discovery plugins) — while `HASS_PLUGINS` (`core_files`,
`device_classes`, `mypy_config`, `metadata`, `sensor`, `docker`, `mdi_icons`) are
added only when validating all of core. That subset is exactly the set of files
an AFK agent hand-writes and a pytest suite never reads: the three translation
files, `services.yaml` against the registered actions, `icons.json`, and the
manifest keys HACS also demands. It stays. The action takes no inputs — it is
`docker run … ghcr.io/home-assistant/hassfest` over the workspace.

**`hacs/action`** runs with `category: integration` and `ignore: brands`. The
ignore is a **dated debt**, not a permanent config line: *open the
`home-assistant/brands` PR, then delete the ignore* is a numbered item in the
pre-1.0.0 checklist.

**manifest = tag = release is enforced, never stamped.** The blueprint rewrites
the manifest version from the tag at release time, which leaves the version in
the tree meaningless for anyone installing from the default branch. Here the
human bumps the manifest in the release commit and CI refuses a tag that
disagrees — ADR-0039's invariant stated as written, and the tree stays honest.

**One HA version is tested, and it is the floor.** A single pin of
`pytest-homeassistant-custom-component` tracking latest stable HA; `hacs.json →
homeassistant` moves forward with it **at each release** (not at each Dependabot
bump). Never claim a floor you do not test — the alternatives were a two-entry
matrix (double the dependency maintenance) or a lower, untested floor (a guess).
HACS declining to offer the integration on an old HA is a clear message rather
than a broken one. Dependabot weekly on `pip` and `github-actions`: a red
Dependabot PR *is* the alarm that HA broke us, and the weekly cron catches
breakage that arrives without a dependency bump. **No HA-beta job** — a moving
target trains you to ignore red, and a wall panel needs no month of warning.

**The dev-env HA container has no part in CI.** Settled; do not re-litigate. The
integration's CI is hermetic — `pytest-homeassistant-custom-component`, no live
instance — and `compose.ha.yaml` stays a human-eyeball surface in the server repo
for looking at entity models and config flows, as `ha/README.md` already says.

**Release notes come from the changelog.** HACS shows the GitHub release body to
anyone considering the update, so it is the one place a stranger reads what
changed; deriving it from `CHANGELOG.md` means the two cannot drift, and gives
the guard job something to do besides fail.

**The CI files themselves land when building starts**, not now. The point of this
ticket is that the spec is precise enough for the build agent to scaffold them
AFK in its first session, beside the code they gate.

### What the spec must record

1. The two workflow files by name, their triggers, and their jobs in order.
2. The `validate` job verbatim: `home-assistant/actions/hassfest` (no inputs) and
   `hacs/action` with `category: integration`, `ignore: brands`.
3. **The release checklist**: rename the `## [Unreleased]` section to the version
   → bump `manifest.json → version` in the same commit → review `hacs.json →
   homeassistant` and the baked-in `MIN_SERVER_VERSION` → append the
   compatibility-table row → annotated tag `vX.Y.Z` → push `main` and the tag →
   `release.yml` guards the invariant and publishes the notes.
4. **The dependency rhythm**: the pin tracks latest stable HA, Dependabot weekly,
   the declared floor follows the pin at release time.
5. The one sentence ruling the dev container out of CI.
6. **Pre-1.0.0**: the `home-assistant/brands` PR (then drop `ignore: brands`);
   the GitHub repo public with a description and topics, which HACS requires.

### Done this session

The repo now exists at `../../../../baby-log-book-homeassistant` — a sibling
checkout inside the mount, like `blb-sass-service`, holding `README.md`,
`AGENTS.md`, `LICENSE` (AGPL-3.0-or-later) and a Python `.gitignore`, committed as
`MrTango` (`0cb3011`) with `origin` set to
`git@github.com:derico-de/baby-log-book-homeassistant.git`. Unpushed: the sandbox
has no route to GitHub and the maintainer pushes from outside. The compatibility
table in its README carries **three** columns — integration / needs server /
needs Home Assistant — because the HA floor now moves per release too. `AGENTS.md`
restates the rules an AFK build must not violate: immutable domain, vocabulary
from `CONTEXT.md`, the version invariant, server-first wire changes,
changelog-per-change, and *this repo lives inside the mount*.

Carried debt, inherited from the server's `LICENSE`: the verbatim AGPL-3.0 text is
still missing from both files, replaced by a maintainer note. AGPL §14 wants it
before either repo is distributed.
