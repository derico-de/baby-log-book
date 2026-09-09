# 06 — The Lapsed gate, checked before the fold

**What to build:** [ADR-0022](../../../docs/adr/0022-a-lapsed-household-stops-syncing.md) allows **no read-only tier**, and a derived read added without that in mind quietly becomes one. This ticket puts the gate in the right places and in the right order, behind one seam that answers *is this Household Lapsed* — returning false until the hosted-service effort fills it in.

Naming the contract now is the point: the Python half handles it from day one and needs no later release to learn how.

Spec §5.7.

**Blocked by:** 02 — The derived read, conditional from the first commit.

**Status:** resolved

- [x] One seam answers whether a Household is Lapsed. Nothing sets it yet; it returns false, and tests inject true.
- [x] The derived read answers `402` with code `lapsed`, in the existing error-body shape.
- [x] It is checked **before any fold and before the ETag check** — a Lapsed Household cannot even learn *nothing changed*.
- [x] **Both claim paths gain it too** — the preview and the claim — checked **before the link is spent**. Letting the claim succeed would burn a one-shot link and mint a session into a Household that then refuses everything.
- [x] The claim gate applies to **all** claims, not just a Hub's: a phone claiming an Invite into a Lapsed Household is the same trap.
- [x] The status-level distinction is preserved, so no client ever parses a body to know which flow it is in.
- [x] A line under `## [Unreleased]` in `CHANGELOG.md`, same commit.

## Comments

**Built.** The seam is `src/lib/server/lapsed.ts` — `isLapsed(db, householdId)`,
answering false, and `setLapsedCheck()` for the hosted-service effort to install
the real answer at boot and for tests to inject one. Callers: `readHubState()`
before the ETag comparison, and `previewLink()` / `claim()` before the attempt is
counted. Tests in `src/lib/server/lapsed.test.ts`.

**Scope note.** [ADR-0022](../../../docs/adr/0022-a-lapsed-household-stops-syncing.md)
refuses pushes and pulls too. This ticket deliberately builds only the three
surfaces spec §5.7 names, because those are the ones the integration has to
handle from day one; gating `/api/sync/push` and `/api/sync/pull` is the hosted
effort's, on the same seam and with the same `402 lapsed` body. Nothing here
asserts that they stay ungated.

**Copy.** `claim_lapsed` landed in en, de and ro. The Romanian is the same
coined-then-reviewed footing as the rest of the file.
