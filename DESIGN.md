# Design

Direction **D1 "Instrument"**, ratified 2026-08-16 (`.scratch/baby-log-book/issues/11-visual-design-direction.md`). The token file `src/styles/tokens.css` is the whole of the visual system; nothing else in the app may name a colour, radius or font size directly. This document describes it — the tokens are the source of truth.

## Theme

Three appearances, driven by the local wall clock, not by a toggle and not by `prefers-color-scheme` (ADR-0008). The clock can only ever make it darker, never lighter; after 19:00 there is no light mode at all.

- **day** — a sunlit kitchen table at 11am. Near-white ground `oklch(0.975 0 0)`, white surfaces.
- **night** — lamps on. Warm-neutral dark ground `oklch(0.17 0.006 60)`.
- **deep** — 23:00 to Day Start, an unlit room. Ground `oklch(0.09 0.005 60)`; peak ink luminance capped at 0.78 (still ≥10:1); shadows removed entirely.

`<html>` carries `data-appearance="day|night|deep"` and `data-theme="light|dark"` (for Pico's assets), written by an inline resolver before first paint. Manual override: Automatic / Always day / Always night — no "always deep".

## Color

One hue. Surfaces sit at chroma 0; all warmth lives in the accent and nowhere else.

- Accent (day): `oklch(0.55 0.15 45)` — a burnt orange; night `oklch(0.78 0.14 65)`; deep `oklch(0.66 0.11 60)`.
- Ink ramp per appearance: `--ink` (body, 15.9:1 day), `--ink-2` (secondary, 8.3:1), `--ink-3` (tertiary, ≥5:1).
- Surfaces: `--ground`, `--surface`, `--surface-2`; lines: `--line`, `--line-strong`.
- `--warn` and `--live` both resolve to `--accent`: overdue is the number adopting the brand colour. There is no red, no second escalation state.
- Entry-type tokens `--t-feed` … `--t-milestone` all resolve to `--ink-2`: types are told apart by glyph and label, never by colour. A new type costs nothing.
- Active chip state is an ink inversion, never the accent — the hue belongs to actions.

## Typography

One family: `system-ui` stack (`--font-ui`), no webfont — the 3am first paint waits for nothing. Weights 400 / 500 / 650 (`--fw-*`).

- Scale `--fs-0` 0.75rem → `--fs-8` 3rem, fixed rem, tight steps.
- The hero figures ("2h 10m") are 70% of `--fs-7` at **weight 300**: loud through size at a light weight. Two stand side by side in the header (sleep | feed) under their column titles ("Sleeping" / "Feeding", `--fs-3` medium), so they stay the biggest thing in the header without shouting.
- Numbers everywhere use tabular lining figures: `--num-feature: 'tnum' 1, 'lnum' 1`.
- `html { font-size: 16px }` pins Pico's document-oriented root scaling; this is an application.

## Spacing, radii, elevation

- Spacing `--sp-1` 0.25rem → `--sp-7` 3rem.
- Radii `--r-1` 10px, `--r-2` 16px, `--r-3` 26px.
- Tap floor `--tap: 48px`; the FAB is 62px, fan items 54px.
- One `--shadow` token per appearance; `none` in deep night.
- Z-scale: header 10 → nav 20 → scrim 30 → fab 40 → sheet 50 → toast 60.

## Motion

- Durations `--dur-1` 120ms, `--dur-2` 190ms, `--dur-3` 280ms; ease `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint).
- Motion conveys state only; a reduced-motion block is the sole place `!important` is allowed.

## Components

Pico v2 is the framework, imported into `@layer framework` so app styles never out-specify it; 63 of its 149 tokens are mapped in `tokens.css`. Custom components live in `src/styles/components.css`: app shell + header, the live grid (sleep | feed) with its quiet nappy line, sync status line, timeline rows, stale-Sleep banner, FAB + fan (FAB at `bottom: 76px` clearing the tab bar), bottom sheet, segmented control (`[role=tab]`), toast, bottom tab bar (3 destinations), chips + filter rail, stat cards (hand-drawn bars, numbers stated as text), settings, and the chrome-less claim page.

- Forms and standard controls are Pico as shipped.
- Layout is mobile-first, one column, thumb-zone driven; nothing may compete with the FAB.
