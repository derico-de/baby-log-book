# 04 — Re-binding a Hub that lost its session

Type: grilling
Status: resolved

## Question

Ticket 29's re-auth story — *a 401 opens Home Assistant's re-auth flow, which asks for a Rescue Link* — only reaches a self-hoster: `mintRescue` is called from one place, `babylog rescue` under `docker exec` (`bin/babylog.js`), 15-minute expiry. A **hosted** family has no shell. Their only path today is a Parent minting a fresh **Invite**, which claims as a *second* Member and leaves a dead *Home Assistant* in the members list forever — attribution splits across two Members, and the timeline lies by fragmentation.

The lost phone hits the identical hole, but a human can ask the operator; a hub against a public origin makes re-binding *routine*, so the integration cannot ship a re-auth flow only self-hosters can complete. Owned here, decided during charting.

Candidate shapes to grill:

- **A Parent-mintable Rescue Link in Settings** — generalises to the lost phone (Oma's new phone today also needs the operator), but ADR-0005 chose claim links minted by whom, and a Parent minting *re-binding* credentials for another Member is new power to reason about.
- **An Invite that replaces rather than adds** — a Parent invites "for" an existing Member; the claim re-binds instead of creating. Keeps one Member, but overloads the Invite.
- **Accept the dead Member** — smallest change; the members list gains clutter and attribution splits. Probably wrong, but state why.

Whatever wins must name its blast radius (who may mint, expiry, what happens to the old Device's session) and check whether it belongs to this map or graduates a fix into the hosted-service world too. `revokeMember`, `mintRescue` and the sessions list in Settings are the code to read first.

## Answer

**The Parent-mintable Rescue Link in Settings wins**, recorded as [ADR-0037](../../../docs/adr/0037-a-rescue-link-is-minted-from-settings.md); the CONTEXT.md **Rescue Link** entry is rewritten to match. The rescue *claim* path (`claims.ts`) was already exactly right — re-bind, no new Member — only the minting surface was CLI-locked.

Two facts found while grilling reshaped the question:

- **The Rescue Link was already the second-device path**, not just recovery: CONTEXT.md's Device entry ("the same person on a second phone claims again") has no other link that binds to an existing Member. So a rescue carries two meanings — *recover* and *add* — and any auto-revoke-on-claim would sign the phone out for adding the tablet.
- **There is no sessions list in Settings** — the ticket's premise was off. Settings shows a device *count*; the only remote revocation a Parent has is removing the whole Member. Per-Device revoke is a missing feature this map does not need (revoking the Hub = removing its own Member) and deliberately does not build.

The decisions, in full:

1. **Shape**: Rescue Link mintable from Settings. Not an Invite-that-replaces (overloads every surface that means "someone new"), not accept-the-dead-Member (HA's re-auth contract assumes the same account comes back — an Invite there *cannot* be written honestly).
2. **Old sessions**: untouched on claim, always. One link, one meaning: *bind this Member to another Device*, silent about the old ones. The stolen phone's session wants a per-Device revoke that is out of scope here.
3. **Who mints**: any Member for themselves (self-rescue *is* add-my-tablet, and no new power); a Parent for any Member. The genuinely new power — a Parent binds a Device that writes as another Member — is named in the ADR.
4. **TTL**: one constant, raised to **60 minutes**, CLI included. "15 minutes because you are standing at the terminal" stops describing a WhatsApp delivery.
5. **Visibility**: an unclaimed rescue joins the pending-Invites list — named for the Member it re-binds, revocable by any Parent, `created_by` recorded. This is the counterweight to (3).
6. **Removal burns pending rescues** for the Removed Member, and `revokeMember` already kills every session — so a hub-credential thief who self-rescues gains no persistence removal does not end. ADR-0034's "cannot open the door to another Device" narrows to "another *Member*"; ADR-0037 records the reconciliation.
7. **Scope**: owned entirely by this map. The sole-Parent lost phone stays the operator's terminal *by construction* (no session exists to mint from); nothing reopens in the hosted-service map — operator-rescue toil, if the pilot shows it, graduates as a fresh effort there.

For the spec: the HA re-auth flow asks for a Rescue Link a Parent mints from Settings, same words as the lost phone — the story ticket 29 wanted, now true for hosted families too.
