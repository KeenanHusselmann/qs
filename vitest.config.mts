/**
 * Vitest's copy of the one path alias this project has.
 *
 * Everything under `src/` imports by `@/…`, which Next resolves from `tsconfig.json`. Vitest does
 * not read `tsconfig` paths, so until now a module could only be unit-tested if it happened to
 * import nothing — which is a rule about what gets tested rather than what is worth testing, and the
 * wrong way round. `chain.ts` decides whether a step may start; it reads the criteria, the process
 * model and the nav, and it should not have to import them by counting `../`s to be testable.
 *
 * One alias, and it is the same one `tsconfig.json` declares. If a second ever appears, both files
 * need it — which is the argument for never having a second.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
