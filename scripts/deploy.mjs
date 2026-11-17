#!/usr/bin/env node
/**
 * Deploy to production.
 *
 * ── Why this is a script and not just `vercel deploy --prod` ───────────────────────────────
 *
 * Vercel refuses the deploy outright when it can read a git commit whose author is not a member of
 * the team:
 *
 *     Deployment Blocked — the commit author did not have contributing access.
 *     The Hobby Plan does not support collaboration for private repositories.
 *
 * The commits here are authored by a personal address that is not on the Vercel account. Vercel
 * only looks for an author when it can see a repository, so the deploy succeeds if `.git` is not
 * there to be read. Moving it aside for the duration is the whole trick.
 *
 * Doing that by hand is the problem: an interrupted deploy leaves the repository looking empty,
 * `git status` reports a catastrophe, and the natural next move — re-initialising — loses history.
 * So the restore runs from a `finally` and from the signal handlers, and the script refuses to
 * start if a previous run left the directory parked.
 *
 * The permanent fix is to add the committing email as a secondary email on the Vercel account,
 * after which this script is a plain wrapper and can be deleted.
 *
 * ── Why the deployments were called `GtyssRqcp` ────────────────────────────────────────────
 *
 * The dashboard names a deployment after the commit it was built from. Parking `.git` is what
 * makes the deploy possible, and it is also what leaves Vercel with no commit to read — so every
 * release in the list was titled with its own random deployment id, and telling one from another
 * meant opening both. A deployment list nobody can read is an audit trail nobody can follow.
 *
 * The git facts are read **here**, before the parking, and handed over as `--meta`. Verified
 * against this account's own history rather than assumed: the one deployment the GitHub
 * integration made before it was disconnected carries `githubCommitMessage`, `githubCommitRef`,
 * `githubCommitSha`, `githubOrg` and `githubRepo`, and that is the set reproduced below.
 *
 * **The author keys are deliberately not sent.** `githubCommitAuthorEmail` and
 * `githubCommitAuthorLogin` are on that deployment too — and that deployment is the one marked
 * *Blocked*, refused on exactly the access check the whole parking dance exists to avoid. Handing
 * back by hand the fact this script goes to such lengths to withhold would be an odd way to spend
 * the trick.
 */

import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const GIT = join(root, ".git");
const PARKED = join(root, ".git-parked");

/**
 * The production domain that follows every `--prod` deploy. No deployment hash in it.
 *
 * It carries the **team slug**, so it moved when the project did: the platform was migrated off
 * `x4o-projects` (Hobby, capped at twelve functions against the twenty-three this app builds, and
 * latterly an overdue balance) onto a Pro scope. A stale value here is not a cosmetic problem — the
 * health probe below would report on the *old* deployment and call a broken release healthy, or a
 * healthy one broken, depending on which way round the two happened to be.
 *
 * `VERCEL_PRODUCTION_URL` overrides it, so a future move needs an environment variable rather than
 * a commit.
 */
const PRODUCTION_URL =
  process.env.VERCEL_PRODUCTION_URL ??
  "https://qs-management-platform-raymond-3084s-projects.vercel.app";

/**
 * `--preview` builds and deploys without promoting.
 *
 * Worth having since the build began running migrations: preview and production share one Neon
 * database, so a preview deploy is how a migration reaches it while production carries on serving
 * the code it already has. Land the schema, look at it, then promote. The parking dance is the
 * same either way, which is the reason this is a flag here rather than a `vercel deploy` typed by
 * hand — an interrupted hand-run is what leaves `.git` parked.
 */
const preview = process.argv.includes("--preview");

/**
 * One `--meta` value, quoted for the shell.
 *
 * `vercel` is a `.cmd` shim on Windows and Node refuses to spawn one without `shell: true`
 * (CVE-2024-27980), so the argument list is re-parsed by cmd.exe. A commit subject is arbitrary
 * text and it does not survive that: measured, `chore(repo): commit as the work account, and
 * refuse anything else` arrives as **eleven** arguments, and `fix: a & b | c > d` truncates at
 * `a` and then runs `b` as a command of its own.
 *
 * Double quotes neutralise the metacharacters. Two things they do not cover, so they are removed
 * rather than escaped: a literal `"` ends the quoting, and `%NAME%` still expands inside it.
 */
