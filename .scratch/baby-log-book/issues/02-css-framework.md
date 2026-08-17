# Lightweight CSS framework for the UI

Type: research
Status: resolved

## Question

Which lightweight CSS framework should provide the UI element baseline, given the brief's hard constraint: **pure CSS with custom properties, not utility-class-heavy**?

Tailwind and equivalents are excluded by the brief. We want something that gives uniform, decent-looking, accessible controls out of the box and gets themed through custom properties.

### What we need from it

- Form controls, buttons, dialogs/sheets, tabs or segmented controls, lists — the vocabulary of a logging app.
- Touch-first sizing; one-handed phone use is the primary case, tablet and desktop browser secondary.
- Dark mode driven by custom properties (3am use makes this non-negotiable).
- Themeable without fighting the framework — we will layer our own design tokens on top.
- Works cleanly inside Svelte components; no jQuery, no heavy JS runtime.
- Small. Accessible. Maintained.

### Candidates to cover

Pico CSS, Open Props, Simple.css, Water.css, Missing.css, Beer CSS, Bulma, Bootstrap (CSS-only), Shoelace / Web Awesome (web components), Franken UI. Add anything current that fits — this space moves.

Consider explicitly whether the answer is **a framework plus a token layer** (e.g. Open Props for tokens, something else for components) rather than one library.

### Deliverable

A comparison plus a recommendation, written to `.scratch/baby-log-book/research/css-framework.md`, including how the recommended option handles dark mode and how much of it we would end up overriding.

## Answer

**Pico CSS v2 for components + Open Props for tokens + ~200 lines of our own CSS.**

Findings: [`research/css-framework.md`](../research/css-framework.md). Sizes there were measured from the packages as published on npm, not quoted from docs — which is how several of the disqualifications below were caught.

### Why

- **Framework-plus-token-layer is the right shape**, but not as this ticket framed it. Open Props ships **no components** — a reset and buttons — so it can never be the component half. Pico brings the controls; Open Props brings the spacing/radius/easing scales Pico lacks and our bespoke timeline needs. The namespaces don't collide.
- **Pico's dark mode is exactly the architecture we specified**: a pure custom-property swap under `:root:not([data-theme])` inside `prefers-color-scheme`, so the OS preference applies only until the user chooses one, plus `color-scheme` so native widgets follow. No JS, so no white flash at 3am.
- **16 class selectors in the entire stylesheet** — the closest thing in the field to "not utility-class-heavy". 11.4 KB gzipped. Inputs compute to ~50px tall on a phone from one token, already clear of the 44px touch floor.

### Rejected

- **Open Props UI (`opui-css`)** — the strongest challenger and the named exit if Pico goes bad: better component coverage (Drawer, Tabs, ToggleGroup, List), `light-dark()` theming, a `--control-size` token. Lost on being class-based, 30.6 KB, one maintainer, ~424 stars, and already on a v5 migration.
- **Beer CSS** — has bottom sheets and Material touch targets, but zero `prefers-color-scheme` rules: dark mode needs JS.
- **Web Awesome** — free tier covers every component we need, but ~201 KB gz of Lit and floating-ui runtime.
- **Franken UI** — disqualified outright: `tailwindcss` is a peer dependency. It *is* Tailwind, which the brief excludes.
- **Water.css** — dead since 2021, dark mode as 91 duplicated media blocks. **Simple.css** — no dark toggle hook, so a user-chosen theme needs a fork. **Bulma / Bootstrap CSS-only** — too big, and Bootstrap's value is the JS we aren't taking.

### Accepted risk

Pico's last release was 2025-03-15 and `main` has had no commits since; a "is this maintained?" discussion drew no maintainer reply. Accepted: 11.4 KB of MIT CSS with no runtime and no security surface, vendorable if upstream stays dead. **Revisit trigger** — if we need a component Pico lacks *and* upstream is still silent, move to Open Props UI rather than forking.

### Override cost

~150–250 lines, and most of it is *new* components rather than fighting Pico: a segmented control (~50 lines — Pico has no `[role=tab]` rules at all) and a bottom sheet (~60 lines). The rest is cheap token work: pin the root font size (Pico scales it to 131.25% on wide screens, wrong for an app), tighten density, enlarge checkboxes. Importing with `@import ... layer(framework)` makes Pico's 20 `!important` declarations irrelevant.
