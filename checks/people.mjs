/**
 * Accounts — §1.3.1, §13.1.
 *
 *     npm run check:people
 *
 * ── What is worth asserting ────────────────────────────────────────────────────────────────
 *
 * Sign-in compared against two environment variables until now, which was honest while one person
 * used it and became a defect the moment a second did: this platform's central claim is that every
 * figure traces to a **named** signer, and one shared login makes every signature name the same
 * person.
 *
 * So the assertions are about the properties whose failure is silent. A password that will not
 * verify fails loudly on the first sign-in; a password stored in the clear, an account that keeps
 * working after its access is removed, or an action that trusts the page to have hidden its own
 * button — none of those announce themselves at all.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import puppeteer from "puppeteer";

import { readEnv, signIn } from "./helpers.mjs";

const BASE = "http://localhost:3000";
const env = readEnv();

const sql = postgres(
  readFileSync(".env.local", "utf8")
    .match(/DATABASE_URL=(.+)/)[1]
    .trim()
    .replace(/^["']|["']$/g, ""),
  { max: 1 },
);

let fails = 0;
const check = (what, ok, detail = "") => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`);
};

/** A domain nothing else uses, so the cleanup at the end cannot take a real person with it. */
const DOMAIN = "@people-check.example";
const TESTER = `tester${Date.now()}${DOMAIN}`;
const PASSWORD = "a long enough passphrase";

const browser = await puppeteer.launch({ headless: "new" });

/** Sign in as somebody, in a context of their own, and report where they landed. */
async function signInAs(email, password) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await page.click('form button[type="submit"]');
  await page.waitForNetworkIdle({ idleTime: 1200, timeout: 25000 }).catch(() => {});
  return page;
}

