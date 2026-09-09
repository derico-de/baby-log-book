# 04 — The Settings screens say what a Hub is

**What to build:** The screens that show the mark from ticket 03. A Parent minting an Invite can say it is for a Hub; the members list says which rows are Hubs; removing one says what removing it does.

Spec §5.1, surfaces. Decided in [ADR-0038](../../../docs/adr/0038-a-hubs-member-is-marked-and-a-hub-stays-a-caregiver.md).

**Blocked by:** 03 — A Member is marked as a person's or a Hub's.

**Status:** resolved

- [x] The invite form carries a *this is for a Hub* choice, and choosing it locks the role to Caregiver visibly.
- [x] A member row reads kind beside role, in the same `·` suffix grammar the row already uses — `Home Assistant · Hub · Caregiver`.
- [x] The role toggle is **hidden on Hub rows** (the refusal already exists server-side; the UI must not offer what will be refused).
- [x] The remove confirmation gains one Hub sentence: it unplugs the panel, it stops reading and writing at once, and its Entries remain.
- [x] **Hub stays Hub in every UI language** — the word is not translated.
- [x] All copy lands in en, de and ro.
- [x] A line under `## [Unreleased]` in `CHANGELOG.md`, same commit.

## Comments

**Built** in `src/routes/settings/+page.svelte`, with `settings_kind_hub`,
`settings_invite_for_hub`, `settings_invite_for_hub_hint` and
`settings_member_remove_hub_confirm` in en, de and ro.

- The row reads `Home Assistant · Hub · caregiver` — kind before role, in the
  suffix grammar the row already used.
- The role toggle is not rendered on a Hub row at all, rather than disabled: the
  server refuses the promotion, and an offer that will be refused is worse than
  no offer.
- The invite form's *this is for a Hub* checkbox disables the role select while
  it is ticked, which is the visible half of the lock; the server locks it again
  at mint time, so a hand-written POST cannot mint a Hub Parent either.
- The pending-Invite row carries `· Hub` too, so a Parent looking at what is
  waiting to be claimed can tell a panel from a person before anyone claims it.

**Not visually verified.** No dev server was started for this. The markup is
typechecked and the copy is in all three files; a look at the real screens is
worth doing before release, and ticket 08 in the integration repo walks the
members list on the dev instance anyway.
