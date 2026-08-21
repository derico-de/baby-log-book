# Product

## Register

product

## Platform

web

## Users

The Members of one Household — the parents, grandparents and caregivers who look after the same babies. They log on their own phones, one-handed, often in the dark, often while holding the baby, and often offline. The signature moment is a dark room at 3am: a half-awake parent recording a feed with one thumb. The same log is read later in calmer moments — checking when the last feed started, whether a nap is due, how the week looked.

## Product Purpose

A shared, local-first log of a baby's day — Feeds, Sleeps, Pee & Poop, Meals, Measurements, Milestones and Tummy Time — that every Member's Device carries and syncs. It answers "when did she last eat?", "how long has she been down?", and "is the bottle still good?" without ceremony. Success is a log kept faithfully because logging costs almost nothing, and a Household that trusts the timeline more than anyone's memory.

## Positioning

The instrument on the nightstand: it reports elapsed time against the Targets the Household stated, and it never nags. (Targets are stated, never learned — ADR-0006; overdue is reported in the one brand hue, because the palette contains no second escalation colour and no red. The six entry types each carry a calm hue of their own — a scanning aid, never a signal; the brand hue keeps its monopoly on actions and overdue — ADR-0026.)

## Brand Personality

Calm, precise, trustworthy. An instrument, not a companion app: it shows numbers plainly and lets the people decide what they mean. Loud through size at a light weight, never through boldness or colour. The domain language (CONTEXT.md) is warm but exact — Household, Baby, Member, Entry — and the UI copy follows it word for word.

## Anti-references

- Colour as the *only* channel, or as escalation: entry types carry a hue (ADR-0026), but glyph and label stay on every surface, no category hue enters the accent's band, and overdue never adopts one — the D3 "Signal" failure was confetti without those guards.
- Warm background plus warm accent — the combination that makes an interface look generated. Surfaces stay at chroma 0; all warmth lives in the single accent.
- Nagging baby-tracker apps: red badges, alarms, guilt-inducing streaks, health guidance the user never asked for.
- Blue-lit night modes: blue is the wrong physiology for an unlit room.
- Toy-like or cutesy baby aesthetics — pastels, rounded mascots, illustration noise.

## Design Principles

- The timeline is the screen; everything else is two taps away and must not compete with the FAB for the thumb.
- Stats says what a day looked like before it says whether it is improving: the grid answers *when*, the cards answer *is this getting better*, and neither is a substitute for the other.
- Colour belongs to actions, not to categories. One hue.
- The appearance follows the clock, and the clock can only ever make it darker, never lighter (ADR-0008).
- Report, never nag. Overdue is the number adopting the brand colour; there is no escalation state.
- Numbers are the interface: tabular figures, and a type scale that makes "2h 40m" the loudest thing on screen.

## Accessibility & Inclusion

Contrast is engineered, not hoped for: body ink at 15.9:1, secondary at 8.3:1, tertiary still ≥5:1; deep night caps peak luminance while keeping ≥10:1. Entry-type identification never depends on colour, so it survives colour-vision deficiency by construction. Tap targets are 48px floor (FAB 62px). Reduced motion is honoured via the dedicated reduced-motion block. The app must remain fully usable offline and one-handed.
