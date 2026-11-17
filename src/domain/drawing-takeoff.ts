/**
 * A take-off from drawings, checked – D1.2, PLATFORM.md §1.3.2 and §5.
 *
 * ── What the agent hands over, and what is believed ────────────────────────────────────────
 *
 * The measuring agent returns two lists. **Parameters** are the figures a measurement rests on –
 * a wall's length, its height, the pier centres – each either
 *
 *   - *read*: a figure with the drawing's own words around it, quoted verbatim;
 *   - *derived*: an expression over other parameters (piers = floor(L / centres) + 1); or
 *   - *assumed*: a figure the drawings leave open ("foundations to engineer's details"), with the
 *     reason, so it is carried as an assumption for a person to confirm rather than as a fact.
 *
 * **Items** are what goes to the bill – a description, a unit and dimension lines, where every
 * timesing and dimension is an expression over parameters.
 *
 * Nothing the model says is taken on trust. A *read* figure's quote must be found in the drawing's
 * text and must contain the figure; a figure that is neither found nor stated as an assumption is
 * refused, and every line that used it goes with it, counted and said. Arithmetic is done here,
 * never by the model, and the number of dimensions a line has must match its unit – the same rule
 * a dimension sheet typed by hand is held to.
 *
 * ── Units ──────────────────────────────────────────────────────────────────────────────────
 *
 * Drawings print millimetres; bills are in metres. A parameter carries the unit it was printed in
 * and is converted once, here – so `2500 mm` is 2,5 in every expression and nobody writes /1000.
 */

import { dimensionsFor } from "@/domain/dimensions";
import { isElement, type ElementId } from "@/domain/elemental-plan";
import { evaluate, literalsIn, namesIn, parseExpression, toNumeric, type Expr } from "@/domain/measure-expression";

export interface ProposedParameter {
  name: string;
  label: string;
  /** The figure as the drawing prints it – "292,69", "2 500". Null for a derived parameter. */
  figure: string | null;
  unit: string;
  quote: string | null;
  expression: string | null;
  assumption: string | null;
}

export interface ProposedLine {
  location: string | null;
  times: string | null;
  dimensions: string[];
  deduct: boolean;
}

export interface ProposedItem {
  section: string | null;
  /** The cost plan element it belongs to – "substructure", "finishes" – where the agent said. */
  element?: string | null;
  description: string;
  unit: string;
  lines: ProposedLine[];
}

export type ParameterStatus = "read" | "derived" | "assumed";

export interface CheckedParameter {
  name: string;
  label: string;
  status: ParameterStatus;
  /** In the measuring unit – metres for a length printed in millimetres. */
  value: number;
  unit: string;
  /** The unit the drawing printed it in – "mm" for a height of 2 500. */
  printedUnit: string;
  figure: string | null;
  expression: string | null;
  quote: string | null;
  source: { documentId: string; page: number | null } | null;
  assumption: string | null;
  /** The assumed parameters this one rests on, itself included where it is one. */
  restsOn: string[];
}

export interface CheckedLine {
  location: string | null;
  timesing: string;
  dimensions: string[];
  deduct: boolean;
  /** How it was worked out, in the agent's own names – "2 × panel_length × wall_height". */
  working: string;
}

export interface CheckedItem {
  section: string | null;
  /** Null where the agent named no element, or one the plan does not have – grouped by its words later. */
  element: ElementId | null;
  description: string;
  unit: string;
  lines: CheckedLine[];
  /** Assumed parameters its quantity rests on – what a checker must confirm. */
  assumptions: string[];
}

export interface Refusal {
  what: string;
  reason: string;
}

export interface CheckedTakeoff {
  parameters: CheckedParameter[];
  items: CheckedItem[];
  refused: Refusal[];
}

/**
 * Where a quote was found – injected so this stays free of the database and the grounding module.
 * Given the figure too, so a caller can ground it by the words immediately around it when the
 * model's quote of a run-together dimension string is not character-perfect.
 */
export type Locate = (quote: string, figure: string) => { documentId: string; page: number | null } | null;

/** Numbers an expression may carry without a parameter: "2 faces", "4 courses". Anything else is a figure. */
const PLAIN = new Set([1, 2, 3, 4]);

const TO_METRES: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1 };
const COUNT_UNITS = new Set(["no", "nr", "each"]);
const AREA_VOLUME = new Set(["m2", "m²", "m3", "m³"]);

