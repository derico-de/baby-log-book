/* ADR-0012: the app is a precached shell and the server renders no UI.

   `ssr = false` because there is no server-owned data to render — the server
   may not hold the Entry a Member logged thirty seconds ago. `prerender`
   makes the shell and its hashed chunks one atomic versioned unit, which is
   what deletes the old-page-404s-on-a-new-chunk-name bug rather than
   mitigating it. */
export const ssr = false;
export const prerender = true;
export const trailingSlash = 'never';
