/**
 * Proposing the *method* behind a rate — PLATFORM.md §4.8, §1.3.1.
 *
 * ── The ASAQS finding, turned into a design ────────────────────────────────────────────────
 *
 * The Association of South African Quantity Surveyors asked ChatGPT to price a one-brick wall in
 * Gauteng. It answered about R215/m², drew its inputs from essentially one website, and practising
 * quantity surveyors assessed the result inaccurate: it could not account for project size, site
 * conditions, or the unknowns a QS allows for. A follow-up piece is titled "Quantity Surveyors
 * concur that AI estimating results should be Assessed Inaccurate".
 *
 * They are right, and the mistake is in the question. **Asking a language model what something
 * costs is asking it to remember a number.** It will produce a plausible one and there is nothing
 * behind it.
 *
 * So this never asks. It asks what a square metre of one-brick walling is *made of* — bricks,
 * mortar, a bricklayer's time — and takes back **quantities only**. Those are measurement facts:
 * stable across years, published in every measurement standard, and wrong in a way a QS spots
 * instantly. The money is then the practice's own, from the rate library, each component priced
 * from a row somebody curated with its source and its date.
 *
 * The model supplies the method. The practice supplies the money. What ASAQS also said AI *should*
 * do — "handling repetitive, data-intensive tasks", with the profession controlling the data — is
 * exactly this shape.
 *
 * ── A price in the reply is a failure, not a bonus ─────────────────────────────────────────
 *
 * `readMethod` drops any component whose description carries a currency amount, and the schema has
 * no field for one. This is the same discipline as `HAS_FIGURE` in `advisor.ts`: a rule the reader
 * is protected by rather than a request the prompt makes politely.
 */

import { askForJson, type Usage } from "@/lib/agent/deepseek";
import { COMPONENT_KINDS, type ComponentKind } from "@/lib/pricing";

/** One line of a proposed method — what goes into a single unit of the bill item, and how much. */
export interface MethodComponent {
  kind: ComponentKind;
  /** What it is, in the words a rate library would file it under. */
  description: string;
  /** The unit that quantity is in — "no", "m3", "hour", "kg". */
  unit: string;
  /** Per **one** unit of the bill item. 104 bricks in a m² of walling, not in the whole wall. */
  quantity: string;
}

export interface Method {
  components: MethodComponent[];
  /** Percent, as a whole number. The allowance for cutting and breakage, not a contingency. */
  wastePercent: number;
  /** What the model wants the reader to know it assumed. Prose, never a figure. */
  note: string | null;
  usage: Usage;
}

const SYSTEM = `You are assisting a South African quantity surveyor building up a unit rate.

You are given one item of measurable work from a Bill of Quantities. Return the RESOURCES that go
into producing ONE unit of that item, as json.

THE RULE THAT MATTERS MOST: never state a price, a rate, a cost or any amount of money. Not in a
number, not in a description, not in the note. You are stating a METHOD, not a valuation. The
quantity surveyor's own rate library supplies every price. A money figure from you would be a
number with nothing behind it, and it will be discarded.

For each resource give:
  kind        one of: labour, material, plant, subcontract, other
  description what it is, in the plain words a rate library would file it under
              ("Stock bricks", "Bricklayer", "Cement, 42,5N", "Concrete mixer")
  unit        the unit that resource is measured in ("no", "m3", "m2", "kg", "t", "hour", "day")
  quantity    how much of it goes into ONE unit of the bill item, as a decimal string

Quantities are per single unit. A square metre of one-brick walling takes about 104 bricks, not the
whole wall's worth. Use South African practice: SANS/ASAQS standard outputs, metric units, and a
comma or a point for the decimal is fine.

Also give:
  wastePercent  a whole number, the allowance for cutting and breakage on materials
  note          one sentence on anything you assumed that a QS should check, or null

Be honest about the limits of what you can know. If the item is too vague to decompose — "sundry
builder's work", "provisional sum" — return an empty components array and say why in the note.

Return json of the shape:
{"components":[{"kind":"material","description":"...","unit":"no","quantity":"104"}],
 "wastePercent":5,"note":"..."}`;

/** Anything that looks like money in prose — "R 1 850", "1850 rand", "ZAR 1850". */
const MONEY = /(\bR\s*\d)|(\bZAR\b)|(\brand\b)|(\bcost\b)|(\bprice\b)/i;

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Read a proposed method, refusing anything that is a price rather than a quantity.
 *
 * Exported for tests. Every rule below is a rule the reader is protected by: a component that
 * arrives with money in it is dropped rather than shown, because the entire claim of this feature
 * is that no figure here came from the model.
 */
export function readMethod(json: unknown, usage: Usage): Method {
  const object = (json ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(object.components) ? object.components : [];

  const components: MethodComponent[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const line = entry as Record<string, unknown>;

    const kind = str(line.kind).toLowerCase() as ComponentKind;
    if (!COMPONENT_KINDS.includes(kind)) continue;

    const description = str(line.description);
    const unit = str(line.unit);
    if (description === "" || unit === "") continue;

    // The rule this file exists for. A priced component is a failed proposal, not a better one.
    if (MONEY.test(description)) continue;

    /*
      A quantity is a number, and the model writes it as text. A comma decimal is South African and
      correct (§7.7); anything that is not a plain positive decimal after that is not a quantity and
      is dropped rather than guessed at.
    */
    const quantity = str(line.quantity).replace(",", ".").replace(/\s/g, "");
    if (!/^\d*\.?\d+$/.test(quantity) || Number(quantity) <= 0) continue;

    components.push({ kind, description, unit, quantity });
  }

  const waste = Number(object.wastePercent);
  const note = str(object.note);

  return {
    components,
    // Bounded, for `assumption-set.ts`'s reason: a decimal in the wrong place fails nothing
    // downstream, it just quietly inflates every rate built this way.
    wastePercent: Number.isFinite(waste) && waste >= 0 && waste <= 25 ? Math.round(waste) : 0,
    note: note === "" || MONEY.test(note) ? null : note,
    usage,
  };
}

/**
 * Ask what an item is made of.
 *
 * The description and unit are all it is given — no rates, no other rows, no project. It cannot
 * price what it cannot see, and it is not being asked to.
 */
export async function proposeMethod(
  description: string,
  unit: string,
  signal?: AbortSignal,
): Promise<Method> {
  const { json, usage } = await askForJson({ purpose: "rate.buildup",
    system: SYSTEM,
    user: `Bill item: ${description}\nMeasured in: ${unit}\n\nWhat goes into one ${unit} of this?`,
    maxTokens: 800,
    signal,
  });

  return readMethod(json, usage);
}
