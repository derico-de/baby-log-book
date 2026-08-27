# 03 — What a Hub does with a Notice

Type: grilling
Status: resolved

## Question

Settled at direction level while charting: **the deployment never wakes a Hub**. A **Notice** ([ADR-0031](../../../docs/adr/0031-a-notice-is-a-target-reached-and-the-household-states-the-offset.md)) stays a phone thing — it rides a Push Subscription a browser mints, which a Hub has no browser to mint, and Home Assistant *is* an automation engine, a better one than this app will ever ship. The Hub gets due **instants** as timestamp sensors and the Household writes its own automation: announce on the hall speaker, dim the lights. *Report, never nag* points the same way — the app states the instant, the Household decides what it means.

This ticket writes that down as an **ADR** (it is hard to reverse once families' automations depend on the sensors, surprising without context beside a notifier that exists, and a real trade-off — a second delivery path was the alternative), and grills the edges:

- Does the ADR also cover the Bottle Chime's ten minutes — i.e. is the *offset* a phone concept too, with the Hub getting only the due instant and `bottle life runs out at`?
- Is the `until` semantics of a Notice ("a late notification is a lie") something the sensor model needs an analogue of, or does a timestamp sensor's nature — always current, never queued — dissolve it?
- One sentence in the spec for the family who asks "why doesn't the wall panel beep?"

## Answer

Written down as [ADR-0036](../../../docs/adr/0036-the-deployment-never-wakes-a-hub.md) — *The deployment never wakes a Hub, and the Household writes the automation*. The edges, as grilled:

- **The Bottle Chime's ten minutes is a phone concept.** The Hub gets only `bottle life runs out at`; the lead never crosses the wire. Verified against the HA 2026.8 docs that the `time` trigger fires at a timestamp sensor's value with a negative `offset`, so "ten minutes before" is one line in a stock automation.
- **The Notice Offsets never ship either** — they time a push's arrival, and a sensor has no arrival to time. Raw due instants only (`feed due at`, `wake window up at`), which also keeps the derived payload a pure function of the log — feeds the [wire contract](09-the-wire-contract.md) cursor-as-ETag finding.
- **`until` dissolves.** A sensor is always-current, never queued; its one way to lie is staleness, and stock `DataUpdateCoordinator` unavailability-on-failed-update is the answer. No analogue needed by design.
- **The family's sentence** (for the spec): *The app states when things are due; what your home does about it — a chime on the hall speaker, a light that warms, nothing at all — is an automation you write in Home Assistant, which is better at that than we will ever be.*
- **The README carries two or three copy-paste automation examples** so the hand-off doesn't read as a shrug; blueprints are out of scope.
