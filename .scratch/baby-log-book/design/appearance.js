/* =====================================================================
   Baby Log Book — the appearance resolver.
   docs/adr/0008-appearance-follows-the-clock.md

   This must run INLINE in <head>, before the first paint. It is the only
   script permitted to block paint: the whole point of the rule is that the
   app is never briefly light in a dark bedroom, and a resolver that runs
   after paint produces exactly the white flash it exists to prevent.

   Boundaries (ADR-0008). Only Day Start is configurable; the rest are
   literal hours by design.

       23:00 ──────── Day Start (05:00)   deep night
       Day Start ──── 07:00               night
       07:00 ──────── 19:00               day, unless the phone says dark
       19:00 ──────── 23:00               night

   ===================================================================== */

(function () {
  "use strict";

  var DEEP_FROM = 23 * 60; // 23:00
  var MORNING = 7 * 60; //  07:00
  var EVENING = 19 * 60; //  19:00

  function minutes(hhmm) {
    var p = String(hhmm || "05:00").split(":");
    return Number(p[0]) * 60 + Number(p[1] || 0);
  }

  /* `override` is the Member's Appearance setting: "auto" | "day" | "night".
     There is deliberately no "deep" — deep night is a concession to a
     moment, not a taste. `dayStart` is the Household's Day Start. */
  function resolve(now, dayStart, override) {
    if (override === "day") return "day";
    if (override === "night") return "night";

    var m = now.getHours() * 60 + now.getMinutes();
    var start = minutes(dayStart);

    if (m >= DEEP_FROM || m < start) return "deep";
    if (m < MORNING || m >= EVENING) return "night";

    /* Daylight hours. The clock can only ever make it darker, never
       lighter, so a phone set to dark mode keeps a dark app at noon. */
    return matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
  }

  function apply() {
    /* Read from wherever settings land; these are the fallbacks that make
       the resolver correct on a cold first paint, before any replica has
       been read. */
    var dayStart = window.__dayStart || "05:00";
    var override = window.__appearance || "auto";

    var appearance = resolve(new Date(), dayStart, override);
    var root = document.documentElement;

    root.setAttribute("data-appearance", appearance);
    /* Pico keys its select, date and time icon assets off `data-theme`, so
       the 86 tokens we do not map still land on the right side. */
    root.setAttribute("data-theme", appearance === "day" ? "light" : "dark");
    root.style.colorScheme = appearance === "day" ? "light" : "dark";
  }

  apply();

  /* The appearance changes under a Member who is already looking at the
     screen — 22:58 is night and 23:02 is deep night. */
  setInterval(apply, 60000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) apply();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply);

  window.__resolveAppearance = resolve; /* exported for tests */
})();
