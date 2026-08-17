// Throwaway build step for the prototypes in this directory.
//
// They theme the REAL Pico CSS v2 (ticket 02's recommendation) rather than a
// hand-written imitation of it, so "how much of the framework survives" is
// answered by evidence. Artifacts run under a CSP that blocks external
// stylesheets, so Pico has to be inlined — this script does that, wrapping it
// in `@layer framework` so our own rules win without a single `!important`.
//
//   node build.mjs                       builds every *.src.html
//   node build.mjs timeline-filter       builds one
//
// <name>.src.html  →  <name>.html

import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("./", import.meta.url);
const pico = readFileSync(new URL("pico.min.css", dir), "utf8")
  .replace(/@charset "UTF-8";/, ""); // illegal anywhere but the top of a sheet

const only = process.argv[2];
const sources = readdirSync(dir)
  .filter((f) => f.endsWith(".src.html"))
  .filter((f) => !only || f.startsWith(only));

if (!sources.length) throw new Error(`no .src.html matched ${only ?? "*"}`);

for (const file of sources) {
  const src = readFileSync(new URL(file, dir), "utf8");
  const out = src.replace("/* @@PICO@@ */", `@layer framework {\n${pico}\n}`);
  if (out === src) throw new Error(`marker /* @@PICO@@ */ not found in ${file}`);

  const target = file.replace(".src.html", ".html");
  writeFileSync(new URL(target, dir), out);
  console.log(
    `built ${target} — ${(out.length / 1024).toFixed(0)} KB ` +
      `(${(pico.length / 1024).toFixed(0)} KB of it is Pico)`,
  );
}
