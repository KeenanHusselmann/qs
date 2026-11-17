/**
 * Every criterion must be filed somewhere a person can reach.
 *
 * `Criterion.module` is a project-relative href typed by hand. A typo there does not fail the build
 * and does not throw at runtime — the criterion simply stops appearing on any page, which reads as
 * "this project does not need a title deed" rather than as a bug. That is the worst kind of failure
 * this checklist can have: a requirement that quietly vanishes.
 *
 * So it is asserted. Three ways a criterion can go missing, all caught here.
 */

import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

const criteria = [...read("src/lib/entry-criteria.ts").matchAll(/id: "([^"]+)",\s*\n\s*process: "([^"]+)",\s*\n\s*module: "([^"]+)"/g)].map(
  ([, id, process, module]) => ({ id, process, module }),
);

const nav = [...read("src/lib/navigation.ts").matchAll(/href: "([^"]*)",[^}]*built: (true|false)/g)].map(
  ([, href, built]) => ({ href, built: built === "true" }),
);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

check("criteria were parsed", criteria.length > 0, `${criteria.length} found`);
check("nav items were parsed", nav.length > 0, `${nav.length} found`);

// 1. The module exists in the nav at all.
for (const { id, module } of criteria) {
  const item = nav.find((n) => n.href === module);
  check(`${id} → ${module} is a real nav item`, Boolean(item));
}

// 2. And it is reachable — an unbuilt item renders as greyed text, not a link, so a criterion
//    allocated to one is filed at an address nobody can open.
const modules = [...new Set(criteria.map((c) => c.module))];
for (const href of modules) {
  const item = nav.find((n) => n.href === href);
  check(`${href} is built, so its criteria can be reached`, Boolean(item?.built));
}

/**
 * 3. A page actually renders at that route.
 *
 * Three modules used to be three files that each passed one string to `ModulePage`; they are one
 * `[module]` route now, which is what let this app fit inside Vercel's twelve-function limit. So
 * the question is no longer "is there a file at this path" but "does something serve this path" —
 * either its own folder, or the dynamic route that catches the rest.
 */
const dynamicModule = (() => {
  try {
    read("src/app/(app)/projects/[id]/[module]/page.tsx");
    return true;
  } catch {
    return false;
  }
})();

for (const href of modules) {
  let own = true;
  try {
    read(`src/app/(app)/projects/[id]${href}/page.tsx`);
  } catch {
    own = false;
  }
  check(`${href} has a page`, own || dynamicModule, own ? "its own" : "the [module] route");
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
