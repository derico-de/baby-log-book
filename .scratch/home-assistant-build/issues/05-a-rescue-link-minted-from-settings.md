# 05 — A Rescue Link minted from Settings

**What to build:** Re-binding a Device to an existing Member is CLI-only today, which reaches self-hosters and nobody else. A Hub against a public origin makes re-binding routine, and the lost phone hits the identical hole — so the mint moves into Settings, where a hosted family can reach it.

The rescue **claim** path is already right; only the minting surface is CLI-locked.

Spec §5.2. Decided in [ADR-0037](../../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md).

**Blocked by:** 04 — The Settings screens say what a Hub is. (Both rework the members area; the edge is sequencing, not logic.)

**Status:** ready-for-agent

- [ ] **Any Member may mint a Rescue Link for themselves**; a **Parent** may mint one for **any Member**. Self-rescue is no new power — it is *add my tablet*, which a Rescue Link was always also for.
- [ ] **One TTL, 60 minutes, everywhere — the CLI included.** Fifteen minutes was priced for an operator standing at a terminal; a Settings mint travels over WhatsApp to someone fumbling with a new phone. An Invite's 7 days is unchanged.
- [ ] **Claiming a rescue never touches old sessions.** One link, one meaning — *bind this Member to another Device* — and silent about the old ones. An auto-revoke would sign the phone out for adding the tablet.
- [ ] An unclaimed rescue **joins the pending-Invites list**, named for the Member it re-binds, revocable by any Parent, with the minter recorded. This is the counterweight to a Parent minting credentials that write as someone else.
- [ ] **Removal burns pending rescues** for the Removed Member, so a stolen credential that self-rescues gains no persistence removal does not end.
- [ ] All copy lands in en, de and ro.
- [ ] A line under `## [Unreleased]` in `CHANGELOG.md`, same commit.
