# baby-log-book

## Project rules

- keep release number in sync with docker container tags
- in this sandbox: commit only, never `git push` — the maintainer pushes from outside the sandbox, unless they explicitly say otherwise

## Tenancy

One deployment hosts many Households ([ADR-0020](docs/adr/0020-one-deployment-many-households.md)),
so **any new store function takes `householdId`, or its review justifies why not**.
The same rule holds for anything else keyed by data: a client-supplied id is
never a capability, and there is no LIMIT-1 "the Household" to fall back on.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, using the default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