/** Read a figure as printed: "2 500", "292,69", "0.46". Refuses thousands-or-decimal ambiguity. */
export function readFigure(text: string): number | null {
  const t = text.replace(/\s| /g, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const marks = t.replace(/\d/g, "");
  if (marks === "") return Number(t);
  if (marks.length === 1) {
    const [whole, part] = t.split(/[.,]/) as [string, string];
    // "1,250" or "1.250": three digits after one mark is a thousands separator as often as not.
    if (part.length === 3 && whole.length <= 3) return null;
    return Number(`${whole}.${part}`);
  }
  return null;
}

const unitKey = (u: string) => u.trim().toLowerCase().replace(/\.$/, "");

/**
 * Whether the quote carries the figure – as printed, as its digits where dimension strings run
 * together, or as the same length in the other unit ("6000 mm" from "@ 6M SPACING").
 */
export function quoteCarries(quote: string, figure: string, unit = ""): boolean {
  const q = quote.replace(/\s| /g, "");
  const f = figure.replace(/\s| /g, "");
  if (f === "") return false;
  if (q.includes(f)) return true;
  const digits = (s: string) => s.replace(/\D/g, "");
  if (digits(f).length >= 2 && digits(q).includes(digits(f))) return true;
  const value = readFigure(figure);
  const factor = TO_METRES[unitKey(unit)];
  if (value === null || factor === undefined) return false;
  const metres = value * factor;
  // Each number in the quote, with the unit written after it where there is one.
  for (const m of quote.matchAll(/(\d[\d.,]*)\s*(mm|m)?(?![a-z])/gi)) {
    const n = readFigure(m[1]!);
    if (n === null) continue;
    const u = (m[2] ?? "").toLowerCase();
    const candidates = u === "mm" ? [n * 0.001] : u === "m" ? [n] : [n * 0.001, n];
    if (candidates.some((c) => Math.abs(c - metres) < 1e-9)) return true;
  }
  return false;
}

const STOP = new Set(["the", "and", "for", "with", "from", "each", "all", "per", "not", "into", "over", "under", "total", "typical"]);
const words = (text: string) => new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.replace(/s$/, "")));

/**
 * Whether the quote says what the figure is.
 *
 * A figure can be in the drawing and still not be *this* figure: "300 X 200 STORMWATER OPENING"
 * carries a 200, and it is not a footing depth. So a figure is taken as read only where its quote
 * names it – shares a word with its label – or is a bare dimension string, where position on the
 * drawing is all there is to go on. Otherwise it is kept as an assumption and said to be one.
 */
export function quoteNames(label: string, quote: string): boolean {
  const letters = (quote.match(/[a-z]/gi) ?? []).length;
  const digits = (quote.match(/\d/g) ?? []).length;
  if (letters <= digits * 0.25) return true;
  const said = words(quote);
  return [...words(label)].some((w) => said.has(w));
}

