/**
 * Every design token a component asks for is defined — PLATFORM.md §7.2.
 *
 * ── The detector this file exists to be ────────────────────────────────────────────────────
 *
 * `--ok-700` and `--warn-500` were referenced thirty-nine and thirty-six times across the run panel,
 * the checklist, the chain badges and the import window, and neither was ever declared. CSS treats
 * an undefined custom property as **invalid at computed-value time**: the declaration is thrown
 * away and the property inherits, so `color: var(--ok-700)` rendered as body grey. Every "Signed
 * off" green and every amber refusal in the platform was colourless, in exactly the places §7.1 #5
 * leans on state being legible at a glance.
 *
 * Seventeen browser suites went past it, because this defect has no text. A screenshot would have
 * caught it and nothing else would — so the check is here instead, where it is a string comparison
 * that runs on every commit and cannot be flaky.
 *
 * The failure it prevents is the quiet kind: a token misspelt in a component still renders, still
 * lays out, still passes, and is simply the wrong colour for ever.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const STYLESHEET = join(SRC, "app", "globals.css");

/**
 * Set at runtime by `next/font`, not in the stylesheet. The only legitimate reference to a token
 * this file cannot see, and it is named rather than pattern-matched so a second one has to be
 * argued for.
 */
const DEFINED_ELSEWHERE = new Set(["--font-inter"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry) ? [path] : [];
  });
}

describe("design tokens", () => {
  const stylesheet = readFileSync(STYLESHEET, "utf8");

  // Declarations, not references: `--ok-700: #166638`, never `var(--ok-700)`.
  const defined = new Set(
    [...stylesheet.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(([, token]) => token),
  );

  it("declares every token any component references", () => {
    const missing = new Map<string, string[]>();

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");

      for (const [, token] of source.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        if (defined.has(token) || DEFINED_ELSEWHERE.has(token)) continue;
        missing.set(token, [...(missing.get(token) ?? []), file.replace(process.cwd(), "")]);
      }
    }

    expect(
      [...missing].map(([token, files]) => `${token} — used in ${files.length} file(s), e.g. ${files[0]}`),
    ).toEqual([]);
  });

  it("carries the semantic families §7.2 fixes, so no screen has to improvise one", () => {
    for (const family of ["ok", "warn", "err"]) {
      for (const step of [50, 500, 700]) {
        expect(defined.has(`--${family}-${step}`), `--${family}-${step}`).toBe(true);
      }
    }
  });

  it("gives numeric text tabular figures", () => {
    // §7.2 requires Inter *because* of its tabular figures; the class that asks for them is what
    // makes a column of rands scannable, and it spent four screens defining nothing.
    expect(stylesheet).toMatch(/\.num\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });
});
