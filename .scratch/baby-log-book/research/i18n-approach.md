# i18n for EN, DE and RO — approach

Status: **complete** — recommendation below. (Skeleton written first; every section filled
against primary sources, mostly the published package tarballs.)
Ticket: [`issues/04-i18n-approach.md`](../issues/04-i18n-approach.md)
Date of research: 2026-08-15

## Recommendation

**Paraglide JS 2 (`@inlang/paraglide-js`), with a `custom-account` strategy plus a cookie
mirror, all three locales in one bundle, and no reload on switch.**

The short reason: Paraglide is the only candidate for which "works fully offline" is not a
feature we configure but a consequence of how it is built. It compiles `messages/{en,de,ro}.json`
into ordinary ESM before the app ships, so the catalogues arrive in the service worker cache
as part of `cache.addAll(build)` with no loader, no fetch, and no `await`. Every other
candidate makes offline something we have to arrange and then keep verifying.

It also happens to win on the two hard correctness axes:

- **Romanian.** Plural selection is literally `new Intl.PluralRules(locale, options).select(n)`,
  and categories are declared per locale — `ro.json` carries `one`/`few`/`other` while
  `en.json` and `de.json` carry two branches, with no positional encoding to get wrong.
- **Per-request SSR.** `paraglideMiddleware()` uses `AsyncLocalStorage`, so two concurrent
  requests on our single Node process cannot see each other's locale. `svelte-i18n` cannot
  say that.

And it is not a bet on a niche package: it is the SvelteKit team's own i18n add-on
(`npx sv add paraglide`), and 2.24.1 was published the day this was written.

**Decisions that come with it**, so the follow-up ticket has no open questions:

| Decision | Value | Why |
|---|---|---|
| `strategy` | `["custom-account", "cookie", "preferredLanguage", "baseLocale"]` | account preference is authoritative; cookie makes the first SSR paint correct; `navigator.language` seeds new users; `en` is the floor. No `url`. |
| `baseLocale` | `en` | |
| `outputStructure` | `message-modules` (default) | tree-shake per message; all three locales ship |
| Per-locale builds | **no** (`experimentalStaticLocale`, `experimentalMiddlewareLocaleSplitting` off) | both are experimental, and per-locale bundles make offline switching impossible without re-precaching every locale anyway |
| Storage plugin | `@inlang/plugin-message-format`, `pathPattern: "./messages/{locale}.json"` | plain JSON in git, no account, reviewable in a PR |
| Switching | `setLocale(next, { reload: false })` + a root `{#key}` on the locale rune | never reload; a cached SSR document would carry the old language |
| Formatting | the generated `plural` / `number` / `datetime` / `relativetime` registry | translator-reachable `Intl`, validated at compile time |

**Runner-up, and the exit if this goes wrong:** plain `Intl` with a hand-rolled message map.
It is capable of everything above — `Intl.PluralRules` is the same engine — and costs us a
`t()` function, a missing-key policy and per-locale formatter memoisation. If Paraglide's
config surface or its `experimental*` churn ever fights us, that is the retreat, and
migrating out is cheap because the catalogues are already plain JSON keyed by message id.

**Explicitly rejected:** `sveltekit-i18n` (its default parser has no plural modifier at all —
only `eq`/`lt`/`gt` — so Romanian would mean hand-encoding `n % 100 = 1..19` into every
counted string), and `svelte-i18n` (a process-global locale store on a long-lived Node server,
which its own SvelteKit guide instructs you to mutate per request; the README concedes the
singleton rework has not happened). `typesafe-i18n` is technically sound but its positional
plural syntax reads `a|b|c` as `zero|one|other`, so the obvious Romanian spelling is silently
wrong, and it supplies no formatters.

**Residual risks to watch** (none blocking):

- Paraglide's option surface carries several `experimental*` flags and the project moves
  fast — 2.24.1 today. Pin the version and read the changelog on upgrade. We use none of the
  experimental flags, which is the mitigation.
- `reload: false` is described in-source as a "deliberately narrow browser-only escape
  hatch". It is the right tool here (client-rendered, non-URL surface, in-memory session
  state we must not lose — a running feed timer is exactly the "non-restorable in-memory
  work" the docs cite), but it puts re-rendering and `document.lang` on us. Prototype the
  `{#key}` root before committing UI work to it.
- Full ICU must be present in the Docker image, or server-rendered DE/RO silently degrade.
  One assertion in the smoke test.

## Maintenance status, checked today

Queried directly from the npm registry on 2026-08-15 (`npm view <pkg> version time`):

| Package | Latest | Published | Repo |
|---|---|---|---|
| `@inlang/paraglide-js` | **2.24.1** | **2026-08-15** (same day — it went 2.24.0 → 2.24.1 while this was being written) | `opral/paraglide-js` |
| `typesafe-i18n` | 5.27.1 | 2026-02-11 (~6 months) | `codingcommons/typesafe-i18n` (moved from `ivanhofer/…`) |
| `svelte-i18n` | 4.0.1 | 2024-10-21 (~22 months) | `kaisermann/svelte-i18n` |
| `sveltekit-i18n` | 2.4.2 | 2023-07-13 (~3 years) | `sveltekit-i18n/lib` |

None carries an npm `deprecated` flag. Note the two red flags: `sveltekit-i18n`
has had no release in three years (predating SvelteKit 2 entirely), and
`typesafe-i18n`'s repository has moved out of its original author's namespace —
see the per-candidate notes below.

