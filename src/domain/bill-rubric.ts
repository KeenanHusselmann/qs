/**
 * What a measured bill is checked against before anybody prices it – D1.2.
 *
 * ── Where this came from ───────────────────────────────────────────────────────────────────
 *
 * A quantity surveyor reviewed the boundary-wall bill this platform measured and found six classes
 * of oversight (MPS, *Review of the internal Bill of Quantities*, 27 September 2026). The
 * expensive ones were not arithmetic — every figure added up — they were **work that was never
 * measured at all**: no blinding under the footings, no reinforcement, no pier footings, no
 * lintels over 82 openings, no pier caps, brickforce measured at the openings only instead of to
 * the engineer's course rule, and carting away left unbulked. On the bill's own rates that was
 * R476 000, a fifth of the measured work, before the items it had no rate for.
 *
 * A prompt alone cannot hold that. The measuring agent is told to measure these things — and a
 * better prompt does help — but "did it remember?" is a question a machine should answer, not a
 * reviewer. So this is the other half: given what was measured, it says what is conspicuously
 * absent, and it says so in a QS's terms, with what to do about it.
 *
 * ── The rule this file follows ─────────────────────────────────────────────────────────────
 *
 * **A finding is a question, never a correction.** Nothing here adds a quantity, and nothing here
 * is a refusal: a wall genuinely built without piers has no pier caps, and a bill for one is
 * right. Each finding says what the documents would normally require, what is missing, and what it
 * would cost to be wrong — so a QS can dismiss it in a second or act on it.
 *
 * It is deliberately not a completeness score. There is no number that means "this bill is
 * finished", and printing one would invite exactly the false comfort the review found.
 */

import type { FindingId } from "@/domain/rubric";

/**
 * A finding's id, which is also the id of the rubric rule it breaks.
 *
 * Typed against the rubric rather than left as a string, so a check added here without a rule
 * written for it does not compile. The rubric is what the practice reads; a check the practice
 * cannot read about is a standard being enforced in private.
 *
 * The suffixed form carries the item the finding is about - `grade:Mass concrete in trench` -
 * because four of these fire per offending item rather than once for the bill.
 */
export type Id = FindingId | `${FindingId}:${string}`;

export type Severity = "high" | "medium" | "low";

export interface RubricItem {
  description: string;
  unit: string;
  /** The measured total. Null where nothing has been measured yet. */
  quantity: number | null;
  section?: string | null;
  /** Whether the quantity rests on a figure nobody read – an assumption. */
  assumed?: boolean;
}

export interface Finding {
  id: Id;
  severity: Severity;
  /** What is missing or wrong, in a sentence a QS would write. */
  finding: string;
  /** Why it matters – what it changes, or what it risks. */
  matters: string;
  /** What to do about it. */
  action: string;
}

const has = (items: readonly RubricItem[], re: RegExp) => items.some((i) => re.test(i.description.toLowerCase()));
const find = (items: readonly RubricItem[], re: RegExp) => items.filter((i) => re.test(i.description.toLowerCase()));
const total = (items: readonly RubricItem[], re: RegExp) => find(items, re).reduce((sum, i) => sum + (i.quantity ?? 0), 0);

