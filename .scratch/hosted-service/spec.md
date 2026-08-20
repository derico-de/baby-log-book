# Hosted Service — Stage-1 Specification

The multi-household pilot: the operator's existing deployment starts hosting
Households for invited friends, free, on the same container, the same SQLite
file and the same `ORIGIN`. This spec is implementable as written; it folds the
resolutions of [Household creation and the operator
surface](issues/05-household-creation-and-operator-surface.md) and [Isolation
hardening and the hosted trust
boundary](issues/06-isolation-hardening-and-trust-boundary.md).

## How to read it

- The governing decision is [ADR-0020](../../docs/adr/0020-one-deployment-many-households.md):
  one deployment hosts many Households, and every query says which. It
  supersedes **only** the one-Household tenancy stance of
  [ADR-0009](../../docs/adr/0009-one-household-per-deployment.md); everything
  else 0009 concluded — required `ORIGIN`, opt-in `TRUST_PROXY`, signing key in
  the volume, pre-migration backups, multi-arch, no HTTP admin — still governs.
- The v1 spec ([`.scratch/baby-log-book/spec.md`](../baby-log-book/spec.md))
  remains the product spec. Stage 1 changes no user-facing behaviour inside a
  Household: a Member of one Household sees exactly the app they saw yesterday.
- Vocabulary is [`CONTEXT.md`](../../CONTEXT.md). **Founding Link** is already
  defined there: a Claim Link that founds a new Household — printed at first
  boot, or minted by the operator for a further Household.

## 1. What Stage 1 is

- Households are **operator-created**: `docker exec <container> babylog
  household "<label>"` mints a Founding Link; whoever claims it founds the
  Household and becomes its first Parent. No public sign-up.
- Free, informal, for invited friends. No payment, no legal ceremony, no
  Trial machinery.
- Same deployment: one container, one SQLite file, one domain. Every pilot
  Household's Claim Links share the one `ORIGIN`.
- The runtime becomes honest about tenancy: the four known isolation leaks are
  fixed (§5) and the two-household fixture proves it (§8).

## 2. Non-goals

Stage 1 deliberately does **not** include:

- **Payment** — no provider integration, no Plan, no Trial. Direction is
  decided ([Pricing and packaging](issues/07-pricing-and-packaging.md),
  [Payment provider direction](issues/02-payment-provider-research.md)); the
  build is a later effort.
- **Public sign-up and onboarding** — a stranger cannot create a Household;
  only the operator can. Deliberately left in the map's fog until pilot
  feedback exists.
- **New infrastructure** — no Postgres, no per-Household database files, no
  second host. [ADR-0021](../../docs/adr/0021-the-paid-service-scales-by-files-not-by-postgres.md)
  fixes the *direction* (SQLite all the way); Stage 1 stays on the pilot's
  single multi-tenant file.
- **Per-Household backup or restore** — the nightly backup stays whole-file
  (§5.6). Per-Household restore is paid-service fog.
- **Per-Household URLs or theming** — one domain for all.
- **Encryption against the operator** — the trust boundary is acknowledged,
  not closed (§6).
- **In-app Household renaming** — the label given at minting is the name;
  renaming stays a possible later feature.
- **An HTTP admin surface** — the no-HTTP-admin doctrine of
  `bin/babylog.js` stands. Everything operator-facing is CLI.

## 3. Founding a Household

### 3.1 The command

```
docker exec -e ORIGIN=https://log.example.com <container> babylog household "Anna & Tom"
```

- Lives in `bin/babylog.js` beside `members` and `rescue`; like them it opens
  the SQLite file directly and imports nothing from the app.
- **The label is a required argument** (1–200 characters after trimming).
  Missing label fails loudly with a usage hint, like `rescue` does.
- Requires `ORIGIN` in the shell (same guard and same error text as `rescue`):
  a link with no address is useless.
- Mints a `bootstrap`-kind Claim Link with `BOOTSTRAP_TTL_MS` (7 days — long
  enough for WhatsApp delivery), carrying the label (§7.1), and prints:
  - the claim URL,
  - what it does, in Founding-Link words: whoever opens it founds the new
    Household and becomes its first Parent,
  - the expiry,
  - and the standing disclosure of §6, as one copy-pastable sentence to send
    along with the link.
- **Creates no rows besides the link.** The Household row appears at claim
  time; an unclaimed link expires leaving no orphan. Re-running the command
  mints a fresh, independent link — it never burns earlier ones.

### 3.2 The claim

A `bootstrap`-kind claim **always founds a new Household**. The current
fallback in `claim()` (`src/lib/server/claims.ts`) — "join the existing
Household if one exists" — is removed along with its `theHousehold()` call:

- A new `households` row is created with `name` = the label carried on the
  link (`''` for a boot-printed link, which carries none).
- The claimer becomes the first Parent; their typed display name and their
  Device's IANA zone become the Member name and the Household Zone, exactly as
  first boot does today. The operator configures nothing about the family's
  rhythm — the family does.