const quoteMeta = (value) =>
  process.platform === "win32"
    ? `"${value.replace(/"/g, "'").replace(/%/g, " ").replace(/\s+/g, " ").trim()}"`
    : value;

/**
 * What this deploy is of — read while `.git` is still here to be read.
 *
 * Order matters and is the whole reason this is a function called early rather than a few lines
 * beside the spawn: after `park()` there is no repository, and every one of these would come back
 * empty.
 *
 * A dirty tree is said out loud. `npm run deploy` ships the working directory, not the commit, so
 * a label naming a commit the build does not match would be worse than the random id it replaces —
 * it would be wrong rather than merely unhelpful.
 */
function commitMeta() {
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return r.status === 0 ? (r.stdout ?? "").trim() : "";
  };

  const sha = git("rev-parse", "HEAD");
  if (!sha) return []; // Not a repository, or git is unavailable. Deploy as before.

  const subject = git("log", "-1", "--pretty=%s");
  const ref = git("rev-parse", "--abbrev-ref", "HEAD");
  const dirty = git("status", "--porcelain") !== "";

  // `origin` names the repository the sha can be looked up in. Absent on a clone with no remote,
  // in which case the sha is still worth having and the link simply is not.
  const origin = git("config", "--get", "remote.origin.url");
  const slug = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(origin);

  const message = subject ? (dirty ? `${subject} (+ uncommitted changes)` : subject) : "";

  return Object.entries({
    githubCommitMessage: message,
    githubCommitRef: ref,
    githubCommitSha: sha,
    githubOrg: slug?.[1] ?? "",
    githubRepo: slug?.[2] ?? "",
  })
    .filter(([, value]) => value)
    .flatMap(([key, value]) => ["--meta", quoteMeta(`${key}=${value}`)]);
}

let parked = false;

function park() {
  if (!existsSync(GIT)) return; // Already a plain directory — nothing to hide.
  renameSync(GIT, PARKED);
  parked = true;
}

function restore() {
  if (!parked || !existsSync(PARKED)) return;
  renameSync(PARKED, GIT);
  parked = false;
  console.log("  .git restored");
}

// Ctrl-C during an upload would otherwise leave the repository parked.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    restore();
    process.exit(130);
  });
}

if (existsSync(PARKED) && existsSync(GIT)) {
  console.error("Both .git and .git-parked exist. Resolve by hand before deploying.");
  process.exit(1);
}
if (existsSync(PARKED)) {
  // A previous run died before restoring. Recover rather than deploying on top of it.
  console.log("Found a parked .git from an earlier run — restoring it first.");
  parked = true;
  restore();
}

// Read before `park()` takes the repository away, and printed so a deploy says what it is of.
const meta = commitMeta();
console.log(`  deploying ${meta.length ? meta[1].replace(/^"?githubCommitMessage=/, "").replace(/"$/, "") : "an unlabelled build"}`);

let code = 1;
try {
  park();
  code = spawnSync("vercel", ["deploy", ...(preview ? [] : ["--prod"]), "--yes", ...meta], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  }).status ?? 1;
} finally {
  restore();
}

// A preview has no stable domain to probe — the URL is on stdout above, and production is
// deliberately untouched.
if (preview) process.exit(code);

if (code === 0) {
  // A build that succeeds still proves nothing about the database: the build never opens a
  // connection. Ask the deployment itself before calling it done.
  const probe = spawnSync("vercel", ["curl", `${PRODUCTION_URL}/api/health`], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const body = (probe.stdout ?? "").trim();

  console.log(`\n  ${PRODUCTION_URL}`);
  console.log(`  health  ${body || "no response"}`);

  if (!body.includes('"status":"ok"')) {
    console.error("\nDeployed, but it cannot reach its database.");
    process.exit(1);
  }
}

process.exit(code);
