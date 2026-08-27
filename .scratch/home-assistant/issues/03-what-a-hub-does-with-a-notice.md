# 03 — What a Hub does with a Notice

Type: grilling
Status: open

## Question

Settled at direction level while charting: **the deployment never wakes a Hub**. A **Notice** ([ADR-0031](../../../docs/adr/0031-a-notice-is-a-target-reached-and-the-household-states-the-offset.md)) stays a phone thing — it rides a Push Subscription a browser mints, which a Hub has no browser to mint, and Home Assistant *is* an automation engine, a better one than this app will ever ship. The Hub gets due **instants** as timestamp sensors and the Household writes its own automation: announce on the hall speaker, dim the lights. *Report, never nag* points the same way — the app states the instant, the Household decides what it means.

This ticket writes that down as an **ADR** (it is hard to reverse once families' automations depend on the sensors, surprising without context beside a notifier that exists, and a real trade-off — a second delivery path was the alternative), and grills the edges:

- Does the ADR also cover the Bottle Chime's ten minutes — i.e. is the *offset* a phone concept too, with the Hub getting only the due instant and `bottle life runs out at`?
- Is the `until` semantics of a Notice ("a late notification is a lie") something the sensor model needs an analogue of, or does a timestamp sensor's nature — always current, never queued — dissolve it?
- One sentence in the spec for the family who asks "why doesn't the wall panel beep?"
