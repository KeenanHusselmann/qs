/**
 * The rubric every output document is held to – one copy, read by the agent and by the reader.
 *
 * ── Why this is a file and not a page ──────────────────────────────────────────────────────
 *
 * The rubric already existed twice: as prose inside the measuring agent's prompt, and as the
 * checks in `bill-rubric.ts` that review what it produced. A third copy – a page describing them
 * both – is the version that goes stale, and a stale rubric is worse than none: it is a document
 * the practice believes is being followed while the agent follows something else.
 *
 * So the rubric lives here as data. `measure-drawings.ts` builds its prompt out of these exact
 * strings, the Rubric page renders the same objects, and `rubric.test.ts` fails if a rule the
 * platform checks has no entry here or an entry here names a check that does not exist. There is
 * one rubric, and both the machine and the reader are looking at it.
 *
 * ── What a rule is ─────────────────────────────────────────────────────────────────────────
 *
 * `rule` is the sentence itself, and it is sent to the model **verbatim** – so it is written as an
 * instruction, not as a description of one. `because` is what it costs to get wrong; that is for
 * the reader and is never sent, because a model given reasons argues with them.
 *
 * `ids` are the findings a check emits when the rule is broken. A rule with any is **checked**:
 * the platform proves it afterwards and does not rely on the model having remembered. One
 * instruction can be proved by more than one check – "measure brickforce to the course rule" is
 * both "there is none" and "there is not enough of it". A rule with none is **instructed**: the
 * agent is told, and nothing verifies it. The page says which is which, because a practice that
 * cannot tell them apart trusts the wrong half.
 */

/** A finding `reviewBill` or `reviewAllowances` can raise. The rubric must carry one rule per id. */
export const FINDING_IDS = [
  "blinding",
  "reinforcement",
  "pier-footings",
  "lintels",
  "pier-caps",
  "brickforce",
  "brickforce-rule",
  "dpc",
  "pier-dpc",
  "movement-joints",
  "primer",
  "cart-away",
  "bulking",
  "site-clearance",
  "trench-conditions",
  "steps",
  "grade",
  "plaster-spec",
  "joint-spec",
  "below-dpc-spec",
  "assumed",
  "step-overlap",
  "pier-brickforce",
  "dpc-free-standing",
  "cap-finish",
  "clean-down",
  "scour",
  "size-spec",
  "tender-notes",
  "contingency",
  "escalation",
  "preliminaries",
] as const;

export type FindingId = (typeof FINDING_IDS)[number];

export interface RubricRule {
  /** The checks that prove it. Empty where the agent is told and nothing verifies it. */
  ids?: readonly FindingId[];
  /** The rule, in the words the agent is given. Sent verbatim; shown verbatim. */
  rule: string;
  /** What it costs to get wrong. For the reader only – never sent to the model. */
  because?: string;
}

export interface RubricSection {
  /** The section's own line, which is also the heading the prompt carries. */
  heading: string;
  rules: readonly RubricRule[];
}

export interface OutputRubric {
  slug: string;
  /** The document this produces. */
  output: string;
  /** Where in the platform it is produced, and the module's path under a project. */
  producedIn: string;
  module: string;
  /** What the rubric is for, in one sentence. */
  purpose: string;
  /** Where the rules came from, so a reader can argue with the source rather than the page. */
  source: string;
  sections: readonly RubricSection[];
}

/**
 * The prompt's own rendering of a section: its heading, then one dash-bullet per rule.
 *
 * The agent's prompt is assembled from this, so the words on the page and the words in the prompt
 * cannot differ – there is nowhere for them to differ.
 */
export const prose = (section: RubricSection): string =>
  `${section.heading}\n${section.rules.map((r) => `- ${r.rule}`).join("\n")}`;

/* ── The measured bill ──────────────────────────────────────────────────────────────────── */

