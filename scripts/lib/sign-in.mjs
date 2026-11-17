/**
 * Signing a script in to a running platform — one copy, for every script that has to.
 *
 * ── Why this is not the suites' `signIn` ───────────────────────────────────────────────────
 *
 * `checks/helpers.mjs` signs in by clicking submit and waiting for a navigation, which is right
 * for a suite: the credentials come from `.env.local`, they are correct by construction, and a
 * failure is a broken build rather than a person to help. Against production neither holds. A
 * refused sign-in never navigates — the login page re-renders in place — so that wait runs to the
 * page timeout and then reports a timeout rather than a password. Headless, that is
 * indistinguishable from nothing happening, and it is what a person meets the first time they
 * mistype.
 *
 * This was written twice into two scripts before it was written once here, and the second copy
 * still had the first copy's bugs when they were found. Hence the file.
 */

import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

import { readEnv } from "../../checks/helpers.mjs";

function askAtTerminal(question) {
  if (!process.stdin.isTTY) {
    throw new Error("--ask needs a terminal to ask at. Run it yourself rather than through a pipe or a tool.");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => rl.question(question, (answer) => (rl.close(), resolve(answer))));
}

/**
 * A password, read from the keyboard without drawing it.
 *
 * Read straight off stdin in raw mode rather than through readline with its `_writeToOutput`
 * overridden. The override version, on a second interface opened after the e-mail's had been
 * closed, was reported from a real PowerShell run as never printing its prompt at all: closing a
 * terminal-mode interface pauses stdin, and what the next one does with the keystrokes after that
 * is not something to rely on — least of all for the one field nobody can see to check.
 *
 * Nothing is drawn in place of the characters, not even stars: a length is information too.
 */
function askPassword(question) {
  if (!process.stdin.isTTY) {
    throw new Error("--ask needs a terminal to ask at. Run it yourself rather than through a pipe or a tool.");
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const done = (finish) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      finish();
    };

    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(value));
        // Ctrl-C keeps working: a prompt nobody can escape is its own kind of hang.
        if (ch === "\u0003") return done(() => reject(new Error("Cancelled.")));
        if (ch === "\u0008" || ch === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        if (ch >= " ") value += ch;
      }
    };

    stdin.on("data", onData);
  });
}

/**
 * Who to sign in as: the environment, then the terminal, then `.env.local`.
 *
 * `QS_EMAIL` and `QS_PASSWORD` win because a terminal prompt is a surprising amount of machinery
 * to stand between somebody and a sign-in, and when the sign-in is refused there is no way to
 * tell a wrong password from one that was mangled getting there. Setting them takes all of that
 * out of the question — at the cost of leaving the password in the shell's environment and, typed,
 * in its history.
 */
export async function identityFor(base, { ask = false } = {}) {
  if (process.env.QS_EMAIL && process.env.QS_PASSWORD) {
    console.log("\nUsing QS_EMAIL and QS_PASSWORD from the environment.");
    return { DEV_USER_EMAIL: process.env.QS_EMAIL.trim(), DEV_USER_PASSWORD: process.env.QS_PASSWORD };
  }
  if (ask) {
    return {
      DEV_USER_EMAIL: (await askAtTerminal(`\nSign in to ${base}\n  e-mail:   `)).trim(),
      DEV_USER_PASSWORD: await askPassword("  password: "),
    };
  }
  // `.env.local`, which is the development account and applies to nothing else.
  return readEnv();
}

/**
 * Sign in, and say what happened either way.
 *
 * Signed in means "no longer on the login page", and nothing else. Not "the error box appeared":
 * a refused sign-in does not always produce one — measured against a running server, a login for
 * an account that does not exist rendered a server-error page with no error box at all, and a
 * wait keyed on that box sat there until it timed out and then blamed the timeout. What the page
 * *is* is the reliable signal; what it *says* is the explanation, read afterwards rather than
 * waited for. The box is raced alongside only so the common refusal is immediate.
 */
export async function signInOrExplain(page, identity, base) {
  /*
    The fingerprint: eight hex characters of the password's SHA-256.

    It reveals nothing and cannot be reversed, but it reproduces against the password that was
    meant, in any shell, so a mangled password can be told from a wrong one — which a refusal
    cannot otherwise answer, and which a character count misses entirely when a shell substitutes
    rather than truncates.
  */
  const fingerprint = createHash("sha256").update(identity.DEV_USER_PASSWORD ?? "").digest("hex").slice(0, 8);
  console.log(
    `Signing in as ${identity.DEV_USER_EMAIL} — password ${(identity.DEV_USER_PASSWORD ?? "").length} characters, fingerprint ${fingerprint}`,
  );

  console.log("  opening the browser…");
  await page.goto(`${base}/login`, { waitUntil: "networkidle0" });
  await page.type("#email", identity.DEV_USER_EMAIL);
  await page.type("#password", identity.DEV_USER_PASSWORD);

  console.log("  signing in…");
  await page.click('button[type="submit"]');

  const left = await Promise.race([
    page
      .waitForFunction(() => !window.location.pathname.startsWith("/login"), { timeout: 45_000, polling: 250 })
      .then(() => true)
      .catch(() => false),
    page
      .waitForFunction(
        () => Boolean([...document.querySelectorAll('[role="status"], [role="alert"]')].some((n) => n.textContent?.trim())),
        { timeout: 45_000, polling: 250 },
      )
      .then(() => false)
      .catch(() => false),
  ]);

  if (left) {
    console.log(`  signed in as ${identity.DEV_USER_EMAIL}.`);
    return;
  }

  const said = await page.evaluate(() => {
    const box = [...document.querySelectorAll('[role="status"], [role="alert"]')].map((n) => n.textContent?.trim()).find(Boolean);
    return box ?? document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 200);
  });
  throw new Error(`${base} did not sign in. The page says: ${said}`);
}
