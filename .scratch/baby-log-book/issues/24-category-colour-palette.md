# 24 — Category colour palette (the "Signal" reversal)

Status: **implemented 2026-08-20** — tokens, components, DESIGN.md/PRODUCT.md and ADR-0026 landed; every fill/ink pair contrast-verified ≥4.5:1.
Reverses part of issue 11's D1 "Instrument" ratification: entry types now get
their own colour, used everywhere a type appears. Probe reviewed on sideshow
("Category palette — the Signal reversal", session `eeHecFePndw`).

## Decision

Each entry type gets a colour, applied as **saturated fill with white glyph**
on the two recognition points and echoed everywhere a type appears. Glyph +
label remain on every surface, so identification never *depends* on colour —
colour-vision safety is preserved by construction, colour becomes the fastest
scanning channel.

What survives of D1: the accent's monopoly. Actions, the FAB and overdue
reporting keep burnt orange; **no category hue enters the 35–70° band**, and
overdue never adopts a category hue. "Report, never nag" is untouched.

## The palette

Six hues, evenly spread, all skipping the accent band. Day/night fills carry
white ink; deep-night dims to L ≈ 0.35 with chroma halved and on-fill ink
capped at L 0.78 (per ADR-0008's luminance cap).

| Type                  | Hue        | Day fill              | Night fill            | Deep fill             | Deep ink              |
| --------------------- | ---------- | --------------------- | --------------------- | --------------------- | --------------------- |
| Feed (breast+bottle)  | rose 15°   | oklch(0.54 0.16 15)   | oklch(0.56 0.15 15)   | oklch(0.36 0.07 15)   | oklch(0.78 0.02 15)   |
| Meal                  | green 150° | oklch(0.50 0.11 150)  | oklch(0.55 0.11 150)  | oklch(0.34 0.05 150)  | oklch(0.78 0.02 150)  |
| Nappy (pee+poop)      | teal 215°  | oklch(0.51 0.09 215)  | oklch(0.55 0.09 215)  | oklch(0.35 0.05 215)  | oklch(0.78 0.02 215)  |
| Measurement           | blue 250°  | oklch(0.51 0.10 250)  | oklch(0.55 0.10 250)  | oklch(0.35 0.05 250)  | oklch(0.78 0.02 250)  |
| Sleep                 | indigo 285°| oklch(0.50 0.12 285)  | oklch(0.55 0.12 285)  | oklch(0.35 0.06 285)  | oklch(0.78 0.02 285)  |
| Milestone             | plum 330°  | oklch(0.53 0.15 330)  | oklch(0.56 0.14 330)  | oklch(0.36 0.06 330)  | oklch(0.78 0.02 330)  |

Values are engineering targets: every fill/ink pair must be contrast-verified
in implementation (white on day/night fills ≥ 4.5:1; deep pairs ≥ 4.5:1).
Semantics: feed = warm rose (nurture), meal = green (solid food), sleep =
indigo (night), nappy = teal (water/clean-up — refusing the yellow/brown
cliché), measurement = instrument blue, milestone = plum (celebration; gold
would collide with the accent).

Each type also gets a **soft** pair per appearance (tint background +
hue-matched dark ink, e.g. day: L 0.94 / C ~0.03 tint with L 0.40 ink) for
idle chips and quiet echoes.

## Where colour lands

- Timeline `.glyph` disc: solid fill, white glyph (capped ink in deep).
- Fan pills: full-item solid fill, white label + sub-label. Pee/poop share
  teal, told apart by glyph.
- Filter type-chips: soft tint idle → solid fill active. Non-type chips keep
  the ink-inversion active state.
- Live grid: the 5px column bars and live-pills take `--t-sleep` / `--t-feed`
  while running; hero figures stay ink.
- Stat cards: bars and per-type marks in the type hue.
- Sheets: header glyph disc in the type fill; forms stay Pico-neutral.
- Overdue numbers: still `--warn` → accent, never a category hue.

## Token plan

The `--t-*` family in `src/styles/tokens.css` grows from one alias to four
roles per type, defined in all three appearances:

    --t-feed            (solid fill)
    --t-feed-ink        (on-fill ink: white day/night, capped in deep)
    --t-feed-soft       (tint background)
    --t-feed-soft-ink   (ink on the tint)

…and likewise `sleep`, `nappy`, `meal`, `measure`, `milestone`. No component
may name a colour directly — the whole feature is these token definitions plus
targeted rules in `components.css`.

## Documents to amend

- `DESIGN.md`: Color section (one-hue rule, `--t-*` paragraph, active-chip rule).
- `PRODUCT.md`: anti-reference "colour-coded category confetti"; positioning note.
- New ADR recording the reversal (issue 11 and the token comments cite the old rule).