export const WHICH_DRAWING: RubricSection = {
  heading: "Which drawing to believe, where two differ:",
  rules: [
    {
      rule: "The ENGINEER'S drawings and structural report govern anything structural – footing size, concrete grade, reinforcement, founding depth, pier size, brickforce courses, movement joints, lintels. An architectural sheet showing a different size is superseded by them, whatever its revision date. Measure the engineer's figure, and say so in the item's description.",
      because:
        "The boundary wall was measured on the architect's superseded 460 x 500 columns while the engineer's detail said 460 x 690. Every quantity that followed – masonry, plaster, paint, the footing under it – was measured on a column that was not being built.",
    },
    {
      rule: "Where two sheets of the same kind differ, measure the LATEST revision and add an assumption saying which you used and which you set aside.",
      because: "A revision that was silently ignored is indistinguishable from one that was never received.",
    },
    {
      rule: "Never mix them: a pier measured 460 x 690 from the engineer is plastered on 460 x 690, not on the architect's 460 x 500.",
      because: "Half-applying a revision is worse than not applying it: the bill is internally inconsistent and nothing in it adds up wrong.",
    },
  ],
};

export const CARRIES_WITH_IT: RubricSection = {
  heading:
    'What a wall carries with it, and is routinely left out. Measure each where the drawings show or the engineer requires it, and where they do not, say so in "gaps":',
  rules: [
    {
      ids: ["blinding"],
      rule: "Blinding under every footing, and the founding depth that goes with it (underside of blinding, not of concrete).",
      because: "The blinding carries its own excavation depth with it, so leaving it out shortens the excavation as well.",
    },
    {
      ids: ["pier-footings"],
      rule: "Pier and column footings – the enlarged base under each pier, with its own excavation.",
      because: "A pier carries more load than the wall between it and normally sits on a base of its own.",
    },
    {
      ids: ["reinforcement"],
      rule: "REINFORCEMENT, in kilograms, from the bar schedule or the reinforcement note: diameter, spacing, each way, top and bottom, with the laps the engineer states. A footing on a structural drawing is reinforced unless that drawing says otherwise.",
      because: "The steel is often a tenth of the measured work. On the boundary wall it was 8,14 t, left out entirely, and the bill still added up.",
    },
    {
      ids: ["lintels"],
      rule: "Lintels over every opening, and the brickforce courses around them.",
      because: "Eighty-two openings with nothing over them is a variation a contractor will price after the award, at their rate rather than yours.",
    },
    {
      ids: ["pier-caps"],
      rule: "Pier caps where the architect shows one, and then the coping is measured BETWEEN piers, not over them.",
      because: "Miss the caps and the coping is over-measured by the width of every pier at the same time – two errors that hide each other.",
    },
    {
      ids: ["pier-dpc"],
      rule: "Damp-proof course to walls AND to piers – a pier is wider than the wall, so it is a separate item.",
      because: "On the boundary wall that was 170 separate pieces of DPC, measured as none.",
    },
    {
      ids: ["brickforce", "brickforce-rule", "pier-brickforce"],
      rule: "Brickforce to the engineer's course rule (every second or fourth course) over every panel, not only over openings, and into the piers where the masonry note bonds it there. A total near the wall's own length means the rule was not applied.",
      because: "Every fourth course of a 2,5 m wall is eight times the wall's length. The bill measured 830 m where the rule gives 5 894 m.",
    },
    {
      ids: ["movement-joints"],
      rule: "Movement joints at the engineer's spacing, over the full height – through the foundation masonry and the coping as well as the wall.",
      because: "A joint that stops at the superstructure does not work; a long masonry wall cracks at the point it was not taken through.",
    },
    {
      ids: ["primer"],
      rule: "Plaster to the reveals of every opening, and the paint system the specification gives – the primer as well as the finishing coats.",
      because: "A painting system is its primer and its coats. Pricing the coats alone understates it and invites a claim.",
    },
    {
      ids: ["bulking"],
      rule: "Earthworks the ground decides: site clearance over the working width (and trees counted), trench support, compaction of the bottom, and carting away BULKED – excavated material loosens by about a quarter, so the volume carted is more than the hole.",
      because: "The bulked figure on the boundary wall was 245 m³ against 113 measured – more than double, and the lorries are paid by the load.",
    },
    {
      ids: ["steps", "step-overlap"],
      rule: "On falling ground, the stepping of the footings: each step is extra excavation, concrete and masonry, AND the overlap concrete where the upper footing laps over the lower, to the length the engineer details.",
      because:
        "A long-section is the only place a step appears; a plan gives no sign of it. The overlap is the part that gets left out even when the steps are counted: on the boundary wall the signed 1 000 mm overlap was about 31 m³, R105 000 to R115 000.",
    },
    {
      ids: ["cap-finish"],
      rule: "Where the walls are painted, the paint to the copings and pier caps as well, unless the drawings leave them as cast.",
      because: "The independent review of the boundary-wall bill found the caps unpainted on a painted wall: R44 000 that no item carried.",
    },
    {
      ids: ["clean-down"],
      rule: "Cleaning down and pointing of every exposed face of face brick, semi-face or fair-faced masonry, by area.",
      because: "Exposed brickwork is cleaned down once it is built. When the boundary wall went to semi-face brick both sides, that was 2 943 m².",
    },
    {
      ids: ["scour"],
      rule: "Scour protection at the outlet of every stormwater opening through a wall – an apron, riprap or splash pad – or a gap saying the engineer must say whether the ground needs it.",
      because: "The regional geotechnical report said the soils erode under concentrated flow, and an opening through a wall concentrates it at the footing. Neither boundary-wall bill measured any.",
    },
  ],
};

