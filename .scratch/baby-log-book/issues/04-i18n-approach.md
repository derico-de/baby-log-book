# i18n for EN, DE and RO

Type: research
Status: resolved

## Question

How should a SvelteKit PWA do i18n for **English, German and Romanian**, with a per-user language preference, working fully offline?

### Candidates to cover

Paraglide JS (inlang), `svelte-i18n`, `typesafe-i18n`, `sveltekit-i18n`, and plain `Intl` with a hand-rolled message map.

### What to weigh

- **Offline**: message catalogues must be available with no network. Anything that fetches translations at runtime needs a caching story, or disqualifies itself.
- **Bundle size**: ideally only the active locale ships, but locale switching must still work offline — those two pull against each other. Say how the recommendation resolves it.
- **Romanian plural rules**: RO has `one`/`few`/`other`, unlike EN and DE. Whichever library wins must handle CLDR plural categories properly, not `n === 1 ? a : b`.
- **Formatting**: relative times ("vor 2 Std", "acum 20 min") are all over this UI — `Intl.RelativeTimeFormat`, `Intl.DateTimeFormat`, `Intl.NumberFormat` for ml and kg.
- **Preference, not URL**: language is a per-user setting, not a route prefix. Check whether the library assumes locale-in-URL and what that costs us.
- **SSR plus client**: `adapter-node` renders on the server; the user's preference lives in their account.
- **Authoring**: how translations are stored and edited in a self-hosted repo, with no translation SaaS.

### Deliverable

A recommendation with reasoning, written to `.scratch/baby-log-book/research/i18n-approach.md`, including how locale switching behaves offline.

## Answer

**Paraglide JS 2 (`@inlang/paraglide-js` 2.24.1)** — the compiler-based rewrite, not the v1 "language tag" API and not an editor product. Catalogues are plain `messages/{en,de,ro}.json` in git; inlang tooling is optional and no account is involved. It is also the SvelteKit team's own add-on (`npx sv add paraglide`).

Findings: [`research/i18n-approach.md`](../research/i18n-approach.md).

### Why

- **Offline is a consequence of its architecture, not a feature we configure.** Messages compile to ESM at build time, Vite bundles them into app chunks, and SvelteKit's documented service worker already precaches those via `cache.addAll(build)`. No loader, no runtime fetch, no `waitLocale()`, no cache key to invent.
- **Romanian plurals are handled properly**: selection is literally `new Intl.PluralRules(locale, options).select(n)` with per-locale category sets, so `ro.json` declares `one`/`few`/`other` while en/de declare two. Verified empirically on Node 24.19: RO gives `20 → other`, `1.5 → few`, `101 → few`.
- **SSR isolation is real**: `paraglideMiddleware()` uses `AsyncLocalStorage` for genuine per-request isolation under `adapter-node`.
- **Preference, not URL**: the default strategy is `["cookie", "globalVariable", "baseLocale"]`. URL routing is opt-in and tree-shaken out when unused.

### Rejected

- **`sveltekit-i18n`** — disqualified outright. Its default parser's complete modifier set is `{ago, currency, date, eq, gt, gte, lt, lte, ne, number}`: no plural modifier, and no `Intl.PluralRules` anywhere in the file. It cannot spell Romanian correctly.
- **`svelte-i18n`** — correct ICU plurals, but its own SvelteKit guide tells you to mutate a process-global `locale` store in `hooks.server.ts`. That is a **cross-request language leak**, which in a multi-user household app means one member's page rendering in another's language. The README concedes the singleton rework hasn't happened.
- **`typesafe-i18n`** — uses `Intl.PluralRules` correctly, but its positional syntax reads three slots as **zero|one|other**, so the obvious Romanian spelling silently renders "2 de minute". Ships no formatters, and its original author died in 2023 (repo now under `codingcommons`).
- **Plain `Intl` + a hand-rolled message map** — the retreat position, not a rejection. Capable of all of it (same plural engine); we would only be writing the `t()`, the missing-key policy and formatter memoisation ourselves.

### Offline locale switching — the answer to the ticket's stated tension

**Ship all three locales.** The bundle-size-vs-offline-switching tension is illusory: switching offline can only ever be served from the precache, so a per-locale bundle would have to precache the other locales anyway. Paraglide's default `message-modules` output tree-shakes per *message* rather than per locale, which is exactly the right granularity.

The switch itself: the preference lives in the account record (already replicated locally), mirrored into a synchronous `$state` rune that a `custom-account` strategy reads. **It must be synchronous** — `getLocale()` silently skips promise-returning custom strategies. A cookie mirror keeps the first SSR paint correct. Switching writes the record, updates cookie and rune, calls `setLocale(next, { reload: false })`, and re-renders via one root `{#key}`.

Deliberately **not** the default reload: offline, a reload is answered from cache, and a cached SSR document has the old language baked into its markup.

### Gaps

`paraglidejs.com` and `tc39.es` were unreachable from the research environment, so all Paraglide claims are read from the published tarball source rather than the docs site. Bundle sizes are not measured — the only figure quoted is the vendor's own, labelled as such.
