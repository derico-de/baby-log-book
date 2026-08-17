# Accounts, households and invites

Type: grilling
Status: resolved
Blocked by: 05

## Question

How do people get into a household, prove who they are, and stay signed in offline — on a self-hosted server with no mail infrastructure?

### Decisions to reach

- **Bootstrapping** — a fresh container has no users. How is the first owner created? First-run setup screen, environment variable, CLI?
- **Joining** — no SMTP means no email invites. An invite link or code the owner copies into WhatsApp is the obvious answer. Single-use or reusable? Expiring? Does it carry the role?
- **Credentials** — password, passkey, or magic link. Grandparents are users: whatever wins has to be explainable in one sentence over the phone. Passkeys are a genuinely good fit for phones and a genuinely bad one for "Oma, on the tablet in the kitchen".
- **Session lifetime** — long-lived (90 days was the working assumption), refreshed on any server contact, valid offline in between. What is stored on the device, and how is it protected?
- **Role enforcement** — owner vs caregiver, enforced server-side. Note the interaction with corrections: anyone may correct anything, so roles gate deleting, inviting, and managing babies.
- **Revocation** — an owner removes a caregiver whose device holds a full local replica. This is a real limitation of the offline-first decision, not a bug. Decide what we do about it and what we simply accept; it may graduate into its own ticket.
- **Self-serve signup** — presumably off. Confirm that the only route in is an invite.

### Carried forward from [Sync protocol](06-sync-protocol.md)

That ticket drew the boundary: it owns what sync *does* when the proof of identity is stale, and this ticket owns the proof itself. Already settled there, so do not re-decide:

- A 401 on push **never** blocks local writes and **never** wipes local data. The outbox is durable; the UI shows a passive "signed out — 14 entries waiting" line and re-authenticating flushes it. Explicit sign-out with a non-empty outbox warns first.
- **Nothing authenticating ever syncs.** Members replicate as id, display name and role only — that is what the timeline's attribution and the local owner/caregiver checks need, and no more.
- Devices carry a stable `device_id`, because it is the tie-breaker in the merge key. Whether that identifier is tied to the session or outlives it is this ticket's call.

## Answer

**There are no passwords.** A one-time link claims a Device, and that Device stays signed in until an Owner revokes it. Recorded as [ADR-0005](../../../docs/adr/0005-claim-links-instead-of-passwords.md); new vocabulary in [`CONTEXT.md`](../../../CONTEXT.md).

### The one primitive

Everything that grants access is a **Claim Link**: single-use, high-entropy, and claimed by a **POST behind a button** — never by the GET that fetches it. That last detail is not a refinement, it is the difference between working and not: WhatsApp, Signal and Telegram all fetch a URL server-side to build the preview card, so a link that claims on GET is burnt by the preview bot before the recipient ever sees it. The server is on the public internet, so the endpoint is rate-limited and the page is `noindex`.

Two flavours, differing only in what they bind to:

- An **Invite** creates a Member. An Owner types the display name and picks the role up front, so the timeline reads "Oma" from her first entry rather than "Unnamed". **7-day expiry** — you send it on Wednesday, she taps it on Sunday. The Member row is created **on claim**, so a pending invite is never a half-real person in the household; until then it sits in a pending list the Owner can revoke.
- A **Rescue Link** re-binds a Device to a Member who already exists, and is minted **from the container** — `docker exec` lists the Members and prints a link, 15-minute expiry because you are standing at the terminal. It re-binds rather than creating a fresh Owner: a new row would leave two "Mamas" and split three years of attribution between them, since every Revision points at the old one.

Bootstrap is the same mechanism with nothing to bind to — on an empty household the command creates the household and first Owner, and the app prints that link to stdout at boot when there are zero Members, so first run needs no command at all. **This is the only privileged path in, and there is no public registration page.**

### Sessions

**No fixed expiry. Revocation is the control, not a timer.** The 90-day working assumption is rejected: a timer signs Oma out precisely when she has not opened the app in a while, which is the moment re-authentication is hardest and you are least likely to be in the room to help.

The token lives in an **HttpOnly, Secure, SameSite=Lax cookie** rather than in IndexedDB, so page JavaScript cannot read it and an XSS cannot exfiltrate it; sync is same-origin, so it rides along with no client-side handling at all. Offline it is simply never checked — only the server validates it, which is what makes a device work for days with no server contact.

**`device_id` outlives the session** and is stored beside the local replica, not with the credential. It is the lexicographic tie-breaker in the merge key ([ADR-0004](../../../docs/adr/0004-cursor-is-not-the-merge-key.md)) and **never a proof of identity** — nothing may treat possession of one as authorisation. Sign-out, re-claim and rescue all keep it; only wiping the local database mints a new one, which is harmless.

### Roles

**Multiple Owners.** Both parents are Owners, and the one-Owner household is one lost phone away from being unmanageable — the very case that produced the Rescue Link. Owners may promote and demote, with one hard rule: **the last Owner can be neither demoted nor removed**, so a household always has at least one. A Member belongs to exactly one Household in v1, which keeps every query household-scoped with no exceptions.

### Removal

**Removal is a state, not a deletion.** The Member row survives forever, marked removed, because every Revision they ever wrote points at it — the timeline must still read "logged by Oma" in three years, and a hard delete would either orphan that attribution or falsify it.

Server-side their tokens die immediately, and the next pull or push gets a **removed** response that is deliberately distinct from the ordinary expired-session 401 — by [Sync protocol](06-sync-protocol.md) a 401 must never wipe local data, and conflating the two would turn every flaky session into data loss. On a removed response the app makes a **best-effort local wipe** and says so plainly.

Two limitations accepted rather than papered over, consistent with [What may a caregiver see?](14-caregiver-visibility-scope.md): a device kept offline forever keeps its copy, and anything sitting in that device's outbox at the moment of removal is rejected and lost.
