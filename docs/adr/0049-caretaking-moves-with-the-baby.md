# Caretaking moves with the Baby, and the other Members say where it is

[ADR-0048](0048-the-zone-prompt-comes-on-arrival.md) asks a Parent to move the Household Zone the moment their phone is in another zone. That was written for a family that travels together. A Parent on a trip without the Baby was asked too, on every return to the app, with *Move* as the first answer. Moving would cut every other Member's days on the traveller's clock: a 07:00 Day Start in New York is 13:00 at home in Berlin.

The Household Zone is where caretaking happens, so it moves with the Baby and never with one Member. A phone cannot tell a trip with the Baby from a trip without her, but the other Members can: whoever still cares for her logs from home, and every Entry carries its Recording Zone. So the prompt is not shown while another Member's latest Entry was logged in the Household Zone in the last twelve hours. Where it is still shown, it asks to *move caretaking*, which asks whether the Baby is there too.

## Consequences

- **The Recording Zone is read for the first time.** [ADR-0010](0010-instants-are-stored-the-zone-is-a-lens.md) captured it so it could be read later. It is read only to decide whether to ask, and never to show or bucket a time.
- **Each Member is read by their latest Entry alone.** When the whole family has travelled, the first Entry logged after arrival by either parent clears the other's pre-flight Entries, so the prompt comes after one log rather than half a day. Until then time fields still say which zone they are read in.
- **Twelve hours is a night.** A Household that has logged nothing at home for longer is treated as gone, and the traveller is asked. A wrong guess costs one question, and the question now says what it is asking.
- **A Hub counts like any Member.** Home Assistant stamps its own configured zone, and a Hub that logs is a button pressed at home.
- **The check reruns after every sync**, because the Entries that answer it come from other Devices. A prompt shown overnight goes away when home logs again.
