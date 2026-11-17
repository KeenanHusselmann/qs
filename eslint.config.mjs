import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /**
     * `vercel build`'s output, which is the same compiled bundle as `.next` under another name.
     *
     * Not here originally because the directory only exists after somebody has run `vercel build` —
     * which `npm run functions` asks for. The first time anybody did, `npm run lint` reported 22
     * errors and 2 137 warnings in minified vendor chunks, none of them about a line anybody wrote.
     * A gate that fails on generated output is a gate people learn to ignore.
     */
    ".vercel/**",
  ]),
]);

export default eslintConfig;
