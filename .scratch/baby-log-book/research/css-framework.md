# Lightweight CSS framework for the UI

Research for [`issues/02-css-framework.md`](../issues/02-css-framework.md). Date of investigation: **2026-08-15**.

## Recommendation, up front

**Pico CSS v2 as the component baseline, with Open Props as the token layer underneath, and a thin `app.css` of our own for the three things Pico does not have (segmented control, bottom sheet, timeline rows).**

Yes — the answer is *a framework plus a token layer*, exactly as the ticket suspected. But not the way it was phrased in the ticket: Open Props does not supply components at all, so it can never be the thing "with something else for components". It is a scale library. Pico brings the controls; Open Props brings the spacing/radius/shadow/easing scales that Pico lacks and that our custom timeline UI needs.

The honest override cost is roughly **150–250 lines of our own CSS**, and almost all of it is *new* components rather than fighting Pico. Details in [Override cost](#override-cost-being-honest).

The one real reservation is maintenance: Pico's last release was **2025-03-15** and there have been no commits to `main` since. That is discussed frankly under [The Pico maintenance question](#the-pico-maintenance-question) — it is a manageable risk, not a disqualifier, and there is a named exit.

---

## How the sizes in this document were measured

Every size below is a **first-hand measurement**, not a figure quoted from a blog or a badge. Each package was downloaded as its published tarball from the npm registry and measured with `gzip -9`:

```
curl https://registry.npmjs.org/<pkg>/-/<pkg>-<version>.tgz | tar xz
gzip -9 -c package/<file>.css | wc -c
```

The dark-mode mechanisms, custom-property counts, class counts and control heights were likewise read out of the shipped CSS, not from documentation. Where documentation and CSS disagreed, the CSS won.

Versions were resolved from the npm registry metadata (`dist-tags` + `time`), which is authoritative for publish dates; GitHub release pages render relative dates that scrape unreliably.

---

## Comparison table

Sizes are gzipped KB of the minified production file.

| Candidate | Latest (publish date) | Licence | CSS gz | JS needed | Dark mode mechanism | Themeable via custom props | Vocabulary coverage | Maintained |
|---|---|---|---|---|---|---|---|---|
| **Pico CSS** | 2.1.1 (2025-03-15) | MIT | **11.4** | none | `[data-theme]` **and** `prefers-color-scheme`, pure token swap, sets `color-scheme` | **148** `--pico-*` props | forms, buttons, `<dialog>`, switch, range, dropdown, group, nav, card. **No tabs, no sheet, no list rows** | ⚠️ stalled 17 mo |
| **Open Props** | 1.7.23 (2026-01-31) | MIT | **7.5** (tokens) | none | `[data-theme=dark]`/`.dark` switch file + `prefers-color-scheme` | **603** props | **none** — tokens only (+ optional normalize 2.3, buttons 1.2) | ✅ active |
| **Open Props UI** (`opui-css`) | 5.4.2 (2026-06-29) | MIT | **30.6** (19.1 components-only) | none | `light-dark()` + `--color-scheme` via `.ui-light`/`.ui-dark` | Open Props + own theme layer | **full**: Dialog, Drawer, Tabs, ToggleGroup, List, TextField, Select, Switch, Range, Toast | ✅ active, but young |
| **Simple.css** | 2.3.7 (2025-05-29) | MIT | 2.7 | none | `prefers-color-scheme` **only** — no toggle | 16 props | typography + basic forms. No dialog, tabs, or lists | ~ quiet |
| **Water.css** | 2.1.1 (**2021-08-11**) | MIT | 3.5 | none | 91 duplicated `prefers-color-scheme` blocks — **not** a token swap | 21 props | typography + basic forms | ❌ dead 5 yr |
| **Missing.css** | 1.3.0 (2026-04-15) | BSD-2 | 12.5 | none | `light-dark()` + `.-dark-theme`/`.-no-dark-theme` | **340** props | forms, buttons, `<dialog>`, **real ARIA tabs**, nav | ✅ active |
| **Beer CSS** | 5.0.3 (2026-08-04) | MIT | 16.5 | **5.7** (`beer.js`) | `body.dark` token swap — **no** `prefers-color-scheme` at all | 53 (Material 3 system colours) | **full**, incl. `dialog.bottom` (sheet) + `nav.bottom` | ✅ very active |
| **Bulma** | 1.0.4 (2025-04-19) | MIT | **63.7** | none | `[data-theme=dark]`, `.theme-dark`, `prefers-color-scheme` | 1416 props | full, but no dialog/tabs behaviour | ~ slowing |
| **Bootstrap** (CSS-only) | 5.3.8 (2025-08-26) | MIT | **30.1** | **23.2** for modal/tabs | `[data-bs-theme=dark]` — **no** OS auto-detect | 449 `--bs-*` props | full, but modal/tabs/offcanvas are JS components | ✅ active |
| **Shoelace** | 2.20.1 (2025-03-11) | MIT | — | heavy (Lit) | — | — | — | ❌ **archived** |
| **Web Awesome** | 3.11.0 (2026-07-30) | MIT | 6.5 + 2.5 theme | **~201 gz full lib** (Lit, floating-ui, marked…) | `.wa-dark`/`.wa-light`, 179 `--wa-*` props | 179 props | **full**, all free-tier | ✅ active |
| **Franken UI** | 2.1.2 (2026-01-18) | MIT | 25.7 core + **89.2** utilities | UIkit JS | Tailwind theming | via Tailwind config | full | ✅ active |
| **µCSS** | GitHub only, no npm | MIT | ~19 (author's figure) | none | inherits Pico's `data-theme` | inherits Pico's | Pico **+ tabs, modal, toast, accordion** | ⚠️ very new, 107 ★ |

---

## Per-candidate notes

### Pico CSS — *recommended baseline*

- **Licence** MIT ([repo](https://github.com/picocss/pico)).
- **Version** 2.1.1, published **2025-03-15** ([npm registry metadata](https://registry.npmjs.org/@picocss/pico); [releases](https://github.com/picocss/pico/releases)).
- **Size, measured**: `pico.min.css` = 83,319 B raw → **11,630 B gzip (11.4 KB)**. The classless build is 10,328 B (10.1 KB); the conditional build 11,869 B.
- **Dark mode — this is the standout.** Read straight from `css/pico.css`:

  ```css
  @media only screen and (prefers-color-scheme: dark) {
    :root:not([data-theme]),
    :host(:not([data-theme])) {
      color-scheme: dark;
      --pico-background-color: rgb(19, 22.5, 30.5);
      --pico-color: #c2c7d0;
      ...
    }
  }
  ```

  Three things matter here and all three are right. (1) It is a **pure custom-property swap** — the same rules, different token values, no duplicated selectors. (2) `:root:not([data-theme])` means the OS preference applies *only when the user has not chosen*, so `[data-theme="dark"]` and `[data-theme="light"]` override cleanly in both directions. (3) It sets `color-scheme`, so native scrollbars, date pickers and form widgets follow — which matters more than people expect on a 3am phone screen. It also handles `:host()`, so it works inside shadow DOM.

  This is precisely the architecture the ticket calls non-negotiable, and no other candidate does it better.
- **Theming surface**: **148** `--pico-*` properties, covering colours, spacing, typography, radius, border width, focus outline, and per-component groups (`--pico-card-*`, `--pico-form-element-*`, `--pico-switch-*`, `--pico-dropdown-*`).
- **Class-light, not utility-heavy**: the entire stylesheet defines **16** class selectors — `.container`, `.container-fluid`, `.grid`, `.contrast`, `.secondary`, `.outline`, `.dropdown`, `.striped`, `.overflow-auto`, `.close`, `.modal-is-open/-opening/-closing`. Everything else is styled off semantic elements and ARIA roles. This is the single best fit in the field for the brief's hard constraint, and it is exactly how you want to write markup inside Svelte components.
- **Touch sizing — already correct.** From the CSS:

  ```css
  input:not([type=checkbox], [type=radio], [type=range]) {
    height: calc(1rem * var(--pico-line-height)
              + var(--pico-form-element-spacing-vertical) * 2
              + var(--pico-border-width) * 2);
  }
  ```

  With the shipped defaults (`--pico-line-height: 1.5`, `--pico-form-element-spacing-vertical: 0.75rem`, border `1px`) that is 24 + 24 + 2 = **50 px** on a phone, where `--pico-font-size` is 100%. Buttons carry the same padding. That clears the 44 px touch-target floor out of the box, and it is governed by **one token** if we want it bigger.
- **Components present**: forms (all input types, validation states via `aria-invalid`), buttons, `<dialog>` modal, `[role=switch]`, `[role=group]`, `[role=search]`, `[role=button]`, dropdown, accordion via `<details>`/`<summary>`, nav, card via `<article>`, progress, tables.
- **Components absent**: **tabs / segmented control**, **bottom sheet**, **app-style list rows**. `[role=tab]` appears zero times.
- **Accessibility**: 7 `:focus-visible` rules and a focus outline token; 3 `prefers-reduced-motion` blocks; validation styling driven by `aria-invalid` rather than classes. The project claims most colours meet WCAG 2.1 AAA and some muted secondaries AA ([v2 docs](https://picocss.com/docs/v2)).
- **Override friction**: no `@layer` in the shipped file, 20 `!important`, but 46 `:where()` and overwhelmingly element-level selectors, so specificity is low. Importing it into a named layer — `@import "@picocss/pico/css/pico.css" layer(framework);` — removes the ordering question entirely and lets unlayered app CSS win without specificity games.

### Open Props — *recommended token layer*

- **Licence** MIT ([repo](https://github.com/argyleink/open-props)).
- **Version** 1.7.23, published **2026-01-31**; `2.0.0-beta.5` is on the `beta` dist-tag, so a major is in flight ([npm metadata](https://registry.npmjs.org/open-props)). Last commit **2026-08-11** — actively developed.
- **Size, measured**: `open-props.min.css` = 29,566 B raw → **7,664 B gzip (7.5 KB)** for **603** custom properties. `normalize.min.css` 2,321 B gz; `buttons.min.css` 1,252 B gz.
- **It is not a framework.** The package ships 124 CSS files, and the only things resembling components are `normalize.css` (a reset) and `buttons.css`. There is no dialog, no tabs, no form-control styling. **Open Props cannot be the UI baseline** — which settles the ticket's framing: it is a token layer, and needs a partner.
- **Dark mode**: `normalize.css` handles dark via `@media (prefers-color-scheme: dark)` only. But the package *also* ships `theme.dark.switch.min.css`, which gives the explicit hook:

  ```css
  :where([data-theme=dark], .dark, .dark-theme) {
    --text-1: var(--gray-0);
    --surface-1: var(--gray-9);
    ...
    color-scheme: dark;
  }
  ```

  So a user-selectable toggle is available if we want Open Props driving surfaces. In the recommended stack we do **not** use it for that — Pico owns colour and surfaces; Open Props contributes the non-colour scales.
- **What it actually buys us**: `--size-*`, `--radius-*`, `--shadow-*`, `--ease-*`, `--animation-*`, `--font-size-*`, `--border-size-*`, and a large OKLCH/HSL palette. Pico has *no* general spacing or sizing scale beyond `--pico-spacing`, and no easing or animation tokens at all. Our timeline, FAB, sticky header and overdue colour-shift are custom CSS regardless of framework, and that custom CSS wants scales. This is a genuine, non-overlapping addition.
- **No namespace collision**: Pico namespaces everything `--pico-*`; Open Props uses `--size-*`, `--gray-*`, `--ease-*`. They coexist without conflict, and our own tokens can bridge them (`--pico-border-radius: var(--radius-3)`).

### Open Props UI (`opui-css`) — *the strongest runner-up*

This is the most interesting find of the investigation and deserves a serious hearing, because it is *literally* the "Open Props plus components" package the ticket hypothesised.

- **Licence** MIT, © 2026 Felix Bohlin (LICENSE file in the tarball). **Source**: [github.com/felix-bohlin/ui](https://github.com/felix-bohlin/ui).
- **Version** 5.4.2, published **2026-06-29** ([npm metadata](https://registry.npmjs.org/opui-css)). Peer-depends on `open-props ^1`.
- **Size, measured**: `dist/opui.css` = 174,198 B raw → **31,305 B gzip (30.6 KB)** for everything. `dist/opui.components.css` (components without tokens/reset) = **19,510 B gzip (19.1 KB)**. Per-component `@import`s are available so a bundler ships only what is used.
- **Component coverage is the best of any pure-CSS candidate** and maps onto our vocabulary almost exactly: Dialog, **Drawer** (+ DrawerHeader/Footer — that is our bottom sheet), **Tabs** (Tabs/TabsItem/TabsTab/TabsPanel), **ToggleGroup** (segmented control), **List/ListItem**, TextField, Textarea, Select, ClassicSelect, Checkbox, Radio, Switch, Range, Button, ButtonGroup, IconButton, Card, Chip, Badge, Callout, Progress, Toast, Tooltip, Accordion, FieldSet/FieldGroup/FieldLegend/FieldDescription, Table, Divider, Avatar, Anchor.
- **Dark mode is the most modern approach in the field** — `light-dark()` driven by a single variable:

  ```css
  .ui-light { --color-scheme: light; }
  .ui-dark  { --color-scheme: dark; }
  :where(html) {
    color-scheme: var(--color-scheme, light dark);
    --text-primary: light-dark(var(--gray-15), var(--gray-1));
    --text-muted:   light-dark(var(--gray-13), var(--gray-4));
  }
  ```

  Default is `light dark` (follows OS); adding one class pins it. Elegant, and every token is declared once instead of twice.
- **Touch sizing is tokenised properly** — better than anyone else here:

  ```css
  --control-size: 40px;  --control-size-large: 46px;
  --control-size-small: 32px;  --control-size-x-small: 28px;
  --button-size: var(--control-size);  --field-size: var(--control-size);
  ```

  40 px default is *below* the 44 px floor, but it is one token: `--control-size: 48px` fixes buttons, fields and everything derived from them at a stroke. That is the definition of "themeable without fighting the framework".
- **Override story is excellent**: it declares `@layer openprops, theme, normalize, components.root, components.extended, utils;` (53 `@layer` statements, only 4 `!important`) and the README explicitly instructs you to put your own styles in a layer above `utils`. Zero specificity warfare by design.
- **Why it loses anyway** — three reasons, and reason 3 is decisive:
  1. **Maturity.** ~424 stars, effectively a single maintainer, and the project describes itself as "exploring how next-gen HTML & CSS features can change the way we create components". It ships a `MIGRATING.md` and is already at major version 5 — that is a lot of churn for a dependency we want to set and forget on a family app that must keep working at 3am.
  2. **Weight.** 30.6 KB vs Pico's 11.4 KB, for components we will partly replace anyway (our timeline rows are bespoke).
  3. **It is class-based, not semantic.** Usage is `<button class="ui-button ui-primary">`, `.ui-*` throughout. That is *not* utility-class-heavy — these are component classes, so it is not excluded by the brief — but it is a step away from the semantic-HTML posture the brief clearly prefers, and it means every Svelte component carries framework class names that a future migration would have to unpick.
- **This is the named exit.** If Pico's dormancy turns into a real problem, Open Props UI is where we go, and the token layer (Open Props) carries over unchanged.

### Missing.css — *credible, wrong aesthetic*

- **Licence BSD-2-Clause**, © 2022 **Big Sky Software** — the htmx people. That affiliation is a real maintenance signal.
- **Version** 1.3.0, published **2026-04-15** ([npm metadata](https://registry.npmjs.org/missing.css)). Active.
- **Size, measured**: 61,375 B raw → **12,766 B gzip (12.5 KB)**.
- **340** custom properties — more than double Pico's — and **137** classes.
- **Dark mode**: `light-dark()` used 25 times, with `color-scheme: light dark` by default and `.-dark-theme` / `.-no-dark-theme` opt-outs. Clean and modern.
- **It has real tabs**, which Pico does not: `[role=tablist]`, `[role=tab]`, `[role=tabpanel]` are all styled from ARIA roles — the accessible way round. 15 `:focus-visible` rules and a `prefers-reduced-motion` block.
- **Why it loses**: the aesthetic and the sizing are built for documents, not thumbs. Buttons are `font-size: .8rem` with `padding-block: 0`, and the whole system is keyed to a vertical rhythm (`--rhythm`, `1rlh`) rather than to touch targets. Turning that into a one-thumb logging UI means overriding the sizing of every interactive element — a bigger job than adding tabs to Pico. Its house style is also distinctly "brutalist documentation", further from where the prototype landed than Pico's neutral look.

### Simple.css — too little

- MIT, 2.3.7 published **2025-05-29** ([npm metadata](https://registry.npmjs.org/simpledotcss)). Measured **2,790 B gzip (2.7 KB)**.
- Only **16** custom properties and **3** classes. Dark mode is `prefers-color-scheme` **only** — there is exactly one such block and no `[data-theme]` or class hook anywhere in the file, so **a user-selectable dark toggle is impossible without forking it**. That alone fails a non-negotiable requirement.
- No dialog styling to speak of, no tabs, no lists. It is a handsome typography sheet for a blog, not a UI kit for an app. Out.

### Water.css — dead, and architecturally wrong

- MIT, but 2.1.1 was published **2021-08-11** — **five years** without a release ([npm metadata](https://registry.npmjs.org/water.css)). Only 3 versions ever published.
- Measured **3,571 B gzip** (auto build).
- The disqualifier is structural, not just staleness: dark mode is implemented as **91 separate `@media (prefers-color-scheme: dark)` blocks** duplicating rules, rather than one token swap. There are only 21 custom properties, and **zero** `:focus-visible` and **zero** `prefers-reduced-motion` rules in the whole stylesheet. Retheming it means editing 91 media blocks. Firmly out.

### Beer CSS — the interesting near-miss

- MIT, 5.0.3 published **2026-08-04** — eleven days before this investigation, out of **342** published versions ([npm metadata](https://registry.npmjs.org/beercss)). Easily the most actively maintained candidate.
- **Size, measured**: CSS 87,944 B raw → **16,891 B gzip (16.5 KB)**; `beer.min.js` → **5,876 B gzip (5.7 KB)**.
- **It has the two things our phone UI most wants and Pico lacks**: `dialog.bottom` (a genuine bottom sheet) and `nav.bottom` (bottom navigation), plus tabs, lists, chips, fields and menus. Being Material Design 3, its touch targets follow the 48 dp convention.
- **Dark mode is a clean token swap** — `body.dark` redefines the Material system colours:
  ```css
  body.dark { --primary: #cfbcff; --surface: ...; --background: #1c1b1e; ... }
  ```
- **Why it loses**, in order of severity:
  1. **`grep -c 'prefers-color-scheme'` returns 0.** There is no OS-preference detection anywhere in the stylesheet — dark mode only happens if JavaScript adds `body.dark`. For an offline-first PWA that must render correctly before hydration, that risks a white flash at 3am, which is the exact failure the brief calls non-negotiable. Fixable with an inline head script, but it is a fix we would be writing ourselves.
  2. **It requires `beer.js`**, against the brief's "no heavy JS runtime". 5.7 KB is not heavy, but it is a runtime dependency for component behaviour.
  3. **Only 53 custom properties**, and they are Material 3 system colours. Retheming beyond swapping Material's palette means fighting Material. The brief wants to layer *our* design tokens on top; Beer wants us to adopt Material's.
  4. It is thoroughly class-based (`.field`, `.chip`, `.max`, `.bottom`) and its visual identity is unmistakably Material — a strong opinion to inherit.

### Bulma — too big, no behaviour

- MIT, 1.0.4 published **2025-04-19** ([npm metadata](https://registry.npmjs.org/bulma)).
- **Measured 65,219 B gzip — 63.7 KB**, by far the largest CSS-only candidate and 5.6× Pico.
- Bulma 1.x did move to custom properties, and generously: **1,416** `--bulma-*` properties, with `[data-theme=dark]`, `.theme-dark` *and* `prefers-color-scheme` support. Credit where due — the dark-mode mechanism is fine.
- But **3,294** class selectors, and it ships no JavaScript at all, which means its modal and tabs are **appearance only** — you write the open/close and tab-switching logic yourself. So we would pay 63.7 KB and still be writing the behaviour. Out on size-to-value.

### Bootstrap (CSS-only) — the JS is the point

- MIT, 5.3.8 published **2025-08-26** ([npm metadata](https://registry.npmjs.org/bootstrap)).
- **Measured**: CSS 232,111 B raw → **30,786 B gzip (30.1 KB)**; `bootstrap.bundle.min.js` → **23,707 B gzip (23.2 KB)**.
- **449** `--bs-*` properties and a good `[data-bs-theme="dark"]` token swap — but note there is essentially **no `prefers-color-scheme` support**: the attribute is the only mechanism, so OS-following is code we write.
- **2,030** class selectors. The fatal point for a "CSS-only" adoption: modal, tabs, offcanvas, dropdown and collapse are **JavaScript components**. Taking the CSS without the JS means 30.1 KB for styling and then implementing all the behaviour anyway; taking the JS means 53.3 KB total and a runtime the brief rules out. Either way it is the worst of both.

### Shoelace / Web Awesome — excluded on runtime weight

- **Shoelace is finished.** The repository is **archived** (GitHub API reports `archived: true`) and its description now reads "Shoelace is now Web Awesome. Come see what's new!" Last publish 2.20.1 on 2025-03-11. Not a candidate.
- **Web Awesome** is the successor: `@awesome.me/webawesome` 3.11.0, published **2026-07-30**, **MIT**, © Fonticons ([npm metadata](https://registry.npmjs.org/@awesome.me/webawesome); [repo](https://github.com/shoelace-style/webawesome)).
- Good news on licensing: the free MIT package contains the **full** component set we would need — `dialog`, `drawer`, `tab-group`, `tab-panel`, `select`, `input`, `checkbox`, `switch`, `radio-group`, `toast`, `card`, and ~60 more. Nothing in our vocabulary is paywalled.
- Theming is respectable: **179** `--wa-*` properties, `.wa-dark`/`.wa-light`, and a 2.5 KB default theme; `native.css` for styling plain HTML is only **6,693 B gzip (6.5 KB)**.
- **Why it is out**: it is a web-components library with a real JS runtime. Its dependency list includes `lit`, `@floating-ui/dom`, `@lit/context`, `@lit-labs/ssr`, `marked`, `@ctrl/tinycolor` and `nanoid`, and the shipped `dist/chunks` total **~201 KB gzipped** across 293 files. Tree-shaking a handful of components cuts that substantially, but Lit plus floating-ui is still tens of KB before a single component renders. The brief says "no heavy JS runtime", and for an offline-first PWA that must paint a timeline instantly on a cold 3am open, custom elements also introduce upgrade/FOUC handling we would rather not own. Excluded on the brief's own terms, not on quality — it is a good library aimed at a different problem.

### Franken UI — excluded by the brief

- MIT, 2.1.2 published **2026-01-18** ([npm metadata](https://registry.npmjs.org/franken-ui)).
- **It is Tailwind.** Its `package.json` lists `tailwindcss` among its peer dependencies (alongside `postcss`, `postcss-js`, `lodash`), and it ships a `dist/shadcn-ui/` preset and a Tailwind plugin. Measured `utilities.min.css` is **91,336 B gzip — 89.2 KB** of utility classes, on top of a 25.7 KB core; it also builds on UIkit's JavaScript.
- The brief excludes "Tailwind and equivalents". Franken UI is not an equivalent of Tailwind — it *is* Tailwind, with a shadcn-style component preset over it. **Disqualified by the hard constraint**, no further evaluation needed.

### µCSS — worth knowing about, too new to adopt

Surfaced from the Pico maintenance discussion itself, which makes it a useful signal rather than a blog-roundup find.

- MIT, hosted at [github.com/Digicreon/mucss](https://github.com/Digicreon/mucss); site [mucss.org](https://mucss.org/). **Not published to npm** — installation is by file copy, which is a real distribution and update problem.
- It is **Pico v2 plus the missing parts**: it bundles `pico.css` and `pico.colors.css` and adds Accordion, Alert, Badge, Breadcrumb, Card, Hero, **Modal**, Nav, Pagination, Progress, Skeleton, Spinner, **Tabs**, **Toast**. It inherits Pico's `data-theme` dark-mode mechanism unchanged. Author states ~19 KB gzipped.
- ~107 stars, 52 commits, one author, first released 2026. Too young to depend on.
- **But it is a useful proof**: the gap between Pico and a complete app UI is small enough that one person closed it in 52 commits. That is the same gap we are proposing to close with ~200 lines of our own CSS — and µCSS is a good reference to crib from, MIT-licensed, when we write our tabs and modal.

---

## The Pico maintenance question

This must not be glossed over, because it is the one genuine weakness in the recommendation.

**The facts.** Pico v2.1.1 was published **2025-03-15**. The last commit to `main` is the same day. Since then the repository has accumulated only Dependabot branches; there are 124 open issues and ~31 open PRs. The repo is *not* archived, and there is no statement of abandonment — but the maintainer has not shipped in 17 months.

**The community's read.** In [discussion #713](https://github.com/picocss/pico/discussions/713), opened 2025-11-24, a user asked directly whether Pico is still maintained. **No maintainer replied.** The one substantive community response (2026-03-10) put it well:

> "If PicoCSS v2 is effectively 'done', that's not necessarily a problem. It's a solid, stable base."

There is also a community fork, [Yohn/PicoCSS](https://github.com/Yohn/PicoCSS), whose description reads "keeping this alive while original maintainer is missing" — though it too has been quiet since 2025-04.

**Why this is an acceptable risk here.**

1. **CSS does not rot the way JavaScript does.** There is no dependency tree to be exploited, no runtime to break, no npm supply-chain surface at runtime. A stylesheet that renders correctly today renders correctly in three years; browsers break CSS extremely rarely and Pico uses no experimental syntax.
2. **There is no security dimension.** An unmaintained CSS file is not an unmaintained auth library.
3. **It is 11.4 KB of MIT-licensed CSS that we can vendor.** If upstream never moves again, we copy `pico.css` into the repo and own it. That is a genuinely small artefact to adopt — smaller than the app code we are writing for the timeline.
4. **We were going to extend it anyway.** Our tabs, sheet and list rows are ours regardless of who maintains upstream.
5. **There is a named exit** (Open Props UI), and because our own tokens sit in a layer between Pico and our components, switching means re-pointing token mappings rather than rewriting components.

**The trigger to revisit**: if a browser change actually breaks Pico rendering, or if we find ourselves overriding more than roughly half the stylesheet, move to Open Props UI. Neither is likely in v1.

---

## Override cost, being honest

This is the part that decides whether the recommendation survives contact with the app. Taking the [one-thumb logging prototype](https://claude.ai/code/artifact/7a11190e-e5dc-43bd-b568-a6083c901f09) (variant D) as the target — timeline as the screen, one FAB, sticky header with "since last feed" and "next due", overdue shifting colour:

**Free — no work at all:**
- Dark mode. Set `data-theme` on `<html>` from a persisted preference, default to unset so the OS decides. Pico does the rest, including `color-scheme` for native widgets. This is the non-negotiable requirement and it costs us one attribute.
- Form controls at ~50 px tall, already above the 44 px touch floor.
- Buttons, switch, range, `aria-invalid` validation states, focus rings, reduced-motion.

**Cheap — token edits, ~20 lines, no fighting:**
- **Pin the root font size.** Pico scales `--pico-font-size` from 100% up to 131.25% across breakpoints. That is a documentation-site behaviour and wrong for an app; set it to 100% everywhere. One line.
- **Tighten density.** Pico's default `--pico-spacing` and `--pico-block-spacing-*` are generous for a dense timeline. Retune the tokens; do not touch the rules.
- **Enlarge checkboxes/radios/switches.** These are ~1.25 em and are the one control group below a comfortable thumb target. A `--pico-switch-*`-adjacent override plus a width/height bump.
- **Map our brand tokens onto Pico's**: `--pico-primary: var(--brand)`, `--pico-border-radius: var(--radius-3)`. Pico is designed for exactly this.

**Real work — but it is *new* code, not overriding:**
- **Segmented control** (feed / sleep / nappy / solids). Pico has no tabs at all. Build on `[role=tablist]`/`[role=tab]` — the accessible route, and Missing.css and µCSS are both MIT-ish references. **~40–60 lines.**
- **Bottom sheet** for the logging flow. Pico's `<dialog>` is a centred desktop modal, and its open/close animation depends on `.modal-is-open`/`.modal-is-opening` body classes that Pico documents but does not ship JS for. We want a thumb-reachable sheet anyway, so: native `<dialog>` + `::backdrop` + a transform transition, wrapped in a small Svelte action. **~40 lines CSS + ~20 lines JS.**
- **Timeline rows.** Pico styles `<ul>` typographically, not as app list rows. But the timeline *is* the app's distinctive screen — this was always going to be bespoke, so counting it as an override cost would be dishonest. **Not a framework cost.**

**Total: roughly 150–250 lines of our own CSS**, of which the majority is building two components Pico never claimed to have. We are not fighting the framework anywhere. Nothing needs `!important`; Pico's selectors are element-level and low-specificity, and importing it into a layer —

```css
@import "@picocss/pico/css/pico.css" layer(framework);
@import "open-props/style" layer(tokens);
/* our tokens and components stay unlayered, so they always win */
```

— makes the cascade question disappear entirely, including around Pico's 20 `!important` declarations, since a later layer beats an earlier one regardless.

**What we would *not* be overriding:** the colour system, the dark-mode machinery, every form control, focus management, validation styling, and the reset. That is the bulk of the tedious, easy-to-get-wrong work, and it is the reason to take a framework at all.

---

## Sources

Primary sources consulted. Sizes and CSS mechanisms were measured directly from the published npm tarballs as described above.

- Pico CSS: [repo](https://github.com/picocss/pico) · [releases](https://github.com/picocss/pico/releases) · [v2 docs](https://picocss.com/docs/v2) · [npm](https://registry.npmjs.org/@picocss/pico) · [maintenance discussion #713](https://github.com/picocss/pico/discussions/713) · [community fork](https://github.com/Yohn/PicoCSS)
- Open Props: [repo](https://github.com/argyleink/open-props) · [site](https://open-props.style/) · [npm](https://registry.npmjs.org/open-props)
- Open Props UI: [repo](https://github.com/felix-bohlin/ui) · [npm](https://registry.npmjs.org/opui-css) · docs at open-props-ui.netlify.app
- Simple.css: [npm](https://registry.npmjs.org/simpledotcss) · [repo](https://github.com/kevquirk/simple.css)
- Water.css: [npm](https://registry.npmjs.org/water.css) · [repo](https://github.com/kognise/water.css)
- Missing.css: [npm](https://registry.npmjs.org/missing.css) · [site](https://missing.style/)
- Beer CSS: [npm](https://registry.npmjs.org/beercss) · [repo](https://github.com/beercss/beercss)
- Bulma: [npm](https://registry.npmjs.org/bulma) · [repo](https://github.com/jgthms/bulma)
- Bootstrap: [npm](https://registry.npmjs.org/bootstrap) · [repo](https://github.com/twbs/bootstrap)
- Shoelace: [archived repo](https://github.com/shoelace-style/shoelace) · [npm](https://registry.npmjs.org/@shoelace-style/shoelace)
- Web Awesome: [repo](https://github.com/shoelace-style/webawesome) · [npm](https://registry.npmjs.org/@awesome.me/webawesome) · [site](https://webawesome.com/)
- Franken UI: [npm](https://registry.npmjs.org/franken-ui) · [site](https://franken-ui.dev/)
- µCSS: [repo](https://github.com/Digicreon/mucss) · [site](https://mucss.org/) · [author's announcement](https://dev.to/amaury_bouchard/ucss-i-built-a-full-featured-css-framework-on-top-of-picocss-4b4n)
