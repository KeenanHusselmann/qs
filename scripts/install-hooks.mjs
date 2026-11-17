/**
 * Point git at the hooks this repository ships.
 *
 * ── Why `core.hooksPath` and not a copy into `.git/hooks` ─────────────────────────────────
 *
 * `.git/hooks` is not tracked, so a hook copied into it is a hook that exists on exactly one
 * machine and rots the moment it is edited anywhere else. `core.hooksPath` points git at a
 * directory that **is** tracked, so the guard travels with the repository and a change to it
 * arrives with the next pull like any other file.
 *
 * The cost is that it has to be set once per clone, which is what this is, and why it runs first in
 * `npm run setup` — before `npm ci` and before the migrations, because both of those can fail on a
 * machine that has not started Docker yet and a guard installed only on the happy path is not one.
 *
 * ── It never fails the thing it runs inside ───────────────────────────────────────────────
 *
 * A tarball, a container build, a directory somebody copied rather than cloned: none of those is a
 * git repository, and none of them is a reason `npm run setup` should stop. It says what happened
 * and exits 0.
 */

import { execFileSync } from "node:child_process";

const HOOKS_PATH = ".githooks";

try {
  const current = (() => {
    try {
      return execFileSync("git", ["config", "--get", "core.hooksPath"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // `--get` exits 1 when the key is simply not set, which is the ordinary first-run case.
      return "";
    }
  })();

  if (current === HOOKS_PATH) {
    console.log(`hooks: already pointed at ${HOOKS_PATH}`);
  } else {
    execFileSync("git", ["config", "core.hooksPath", HOOKS_PATH], { stdio: "ignore" });
    console.log(
      `hooks: git will now run ${HOOKS_PATH}/ — pre-push refuses a direct push to platform`,
    );
  }
} catch (error) {
  console.log(
    `hooks: not installed (${error instanceof Error ? error.message : error}). ` +
      "Not a git repository, or git is not on PATH — nothing else depends on this.",
  );
}
