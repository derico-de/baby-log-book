# 04 — Re-binding a Hub that lost its session

Type: grilling
Status: open

## Question

Ticket 29's re-auth story — *a 401 opens Home Assistant's re-auth flow, which asks for a Rescue Link* — only reaches a self-hoster: `mintRescue` is called from one place, `babylog rescue` under `docker exec` (`bin/babylog.js`), 15-minute expiry. A **hosted** family has no shell. Their only path today is a Parent minting a fresh **Invite**, which claims as a *second* Member and leaves a dead *Home Assistant* in the members list forever — attribution splits across two Members, and the timeline lies by fragmentation.

The lost phone hits the identical hole, but a human can ask the operator; a hub against a public origin makes re-binding *routine*, so the integration cannot ship a re-auth flow only self-hosters can complete. Owned here, decided during charting.

Candidate shapes to grill:

- **A Parent-mintable Rescue Link in Settings** — generalises to the lost phone (Oma's new phone today also needs the operator), but ADR-0005 chose claim links minted by whom, and a Parent minting *re-binding* credentials for another Member is new power to reason about.
- **An Invite that replaces rather than adds** — a Parent invites "for" an existing Member; the claim re-binds instead of creating. Keeps one Member, but overloads the Invite.
- **Accept the dead Member** — smallest change; the members list gains clutter and attribution splits. Probably wrong, but state why.

Whatever wins must name its blast radius (who may mint, expiry, what happens to the old Device's session) and check whether it belongs to this map or graduates a fix into the hosted-service world too. `revokeMember`, `mintRescue` and the sessions list in Settings are the code to read first.