try {
  await sql`delete from users where email like ${"%" + DOMAIN}`;

  const admin = await browser.newPage();
  await signIn(admin, env);
  await admin.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });

  check("settings carries the list of people", (await admin.$('[data-region="people"]')) !== null);

  /*
    The environment credential is listed rather than hidden. It can always sign in and it has no
    row, so a list that left it out would be a plausible-looking lie — somebody reading it would
    believe they were seeing everybody with access.
  */
  check(
    "and shows the environment credential, which has no row",
    (await admin.$('[data-person="operator"]')) !== null,
  );

  // ── Adding somebody: a link, never a password the administrator knows (audit C7) ────────
  check("the add form asks for no password", (await admin.$('[data-region="add-person"] input[name="password"]')) === null);
  await admin.type('[data-region="add-person"] input[name="name"]', "A Tester");
  await admin.type('[data-region="add-person"] input[name="email"]', TESTER);
  await admin.click('[data-action="add-person"]');
  await admin.waitForSelector('[data-input="password-link"]', { timeout: 30000 });
  const invite = await admin.$eval('[data-input="password-link"]', (el) => el.value);

  const [row] = await sql`select * from users where email = ${TESTER}`;
  check("an administrator can add somebody", row !== undefined);
  check("and is handed a single-use link to send them", /\/login\?set=[\w-]{40,}$/.test(invite), invite.replace(/set=.*/, "set=…"));

  if (row) {
    check("recorded under their own name, which is what a signature will say", row.name === "A Tester");
    check("and against whoever added them", row.created_by === env.DEV_USER_EMAIL, row.created_by ?? "");
    check("a new person is not an administrator by default", row.is_admin === false);
    // Only the token's hash is stored: a copy of the table yields no working link.
    const token = invite.split("set=")[1] ?? "";
    const [stored] = await sql`select token_hash, purpose from password_links where user_id = ${row.id}`;
    check("the link's token is not in the database", Boolean(stored) && !stored.token_hash.includes(token) && stored.purpose === "invite");
  }

  // ── The person chooses their own password with it ──────────────────────────────────────
  const linkPage = await (await browser.createBrowserContext()).newPage();
  await linkPage.goto(invite.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle0" });
  check("the link opens 'choose your password'", (await linkPage.$('[data-region="set-password"]')) !== null);

  // A weak password is refused by the server, and the link survives the refusal.
  await linkPage.type('input[name="password"]', "short");
  await linkPage.type('input[name="confirm"]', "short");
  await linkPage.click('form button[type="submit"]');
  await linkPage.waitForFunction(() => /at least \d+ characters/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  check("a short password is refused by the server", /at least \d+ characters/.test(await linkPage.$eval("main", (e) => e.innerText)));

  await linkPage.goto(invite.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle0" });
  await linkPage.type('input[name="password"]', PASSWORD);
  await linkPage.type('input[name="confirm"]', PASSWORD);
  await linkPage.click('form button[type="submit"]');
  await linkPage.waitForSelector('[data-region="password-set"]', { timeout: 20000 }).catch(() => {});
  check("a good one is set, and they are sent to sign in", (await linkPage.$('[data-region="password-set"]')) !== null, linkPage.url().replace(BASE, ""));

  if (row) {
    const [after] = await sql`select password_hash from users where id = ${row.id}`;
    // The one that would be catastrophic and silent: a column holding the password would look identical on screen.
    check(
      "the password is not in the database, in any recoverable form",
      !after.password_hash.includes(PASSWORD) && !after.password_hash.includes("passphrase"),
      after.password_hash.split("$").slice(0, 4).join("$") + "$…",
    );
    check("it is stored with its own cost parameters and salt", /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/.test(after.password_hash));
  }

  // The same link a second time does nothing.
  await linkPage.goto(invite.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle0" });
  await linkPage.type('input[name="password"]', "another long passphrase");
  await linkPage.type('input[name="confirm"]', "another long passphrase");
  await linkPage.click('form button[type="submit"]');
  await linkPage.waitForFunction(() => /already been used/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  check("a link works once", /already been used/.test(await linkPage.$eval("main", (e) => e.innerText)));

  // ── The account works ───────────────────────────────────────────────────────────────────
  const tester = await signInAs(TESTER, PASSWORD);
  check("the person can sign in with their own password", !tester.url().includes("/login"), tester.url().replace(BASE, ""));

  const wrong = await signInAs(TESTER, "not the passphrase");
  check("and cannot with the wrong one", wrong.url().includes("/login"));

  /*
    One message for every failure. "No such account" tells anybody who asks which addresses exist;
    "this account is deactivated" tells them which ones used to.
  */
  const unknown = await signInAs(`nobody${DOMAIN}`, PASSWORD);
  const refusal = await unknown.$eval("form", (f) => f.innerText).catch(() => "");
  check(
    "an unknown address is refused in the same words as a wrong password",
    /do not match an account/.test(refusal),
    refusal.split("\n").find((l) => /match/.test(l)) ?? "",
  );

  // ── Removing access ─────────────────────────────────────────────────────────────────────
  await admin.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
  await admin.click(`[data-person="${row.id}"] [data-action="deactivate"]`);
  await admin.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});

  const [off] = await sql`select deactivated_at, deactivated_by from users where id = ${row.id}`;
  check("access can be removed", off.deactivated_at !== null);
  check("recording who removed it", off.deactivated_by === env.DEV_USER_EMAIL);

  const barred = await signInAs(TESTER, PASSWORD);
  check("and the person can no longer sign in", barred.url().includes("/login"));

  // The session they already had ends too (ARC-003). Before, a deactivated person's open browser
  // kept working for as long as they kept using it.
  await tester.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  check("and the session they were already in has ended", tester.url().includes("/login"), tester.url().replace(BASE, ""));

  /*
    Soft, not a delete. The row is what everything they signed points at, and removing it would
    leave those signatures naming nobody.
  */
  const [{ n: still }] = await sql`select count(*)::int as n from users where id = ${row.id}`;
  check("their record survives, so their signatures still name somebody", still === 1);

  await admin.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
  await admin.click(`[data-person="${row.id}"] [data-action="reactivate"]`);
  await admin.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});
  const restored = await signInAs(TESTER, PASSWORD);
  check("access can be given back", !restored.url().includes("/login"));

  // ── A non-administrator ─────────────────────────────────────────────────────────────────
  const theirSettings = await restored.goto(`${BASE}/settings`, { waitUntil: "networkidle0" }).then(() => restored);
  check("a non-administrator is not offered the form", (await theirSettings.$('[data-region="add-person"]')) === null);
  check("and is told why rather than shown nothing", /Only an administrator/.test(await theirSettings.$eval('[data-region="people"]', (el) => el.innerText)));
  check(
    "nor any way to remove somebody's access",
    (await theirSettings.$$('[data-action="deactivate"]')).length === 0,
  );

  /*
    The assertion the hidden form is worth nothing without.

    A server action is a public endpoint: hiding the button hides the button. This calls the action
    the way anybody who could read the page source would, and expects the server's own refusal.
  */
  const bypass = await theirSettings.evaluate(async () => {
    const form = new FormData();
    form.set("name", "Snuck In");
    form.set("email", "snuck@people-check.example");

    const response = await fetch(location.href, {
      method: "POST",
      headers: { "Next-Action": "probe" },
      body: form,
    });
    return response.status;
  });

  const [{ n: snuck }] = await sql`select count(*)::int as n from users where email = 'snuck@people-check.example'`;
  check(
    "and posting to the action directly creates nobody",
    snuck === 0,
    `server answered ${bypass}`,
  );
  /*
    ── Two-step sign-in (audit C7) ────────────────────────────────────────────────────────────

    The tester turns it on with the key the page shows; the code is worked here the way an
    authenticator app works it (RFC 6238), so the check proves the platform interoperates rather
    than agreeing with itself.
  */
  const totp = (key, step) => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0, value = 0;
    const bytes = [];
    for (const ch of key.replace(/\s/g, "")) {
      value = (value << 5) | alphabet.indexOf(ch);
      bits += 5;
      if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
    const offset = mac[mac.length - 1] & 15;
    return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1e6).padStart(6, "0");
  };
  const step = () => Math.floor(Date.now() / 30000);

  const mfa = await signInAs(TESTER, PASSWORD);
  await mfa.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
  await mfa.waitForFunction(() => Object.keys(document.querySelector('[data-action="two-step-start"]') ?? {}).some((k) => k.startsWith("__reactProps")), { timeout: 15000 });
  await mfa.click('[data-action="two-step-start"]');
  await mfa.waitForSelector('[data-region="two-step-key"]', { timeout: 15000 });
  const key = await mfa.$eval('[data-region="two-step-key"]', (e) => e.textContent ?? "");
  check("turning it on shows a QR code and the key", Boolean(await mfa.$('[data-region="two-step"] img[src^="data:image/png"]')) && /^[A-Z2-7 ]{32,40}$/.test(key));
  await mfa.type('[data-input="two-step-code"]', totp(key, step()));
  await mfa.click('[data-action="two-step-confirm"]');
  await mfa.waitForSelector('[data-two-step="on"]', { timeout: 15000 }).catch(() => {});
  check("a code from the app turns it on", Boolean(await mfa.$('[data-two-step="on"]')));
  const [sealed] = await sql`select totp_secret, totp_enabled_at from users where email = ${TESTER}`;
  check("the key is not stored in the clear", Boolean(sealed?.totp_secret) && !sealed.totp_secret.includes(key.replace(/\s/g, "")) && sealed.totp_secret.startsWith("v1."));

  // Signing in now asks for a code after the password.
  const second = await signInAs(TESTER, PASSWORD);
  check("signing in now asks for a code", second.url().includes("/login") && Boolean(await second.$('input[name="code"]')));
  await second.type('input[name="code"]', "000000");
  await second.click('form button[type="submit"]');
  await second.waitForFunction(() => /code is not right/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  check("a wrong code is refused", second.url().includes("/login") && /code is not right/.test(await second.$eval("main", (e) => e.innerText)));
  // The next step's code: the one used to confirm cannot be used again.
  await second.$eval('input[name="code"]', (el) => (el.value = ""));
  await second.type('input[name="code"]', totp(key, step() + 1));
  await Promise.all([second.click('form button[type="submit"]'), second.waitForNavigation({ timeout: 20000 }).catch(() => {})]);
  check("the right code gets in", !second.url().includes("/login"), second.url().replace(BASE, ""));

  // An administrator clears it for a lost phone.
  await admin.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
  await admin.waitForFunction((id) => Object.keys(document.querySelector(`[data-person="${id}"] [data-action="reset-two-step"]`) ?? {}).some((k) => k.startsWith("__reactProps")), { timeout: 15000 }, row.id);
  await admin.click(`[data-person="${row.id}"] [data-action="reset-two-step"]`);
  await admin.waitForNetworkIdle({ idleTime: 1200, timeout: 25000 }).catch(() => {});
  const [cleared] = await sql`select totp_secret, totp_enabled_at from users where email = ${TESTER}`;
  check("an administrator can reset it for a lost phone", cleared.totp_secret === null && cleared.totp_enabled_at === null);
} finally {
  await sql`delete from users where email like ${"%" + DOMAIN}`.catch(() => {});
  await sql.end();
  await browser.close();
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} failed.`);
process.exit(fails ? 1 : 0);
