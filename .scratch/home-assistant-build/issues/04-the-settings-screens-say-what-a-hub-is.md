# 04 — The Settings screens say what a Hub is

**What to build:** The screens that show the mark from ticket 03. A Parent minting an Invite can say it is for a Hub; the members list says which rows are Hubs; removing one says what removing it does.

Spec §5.1, surfaces. Decided in [ADR-0038](../../../docs/adr/0038-a-hubs-member-is-marked-and-a-hub-stays-a-caregiver.md).

**Blocked by:** 03 — A Member is marked as a person's or a Hub's.

**Status:** ready-for-agent

- [ ] The invite form carries a *this is for a Hub* choice, and choosing it locks the role to Caregiver visibly.
- [ ] A member row reads kind beside role, in the same `·` suffix grammar the row already uses — `Home Assistant · Hub · Caregiver`.
- [ ] The role toggle is **hidden on Hub rows** (the refusal already exists server-side; the UI must not offer what will be refused).
- [ ] The remove confirmation gains one Hub sentence: it unplugs the panel, it stops reading and writing at once, and its Entries remain.
- [ ] **Hub stays Hub in every UI language** — the word is not translated.
- [ ] All copy lands in en, de and ro.
- [ ] A line under `## [Unreleased]` in `CHANGELOG.md`, same commit.
