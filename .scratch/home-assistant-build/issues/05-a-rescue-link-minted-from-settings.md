# 05 — A Rescue Link minted from Settings

**What to build:** Re-binding a Device to an existing Member is CLI-only today, which reaches self-hosters and nobody else. A Hub against a public origin makes re-binding routine, and the lost phone hits the identical hole — so the mint moves into Settings, where a hosted family can reach it.

The rescue **claim** path is already right; only the minting surface is CLI-locked.

Spec §5.2. Decided in [ADR-0037](../../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md).

**Blocked by:** 04 — The Settings screens say what a Hub is. (Both rework the members area; the edge is sequencing, not logic.)

**Status:** resolved

- [x] **Any Member may mint a Rescue Link for themselves**; a **Parent** may mint one for **any Member**. Self-rescue is no new power — it is *add my tablet*, which a Rescue Link was always also for.
- [x] **One TTL, 60 minutes, everywhere — the CLI included.** Fifteen minutes was priced for an operator standing at a terminal; a Settings mint travels over WhatsApp to someone fumbling with a new phone. An Invite's 7 days is unchanged.
- [x] **Claiming a rescue never touches old sessions.** One link, one meaning — *bind this Member to another Device* — and silent about the old ones. An auto-revoke would sign the phone out for adding the tablet.
- [x] An unclaimed rescue **joins the pending-Invites list**, named for the Member it re-binds, revocable by any Parent, with the minter recorded. This is the counterweight to a Parent minting credentials that write as someone else.
- [x] **Removal burns pending rescues** for the Removed Member, so a stolen credential that self-rescues gains no persistence removal does not end.
- [x] All copy lands in en, de and ro.
- [x] A line under `## [Unreleased]` in `CHANGELOG.md`, same commit.

## Comments

**Built.** `RESCUE_TTL_MS` is 60 minutes in `claims.ts` and in `bin/babylog.js`
alike, and `cli.test.ts` still holds the two to each other.

One shape decision worth recording, because it renamed a route:

- **`/api/invites` became `/api/links`.** A pending rescue joining the pending
  Invites is not a list that happens to hold two things — it is one question,
  *what is currently a way in, and do we still want it to be*, and `CONTEXT.md`
  already has the umbrella word for it: **Claim Link**. So `listPendingInvites`
  became `listPendingLinks` (Invites and rescues, a rescue taking its name and
  role from the Member it re-binds by join rather than by copy, so a rename keeps
  up), `revokeInvite` became `revokePendingLink`, and the route is one endpoint:
  `GET` lists (Parent), `POST` mints either kind, `DELETE` revokes either kind
  (Parent). The app is the only caller.
- **Authorisation for a rescue lives in the route**, not in `mintRescue`: self is
  anybody's, anyone else is a Parent's, and the subject has to be a live Member
  of *this* Household — a member id is a client-supplied id and never a
  capability (ADR-0020). `isolation.test.ts` covers both halves of that boundary.
- **Removal burns pending rescues in `revokeMember`**, beside the session and
  push-subscription kills, and scoped by the same Household predicate.

**Copy** landed in en, de and ro: `settings_rescue_mint`,
`settings_rescue_explain`, `settings_pending_invite`, `settings_pending_rescue`.
The README's operator section and its "how people get in" paragraph now say
Settings first and the terminal second. ADR-0005's line about fifteen minutes is
left as written — ADR-0037 supersedes it, and ADRs record what was decided when.