- The `household`-kind seed revision and the `member` revision are written as
  today, scoped to the new Household.

The `invite` and `rescue` claim paths lose their `theHousehold()` fallbacks
too: both link kinds always carry `household_id` at minting, so a row without
one is `invalid`, never "whatever Household is first in the file".

### 3.3 First boot — unchanged

First boot with zero Members (the check stays global: `COUNT(*) FROM members`)
still prints a Founding Link for Household #1. The self-hosting first-run
story is untouched; a deployment that never runs `babylog household` behaves
exactly as ADR-0009 described.

Two boot details change beneath the surface:

- `mintBootstrap()` currently deletes **all** unclaimed bootstrap links so
  exactly one is ever live. That supersession now applies only to boot-minted
  links (those carrying no label, §7.1) — an operator-minted Founding Link
  waiting for a friend must survive a container restart.
- The `household ready — zone …` boot line reads `theHousehold()` and dies
  with it. Replacement: a count line — `N household(s), M member(s)`.

## 4. The operator surface

All CLI, all in `bin/babylog.js`, all reading the database directly.

### 4.1 `babylog households` (new)

One block per Household: **name** (`(unnamed)` when empty), **id**, **member
count** (active, i.e. `removed_at IS NULL`), and **last activity** — the
`received_at` of the Household's most recent revision, `never` when none.
This answers the pilot question "is anyone actually using this".

### 4.2 `babylog members` (changed)

Output gains Household grouping: members listed under their Household's name
(falling back to id when unnamed), instead of one flat list with no household
column. Per-member lines are unchanged.

### 4.3 `babylog rescue` (changed)

The lookup runs **inside one named Household**, never across the file:

- With exactly one Household in the file: `babylog rescue "Mama"` works
  unchanged, so existing self-hoster docs stay true.
- With more than one: the Household comes first — `babylog rescue "Anna & Tom"
  "Mama"` (two argv arguments, not joined). Omitting it fails loudly and lists
  the Household names.
- The Household is matched by name (`COLLATE NOCASE`) or id; an ambiguous name
  fails listing ids, the same shape as the existing ambiguous-member error.
- Within the Household, member matching is unchanged (name NOCASE or id).
  Cross-household name clashes are impossible by construction — the search
  space is one Household.
- The mint already copies the member's `household_id` onto the link and needs
  nothing more.

### 4.4 `ORIGIN`

One domain serves every pilot Household; all Claim Links are minted against
the one `ORIGIN`. Nothing per-Household enters the config.

## 5. Isolation

The schema was already fully household-scoped; the leaks are runtime. All four
must-fix items below ship in Stage 1, enforced by an **ownership guard** — no
schema migration of ids, which stay globally unique and client-minted. The
principle (ADR-0020): **a client-supplied id is never a capability.**

### 5.1 The ownership guard in push

In `push()` (`src/lib/server/sync.ts`):

- **Foreign revision id.** `revisionExists` takes `householdId`. A pushed
  revision whose id exists in the session's Household is a replay and stays an
  accepted no-op. One whose id exists in **another** Household is **rejected**
  — silently accepting it as a replay would be data loss for the pusher plus
  an existence oracle.
- **Foreign entity id.** A pushed revision whose `entity_id` already lives in
  another Household — as an entity of any kind or as the `entity_id` of any
  existing revision — is rejected.
- **The reason is generic.** Both rejections use one uninformative reason
  string (e.g. `not accepted`), via the existing per-revision `rejected[]`
  mechanism. The oracle this still leaves — that some random UUID exists — is
  accepted; all it reveals is that a UUID exists.
- The deterministic server-minted ids (`merge:…`, `bottle-past:…`) go through
  the same scoped `revisionExists`, so one Household's merge bookkeeping can
  never suppress another's.

### 5.2 `household`-kind revisions ignore the client's entity id

A `household`-kind revision can only ever mean the session's Household. The
server overwrites the client's `entity_id` with `authed.householdId` before
validation and insert — the bare `UPDATE households … WHERE id = ?` in
`materialise()` can then only ever hit the right row, and "a Parent of A
renames B" becomes unwritable rather than merely rejected.

### 5.3 Every helper says which Household

- `theHousehold()` (`store.ts`, LIMIT-1) is **deleted**, replaced by
  `getHousehold(db, householdId)`. The four call sites resolve from the
  session or the Claim Link, per ADR-0020's "no LIMIT-1 anywhere":
  - `api/session` GET → `authed.householdId`;
  - push target-zone seeding (`api/sync/push`) → `authed.householdId`;
  - `api/claim` GET: the `household_exists` field is **dropped** — no client
    reads it, and under §3.2 a Founding Link's behaviour no longer depends on
    what exists;
  - `api/claim` POST: the post-claim response reads the Household founded or
    joined by the claim (`result.householdId`), and the claim paths' fallbacks
    are gone (§3.2).