/*
  The vocabulary a South African bill uses for each thing this rubric looks for.

  Written once, here, because every rule needs the same words and a rule that spells them its own
  way is a rule that silently stops matching when somebody writes "d.p.c." instead of "DPC".
*/
const CONCRETE = /concrete|footing|foundation base|blinding/;
const FOOTING = /(strip )?footing|foundation (concrete|base)/;
const BLINDING = /blinding|binding layer|50\s*mm.*(15|10)\s*mpa/;
const REINFORCEMENT = /reinforce|\bbar\b|\bY\s?\d{2}\b|mesh|ref\s?\d{3}/i;
const PIER = /\bpier|\bcolumn/;
const PIER_FOOTING = /(pier|column).*(footing|base|pad)|(footing|base|pad).*(pier|column)/;
const CAP = /\bcap\b|pier cap|column cap/;
const COPING = /coping|capping/;
const OPENING = /opening|sleeve|duct|pipe through/;
const LINTEL = /lintel/;
const DPC = /damp[- ]proof|\bdpc\b/;
const BRICKFORCE = /brickforce|brick force|wall reinforcement|truss.?type/;
const JOINT = /movement joint|expansion joint|control joint/;
const WALLING = /walling|brickwork|masonry|\bwall\b/;
const PLASTER = /plaster|render|screed to wall/;
const PAINT = /paint|coating/;
const PRIMER = /primer|undercoat|sealer/;
/** The digging itself. "Excavated material" in a backfill or cart-away description is not it. */
const EXCAVATION = /excavat(e|ion|ing)\b/;
const CART = /cart(ing)? away|remove from site|spoil/;
const BACKFILL = /backfill|filling to trench/;
const CLEARANCE = /site clearance|clear (the )?site|grub|bush clearing|remove trees/;
const SUPPORT = /support to|planking and strutting|shoring/;
const COMPACTION = /compact/;
const STEP = /\bstep(s|ped|ping)?\b/;
const OVERLAP = /overlap/;
/** Masonry left exposed: face brick, semi-face, fair-faced. "Both faces" of a plastered wall is not it. */
const FACEWORK = /face ?brick|semi[- ]face|fair[- ]?faced/;
const CLEAN_DOWN = /clean(ing)? down|clean(ing)? and point|pointing/;
const STORMWATER = /storm ?water|weep ?hole/;
const SCOUR = /scour|apron|rip-?rap|splash|erosion|outlet protection|stone pitching/;
/** A wall standing on its own – the kind SANS 10400-K says carries no horizontal DPC. */
const FREE_STANDING = /boundary wall|free[- ]?standing|screen wall|garden wall/;
/** What a tender bill should never say: the reviewer's notes, left in the description. */
const REVIEW_NOTE = /\bq\d{1,3}\b|\bquer(y|ies)\b|deletion recommended|recommend(ed)? (deletion|omission)|\btb[cad]\b|to be confirmed/i;
/** A size in a description: "460 x 690", "360 mm wide", "50mm". */
const SIZE = /\d\s*(x|×)\s*\d|\d\s*mm/i;

/**
 * The bill, reviewed.
 *
 * `items` is what has been measured. Everything else is optional context: where a caller knows the
 * engineer specified something, it can say so, and the rule stops guessing.
 */