export const HOW_TO_MEASURE: RubricSection = {
  heading: "How a quantity surveyor measures it – follow these:",
  rules: [
    {
      rule: "Walls are measured net between piers or columns; piers are counted separately. Count piers per straight run (a run of length L at centres c has floor(L / c) + 1 piers; runs that meet share their corner pier).",
    },
    { rule: "Where the height is to the top of a coping or cap, the brickwork height is that height less the coping." },
    { rule: "Foundation walling is measured from the top of the footing to ground level; excavation to the bottom of the footing." },
    {
      ids: ["cart-away"],
      rule: 'Backfill is the excavation, less deduction lines ("deduct": true) for the concrete and the walling below ground. Carting away is the volume of that concrete and walling – the soil they displace.',
      because: "Whatever the concrete and the masonry below ground displace has to leave the site, and it is paid for by the load.",
    },
    { rule: "Plaster and paint to piers: the exposed girth of a pier times its height (the faces not hidden by the wall), per pier." },
    { rule: "Brickforce runs the length of the panel it is in, per course." },
    { rule: "Openings, sleeves and other counted items are items in no." },
    {
      rule: "Formwork to the sides of footings cast against the excavation is not measured. Where the ground may not stand, measure it as a provisional proportion of the sides and say which proportion.",
      because: "Measured in full, the formwork to a long strip footing was up to R136 000 the contractor would never spend. The Rev 4 bill carried a 25% allowance instead.",
    },
    {
      rule: "Where an authority's conditions forbid changing the ground level – a servitude, most often – measure no topsoil strip or cut to level inside it, and say so.",
      because: "The utility's conditions for the boundary wall's servitude forbade any change in ground level, and the bill had a topsoil strip there all the same.",
    },
    {
      ids: ["dpc-free-standing"],
      rule: "A free-standing wall – a boundary, screen or garden wall – carries no horizontal DPC under SANS 10400-K clause 4.2.4.3, unless the engineer's design calls for one. Where the engineer's drawing shows one, measure it and name the conflict in \"gaps\".",
      because:
        "A membrane DPC is a slip plane: above it the wall resists overturning by its own weight alone. Measuring one because walls usually have one adds work and a weakness; leaving out one the engineer requires is the engineer's decision taken by the QS.",
    },
    {
      ids: ["assumed"],
      rule: 'A quote must name its own figure – a footing depth is quoted from a footing label, never from another element\'s dimension (the 200 in "300 X 200 STORMWATER OPENING" is not a footing depth). A figure the drawings do not label is an assumption.',
      because:
        "An assumed founding depth is the difference between a bill and a guess, and it is invisible once the figures are added up. The platform counts the items resting on one and says so.",
    },
  ],
};

/**
 * The rules that live inside the item schema rather than in a list of their own.
 *
 * These are not sent as a block – the prompt states them where it defines "description" and
 * "gaps". They are rubric all the same, and a reader looking for "why does the bill have to say
 * 25 MPa" should find the answer here rather than in a prompt they cannot see.
 */
