/**
 * Drives the login screen in a real browser.
 *
 * A server action cannot be exercised with curl — the request carries headers Next generates at
 * build time — so the only honest way to prove sign-in works is to click the button.
 *
 * Throwaway: this is a check, not a test suite. It is deleted once there is a real one.
 */

import puppeteer from "puppeteer";
import { readEnv } from "./helpers.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";

const env = readEnv();

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

try {
  // 1. An unauthenticated visit to a protected page lands on login.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  check("unauthenticated Home redirects to login", page.url().includes("/login"), page.url());

  /*
    1b. "Forgot password?" leads somewhere, signed out.

    The link pointed at a page that did not exist and landed on "There is nothing at this address".
    Clicked rather than visited, so the check fails if the link's href drifts from the page's path.
  */
  await Promise.all([page.click('a[href="/forgot-password"]'), page.waitForNavigation({ waitUntil: "networkidle0" })]);
  const resetHeading = await page.$eval("h1", (h) => h.textContent).catch(() => null);
  check("forgot password opens its page", page.url().endsWith("/forgot-password"), page.url());
  check("and it explains the reset", resetHeading === "Reset your password", resetHeading ?? "no heading");
  await Promise.all([page.click('a[href="/login"]'), page.waitForNavigation({ waitUntil: "networkidle0" })]);
  check("and leads back to sign in", page.url().endsWith("/login"), page.url());

  // 2. Wrong password is rejected, and says so.
  await page.type("#email", env.DEV_USER_EMAIL);
  await page.type("#password", "definitely-not-the-password");
  await Promise.all([page.click('button[type="submit"]'), page.waitForNetworkIdle()]);

  /*
    Wait for the message, do not sample for it.

    `waitForNetworkIdle` returns when the server action's round trip is quiet, which is before
    React has committed the re-render that puts the refusal on screen. Reading immediately made
    this check fail roughly one run in ten — always on a busy machine, never on a rerun — and a
    gate that fails at random teaches everyone to press the button again instead of reading it.
  */
  const errorText = await page
    .waitForSelector('[role="status"]', { timeout: 5000 })
    .then((el) => el.evaluate((e) => e.textContent))
    .catch(() => null);

  check("wrong password is rejected", page.url().includes("/login"), page.url());
  check("and the error is shown", Boolean(errorText), errorText ?? "no message rendered");

  // 3. Correct credentials sign in and land on Home (/).
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", env.DEV_USER_EMAIL);
  await page.type("#password", env.DEV_USER_PASSWORD);
  await Promise.all([page.click('button[type="submit"]'), page.waitForNavigation()]);

  check("correct credentials land on Home", new URL(page.url()).pathname === "/", page.url());

  // 4. The session cookie is set, and set safely.
  const cookies = await browser.cookies();
  const session = cookies.find((c) => c.name === "qs_session");
  check("session cookie is set", Boolean(session));
  check("cookie is httpOnly", session?.httpOnly === true);
  check("cookie is sameSite lax", session?.sameSite === "Lax", session?.sameSite);

  const days = session ? (session.expires * 1000 - Date.now()) / 86_400_000 : 0;
  check("cookie persists ~30 days", days > 28 && days < 31, `${days.toFixed(1)} days`);

  // 5. The session survives a fresh page load — this is what "stay signed in" means.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  check("still signed in after reload", new URL(page.url()).pathname === "/", page.url());

  // 6. And survives a brand-new browser context sharing the same cookie jar (a new tab).
  const tab = await browser.newPage();
  await tab.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  check("still signed in in a new tab", new URL(tab.url()).pathname === "/", tab.url());
  await tab.close();

  // 7. Signing out ends the session on the server, not only in this browser (ARC-003). A copy of the
  //    cookie taken before signing out is what a thief would hold; it must stop working.
  await page.click('button[aria-label="Account menu"]');
  await page.waitForSelector('[role="menu"] form button[type="submit"]');
  await Promise.all([page.click('[role="menu"] form button[type="submit"]'), page.waitForNavigation()]);
  check("signing out lands on login", page.url().includes("/login"), page.url());

  await browser.setCookie(session);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  check("a copy of the cookie stops working once signed out", page.url().includes("/login"), page.url());

  // 8. A tampered cookie is rejected — the signature is doing its job.
  await browser.setCookie({ ...session, value: `${session.value.slice(0, -4)}AAAA` });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  check("tampered cookie is rejected", page.url().includes("/login"), page.url());
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