- `getMember` and `revokeMember` take `householdId` and match only inside it.
- `revisionExists` takes `householdId` (§5.1).
- Already scoped, verified by the survey, no change: `pullRevisions`,
  `currentCursor`, `revisionsOf`, `liveSessions`, `mergedIntoMap`, `getEntry`,
  `listMembers`, `countActiveParents`, `listTargets`, and the `revisionsOf`
  fold inside `materialise`.

### 5.4 Belt-and-braces predicates in `materialise`

The upserts in `materialise()` additionally carry a household predicate, so
even a future bug upstream cannot cross the boundary: the `ON CONFLICT … DO
UPDATE` arms refuse to update a row whose `household_id` differs from the
caller's, and the `households` UPDATE names the session's Household (§5.2).
Defence in depth — with §5.1–5.3 in place these predicates should never fire,
and the fixture (§8) proves the outer layers alone already hold.

### 5.5 The SSE wake set is Household-keyed

`live.ts` becomes a map of Household id → listener set: `subscribe(householdId,
listener)`, `wake(householdId)` after a push commits. A push wakes only its
own Household's Devices. The signal still carries no data — the pull remains
the only path by which rows arrive. This is what lets ADR-0020 state "every
runtime structure is household-keyed" without a reasoned-about exception.

### 5.6 Deliberate globals — kept, with eyes open

- **The rate limiter** stays IP-keyed and global: it defends endpoints, not
  tenants.
- **The nightly backup** stays whole-file. Operator fact, stated here because
  the spec is where the operator reads it: **restoring a backup rolls back
  every pilot Household at once.** Per-Household backup/restore is
  paid-service fog.

## 6. The trust boundary

No technical change in Stage 1. The operator can read, rescue-link into, and
delete any Household — ADR-0005's "shell access = full Household access" now
spans other people's data, and the pilot answers with **disclosure, not
encryption** (ADR-0020): whoever receives a Founding Link is told, in one
plain sentence, in spirit:

> "It runs on my server, so technically I can see everything you log — same
> trust as sending it to me directly."

The `babylog household` output prints this sentence beside the link (§3.1), so
handing it over is the default, not a thing to remember. A paid service owes a
stronger answer; Stage 1 deliberately does not give it.

## 7. Schema and protocol changes

### 7.1 Migration `0002-founding-label`

One nullable column: `claim_links.household_label TEXT`. Carries the label a
Founding Link applies as the Household's initial name. A separate column, not
a reuse of `display_name` — that column means "the Member name an Invite
carries" and the semantics must not collide. It doubles as the discriminator
of §3.3: `household_label IS NULL` on a bootstrap link means boot-minted.

The migration runs under the existing boot contract: pre-migration backup,
refuse-to-start on failure.

### 7.2 No protocol bump

`PROTOCOL_VERSION` is unchanged. The wire format is identical; the ownership
guard only widens the use of the existing `rejected[]` channel, and a
correctly-behaving client (which only ever pushes its own Household's data)
never sees a difference. Dropping `household_exists` from the claim GET breaks
nothing — no client reads it.

## 8. The testing bar

**Isolation is demonstrated, not assumed.** The bar is the **two-household
fixture**: two populated Households, every boundary attacked from the wrong
side. The Stage-1 test suite must cover, cross-household:

- push with a foreign `entity_id` for **every** revision kind — including a
  `household`-kind revision naming the other Household;
- replay of a foreign revision id (rejected, not silently accepted);
- the deterministic `merge:…` and `bottle-past:…` id shapes across Households;
- pull returns only the session Household's revisions;
- last-Parent protection counts only the own Household's Parents;
- `revokeMember` and the rescue mint act only inside their Household;
- claim links land only in the minting Household;
- the Founding-Link paths: CLI mint founds a new Household with the label as
  its name; boot founds Household #1 with `''`; a boot re-mint supersedes only
  the boot-minted pending link;
- `babylog rescue` scoping: single-household form unchanged, multi-household
  form requires and respects the Household argument;
- the SSE wake reaches only the pushing Household's listeners.

**Standing rule, to be added to `AGENTS.md`:** any new store function takes
`householdId`, or its review justifies why not.

## 9. Decision record

| Decision | Where |
| --- | --- |
| One deployment, many Households; every query says which | [ADR-0020](../../docs/adr/0020-one-deployment-many-households.md) |
| Superseded on tenancy only | [ADR-0009](../../docs/adr/0009-one-household-per-deployment.md) |
| Paid service scales by SQLite files, not Postgres (direction; not built here) | [ADR-0021](../../docs/adr/0021-the-paid-service-scales-by-files-not-by-postgres.md) |
| Creation mechanism, CLI surface, rescue scoping | [ticket 05 resolution](issues/05-household-creation-and-operator-surface.md) |
| Must-fix list, guard shape, kept globals, trust stance, testing bar | [ticket 06 resolution](issues/06-isolation-hardening-and-trust-boundary.md) |
| Founding Link (glossary) | [`CONTEXT.md`](../../CONTEXT.md) |