export function reviewBill(
  items: readonly RubricItem[],
  context: { reinforcedDesign?: boolean; slopingGround?: boolean; freeStanding?: boolean } = {},
): Finding[] {
  const findings: Finding[] = [];
  const add = (id: Id, severity: Severity, finding: string, matters: string, action: string) => findings.push({ id, severity, finding, matters, action });
  if (items.length === 0) return findings;

  const hasFooting = has(items, FOOTING) && has(items, CONCRETE);
  const piers = find(items, PIER).filter((i) => i.unit === "no");
  const pierCount = piers.reduce((sum, i) => sum + (i.quantity ?? 0), 0);
  const openings = find(items, OPENING).filter((i) => i.unit === "no");
  const openingCount = openings.reduce((sum, i) => sum + (i.quantity ?? 0), 0);
  /*
    Whether the wall stands on its own. The caller may know; otherwise the bill usually says so in
    its own words ("boundary wall"), in a description or a section heading.
  */
  const freeStanding =
    context.freeStanding ?? items.some((i) => FREE_STANDING.test(`${i.section ?? ""} ${i.description}`.toLowerCase()));

  // ── The work that gets left out ─────────────────────────────────────────────────────────
  if (hasFooting && !has(items, BLINDING)) {
    add(
      "blinding",
      "high",
      "Footing concrete is measured, but no blinding under it.",
      "A structural design normally calls for 50 mm of blinding under every footing, and it carries its own excavation depth with it.",
      "Measure blinding to the engineer's detail, or record that the design does not require it.",
    );
  }
  if (hasFooting && context.reinforcedDesign !== false && !has(items, REINFORCEMENT)) {
    add(
      "reinforcement",
      "high",
      "Footing concrete is measured with no reinforcement.",
      "A footing designed by an engineer is reinforced unless the design says otherwise, and the steel is often a tenth of the measured work. On the boundary wall this was 8,14 t left out.",
      "Measure the bars the structural drawing schedules, in kilograms, or record that the design is unreinforced.",
    );
  }
  if (hasFooting && pierCount > 0 && !has(items, PIER_FOOTING)) {
    add(
      "pier-footings",
      "high",
      `Piers are counted (${pierCount}) but no pier footings are measured.`,
      "A pier carries more load than the wall between it and normally sits on an enlarged base, with its own excavation.",
      "Measure the pier bases from the structural detail, with the extra excavation they need.",
    );
  }
  if (openingCount > 0 && !has(items, LINTEL)) {
    add(
      "lintels",
      "high",
      `${openingCount} openings are counted, with nothing over them.`,
      "Every opening in masonry needs a lintel or an arch. Eighty-two of them is an item a contractor will price as a variation.",
      "Measure the lintel the engineer specifies over each opening, and the brickforce courses around it.",
    );
  }
  if (pierCount > 0 && has(items, COPING) && !has(items, CAP)) {
    add(
      "pier-caps",
      "medium",
      "The wall is coped but the piers have no caps.",
      "Where the architect shows a separate pier cap, the coping is measured between piers – otherwise the coping is over-measured and the caps are missing.",
      "Measure pier caps by number and reduce the coping to the length between piers.",
    );
  }
  if (has(items, WALLING) && !has(items, BRICKFORCE)) {
    add(
      "brickforce",
      "medium",
      "No brickforce is measured in the walling.",
      "An engineer's masonry note normally calls for brickforce every second or fourth course throughout, not only over openings.",
      "Measure brickforce to the course rule on the structural drawing, over the full length of every panel.",
    );
  } else if (has(items, BRICKFORCE)) {
    /*
      Brickforce shorter than the wall it is in.

      A course rule – every second or fourth course – puts several metres of brickforce in every
      metre of wall, so a total under the wall's own length means it was measured somewhere
      particular, usually over the openings, and the rule was never applied. On the boundary wall
      it was 830 m against 5 894 m.
    */
    const run = Math.max(total(items, DPC), total(items, COPING));
    const laid = total(items, BRICKFORCE);
    // Two courses' worth is the floor: every fourth course of a 2,5 m wall is eight times the
    // wall's length, and even every tenth course is more than two. Under that, it was patched in.
    if (run > 0 && laid > 0 && laid < run * 2) {
      add(
        "brickforce-rule",
        "medium",
        `Brickforce (${laid.toFixed(2)} m) is barely more than the wall's own length (${run.toFixed(2)} m) – fewer than two courses' worth.`,
        "Brickforce laid every second or fourth course runs several times the length of the wall. A total under it means the course rule was never applied – on the boundary wall, the openings were measured and the panels were not.",
        "Measure brickforce to the course rule on the structural drawing, over every panel.",
      );
    }
    if (pierCount > 0 && !find(items, BRICKFORCE).some((i) => PIER.test(i.description.toLowerCase()))) {
      add(
        "pier-brickforce",
        "low",
        "Brickforce is measured in the panels but not into the piers.",
        "Where the engineer's note bonds the brickforce into the piers, each course runs the pier's width further at every pier. On the boundary wall that was R14 000.",
        "Check the masonry note; where it takes brickforce into the piers, measure that length per course per pier.",
      );
    }
  }
  /*
    A damp-proof course, and the wall that should not have one.

    SANS 10400-K clause 4.2.4.3 (deemed-to-satisfy) says no horizontal DPC is provided in a
    free-standing wall: a membrane is a plane with no bond across it, so above it the wall resists
    overturning by its own weight alone. So a free-standing wall without a DPC is not a gap, and one
    with a DPC is a question for the engineer, not a correction. On the boundary wall the engineer's
    signed note kept the DPC, and that is the engineer's call to make in writing.
  */
  if (has(items, WALLING) && !has(items, DPC) && !freeStanding) {
    add("dpc", "medium", "No damp-proof course is measured.", "Masonry below and above ground needs a DPC, and piers need it at their own width.", "Measure the DPC the drawings specify, to walls and to piers.");
  }
  if (freeStanding && has(items, DPC)) {
    add(
      "dpc-free-standing",
      "low",
      "A damp-proof course is measured in a free-standing wall.",
      "SANS 10400-K clause 4.2.4.3 provides no horizontal DPC in a free-standing wall: a membrane is a slip plane, and above it the wall stands on its own weight. If the engineer's rational design keeps it, the bill is right; if not, it is work and a weakness nobody asked for.",
      "Ask the engineer to confirm the DPC in writing, with the slip-plane check, or delete it.",
    );
  }
  if (has(items, DPC) && pierCount > 0 && find(items, DPC).every((i) => i.unit === "m")) {
    add(
      "pier-dpc",
      "low",
      "The DPC is measured in metres of wall only.",
      "A pier is wider than the wall, so its DPC is a separate item – on the boundary wall, 170 of them.",
      "Add the DPC to piers, by number or by area.",
    );
  }
  if (has(items, WALLING) && !has(items, JOINT)) {
    add("movement-joints", "medium", "No movement joints are measured in the walling.", "A long masonry wall cracks without them, and they run through the foundation masonry and the coping as well as the superstructure.", "Measure the joints at the engineer's spacing, over the full height.");
  }
  if (has(items, PAINT) && !has(items, PRIMER)) {
    add("primer", "low", "Paint is measured without a primer or sealer coat.", "A painting system is a primer and its finishing coats; pricing the coats alone understates it.", "Measure the system the specification gives – primer plus the finishing coats.");
  }
  if (has(items, PAINT) && (has(items, COPING) || has(items, CAP)) && !find(items, PAINT).some((i) => /coping|capping|\bcaps?\b/.test(i.description.toLowerCase()))) {
    add(
      "cap-finish",
      "low",
      "The walls are painted, but nothing is measured to the copings or caps.",
      "Where the architect paints the wall, the coping and the pier caps are usually painted with it – on the boundary wall, R44 000 that no item carried.",
      "Measure the paint to copings and caps, or record that they are left as cast.",
    );
  }
  if (has(items, FACEWORK) && !has(items, CLEAN_DOWN)) {
    add(
      "clean-down",
      "medium",
      "Face or fair-faced brickwork is measured with no cleaning down.",
      "Exposed brickwork is cleaned down and pointed once it is built, each face that shows. On the boundary wall in semi-face brick that was 2 943 m².",
      "Measure cleaning down by area for every exposed face.",
    );
  }

  // ── Earthworks that the ground, not the drawing, decides ────────────────────────────────
  if (has(items, EXCAVATION) && !has(items, CART)) {
    add("cart-away", "medium", "Excavation is measured with nothing carted away.", "Whatever the concrete and the walling below ground displace has to leave the site.", "Measure the surplus for carting away.");
  } else if (has(items, EXCAVATION) && has(items, CART) && has(items, BACKFILL)) {
    /*
      Bulking.

      Soil loosens when it is dug – about a quarter more by volume – so the lorries carry more than
      the hole gives up. A cart-away quantity that is exactly the excavation less the backfill is
      the tell-tale that nobody applied it; on the boundary wall the bulked figure was 245 m³
      against 113 measured, more than double.
    */
    const dug = items.filter((i) => EXCAVATION.test(i.description.toLowerCase()) && !CART.test(i.description.toLowerCase()) && !BACKFILL.test(i.description.toLowerCase()));
    const surplus = dug.reduce((sum, i) => sum + (i.quantity ?? 0), 0) - total(items, BACKFILL);
    const carted = total(items, CART);
    if (surplus > 0 && carted > 0 && Math.abs(carted - surplus) / surplus < 0.02) {
      add(
        "bulking",
        "medium",
        `Carting away (${carted.toFixed(2)} m³) is the excavation less the backfill, unbulked.`,
        "Excavated material bulks by about 25%, so the volume carted is that much more than the hole it came from.",
        "Apply the bulking factor the practice uses, or state the one assumed.",
      );
    }
  }
  if (has(items, EXCAVATION) && !has(items, CLEARANCE)) {
    add("site-clearance", "low", "No site clearance is measured.", "A wall line through bush needs clearing, and trees are counted separately.", "Measure clearance over the working width, and count the trees.");
  }
  if (has(items, EXCAVATION) && !has(items, SUPPORT) && !has(items, COMPACTION)) {
    add(
      "trench-conditions",
      "low",
      "No trench support, compaction or testing is measured.",
      "A trench deep enough to found a wall usually needs support, compaction of the bottom and a test or two – and they are priced as items, not absorbed.",
      "Measure them, or record that the ground conditions do not require them.",
    );
  }
  // Only where no step is measured: the finding says nothing is, and a bill that measured them was
  // told it had not.
  if (context.slopingGround && hasFooting && !has(items, STEP)) {
    add("steps", "medium", "Nothing is measured for stepping the footings.", "On falling ground a strip footing steps, and each step adds excavation, concrete and masonry.", "Measure the steps from the long-section, or record the ground as level.");
  }
  if (hasFooting && has(items, STEP) && !has(items, OVERLAP)) {
    add(
      "step-overlap",
      "high",
      "The footings step, but no overlap concrete is measured at the steps.",
      "At a step the upper footing laps over the lower by the length the engineer details, and that concrete is on top of the strip. On the boundary wall the signed detail's 1 000 mm overlap was about 31 m³ – R105 000 to R115 000.",
      "Measure the overlap at every step to the engineer's detail, with the excavation under it.",
    );
  }
  const stormwater = find(items, STORMWATER).filter((i) => i.unit === "no");
  if (stormwater.length > 0 && !has(items, SCOUR)) {
    add(
      "scour",
      "medium",
      `${stormwater.reduce((sum, i) => sum + (i.quantity ?? 0), 0)} stormwater openings are counted, with nothing at their outlets.`,
      "Water let through a wall concentrates at each opening, and soils that erode under concentrated flow undermine the footing from there. Neither boundary-wall bill had any.",
      "Measure scour protection at each outlet – an apron, riprap or splash pad – or ask the engineer whether the ground needs it.",
    );
  }

  // ── What the description does not say ───────────────────────────────────────────────────
  for (const item of items.filter((i) => /concrete/.test(i.description.toLowerCase()) && i.unit === "m3" && !/blinding/.test(i.description.toLowerCase()))) {
    if (!/\d+\s*mpa/i.test(item.description)) {
      add(`grade:${item.description.slice(0, 40)}` as Id, "medium", `"${item.description}" does not state a concrete grade.`, "A contractor cannot price concrete without its strength, and 15 MPa blinding priced as structural concrete is the wrong rate.", "Put the grade and the aggregate the engineer specifies into the description.");
    }
  }
  for (const item of find(items, PLASTER)) {
    if (!/\d+\s*mm|class|steel[- ]float|wood[- ]float/i.test(item.description)) {
      add(`plaster-spec:${item.description.slice(0, 40)}` as Id, "low", `"${item.description}" does not state a thickness, class or finish.`, "Plaster is priced by what it is – a 12 mm steel-floated class II plaster is not the same item as a skim.", "Describe the class, the thickness and the finish.");
    }
  }
  for (const item of find(items, JOINT)) {
    if (!/filler|sealant|sealer|polysulphide|jointex/i.test(item.description)) {
      add(`joint-spec:${item.description.slice(0, 40)}` as Id, "low", `"${item.description}" does not say what fills or seals it.`, "The filler and the sealant are most of the cost of a movement joint.", "Name the filler and the sealant from the specification.");
    }
  }
  /*
    A counted or run item that does not say how big it is. A cap or a coping is priced by its size,
    and the size in the description is what lets anyone see it is the wrong one – a pier cap of
    750 x 520 under a pier that needs 790 x 560 is only visible if the bill says 750 x 520.
  */
  for (const item of items.filter(
    (i) =>
      ((i.unit === "no" && (PIER.test(i.description.toLowerCase()) || CAP.test(i.description.toLowerCase()) || LINTEL.test(i.description.toLowerCase()))) ||
        (i.unit === "m" && (COPING.test(i.description.toLowerCase()) || LINTEL.test(i.description.toLowerCase())))) &&
      ![BRICKFORCE, DPC, PLASTER, PAINT, JOINT].some((re) => re.test(i.description.toLowerCase())),
  )) {
    if (!SIZE.test(item.description)) {
      add(`size-spec:${item.description.slice(0, 40)}` as Id, "low", `"${item.description}" does not state its size.`, "A pier, cap, coping or lintel is priced by its size, and a size in the description is what lets anyone see it is the wrong one.", "Put the dimensions from the drawing into the description.");
    }
  }
  // A tender bill describes the work. The reviewer's questions belong on the query sheet.
  for (const item of items.filter((i) => REVIEW_NOTE.test(i.description))) {
    add(`tender-notes:${item.description.slice(0, 40)}` as Id, "medium", `"${item.description}" carries a review note, not a description.`, "A query reference or a recommendation in a description goes out to every tenderer, who will price the doubt rather than the work.", "Move the note to the query sheet and describe only the work.");
  }
  /*
    Masonry below the damp course is a different brick from the one above it.

    What says so is the unit's durability class, not its size, shape or strength. SANS 227 puts
    clay units for damp conditions and below DPC in NFX (non-facing extra); NFP is the plaster
    brick for superstructure, and engineering units are the other answer. So "NFP", "imperial" and
    "solid" never said it – the check used to accept all three – and neither does "class II", which
    on a masonry item is the mortar. A strength alone does not either: a 14 MPa NFP is still a
    plaster brick. The engineer's own words ("suitable for moist exposure below DPC") do.
  */
  for (const item of find(items, /foundation walling|walling below (ground|dpc)|substructure walling/)) {
    if (!/engineering|\bnfx\b|suitable (for|in) (moist|damp|wet|use below|below)/i.test(item.description)) {
      add(
        `below-dpc-spec:${item.description.slice(0, 40)}` as Id,
        "medium",
        `"${item.description}" does not say the units are suitable below ground.`,
        "Masonry below the damp course is permanently damp; a face brick, or a stock or NFP brick specified for superstructure, is the wrong unit.",
        "Describe the unit the engineer requires below DPC – NFX or engineering units, not NFP.",
      );
    }
  }

  // ── What rests on a figure nobody read ──────────────────────────────────────────────────
  const assumed = items.filter((i) => i.assumed);
  if (assumed.length > 0) {
    add(
      "assumed",
      "high",
      `${assumed.length} item${assumed.length === 1 ? "" : "s"} rest${assumed.length === 1 ? "s" : ""} on a figure nobody read: ${assumed.slice(0, 3).map((i) => i.description).join("; ")}${assumed.length > 3 ? "; …" : ""}.`,
      "An assumed founding depth or footing width is the difference between a bill and a guess, and it is invisible once the figures are added up.",
      "Confirm each with the engineer, or mark the bill provisional until they are.",
    );
  }

  return findings.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity]);
}