export function checkTakeoff(proposed: { parameters: ProposedParameter[]; items: ProposedItem[] }, locate: Locate): CheckedTakeoff {
  const refused: Refusal[] = [];
  const checked = new Map<string, CheckedParameter>();
  const values = new Map<string, number>();
  const byName = new Map<string, ProposedParameter>();

  for (const p of proposed.parameters) {
    const name = (p.name ?? "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      refused.push({ what: p.label || name || "a figure", reason: `"${name}" is not a usable name.` });
      continue;
    }
    if (byName.has(name)) {
      refused.push({ what: p.label || name, reason: `"${name}" is named twice; the first is kept.` });
      continue;
    }
    byName.set(name, p);
  }

  // Printed and assumed figures first – they need nothing else.
  for (const [name, p] of byName) {
    if (p.expression && !p.figure) continue;
    const label = p.label?.trim() || name;
    const unit = unitKey(p.unit ?? "");
    const factor = TO_METRES[unit] ?? (COUNT_UNITS.has(unit) || AREA_VOLUME.has(unit) ? 1 : null);
    if (factor === null) {
      refused.push({ what: label, reason: `"${p.unit}" is not a unit a figure is measured in here (mm, m, m², m³, no).` });
      continue;
    }
    const printed = p.figure ? readFigure(p.figure) : null;
    if (printed === null || printed <= 0) {
      refused.push({ what: label, reason: p.figure ? `"${p.figure}" cannot be read as one figure without guessing.` : "No figure was given." });
      continue;
    }
    let status: ParameterStatus | null = null;
    let source: CheckedParameter["source"] = null;
    if (p.quote && quoteCarries(p.quote, p.figure!, p.unit)) {
      source = locate(p.quote, p.figure!);
      if (source) status = "read";
    }
    let assumption = p.assumption?.trim() || null;
    if (status === "read" && !quoteNames(label, p.quote!)) {
      status = "assumed";
      assumption = `The drawing prints ${p.figure} here, but not against this: taken from "${p.quote!.replace(/\s+/g, " ").slice(0, 80)}". Confirm it is the ${label.toLowerCase()}.`;
    }
    if (!status && assumption) status = "assumed";
    if (!status) {
      refused.push({
        what: label,
        reason: p.quote ? `The quote for ${p.figure} ${p.unit} is not in the drawings, and it is not stated as an assumption.` : `${p.figure} ${p.unit} has no quote from the drawings and is not stated as an assumption.`,
      });
      continue;
    }
    const value = printed * factor;
    values.set(name, value);
    checked.set(name, {
      name,
      label,
      status,
      value,
      unit: factor === 1 ? p.unit : "m",
      printedUnit: p.unit,
      figure: p.figure,
      expression: null,
      quote: p.quote && source ? p.quote : null,
      source,
      assumption: status === "assumed" ? assumption : null,
      restsOn: status === "assumed" ? [name] : [],
    });
  }

  // Derived figures, in whatever order they resolve – a derived figure may read another.
  const pending = [...byName].filter(([name, p]) => p.expression && !p.figure && !checked.has(name));
  const parsed = new Map<string, Expr>();
  for (const [name, p] of pending) {
    const r = parseExpression(p.expression!);
    if (!r.ok) {
      refused.push({ what: p.label || name, reason: `${p.expression}: ${r.reason}` });
      continue;
    }
    const loose = literalsIn(r.expr).filter((n) => !PLAIN.has(n));
    if (loose.length) {
      refused.push({ what: p.label || name, reason: `${loose.join(", ")} is written into the working rather than read from the drawings as a figure.` });
      continue;
    }
    parsed.set(name, r.expr);
  }
  let progress = true;
  while (progress && parsed.size) {
    progress = false;
    for (const [name, expr] of parsed) {
      const needs = namesIn(expr);
      if (!needs.every((n) => values.has(n))) continue;
      const p = byName.get(name)!;
      const result = evaluate(expr, values);
      parsed.delete(name);
      progress = true;
      if (!result.ok || result.value <= 0) {
        refused.push({ what: p.label || name, reason: `${p.expression}: ${result.ok ? "it comes to nought or less." : result.reason}` });
        continue;
      }
      values.set(name, result.value);
      checked.set(name, {
        name,
        label: p.label?.trim() || name,
        status: "derived",
        value: result.value,
        // Worked out from converted figures, so a length is in metres whatever the model called it.
        unit: TO_METRES[unitKey(p.unit ?? "")] !== undefined ? "m" : p.unit,
        printedUnit: TO_METRES[unitKey(p.unit ?? "")] !== undefined ? "m" : p.unit,
        figure: null,
        expression: p.expression,
        quote: null,
        source: null,
        assumption: null,
        restsOn: [...new Set(needs.flatMap((n) => checked.get(n)!.restsOn))],
      });
    }
  }
  for (const [name] of parsed) {
    const p = byName.get(name)!;
    const missing = namesIn(parsed.get(name)!).filter((n) => !values.has(n));
    refused.push({ what: p.label || name, reason: `It reads ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not a figure the drawings gave.` });
  }

  // Items.
  const items: CheckedItem[] = [];
  for (const item of proposed.items) {
    const description = item.description?.trim();
    if (!description) continue;
    const unit = item.unit?.trim() || "";
    const wanted = dimensionsFor(unit);
    const lines: CheckedLine[] = [];
    const assumptions = new Set<string>();
    for (const [i, line] of (item.lines ?? []).entries()) {
      const what = `${description} – line ${i + 1}`;
      const dims = line.dimensions ?? [];
      if (wanted !== null && dims.length !== wanted) {
        refused.push({ what, reason: `${dims.length} ${dims.length === 1 ? "dimension" : "dimensions"} for an item in ${unit}.` });
        continue;
      }
      const exprs = [line.times?.trim() || "1", ...dims];
      const results: number[] = [];
      let reason: string | null = null;
      for (const text of exprs) {
        const r = parseExpression(String(text));
        if (!r.ok) {
          reason = `${text}: ${r.reason}`;
          break;
        }
        const loose = literalsIn(r.expr).filter((n) => !PLAIN.has(n));
        if (loose.length) {
          reason = `${loose.join(", ")} is written into "${text}" rather than read from the drawings as a figure.`;
          break;
        }
        const e = evaluate(r.expr, values);
        if (!e.ok) {
          reason = `${text}: ${e.reason}`;
          break;
        }
        if (e.value <= 0) {
          reason = `${text} comes to nought or less.`;
          break;
        }
        namesIn(r.expr).forEach((n) => checked.get(n)!.restsOn.forEach((a) => assumptions.add(a)));
        results.push(e.value);
      }
      if (reason) {
        refused.push({ what, reason });
        continue;
      }
      lines.push({
        location: line.location?.trim() || null,
        timesing: toNumeric(results[0]!),
        dimensions: results.slice(1).map(toNumeric),
        deduct: Boolean(line.deduct),
        working: exprs.map((e) => String(e).trim()).join(" × "),
      });
    }
    if (lines.length === 0) {
      refused.push({ what: description, reason: "No line of it could be measured." });
      continue;
    }
    const element = item.element?.trim().toLowerCase() ?? "";
    items.push({ section: item.section?.trim() || null, element: isElement(element) ? element : null, description, unit, lines, assumptions: [...assumptions] });
  }

  return { parameters: [...checked.values()], items, refused };
}