const WHAT_A_DESCRIPTION_SAYS: RubricSection = {
  heading: "What a description must carry, because it is what decides the rate:",
  rules: [
    {
      ids: ["grade"],
      rule: "The concrete grade and aggregate, on every concrete item measured in m³.",
      because: "A contractor cannot price concrete without its strength, and 15 MPa blinding priced as structural concrete is the wrong rate on both.",
    },
    {
      ids: ["plaster-spec"],
      rule: "The plaster class, thickness and finish.",
      because: "A 12 mm steel-floated class II plaster is not the same item as a skim, and the two do not price alike.",
    },
    {
      ids: ["joint-spec"],
      rule: "The filler and the sealant in every movement joint.",
      because: "They are most of what a movement joint costs.",
    },
    {
      ids: ["below-dpc-spec"],
      rule: "For masonry below the damp course, the unit the engineer requires there – not the superstructure brick.",
      because: "Masonry below the damp course is permanently damp. A face brick specified for superstructure is the wrong unit and will be rejected on site.",
    },
    {
      ids: ["size-spec"],
      rule: "The size of every pier, cap, coping and lintel, as the drawing dimensions it.",
      because: "A size in the description is what shows it is the wrong one. The QS's draft described pier caps of 750 x 520 for piers that needed about 790 x 560, and only the stated size gave it away.",
    },
    {
      ids: ["tender-notes"],
      rule: "No query references, review notes or recommendations in a description. The tender bill describes the work; the questions go on the query sheet.",
      because: "The Rev 3 bill went for review with query numbers and \"deletion recommended\" in its descriptions. Every tenderer reads those, and prices the doubt.",
    },
    {
      ids: ["dpc"],
      rule: "The DPC material and width, and the brick and mortar class of the walling.",
      because: "A bill that says only 'brickwork' is a bill every tenderer prices differently, which is the one thing a bill exists to prevent.",
    },
  ],
};

const WHAT_CANNOT_BE_MEASURED: RubricSection = {
  heading: "What could not be measured is reported, never dropped:",
  rules: [
    {
      rule: 'Name in "gaps" what the documents require or imply that you could NOT measure – work whose figure is not on any sheet, work another discipline must confirm.',
    },
    {
      ids: ["site-clearance"],
      rule: "Site clearance over the working width, with trees counted separately.",
      because: "A wall line through bush needs clearing before anything else can start.",
    },
    {
      ids: ["trench-conditions"],
      rule: "Trench support, compaction of the bottom, and the tests that go with them.",
      because: "A trench deep enough to found a wall usually needs them, and they are priced as items, not absorbed into the excavation rate.",
    },
    {
      rule: "Preliminaries and provisional sums are not measured items – but name them in \"gaps\" where the documents show the site needs them (a surveyor's pegging certificate, a utility's supervision, the engineer's inspections, cube tests, geotechnical work, service diversions).",
      because: "The quantity surveyor prices these. An agent that measures them double-counts; one that ignores them leaves the QS to remember.",
    },
  ],
};

export const MEASURED_BILL: OutputRubric = {
  slug: "bill-of-quantities",
  output: "Bill of Quantities",
  producedIn: "Take-off",
  module: "/take-off",
  purpose:
    "What a bill measured from the drawings must contain before anybody prices it, and what the platform proves about it afterwards.",
  source:
    "A quantity surveyor's review of the boundary-wall bill this platform measured (MPS, Review of the internal Bill of Quantities, 27 September 2026). The expensive findings were not arithmetic – every figure added up – they were work that was never measured: R476 000, a fifth of the measured total. Extended from the independent review of the Rev 3 tender bill for the same wall (12 October 2026) and the fixes carried into Rev 4: the step overlap, the caps, the clean-down, the scour, the free-standing DPC and what a tender bill must not say.",
  sections: [WHICH_DRAWING, CARRIES_WITH_IT, HOW_TO_MEASURE, WHAT_A_DESCRIPTION_SAYS, WHAT_CANNOT_BE_MEASURED],
};

/* ── The elemental cost plan ────────────────────────────────────────────────────────────── */

export const COST_PLAN: OutputRubric = {
  slug: "elemental-cost-plan",
  output: "Elemental Cost Plan",
  producedIn: "Cost Plan",
  module: "/cost-plan",
  purpose: "What the allowances over a measured bill have to answer for.",
  source: "The same review, reading the plan's allowances against the bill underneath them.",
  sections: [
    {
      heading: "An allowance is read against the bill it sits on:",
      rules: [
        {
          ids: ["contingency"],
          rule: "Carry a contingency that matches how settled the bill is – 10% while the bill still has open questions of its own.",
          because: "A contingency is for what the design has not settled. Five per cent on a bill that is missing work prices two risks as one.",
        },
        {
          ids: ["escalation"],
          rule: "State the base date of the rates and the period they are expected to hold.",
          because: "A rate is a fact about a date. Without one, nobody can tell whether nil escalation is a decision or an omission.",
        },
        {
          ids: ["preliminaries"],
          rule: "Itemise the preliminaries this site needs, and keep a percentage only as a check against them.",
          because:
            "A percentage carries no site: the surveyor's pegging, the utility's supervision, the engineer's inspections and the cube tests are priced one by one, and they do not scale with the brickwork.",
        },
      ],
    },
  ],
};

