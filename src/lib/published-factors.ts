/**
 * Published resource factors — the platform's own, for work a practice has not costed yet.
 *
 * ── Why this is allowed, when §1.3 says nothing is pre-populated ───────────────────────────
 *
 * §1.3's rule is about **a project's data**: "a project's data exists because a run produced it and
 * a human approved it". That is the traceability rule — every figure on a report reaches a document
 * and a signature — and it is not bent here, because nothing in this file can reach a report. It
 * reaches a take-off, which is a calculation a QS asks for and reads on screen.
 *
 * The precedent is `DEFAULT_ASSUMPTIONS`, which ships eleven financial figures — the prime rate,
 * escalation, the discount rate — that decide whether a scheme passes a gate. Its own note gives
 * the reasoning, and it applies here word for word: *a defensible default is better than an empty
 * field, provided it is visibly the platform's rather than invisibly everybody's.*
 *
 * ── They live in code, and that is the safeguard ───────────────────────────────────────────
 *
 * Not seeded into `resource_factors`. A seeded row would be indistinguishable from one the practice
 * filed — editable, withdrawable, and indistinguishable in a year from a figure somebody vouched
 * for. Here the origin is **structural**: a factor is the practice's if and only if it is a row in
 * the table, and no flag anybody can set says otherwise.
 *
 * A practice overrides one by filing its own for the same resource. It never edits these.
 *
 * ── What is in here, and the far longer list of what is not ────────────────────────────────
 *
 * **Only what geometry fixes.** Every figure below is derived from the standard stock brick at
 * 222 × 106 × 73 mm with 10 mm joints, and can be re-derived with a calculator by anyone who
 * doubts it. That is the class of factor that is genuinely constant, genuinely publishable, and
 * genuinely not worth a practice's time to measure for itself.
 *
 * **No labour, and no plant.** This is the deliberate part. Published South African output for a
 * bricklayer runs 350–500 bricks a day working alone and 500–1 000 with an assistant — which is
 * 1,96 hours per m² of one-brick wall against 1,11, a factor of two, and **both are correct**
 * depending on the gang. Shipping a midpoint would be inventing precision and dressing it in the
 * platform's authority, which is worse than the model proposing one, not better: at least the
 * model's line says it is proposed. Labour and plant are what a practice should record, and the
 * factor table exists for them.
 *
 * So this fills the half that is fixed, the model proposes the half that is not, the practice
 * overrides anything it has measured, and every line on a take-off says which of the three it is.
 */

import type { ResourceFactor } from "@/lib/factors";

/**
 * The attribution every row here carries.
 *
 * A reserved string rather than a boolean column, because it is what a reader sees: "published ·
 * derived from a standard stock brick" tells them exactly how much authority to give the figure,
 * which "isDefault: true" would not.
 */
export const PUBLISHED_SOURCE =
  "Derived from standard stock brick 222 × 106 × 73 mm, 10 mm joints";

/**
 * A published factor, in the same shape a filed one has.
 *
 * The id is prefixed `published:` so a row from here is recognisable in a log or a test even when
 * it has travelled through code that does not know the difference — but nothing depends on parsing
 * it, because these never enter the table and the caller always knows where they came from.
 */
const factor = (
  work: string,
  resource: string,
  resourceUnit: string,
  quantity: string,
  kind: ResourceFactor["kind"] = "material",
): ResourceFactor => ({
  id: `published:${work}:${resource}`.toLowerCase().replace(/\s+/g, "-"),
  work,
  workUnit: "m2",
  kind,
  resource,
  resourceUnit,
  quantity,
  /*
    No waste allowance stated, deliberately.

    Cutting and breakage depend on the site, the handling and the pattern — a corner-heavy plan
    wastes more brick than a long straight boundary wall. The geometry does not fix it, so nothing
    here claims to, and `asFactor` leaves it undefined so the method's own allowance applies.
  */
  wasteRate: null,
  // Geometry is not provincial.
  region: null,
  source: PUBLISHED_SOURCE,
  /*
    The date the derivation was made, not a price date.

    `factorsFor` filters on `effectiveDate <= asAt`, so this has to be a real past date or these
    would be invisible. A brick's dimensions are not a fact about a date the way a price is, but
    the column is shared and honesty is cheaper than a special case.
  */
  effectiveDate: "2026-01-01",
});

/**
 * Every factor the platform publishes.
 *
 * Two kinds of walling, two figures, both re-derivable with a calculator:
 *
 *     face area of one brick with joints = 0,232 × 0,083   = 0,019256 m²
 *     half-brick wall                    = 1 ÷ 0,019256    =  51,9 bricks/m²
 *     one-brick wall                     = 2 ÷ 0,019256    = 103,9 bricks/m²
 *
 * **Two, and not the four this began as.** Mortar was derived too and then withdrawn — the note
 * below the list says why, and it is the most useful thing in this file.
 *
 * Short on purpose. A long list of plausible constants nobody derived would be the thing this
 * platform exists to refuse — every addition here needs a derivation or a citation in the comment
 * beside it, and anything that has neither belongs in the practice's own table instead.
 */
export const PUBLISHED_FACTORS: readonly ResourceFactor[] = [
  factor("Half-brick wall in stock brick", "Stock brick", "no", "51.9000"),
  factor("One-brick wall in stock brick", "Stock brick", "no", "103.9000"),
];

/*
  ── Why mortar is derived above and not published ────────────────────────────────────────────

  The volume is sound — 0,0168 m³/m² half-brick and 0,0435 one-brick, being the wall less the
  bricks — and publishing it still caused a real fault, found by running it rather than by reading
  the code.

  A held factor overrides a proposed one **by resource**, and that only works when the two describe
  the same thing at the same granularity. The model decomposes mortar into its constituents —
  cement, sand — while a published "Mortar" line is the aggregate. Neither overrides the other,
  both survive, and the wall is given its mortar twice: once as mortar and once as the cement and
  sand that make it. The total counted both.

  A double-counted order is worse than a missing one, because nothing about it looks wrong.

  So only resources the model proposes as discrete items are published, and brick is the clear
  case. The general lesson is worth more than the two rows: **a partial factor set and a proposed
  method are two decompositions of one piece of work, and merging them by name is only safe where
  the granularity agrees.** Anything published here must be checked against what the method
  actually returns before it is added.
*/