/** What the cost plan's allowances say, against what the bill underneath them is worth. */
export interface AllowanceReview {
  preliminariesPct: number;
  contingencyPct: number;
  escalationPct: number;
  /** Whether a base date for the rates has been stated. */
  rateBaseDate?: string | null;
  /** Findings from the bill – a plan over an incomplete bill needs a wider contingency. */
  billFindings?: readonly Finding[];
}

export function reviewAllowances(a: AllowanceReview): Finding[] {
  const findings: Finding[] = [];
  const open = (a.billFindings ?? []).filter((f) => f.severity === "high").length;

  if (a.contingencyPct < 10 && open > 0) {
    findings.push({
      id: "contingency" as const,
      severity: "high",
      finding: `Contingency is ${a.contingencyPct}% over a bill with ${open} open question${open === 1 ? "" : "s"} of its own.`,
      matters: "A contingency is for what the design has not settled. Five per cent on a bill that is missing work is two risks priced as one.",
      action: "Carry 10% until the questions on the bill are closed, or close them first.",
    });
  }
  if (a.escalationPct === 0 && !a.rateBaseDate) {
    findings.push({
      id: "escalation" as const,
      severity: "medium",
      finding: "Escalation is nil and the rates carry no base date.",
      matters: "A rate is a fact about a date. Without one, nobody can tell whether nil escalation is a decision or an omission.",
      action: "State the base date of the rates and the period they are expected to hold.",
    });
  }
  if (a.preliminariesPct > 0) {
    findings.push({
      id: "preliminaries" as const,
      severity: "medium",
      finding: `Preliminaries are a flat ${a.preliminariesPct}% of measured work.`,
      matters: "A percentage carries no site: the surveyor's pegging, the utility's supervision, the engineer's inspections and the cube tests are items a contractor prices one by one, and they do not scale with the brickwork.",
      action: "Itemise the preliminaries this site needs, and keep the percentage only as a check against them.",
    });
  }
  return findings;
}
