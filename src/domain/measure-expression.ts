/**
 * Measurement expressions – how a dimension is worked out, written down so it can be checked.
 *
 * ── Why the model writes an expression and never a number ──────────────────────────────────
 *
 * A take-off from drawings is arithmetic on figures the drawings print: 163 piers is
 * `floor(105,40 / 3) + 1` per run, a wall panel's area is its length times its height. A language
 * model that does that arithmetic itself gets it wrong often enough to matter and never says so.
 * So the agent names the figures it read (`L_NW`, `pier_centres`) and writes how they combine;
 * the platform evaluates it here. The working is then on the sheet for a checker to read, and the
 * arithmetic is the platform's.
 *
 * ── A small grammar, on purpose ────────────────────────────────────────────────────────────
 *
 *     expr   := term (("+" | "-") term)*
 *     term   := factor (("*" | "×" | "/") factor)*
 *     factor := number | name | func "(" expr ("," expr)* ")" | "(" expr ")" | "-" factor
 *     func   := ceil | floor | round | min | max
 *
 * Nothing else is accepted – no `eval`, no property access, no calls outside that list. An
 * expression that does not parse is refused with the reason, not guessed at.
 */

export type Expr =
  | { kind: "number"; value: number; text: string }
  | { kind: "name"; name: string }
  | { kind: "neg"; operand: Expr }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: Expr; right: Expr }
  | { kind: "call"; fn: Fn; args: Expr[] };

const FUNCTIONS = ["ceil", "floor", "round", "min", "max"] as const;
type Fn = (typeof FUNCTIONS)[number];

type Token = { t: "num"; v: number; text: string } | { t: "name"; v: string } | { t: "op"; v: string };

function tokenize(text: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+/.exec(text.slice(i));
      if (!m) return `"${text.slice(i, i + 6)}" is not a number.`;
      tokens.push({ t: "num", v: Number(m[0]), text: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))!;
      tokens.push({ t: "name", v: m[0] });
      i += m[0].length;
      continue;
    }
    if ("+-*/(),×x".includes(c)) {
      // "x" only as an operator between two operands is too ambiguous with names; "×" and "*" only.
      if (c === "x") return `"x" is not an operator – write "*".`;
      tokens.push({ t: "op", v: c === "×" ? "*" : c });
      i++;
      continue;
    }
    return `"${c}" is not allowed in a measurement expression.`;
  }
  return tokens;
}

export type Parsed = { ok: true; expr: Expr } | { ok: false; reason: string };

export function parseExpression(text: string): Parsed {
  const lexed = tokenize(text.trim());
  if (typeof lexed === "string") return { ok: false, reason: lexed };
  const tokens: Token[] = lexed;
  if (tokens.length === 0) return { ok: false, reason: "The expression is empty." };
  let at = 0;
  const peek = () => tokens[at];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;

  function expr(): Expr {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[at++]!.v as "+" | "-";
      left = { kind: "binary", op, left, right: term() };
    }
    return left;
  }
  function term(): Expr {
    let left = factor();
    while (isOp("*") || isOp("/")) {
      const op = tokens[at++]!.v as "*" | "/";
      left = { kind: "binary", op, left, right: factor() };
    }
    return left;
  }
  function factor(): Expr {
    const token = tokens[at++];
    if (!token) throw new Error("The expression ends too soon.");
    if (token.t === "num") return { kind: "number", value: token.v, text: token.text };
    if (token.t === "op" && token.v === "-") return { kind: "neg", operand: factor() };
    if (token.t === "op" && token.v === "(") {
      const inner = expr();
      if (!isOp(")")) throw new Error("A bracket is not closed.");
      at++;
      return inner;
    }
    if (token.t === "name") {
      if (isOp("(")) {
        if (!(FUNCTIONS as readonly string[]).includes(token.v)) throw new Error(`"${token.v}" is not a function this accepts – only ${FUNCTIONS.join(", ")}.`);
        at++;
        const args = [expr()];
        while (isOp(",")) {
          at++;
          args.push(expr());
        }
        if (!isOp(")")) throw new Error(`"${token.v}(" is not closed.`);
        at++;
        return { kind: "call", fn: token.v as Fn, args };
      }
      return { kind: "name", name: token.v };
    }
    throw new Error(`"${token.v}" is out of place.`);
  }

  try {
    const result = expr();
    if (at < tokens.length) return { ok: false, reason: `"${(tokens[at] as { v: unknown }).v}" is out of place.` };
    return { ok: true, expr: result };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The expression does not parse." };
  }
}

/** Every name the expression reads, once each. */
export function namesIn(expr: Expr): string[] {
  const out = new Set<string>();
  const walk = (e: Expr) => {
    if (e.kind === "name") out.add(e.name);
    else if (e.kind === "neg") walk(e.operand);
    else if (e.kind === "binary") {
      walk(e.left);
      walk(e.right);
    }
    else if (e.kind === "call") e.args.forEach(walk);
  };
  walk(expr);
  return [...out];
}

/** Every number written into the expression itself. */
export function literalsIn(expr: Expr): number[] {
  const out: number[] = [];
  const walk = (e: Expr) => {
    if (e.kind === "number") out.push(e.value);
    else if (e.kind === "neg") walk(e.operand);
    else if (e.kind === "binary") {
      walk(e.left);
      walk(e.right);
    }
    else if (e.kind === "call") e.args.forEach(walk);
  };
  walk(expr);
  return out;
}

export type Evaluated = { ok: true; value: number } | { ok: false; reason: string };

export function evaluate(expr: Expr, values: ReadonlyMap<string, number>): Evaluated {
  const run = (e: Expr): number => {
    switch (e.kind) {
      case "number":
        return e.value;
      case "name": {
        const v = values.get(e.name);
        if (v === undefined) throw new Error(`"${e.name}" is not a figure read from the drawings.`);
        return v;
      }
      case "neg":
        return -run(e.operand);
      case "binary": {
        const a = run(e.left);
        const b = run(e.right);
        if (e.op === "/" && b === 0) throw new Error("It divides by nought.");
        return e.op === "+" ? a + b : e.op === "-" ? a - b : e.op === "*" ? a * b : a / b;
      }
      case "call": {
        const args = e.args.map(run);
        if ((e.fn === "min" || e.fn === "max") && args.length < 2) throw new Error(`${e.fn} needs two or more values.`);
        if (e.fn !== "min" && e.fn !== "max" && args.length !== 1) throw new Error(`${e.fn} takes one value.`);
        // A float's 97.99999999 is 98 to a QS: nudge by far less than the four places a quantity keeps.
        if (e.fn === "ceil") return Math.ceil(args[0]! - 1e-9);
        if (e.fn === "floor") return Math.floor(args[0]! + 1e-9);
        if (e.fn === "round") return Math.round(args[0]!);
        return e.fn === "min" ? Math.min(...args) : Math.max(...args);
      }
    }
  };
  try {
    const value = run(expr);
    if (!Number.isFinite(value)) return { ok: false, reason: "It does not come to a number." };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "It does not evaluate." };
  }
}

/** A value at the four places the bill holds, as the numeric text the database takes. */
export function toNumeric(value: number): string {
  const scaled = Math.round(Math.abs(value) * 10_000 + 1e-7) * Math.sign(value);
  const negative = scaled < 0;
  const digits = String(Math.abs(scaled)).padStart(5, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}