/* ── The comparative evaluation of quotations ───────────────────────────────────────────── */

export const QUOTATION_EVALUATION: OutputRubric = {
  slug: "quotation-evaluation",
  output: "Comparative Evaluation of Quotations",
  producedIn: "Quotations",
  module: "/rfq",
  purpose: "How a response is read, so that the comparison between responses is of like with like.",
  source:
    "Built against a quantity surveyor's own manual audit of three engineering fee proposals (September 2026) and held to it: the platform reproduces the audit's nineteen findings and invents none.",
  sections: [
    {
      heading: "The division of labour – the model describes, the platform checks:",
      rules: [
        {
          rule: "Describe the response. You do NO arithmetic and make NO comparison: the platform checks every figure and every sum you describe.",
          because:
            "A model that adds up is a model that can be confidently wrong. Every sum in the evaluation is done by code against the figures the document prints, so an error is found rather than repeated.",
        },
        {
          rule: "NEVER a claim that figures do or do not add up, agree or match – the checker does every sum, and a risk that does arithmetic is a guess the report would repeat.",
        },
        {
          rule: "Never correct the document: if a subtotal gathers five items, sum all five even if its printed figure looks short – the checker finds errors.",
          because: "A silently corrected total is an error that leaves no trace. The whole point is to show the client the discrepancy, not to tidy it away.",
        },
      ],
    },
    {
      heading: "What is on the page, and only that:",
      rules: [
        {
          rule: 'Copy every quote CHARACTER FOR CHARACTER, at least 15 characters – including run-together digits and missing spaces exactly as they appear.',
          because: "A quote that cannot be found in the document is dropped. That is what stops the evaluation from describing a proposal nobody submitted.",
        },
        {
          rule: 'The supplier is the firm that submitted the response, as its name appears in the text – NEVER the client or person it is addressed to. Where the letterhead is an image and the name is not in the text, "supplier" is null – do not guess it.',
          because: "Naming the addressee as the supplier puts the client's own name in the comparison table as a bidder.",
        },
        {
          rule: 'Name in "unseen" what the response refers to but neither its text nor the OCR of its images contains – an annexure not attached, an image that could not be read.',
          because: "These cannot be checked, and saying so is what stops them being taken as checked.",
        },
        {
          rule: 'A requirement is "met" only where the response DOES what it asks, not where it mentions it: fees "rendered in accordance with" a guideline but priced by the hour are not fees calculated on it; a field left as a placeholder ("R[amount]") is not met.',
          because: "Mentioning a requirement is the cheapest thing a proposal can do. Scoring it as met rewards exactly that.",
        },
      ],
    },
    {
      heading: "Like for like, or not compared at all:",
      rules: [
        {
          rule: "For EACH scope item the RFQ asked for, say whether this response includes it, excludes it or does not mention it, and which line prices it.",
          because: "A cheaper fee that covers two of three services is not cheaper. The comparison is meaningless until each response is read against the same list.",
        },
        {
          rule: "A fee formula uses the figures the formula PRINTS – the cost of works it names, even where that differs from the estimate elsewhere in the response.",
          because: "Re-basing a firm's formula onto a different estimate produces a fee they never quoted, and the report would present it as theirs.",
        },
        {
          rule: "Transcribe every table of counts – hours per stage and per person – rather than summing it, and leave no money column out: every figure in every column is a line.",
          because: "A stage table that totals 105% is found by adding it up. It cannot be found in a table that was never transcribed.",
        },
      ],
    },
  ],
};

export const RUBRICS: readonly OutputRubric[] = [MEASURED_BILL, COST_PLAN, QUOTATION_EVALUATION];

/** Every rule the rubric carries, flattened – for the parity test and the page's counts. */
export const allRules = (): readonly RubricRule[] => RUBRICS.flatMap((r) => r.sections.flatMap((s) => s.rules));

/** Whether the platform proves a rule, or only asks for it. */
export const isChecked = (rule: RubricRule): boolean => (rule.ids?.length ?? 0) > 0;
