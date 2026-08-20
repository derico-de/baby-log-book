# Feedback channel for the pilot

Type: grilling
Status: resolved

## Question

How do the pilot friends report feedback, and what are they asked to watch for?

Graduated from the map's fog once the Stage-1 spec existed. The pilot's whole point is feedback (the map's Not-yet-specified says public sign-up and onboarding wait on it), so the channel is a decision, not an afterthought.

To decide:

- **Channel**: in-app affordance (conflicts with the app's deliberate minimalism and would be Stage-1 scope creep), the repo's issue tracker (friends are not necessarily GitHub people), or plain chat (WhatsApp/Signal — where the Founding Links already travel). What is the cheapest channel the friends will actually use?
- **Prompted or passive**: do we ask specific questions (pricing reaction, what they'd pay, missing features) at set moments, or just leave the door open?
- **What signals decide the open fog**: which feedback items gate "public sign-up and onboarding" and pricing confidence — so the pilot has an end condition rather than running indefinitely.
- **Operator-side notes**: where the operator records what came back, so it lands somewhere a later session can read (this effort's directory?).

## Answer

**Channel: plain chat, 1:1 threads per Household** — the same WhatsApp/Signal thread the Founding Link arrived in. No in-app affordance (would breach the Stage-1 spec's non-goals and the app's minimalism), no GitHub (friends aren't necessarily GitHub people), and the support email stays reserved for paying customers. Separate threads, not a group: the friends don't necessarily know each other and baby data is intimate; a group can be created later if the same report arrives three times.

**Prompted, lightly — usability-only.** Purely passive pilots go silent (people don't report friction, they just stop logging), so the operator asks at two set moments in each thread:

1. **After the first week**: did anything confuse you setting up or logging at 3am?
2. **After ~a month**: what do you reach for that isn't there? What do you never use?

**No pricing questions** — the clause in this ticket's question listing "pricing reaction, what they'd pay" as candidate prompts is superseded by the trade-off recorded in [Pilot → paid transition](11-pilot-to-paid-transition.md): Guest-Household friends give usability feedback, never pricing signal.

**End condition — the gate for "public sign-up and onboarding" work to start:**

1. At least **3 pilot Households founded** via Founding Link with no hand-holding beyond the link itself — the claim flow works on people who don't live with the operator.
2. At least **2 Households still actively logging after 4 weeks** — retention beyond novelty.
3. **No open isolation or sync bugs** surfaced by pilot use.
4. Both prompts answered by most Households, with the surfaced friction either **fixed or consciously deferred**.

Pricing confidence is explicitly *not* an output of the pilot — it came from [competition research](01-competition-research.md) and is locked in [Pricing, packaging and positioning](07-pricing-and-packaging.md).

**Operator-side notes: a single running log** at [`pilot-feedback.md`](../pilot-feedback.md) in this effort's directory — one dated entry per item, tagged with its Household and a disposition (fixed / deferred / ignored). Anything that becomes real work graduates to a normal tracker issue; the log itself is the artifact a later session reads to judge the gate.