## Candidates

### 1. Paraglide JS (inlang) — `@inlang/paraglide-js` 2.24.1

**What it actually is today.** The ticket is right to be suspicious: inlang has changed
shape repeatedly. As of today it is *not* an editor product you have to adopt, and it is
*not* the old `paraglide-js@1` "language tag" API. Paraglide 2 is a **compiler**. It lives
in its own repository now (`github.com/opral/paraglide-js`, moved out of the `opral/monorepo`),
its docs live at `paraglidejs.com`, and the package is MIT. All facts below are read out of
the published tarball
([`paraglide-js-2.24.1.tgz`](https://registry.npmjs.org/@inlang/paraglide-js/-/paraglide-js-2.24.1.tgz)),
not from the marketing site.

The shape is: JSON catalogues in the repo → a Vite plugin runs the compiler → a generated
`src/paraglide/` directory of plain ESM. Your code imports `m.some_message()` — a real
function, not a runtime dictionary lookup.

**Catalogues are plain JSON in the repo.** Storage is a plugin; the default is
`@inlang/plugin-message-format` (v4.4.3), configured by `project.inlang/settings.json`
with `"pathPattern": "./messages/{locale}.json"`. A simple message is just
`"hello_world": "Hallo Welt!"`. There is no SaaS in the loop — the README states plainly
that inlang tools (Fink, Sherlock, the CLI) are *optional* and "No account required"
([plugin README](https://registry.npmjs.org/@inlang/plugin-message-format/-/plugin-message-format-4.4.3.tgz),
[paraglide README](https://github.com/opral/paraglide-js)).

**Romanian plurals: correct by construction.** The generated `registry.js` is four
one-line functions, and `plural` is literally `Intl.PluralRules`:

```js
export function plural(locale, input, options) {
	return new Intl.PluralRules(locale, options).select(Number(input))
};
```

(`dist/compiler/registry.js` in the tarball.) A plural message is authored per locale, and
**each locale declares only the categories it needs** — so `messages/ro.json` carries three
branches while `en.json` and `de.json` carry two:

```jsonc
// messages/ro.json
{
  "minutes_ago": [{
    "declarations": ["input count", "local countPlural = count: plural"],
    "selectors": ["countPlural"],
    "match": {
      "countPlural=one":   "acum un minut",
      "countPlural=few":   "acum {count} minute",
      "countPlural=other": "acum {count} de minute"
    }
  }]
}
```

This is the property that matters for RO: the category set is not shared across locales
and is not positional, so the `de` particle gets its own branch without contorting `en`.
Ordinals work too — `plural` forwards options to `Intl.PluralRules`, so
`local x = n: plural type=ordinal` is available.

**Locale is not in the URL unless you ask for it.** The default strategy in
`dist/compiler/compiler-options.d.ts` is:

```js
readonly strategy: ["cookie", "globalVariable", "baseLocale"],
readonly cookieName: "PARAGLIDE_LOCALE",
```

The full built-in set is `"cookie" | "baseLocale" | "globalVariable" | "url" |
"preferredLanguage" | "localStorage"`, plus `custom-*` strategies you register with
`defineCustomServerStrategy()` / `defineCustomClientStrategy()`
(`dist/compiler/runtime/strategy.js`). URL routing is opt-in, and the whole `url` branch is
behind a `TREE_SHAKE_URL_STRATEGY_USED` flag — unused, it compiles out. This is the single
best fit for our "preference, not URL" requirement of anything in the list.

Caveat worth knowing before we build on it: a **custom client strategy's `getLocale()` must
be synchronous**. `dist/compiler/runtime/get-locale.js` explicitly skips promise-returning
custom strategies (`// Can't await in sync function, skip async strategies`). So our
strategy must read an already-in-memory value, not do an async IndexedDB read.

**SSR under `adapter-node`.** `paraglideMiddleware(request, cb)` resolves the locale per
request and stores it in **AsyncLocalStorage**; `getLocale()` reads
`serverAsyncLocalStorage?.getStore()?.locale` first (`get-locale.js`). That is genuine
per-request isolation on a long-lived Node process — no module-level mutable locale, which
is exactly the failure mode SvelteKit warns about in
[State management → "Avoid shared state on the server"](https://raw.githubusercontent.com/sveltejs/kit/main/documentation/docs/20-core-concepts/50-state-management.md).

**Official SvelteKit blessing.** `paraglide` is a first-party add-on in the Svelte CLI:
`npx sv add paraglide`, documented at
[`sveltejs/cli` docs/30-add-ons/25-paraglide.md](https://raw.githubusercontent.com/sveltejs/cli/main/documentation/docs/30-add-ons/25-paraglide.md),
implemented at `packages/sv/src/addons/paraglide.ts`. Note that the scaffold wires a
`reroute` hook (i.e. URL routing) — we would drop that and keep the cookie/custom strategy.
There is also `@inlang/paraglide-js-svelte` (v1.0.4) for typed rich-text markup, if we ever
need a link inside a translated sentence.

**Bundle shape — the important detail for us.** With the default
`outputStructure: "message-modules"`, the compiler emits one module per message containing
*every* locale's compiled function, and a dispatcher that switches at call time
(`dist/compiler/compile-bundle.js`, `dist/compiler/output-structure/message-modules.js`):

```js
const en_minutes_ago = (i) => …
const de_minutes_ago = (i) => …
const ro_minutes_ago = (i) => …
export const minutes_ago = ((inputs, options = {}) => {
  const locale = options.locale ?? getLocale()
  if (locale === "en") return en_minutes_ago(inputs)
  if (locale === "de") return de_minutes_ago(inputs)
  return ro_minutes_ago(inputs)
});
```

So tree-shaking is **per message, not per locale**: unused messages vanish, used messages
ship in all three languages. That is the opposite of what "smallest bundle" instinct wants
— and, as argued under [Offline](#offline--service-worker-story), it is exactly what an
offline app wants. (The vendor's own benchmark claims 47 KB for 100 used messages across
5 locales — [paraglidejs.com/benchmark](https://paraglidejs.com/benchmark), vendor-run,
not independently verified here.)

Escape hatches if we ever wanted per-locale bundles: `experimentalStaticLocale` /
per-locale builds, and `experimentalMiddlewareLocaleSplitting`. Both are flagged
experimental in `compiler-options.d.ts`, and the per-locale build path makes
`setLocale(…, { reload: false })` impossible by construction — the compiled code emits
`console.warn("Paraglide: options.locale cannot override a locale-specialized client
bundle; use a full document navigation to switch locales.")`. We do not want them.

### 2. `svelte-i18n` 4.0.1

**Plurals: correct.** It depends on `intl-messageformat` (`^10.5.3`), i.e. full ICU
MessageFormat. Reading the published `intl-messageformat` source, plural selection is
`formatters.getPluralRules(locales, { type: el.pluralType }).select(numericValue - offset)`
with a fallback to `other`
([`intl-messageformat-11.2.13.tgz`, `index.js`](https://registry.npmjs.org/intl-messageformat/-/intl-messageformat-11.2.13.tgz)).
CLDR categories, correct for RO. Formatting helpers (`getNumberFormatter`,
`getDateFormatter`, `getTimeFormatter`) are exported from `dist/runtime.d.ts`.

**Where it loses.** Two things, both structural.

*Maintenance.* The package README's very first line, above the title, is the author's own
notice: "`svelte-i18n` is due to some reworking, like moving from a singleton to instances.
This will be worked on when I find the time and priority 🙏"
([README in the 4.0.1 tarball](https://registry.npmjs.org/svelte-i18n/-/svelte-i18n-4.0.1.tgz)).
Last release 2024-10-21; last push to `kaisermann/svelte-i18n` also 2024-10-21
([GitHub API](https://api.github.com/repos/kaisermann/svelte-i18n)).

*The singleton is not a cosmetic complaint — it is the SSR bug.* The project's own SvelteKit
guide tells you to write this:

```ts
// hooks.server.ts
import { locale } from 'svelte-i18n'
export const handle = async ({ event, resolve }) => {
  const lang = event.request.headers.get('accept-language')?.split(',')[0]
  if (lang) locale.set(lang)      // module-level store, shared by every request
  return resolve(event)
}
```

([`docs/Svelte-Kit.md`](https://raw.githubusercontent.com/kaisermann/svelte-i18n/main/docs/Svelte-Kit.md).)
On `adapter-node` that store is process-global and shared across concurrent requests —
precisely the "Alice's secret leaks to Bob" pattern SvelteKit's
[state-management docs](https://raw.githubusercontent.com/sveltejs/kit/main/documentation/docs/20-core-concepts/50-state-management.md)
tell you never to write. For a household log where the grandmother reads Romanian and the
father reads German, two overlapping requests can render in the wrong language. There is no
supported fix; the fix *is* the reworking the README says has not happened.

Its loading model is also async by default — `register(locale, () => import('./en.json'))`
plus `await waitLocale()` — which is cacheable (see below) but means every locale switch
goes through a promise gate.

### 3. `typesafe-i18n` 5.27.1

**Plurals: correct engine, dangerous syntax.** The runtime does use CLDR categories —
`i18nString = (locale, formatters) => translateString.bind(null, {}, new Intl.PluralRules(locale), formatters)`,
and the selector switches on `zero/one/two/few/many/other` with `few ?? other` and
`many ?? other` fallbacks (`dist/i18n.string.js` in the
[5.27.1 tarball](https://registry.npmjs.org/typesafe-i18n/-/typesafe-i18n-5.27.1.tgz)).

But the authoring syntax is **positional pipe-separated**, and the arity mapping in
`parser/index.mjs` is:

| Slots written | Meaning |
|---|---|
| 1 | `other` |
| 2 | `one` \| `other` |
| 3 | **`zero` \| `one` \| `other`** |
| 4–6 | `zero` \| `one` \| `two` \| `few` \| `many` \| `other` |

That third row is a live trap for Romanian. The natural thing to write for RO is
`{{count:un minut|?? minute|?? de minute}}` — three slots, read by a human as
one/few/other. The parser reads them as **zero/one/other**, and it fails silently: `2`
selects `few`, `few` is undefined, `few ?? other` falls through to the third slot, so `2`
renders "2 de minute". Wrong, and wrong in a way no test that only checks 1 and 20 will
catch. Getting RO right requires the full six-slot form with three empty slots:
`{{count:|un minut||?? minute||?? de minute}}`. Reviewable? Barely.
(`??` is typesafe-i18n's value injection — `REGEX_PLURAL_VALUE_INJECTION = /\?\?/g` in
`dist/i18n.string.js`.)

**Maintenance and continuity.** The README carries the line "Created by Ivan Hofer
(1995–2023)" — the original author died, and the project was handed to a collective. The
old namespace `github.com/ivanhofer/typesafe-i18n` now 404s from the GitHub API; the live
repo is [`codingcommons/typesafe-i18n`](https://api.github.com/repos/codingcommons/typesafe-i18n),
last pushed 2026-03-22, 2.5k stars, 41 open issues. Not abandoned, but the handover is real
and the release cadence has slowed (latest npm publish 2026-02-11).

Other frictions: it is a **code generator** — you run a watcher that regenerates
`i18n-types.ts`, `i18n-util.ts`, `i18n-util.sync.ts`, `i18n-util.async.ts` into your tree,
which is a build step to own. Catalogues are TypeScript objects, not JSON, which is fine for
a dev-authored repo but awkward if a non-developer ever edits Romanian. Formatters are
whatever `Intl` wrappers you write yourself in `formatters.ts` — flexible, but nothing is
provided.

### 4. `sveltekit-i18n` 2.4.2 — **disqualified on plurals**

The umbrella package `sveltekit-i18n` was last published **2023-07-13**, and its two parsers
(`@sveltekit-i18n/parser-default` 1.1.1, `@sveltekit-i18n/parser-icu` 1.0.8) on
**2023-07-12** — before SvelteKit 2 existed. (In fairness: `@sveltekit-i18n/base` 1.3.8 was
published 2026-06-09 and the repo was pushed 2026-08-09, so the core is not dead; the
parsers and the wrapper are frozen. All dates from the npm registry `time` field and the
[GitHub API](https://api.github.com/repos/sveltekit-i18n/lib).)

The decisive finding is in the default parser's source
([`parser-default-1.1.1.tgz`, `dist/index.js`](https://registry.npmjs.org/@sveltekit-i18n/parser-default/-/parser-default-1.1.1.tgz)).
Its complete modifier list is:

```js
{ ago, currency, date, eq, gt, gte, lt, lte, ne, number }
```

**There is no plural modifier and no `Intl.PluralRules` anywhere in the file.** Pluralisation
is meant to be expressed with `eq` / `lt` / `gt` comparisons written by hand *inside each
message*. For English and German that degrades to the `n === 1 ? a : b` the ticket rules out;
for Romanian it would mean hand-encoding `n % 100 = 1..19` into every counted string in the
app. Not viable.

Its formatting modifiers *are* `Intl`-based (`Intl.NumberFormat`, `Intl.DateTimeFormat`,
`Intl.RelativeTimeFormat`), though `ago` carries an odd fixed unit ladder — months are
`13/3` weeks. Swapping in `@sveltekit-i18n/parser-icu` would fix plurals (it delegates to
`intl-messageformat`), but that is a 2023 package wrapping the runtime we'd get anyway, on
top of a library whose loader model is route-keyed async loading
(`loaders: [{ locale, key, routes, loader }]`, `@sveltekit-i18n/base` `dist/index.d.ts`) —
extra machinery built around URL routes, which is the axis we don't want.

### 5. Plain `Intl` + a hand-rolled message map

Genuinely viable, and worth stating why, because it is the honest baseline: `Intl.PluralRules`
is in every browser we target, so `new Intl.PluralRules(locale).select(n)` gives us correct
Romanian categories in one line without any dependency. A hundred lines gets us a
`t(key, params)` over three imported JSON objects, a `Map` of interpolators, and per-locale
memoised `Intl.*` formatters.

What we would be signing up to build and keep correct:

- a plural-category dispatch layer per message (the `{ one, few, other }` object plus the
  lookup with `other` fallback);
- interpolation with escaping;
- **the missing-key and missing-locale story** — silently rendering `undefined` at 3am is
  the failure this app cannot afford;
- no type safety on keys or params, so a renamed key is found by the user, not the compiler;
- no tooling for "which Romanian strings are missing".

That last group is the whole value of the compiler-based option, and Paraglide's generated
output is small enough that we are not buying much runtime in exchange. The hand-rolled map
stays on the table as the *fallback* if Paraglide's config surface turns out to fight us,
not as the first choice.

## Romanian CLDR plural rules (verified against primary data)

From CLDR `common/supplemental/plurals.xml` (locale group `ro mo`) —
[unicode-org/cldr `plurals.xml`](https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/plurals.xml):

| Category | Rule | Integer samples |
|---|---|---|
| `one` | `i = 1 and v = 0` | 1 |
| `few` | `v != 0 or n = 0 or n != 1 and n % 100 = 1..19` | 0, 2~16, 101, 1001, … (decimals: 0.0~1.5, 10.0, 100.0, …) |
| `other` | (fallback) | 20~35, 100, 1000, 10000, … |

For comparison, the group containing `de` and `en` has only:

| Category | Rule | Integer samples |
|---|---|---|
| `one` | `i = 1 and v = 0` | 1 |
| `other` | (fallback) | 0, 2~16, 100, 1000, … |

**What this means concretely for this app.** Romanian is not "singular/plural". It is
three-way and the split is *not* at 1 vs many — it is at 19 vs 20, repeating every
hundred:

- `1 minut` → `one`
- `0 minute`, `2 minute`, … `19 minute`, `101 minute` → `few`
- `20 de minute`, `35 de minute`, `100 de minute` → `other` (note the obligatory
  *de* particle — this is exactly why `other` is a distinct message, not a
  formatting artefact)
- `1,5 minute` → `few`, because `v != 0` (any fractional value is `few`)

That last row is the trap for hand-rolled code: a decimal quantity in Romanian is
`few` even when its numeric value is 1. `n === 1 ? a : b` gets `20 de minute`
wrong, gets `0 minute` wrong, and gets `1,5 minute` wrong. Since this UI shows
"acum 20 de minute" / "120 ml" / "3,5 kg" constantly, all three failure modes are
reachable on the first screen.

The authority for the *runtime* side of this is `Intl.PluralRules`, which is
specified to use CLDR categories and is the same data — see
[MDN: `Intl.PluralRules`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules).
`new Intl.PluralRules('ro').select(20)` returns `"other"`; `.select(19)` returns
`"few"`. Any candidate that delegates plural selection to `Intl.PluralRules` (or
to a compiled ICU MessageFormat / MF2 matcher fed by CLDR) is correct by
construction; any candidate that ships its own hand-written rule table has to be
checked.

## Formatting (relative times, ml/kg)

**None of this needs a library.** `Intl.RelativeTimeFormat`, `Intl.DateTimeFormat` and
`Intl.NumberFormat` are platform APIs; whichever candidate wins, the formatting layer is
the same code. What differs is only whether the library lets a *translator* reach the
options, or whether we call `Intl` from app code and pass the string in as a parameter.

Verified empirically on Node 24.19 with full ICU (`node -e '…'`, the same ICU data the
browsers use) — this is also an independent re-check of the CLDR table above:

```
RO plural categories: [ 'one', 'few', 'other' ]     DE: [ 'one', 'other' ]
  ro 0 → few    ro 1 → one     ro 2 → few    ro 19 → few
  ro 20 → other ro 35 → other  ro 100 → other ro 101 → few   ro 1.5 → few
```

Every boundary predicted from `plurals.xml` holds, including the two that break naive code:
`20 → other` and `1.5 → few`.

The formatters, for the strings this UI actually shows:

| | `en` | `de` | `ro` |
|---|---|---|---|
| `NumberFormat` `style:"unit"`, `unit:"milliliter"`, `unitDisplay:"short"` (120) | `120 mL` | `120 ml` | `120 ml` |
| same, `unit:"kilogram"` (3.5) | `3.5 kg` | `3,5 kg` | `3,5 kg` |
| `RelativeTimeFormat` `{numeric:"auto",style:"short"}` (−20, minute) | `20 min. ago` | `vor 20 Min.` | `acum 20 min.` |
| same (−2, hour) | `2 hr. ago` | `vor 2 Std.` | `acum 2 h` |
| `DateTimeFormat` `{hour:"2-digit",minute:"2-digit"}` | `03:05 AM` | `03:05` | `03:05` |

Three notes that will matter when we build the timeline:

1. **`RelativeTimeFormat` sidesteps the Romanian plural problem entirely for relative
   times.** ICU already knows that `acum 20 min.` needs no `de` — we pass a number and a
   unit, not a pluralised sentence. So the "20 de minute" trap only bites on strings *we*
   write, e.g. "3 feeds today" / "3 alăptări astăzi".
2. **`en` renders millilitres as `mL`, capital L.** That is correct CLDR for en-US and will
   look like a bug to a reviewer. Decide once whether we accept it or hard-code `ml`.
3. `style:"short"` gives RO `acum 2 h`, not `acum 2 ore`. Fine for a dense one-thumb screen;
   worth a deliberate look at `style:"long"` for the "next due" line where it reads as prose.

Reference: [MDN `Intl.PluralRules`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules),
[`Intl.RelativeTimeFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat),
[`Intl.NumberFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat).

**How each candidate exposes them.** Paraglide ships all four as *declaration formatters*
in the generated `registry.js` — `plural`, `number`, `datetime`, `relativetime`, each a
one-line `Intl` wrapper, with option validation at compile time (e.g. `relativetime`
*requires* exactly one `unit`, and rejects `unit=century` with
`Invalid "relativetime" unit "century"` — `dist/compiler/compile-annotation.js`). So a
translator can write

```jsonc
"last_feed_relative": [{
  "declarations": ["input minutes", "local ago = minutes: relativetime unit=minute style=short"],
  "match": { "ago=*": "{ago}" }
}]
```

and change `style` per language without touching Svelte. `svelte-i18n` exposes
`getNumberFormatter` / `getDateFormatter` / `getTimeFormatter` but no relative time.
`sveltekit-i18n`'s default parser has `number`, `date`, `ago`, `currency` modifiers backed
by `Intl`. `typesafe-i18n` provides none — you write `formatters.ts` yourself. The
hand-rolled option is, by definition, all four written by us.

One caveat on Node: `Intl` correctness depends on the container having full ICU. Node ships
full-icu by default in official builds, but a slim/Alpine base image built with
`--with-intl=small-icu` would silently degrade DE and RO to English output on the **server**
render. Worth one assertion in the Docker smoke test:
`new Intl.NumberFormat('de').format(3.5) === '3,5'`.

## Offline / service worker story

### How anything reaches the cache in SvelteKit

SvelteKit auto-registers `src/service-worker.js`, and the `$service-worker` module hands the
worker three lists. The one that matters:

> `export const build: string[]` — "An array of URL strings representing the files generated
> by Vite, suitable for caching with `cache.addAll(build)`. During development, this is an
> empty array."
> — [`packages/kit/src/types/ambient.d.ts`](https://raw.githubusercontent.com/sveltejs/kit/main/packages/kit/src/types/ambient.d.ts)

The documented worker precaches `[...build, ...files]` in its `install` handler and serves
them from cache thereafter
([Service workers docs](https://raw.githubusercontent.com/sveltejs/kit/main/documentation/docs/30-advanced/40-service-workers.md)).
`files` is everything in `static/`. So the precache boundary is exactly: **Vite's build
output plus `static/`.** Anything a library fetches from outside that boundary at runtime —
a CDN, a translation service, an API route — is not covered and needs its own caching story.

### Why Paraglide needs no caching story at all

The catalogues never reach the service worker cache *as catalogues*. The compiler turns
`messages/{en,de,ro}.json` into ESM at build time; Vite bundles that ESM into ordinary app
chunks; those chunks are in `build`; `cache.addAll(build)` already stores them. There is no
locale fetch to intercept, no `waitLocale()` to await, no cache key to invent, and no
possible state where the app is running but a translation is missing. The JSON files never
ship — they are compiler input, like `.svelte` files.

This is also why the **bundle-size vs. offline-switching tension resolves in favour of
shipping everything**, and it is worth being explicit that the two goals are not merely in
tension but mutually exclusive:

- If only the active locale ships, switching offline requires loading another locale's code.
- Offline, that load can only be served from the precache.
- So the other locales must be precached anyway — at which point nothing was saved on the
  wire, only on parse/execute.

Per-locale shipping only pays off for an *online* app that will mostly never switch. Ours is
offline-first with **three** locales and a preference users genuinely flip (a Romanian
grandmother borrowing the father's phone is the motivating case). So: ship all three, which
is Paraglide's default `message-modules` behaviour, and stop thinking about it. The cost is
bounded — messages are tree-shaken per message, so it scales with *screens built*, not with
catalogue size, and only ~2× the single-locale message weight for the two extra languages.

### How locale switching actually behaves offline

The default `setLocale()` performs a full document reload
(`window.location.reload()` when the URL strategy is off — `dist/compiler/runtime/set-locale.js`).
**We should not use the default here**, and the reason is specifically an offline one:
offline, a reload is answered by the service worker from cache. If what we cached is an
SSR-rendered document, that HTML has the *old* language baked into its markup, so the user
sees a flash of the previous language until hydration corrects it — or a hydration mismatch.
Avoid the whole class of problem by never reloading on switch.

Concretely, the flow we should build:

1. **Preference lives in the account record**, which is already replicated to the device
   (map: "the household's entire log replicated locally", long-lived sessions). Offline, the
   locale is known locally with no server contact.
2. **A module-level reactive mirror** — a `$state` rune holding the current locale, seeded
   at boot from the local replica. This has to be synchronous: Paraglide's `getLocale()`
   silently *skips* any custom client strategy whose `getLocale()` returns a promise
   (`dist/compiler/runtime/get-locale.js`), so an async IndexedDB read is not an option here.
3. **Strategy order** `["custom-account", "cookie", "preferredLanguage", "baseLocale"]`.
   `custom-account` is authoritative; the cookie is a *mirror* written on every change so the
   very first server render of a cold, online load is already correct before any JS runs;
   `preferredLanguage` (`navigator.language`) is the sensible default for a brand-new user;
   `baseLocale` (`en`) is the floor.
4. **Switching** = write the new locale to the local account record (queued for sync like any
   other write), update the mirror cookie, set the `$state` rune, and call
   `setLocale(next, { reload: false })`. Then re-render the tree — Paraglide's message
   functions are plain calls and are not reactive on their own, and the API docs say so
   outright: `reload: false` "does not re-render the UI or update the document". In Svelte
   the idiomatic fix is one `{#key}` block at the root keyed on the locale rune, plus setting
   `document.documentElement.lang` (and `dir`, via Paraglide's `getTextDirection()`) by hand.
5. **Net effect offline**: zero network, zero navigation, zero cache lookups. All three
   locales are already in memory; the switch is a re-render. It behaves identically online
   and offline, which is the property we want — no code path that only works with a server.

Two consequences worth writing down now:

- **Offline there is no SSR at all** — navigations are served by the worker, so the locale
  decision is entirely client-side. That is another reason the client strategy must not
  depend on a server round-trip, and a reason to treat the cookie as a mirror rather than the
  source of truth.
- **On PWA update**, a new deployment changes `version`, so a fresh cache is filled with a
  fresh bundle containing all three locales together. Catalogues can never be stale relative
  to the code that calls them, because they *are* the code. This removes a whole category of
  bug that a JSON-fetching library would create (new app version, cached old `ro.json`).

### If we had picked a runtime library instead

For completeness, since it is the reason the others lose ground here rather than
disqualifying themselves: `svelte-i18n`'s `register(locale, () => import('./ro.json'))` and
`sveltekit-i18n`'s async `loaders` both go through Vite, so their catalogue chunks do land
in the build output and would be precached. It is *workable*. But it costs us a
verification burden (assert on every build that each locale's chunk is in `build`), an
`await waitLocale()` gate on every switch, and — with `sveltekit-i18n` — a route-keyed
loader model that must be told to load everything eagerly, defeating its own design. Paraglide
removes the question rather than answering it.

## Comparison table

Scored against the ticket's seven criteria. ✅ = fits with no work, ⚠️ = works but costs us
something, ❌ = fails or would have to be built.

| | Paraglide 2 | `svelte-i18n` | `typesafe-i18n` | `sveltekit-i18n` | Plain `Intl` |
|---|---|---|---|---|---|
| **(a) Offline catalogues** | ✅ compiled into app chunks; in `build`, precached by definition | ⚠️ async chunks; workable, must be verified + `waitLocale()` gate | ⚠️ generated `.sync`/`.async` variants; sync mode works | ⚠️ async route-keyed loaders, must be forced eager | ✅ static imports |
| **(b) Bundle vs. offline switching** | ✅ tree-shakes per *message*; all 3 locales ship — exactly what offline wants | ⚠️ full ICU parser + runtime always ships | ✅ ~1 KB runtime | ⚠️ runtime + parser | ✅ smallest |
| **(c) RO `one`/`few`/`other`** | ✅ `Intl.PluralRules`; per-locale category sets | ✅ ICU via `intl-messageformat` → `Intl.PluralRules` | ⚠️ correct engine, but 3-slot syntax silently means `zero\|one\|other` — RO needs 6 slots | ❌ **no plural modifier at all**; only `eq`/`lt`/`gt` | ⚠️ correct if we build the dispatch ourselves |
| **(d) `Intl` Relative/DateTime/Number** | ✅ all four in the generated registry, translator-reachable | ⚠️ number/date/time; no relative time | ❌ none; write `formatters.ts` | ✅ `number`/`date`/`ago`, but quirky unit ladder | ✅ direct |
| **(e) Preference, not URL** | ✅ default strategy is `["cookie","globalVariable","baseLocale"]`; `url` is opt-in and tree-shaken away | ✅ locale is a store | ✅ locale is a parameter | ⚠️ loaders are keyed by `routes` | ✅ |
| **(f) SSR on `adapter-node`** | ✅ `paraglideMiddleware` + AsyncLocalStorage → real per-request isolation | ❌ **process-global singleton store**; its own SvelteKit guide tells you to `locale.set()` in `hooks.server.ts` | ✅ per-request `L` instance | ⚠️ instance-per-request possible, docs thin | ⚠️ ours to get right |
| **(g) Authoring, no SaaS** | ✅ plain JSON per locale in the repo; inlang tooling optional, no account | ✅ plain JSON | ⚠️ TypeScript objects + a codegen watcher to own | ✅ plain JSON/JS | ✅ plain JSON |
| **Maintained** | ✅ 2.24.1, published today; official `sv add paraglide` | ❌ last release 2024-10; README admits a rework is pending | ⚠️ author died 2023, repo handed to `codingcommons`; last publish 2026-02 | ⚠️ core alive (2026-06) but wrapper + parsers frozen at 2023-07 | n/a |

The two rows that decide it are **(c)** and **(f)**. `sveltekit-i18n` fails (c) outright.
`svelte-i18n` fails (f) in a way that produces a wrong-language render for a *different
user*, on the exact multi-user, multi-language household this app is for. `typesafe-i18n`
passes everything but leaves a silent Romanian correctness trap in the authoring syntax and
gives us nothing for formatting. Plain `Intl` passes on capability and loses only on the
work we would do ourselves — which is real work, in the part of the app (message plumbing)
that has no user-visible payoff.

## Sources

All primary. Where a claim is about how a library *behaves*, it was read out of the published
npm tarball rather than from documentation, and the file is named.

**Unicode / CLDR**

- [`common/supplemental/plurals.xml`](https://raw.githubusercontent.com/unicode-org/cldr/main/common/supplemental/plurals.xml)
  — `<pluralRules locales="mo ro">` (RO one/few/other) and `locales="ast de en et fi …"` (DE/EN one/other).
- Re-verified empirically against ICU via `Intl.PluralRules` on Node 24.19 (see [Formatting](#formatting-relative-times-mlkg)).
- [MDN `Intl.PluralRules`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules) ·
  [`Intl.RelativeTimeFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat) ·
  [`Intl.NumberFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat) ·
  [`Intl.DateTimeFormat`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat)

**Paraglide / inlang**

- Tarball [`@inlang/paraglide-js@2.24.1`](https://registry.npmjs.org/@inlang/paraglide-js/-/paraglide-js-2.24.1.tgz):
  `dist/compiler/registry.js` (the four `Intl` formatters),
  `dist/compiler/compiler-options.d.ts` (`defaultCompilerOptions`, `outputStructure`, `experimental*`),
  `dist/compiler/runtime/strategy.js` (built-in + `custom-*` strategies),
  `dist/compiler/runtime/get-locale.js` (AsyncLocalStorage on the server; async custom strategies skipped),
  `dist/compiler/runtime/set-locale.js` (`reload` behaviour, cookie write, `navigateOrReload`),
  `dist/compiler/compile-bundle.js` + `dist/compiler/output-structure/message-modules.js` (per-message dispatcher over all locales),
  `dist/compiler/compile-annotation.js` (`relativetime` unit validation),
  `README.md`.
- Repo: [`github.com/opral/paraglide-js`](https://github.com/opral/paraglide-js). Registry metadata: `https://registry.npmjs.org/@inlang/paraglide-js/latest`.
- Tarball [`@inlang/plugin-message-format@4.4.3`](https://registry.npmjs.org/@inlang/plugin-message-format/-/plugin-message-format-4.4.3.tgz)
  — `README.md`: `pathPattern`, simple vs. complex messages, `declarations`/`selectors`/`match`, `plural type=ordinal`.
- [`@inlang/paraglide-js-svelte@1.0.4`](https://registry.npmjs.org/@inlang/paraglide-js-svelte/latest).
- Vendor benchmark claim (**not** independently verified): `https://paraglidejs.com/benchmark`.

**SvelteKit**

- [`documentation/docs/30-advanced/40-service-workers.md`](https://raw.githubusercontent.com/sveltejs/kit/main/documentation/docs/30-advanced/40-service-workers.md)
  — auto-registration, `cache.addAll([...build, ...files])` in `install`.
- [`packages/kit/src/types/ambient.d.ts`](https://raw.githubusercontent.com/sveltejs/kit/main/packages/kit/src/types/ambient.d.ts)
  — the `$service-worker` module: definition of `build`, `files`, `version`, `base`.
- [`documentation/docs/20-core-concepts/50-state-management.md`](https://raw.githubusercontent.com/sveltejs/kit/main/documentation/docs/20-core-concepts/50-state-management.md)
  — "Avoid shared state on the server".
- [`sveltejs/cli` docs/30-add-ons/25-paraglide.md](https://raw.githubusercontent.com/sveltejs/cli/main/documentation/docs/30-add-ons/25-paraglide.md)
  and [`packages/sv/src/addons/paraglide.ts`](https://raw.githubusercontent.com/sveltejs/cli/main/packages/sv/src/addons/paraglide.ts).

**`svelte-i18n`**

- Tarball [`svelte-i18n@4.0.1`](https://registry.npmjs.org/svelte-i18n/-/svelte-i18n-4.0.1.tgz)
  — `README.md` (the "due to some reworking" notice), `package.json` (`intl-messageformat: ^10.5.3`), `dist/runtime.d.ts` (exports).
- [`docs/Svelte-Kit.md`](https://raw.githubusercontent.com/kaisermann/svelte-i18n/main/docs/Svelte-Kit.md)
  — the `locale.set()`-in-`hooks.server.ts` pattern.
- [GitHub API `kaisermann/svelte-i18n`](https://api.github.com/repos/kaisermann/svelte-i18n) — `pushed_at` 2024-10-21.
- Tarball [`intl-messageformat@11.2.13`](https://registry.npmjs.org/intl-messageformat/-/intl-messageformat-11.2.13.tgz),
  `index.js` — `getPluralRules(locales, {type}).select(...)` with `other` fallback.

**`typesafe-i18n`**

- Tarball [`typesafe-i18n@5.27.1`](https://registry.npmjs.org/typesafe-i18n/-/typesafe-i18n-5.27.1.tgz):
  `dist/i18n.string.js` (`new Intl.PluralRules(locale)`, `getPlural` switch with `few ?? other`),
  `parser/index.mjs` (`parsePluralPart` — the 1/2/3/6-slot arity mapping),
  `README.md` ("Created by Ivan Hofer (1995-2023)").
- [GitHub API `codingcommons/typesafe-i18n`](https://api.github.com/repos/codingcommons/typesafe-i18n) — live repo, `pushed_at` 2026-03-22.
  `https://api.github.com/repos/ivanhofer/typesafe-i18n` returns Not Found (namespace transferred).

**`sveltekit-i18n`**

- Tarball [`@sveltekit-i18n/parser-default@1.1.1`](https://registry.npmjs.org/@sveltekit-i18n/parser-default/-/parser-default-1.1.1.tgz),
  `dist/index.js` — complete modifier set `{ago, currency, date, eq, gt, gte, lt, lte, ne, number}`; no `Intl.PluralRules`.
- Tarball [`@sveltekit-i18n/base@1.3.8`](https://registry.npmjs.org/@sveltekit-i18n/base/-/base-1.3.8.tgz), `dist/index.d.ts` — `loaders`/`routes` model.
- Registry publish times: `sveltekit-i18n` 2.4.2 → 2023-07-13, `parser-default` 1.1.1 → 2023-07-12,
  `parser-icu` 1.0.8 → 2023-07-12, `base` 1.3.8 → 2026-06-09.
  [GitHub API `sveltekit-i18n/lib`](https://api.github.com/repos/sveltekit-i18n/lib) — `pushed_at` 2026-08-09.

### Gaps

- `paraglidejs.com` (the Paraglide documentation site) and `tc39.es` were **unreachable from
  this environment**. Everything attributed to Paraglide above is therefore read from the
  published package source rather than the docs site, which is the stronger source anyway;
  but the docs pages on strategies, variants and SSR should be skimmed once by a human before
  implementation, in case they document behaviour the source does not make obvious.
- The `ECMA-402` sanctioned-unit table was not fetched (tc39.es timed out); `milliliter` and
  `kilogram` were instead confirmed to work by running `Intl.NumberFormat` directly.
- Bundle sizes are **not measured**. The only size figure quoted is the vendor's own
  benchmark, labelled as such. Measure `en+de+ro` for real once there are a hundred messages.
