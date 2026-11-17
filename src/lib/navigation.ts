/**
 * What the platform has, and what a project has.
 *
 * ── This is not the process model ──────────────────────────────────────────────────────────
 *
 * The BPMN hierarchy lives in `process-model.ts` and belongs **on the project overview**, not in
 * the chrome. The v3 portal shipped it as a sidebar tree and removed it on client feedback: eight
 * domains and 52 areas made the nav the tallest thing in the shell, so a reader working on one step
 * scrolled past the firm's entire process library to reach Settings. The question it answers —
 * *"what else is there, and what can this platform actually do?"* — is one people ask **about a
 * project, once, while looking at that project.** A page question, not a chrome question.
 *
 * So the nav is the handful of places that exist, named as construction work: Take-off, Bill of
 * Quantities, Valuations, Variations. Not "D2.1 Project Initiation & Charter" — a QS navigates by
 * the artefact they are working on, never by a process-area code.
 *
 * ── Labels are Title Case ──────────────────────────────────────────────────────────────────
 *
 * Every significant word capitalised: "Site & Zoning", "Cost Report", "Bill of Quantities". Minor
 * words inside a term stay lowercase, which is why it is *of* Quantities — that is how §4.7 and
 * §9.1 write it, and the domain's spelling of its own document beats a mechanical rule.
 *
 * These labels are not decoration: `module-page.tsx` renders the matching one as the page `<h1>`
 * and `placement.ts` uses them to say where a document landed. Change one here and it changes
 * everywhere, which is the point — there is one list.
 *
 * ── Where the items came from ──────────────────────────────────────────────────────────────
 *
 * Three sources, reconciled:
 *
 *  - **The Mzilikazi QS platform**, whose nav is the working list a QS on affordable housing
 *    actually uses: Dashboard · Project Inputs · Data Import · BoQ Builder · Repetition Designer ·
 *    Tender Room · Rate Library · Cash Flow · Approvals · Settings. Repetition
 *    Designer and Approvals were never built and were removed in the simplification of 16 Nov 2026,
 *    with the site-administration places (programme, claims, meetings, compliance, handover).
 *  - **WinQS**, for the commercial chain it has proven over twenty years — cost plan → take-off →
 *    bill → pricing → tender → contract → valuations → variations → cost report → final account.
 *  - **The BPMN model**, for *order and dependency* only. Its code rides along on each item as
 *    `process` for reference, and never appears as a label.
 *
 * The BPMN model earns its place by driving **which modules are ready** — a step is startable when
 * its upstream is signed and its documents are filed (§1.3.1) — not by supplying the words.
 */

export interface NavItem {
  label: string;
  href: string;
  /** The process area this module executes, for reference. Never shown as the label. */
  process?: string;
  /** False renders it greyed and marked, never as a link to a page that does not exist. */
  built: boolean;
}

export interface NavGroup {
  /** Undefined for the ungrouped items at the top. */
  heading?: string;
  items: readonly NavItem[];
}

/**
 * Platform level — what exists when no project is open.
 *
 * Deliberately short. Everything project-shaped is reached by opening a project.
 *
 * The Mzilikazi platform puts a project switcher at the top of the sidebar rather than the top bar.
 * §7.3 specifies the top bar, and that is where ours will go — but the switcher matters either way:
 * a QS carries 5–50 projects and a plain select is not navigation.
 */
export const PLATFORM_NAV: readonly NavGroup[] = [
  {
    items: [
      /*
        Home: the projects, what each is waiting on, and the ad hoc requests. Signing in lands here.
        It replaced two front pages – an Overview that was mostly the practice's brochure and a
        Portfolio dashboard – because a first-time reader met two "dashboards" before any work.
        A project's figures are on that project's own Dashboard.
      */
      { label: "Home", href: "/", built: true },
      { label: "Projects", href: "/projects", built: true },
      // The ad hoc requests (November meeting: "here's the input, this is what I need").
      { label: "Ad hoc requests", href: "/my-work", built: true },
    ],
  },
  {
    heading: "Firm",
    items: [
      /*
        The practice's own pricing, and the home of its cost data (§4.5, §6.3). Firm-level, because a
        rate copied into every job is a rate that has to be corrected in every job.
      */
      { label: "Rate Library", href: "/rates", built: true },
      // The practice's figures against the market, broken down by stage of work (November meeting).
      { label: "Benchmarks", href: "/benchmarks", built: true },
      { label: "Contacts", href: "/contacts", built: true },
      /*
        The figures the platform assumes on the practice's behalf. The reference pages read once – the
        policies, the drafting rubric and the process model – are linked from Settings rather than
        given a row each here.
      */
      { label: "Settings", href: "/settings", built: true },
    ],
  },
];

/**
 * Project level — the places a project has, in the order the work flows.
 *
 * Renders only when a project is open. It **does not render empty**: a nav full of items that
 * cannot be reached is worse than no nav at all.
 */
export const PROJECT_NAV: readonly NavGroup[] = [
  {
    items: [
      { label: "Overview", href: "", built: true },
      // This project's approved figures: what it is worth, per unit, per m², and what is short.
      { label: "Dashboard", href: "/dashboard", built: true },
      /**
       * The project's documents, and what the agent makes of them (§1.3.2).
       *
       * This was **Data import**, under Set up, and both halves of that were wrong. It named the
       * action rather than the thing, so the sidebar — a list of *places* — carried a verb; and it
       * sat among the steps as though filing documents were one step of several, when every step
       * reads from it. A corpus is something the project **has**, like its name and its settings,
       * so it belongs here beside Overview.
       *
       * Importing is the verb, and a verb belongs on a button. It starts from the project's front
       * page, which is where someone looking at an empty project already is.
       */
      { label: "Documents", href: "/corpus", process: "D3.1", built: true },
    ],
  },
  {
    heading: "Set up",
    items: [
      // The project's own parameters — unit types, block types, phases, areas. What the cost model reads.
      { label: "Project Inputs", href: "/inputs", process: "D2.1", built: true },
      /*
        A draft bill read line by line against the design – the practice's own review workbook as a
        place: sources register, design parameters, every item mapped with a status, the options
        compared, the queries that go out, and each option priced.

        It took the place of "Documents & Drawings", which was never built and was the same thing
        seen from the other side: the drawing register is the review's sources sheet, and a register
        nobody maps a bill against is a list of file names.
      */
      { label: "Design Review", href: "/review", process: "D3.1", built: true },
      { label: "Site & Zoning", href: "/site", process: "D3.1 · D7.1", built: true },
    ],
  },
  {
    heading: "Cost planning",
    items: [
      { label: "Feasibility Estimate", href: "/feasibility", process: "D1.1", built: true },
      /**
       * The same process area as the estimate above it, and a separate step.
       *
       * D1.1's sub-processes are "Feasibility Cost Estimate", "Elemental Cost Plan", "Cost Plan
       * Revision" — an order, inside one area. The process model is L2 and cannot express an edge
       * whose two ends carry the same code, so the order between them is not read from it: the cost
       * plan **carries** figures from the estimate, and `chain.ts` derives the dependency from that.
       */
      { label: "Cost Plan", href: "/cost-plan", process: "D1.1", built: true },
      /*
        Other people's estimates for the same works, set side by side by element – the practice's
        MEMO-04 as a place. Beside the cost plan because it is where a cost plan's figure is argued
        from when the engineers' own estimates disagree, and the memo's conclusion was that the
        common cost of works should come from here rather than from either of them.
      */
      { label: "Estimate Comparison", href: "/estimates", process: "D1.1", built: true },
      /*
        D1.1's third sub-process, Cost Plan Revision & Design Cost Control: the detailed estimate
        built from the priced bill, held to the signed cost plan's targets element by element, with
        the movement explained and the client's decision recorded. A lens over two signed things and
        a register of decisions – no run of its own to sign.
      */
      { label: "Cost Control", href: "/cost-control", process: "D1.1", built: true },
      // The contract sum phased over time, against what the certificates have paid.
      { label: "Cash Flow", href: "/cash-flow", process: "D1.7", built: true },
    ],
  },
  {
    heading: "Measurement",
    items: [
      // Dimension sheets – timesing, length, width, depth, deductions – sent to the bill as measured quantities.
      { label: "Take-off", href: "/take-off", process: "D1.2", built: true },
      /**
       * The first step whose run proposes **rows** rather than a fixed set of figures (§1.3.3).
       *
       * It sits under Measurement beside Take-off because that is where a QS looks for it, and it is
       * built before Take-off deliberately: a bill is rows with a description, a unit, a quantity and
       * a rate, which this platform can read out of a specification and a priced source. Take-off
       * produces the *dimensions* that feed those quantities, and §10's measured finding is that a
       * technical drawing carries its value in geometry nothing here reads yet.
       */
      { label: "Bill of Quantities", href: "/bill", process: "D1.2", built: true },
      /**
       * §4.8, over the bill's own rows — the rate column, a build-up behind it, and one act across
       * a selection because "nobody prices 4,000 items one at a time".
       *
       * A place rather than a step: it has no entry criteria and produces no run, so it never
       * appears on the project overview's list of steps and gates nothing. What it edits is the
       * bill, and the bill's signature is what freezes it.
       */
      { label: "Pricing", href: "/pricing", process: "D1.2", built: true },
    ],
  },
  {
    heading: "Procurement",
    items: [
      // Issue the tender on the signed bill, addenda and acknowledgements, returns, the opening.
      { label: "Tender Room", href: "/tender", process: "D1.3", built: true },
      { label: "Tender Analysis", href: "/tender-analysis", process: "D1.3", built: true },
      // Responses to a request for quotation, checked, compared like for like, and a recommendation.
      { label: "Quotations", href: "/rfq", process: "D1.3", built: true },
      { label: "Contract", href: "/contract", process: "D1.4", built: true },
    ],
  },
  {
    heading: "Construction",
    items: [
      { label: "Valuations", href: "/valuations", process: "D1.5", built: true },
      { label: "Variations", href: "/variations", process: "D1.6", built: true },
      { label: "Cost Report", href: "/cost-report", process: "D1.7", built: true },
    ],
  },
  {
    heading: "Close-out",
    items: [
      { label: "Final Account", href: "/final-account", process: "D1.8", built: true },
    ],
  },
  /**
   * Settings, at the foot of the list.
   *
   * Project Details sat in the top group beside Overview, Corpus and Data, which put a settings
   * page among the three places somebody opens every day. The top group is what a reader lands in;
   * the stages are the work; configuration is neither, and it is opened once at the start of a job
   * and then rarely.
   *
   * Its own heading rather than an unlabelled row at the bottom, so it folds like everything else
   * and the six stage groups are not interrupted by a loose item after them.
   */
  {
    heading: "Settings",
    items: [{ label: "Project Details", href: "/settings", built: true }],
  },
];

/**
 * Where a step is explained: its area on the process-model page.
 *
 * The advisor's step chips are there to say *how this is done*, and they opened the project's own
 * page for the step instead – the place to do the work, not the explanation of it. This gives the
 * explanation: the step's `process` area at `/process?area=…`. Where a step executes two areas
 * ("D3.1 · D7.1") the first is the one it is filed under, so that is the one opened.
 *
 * It reads only the nav, not the process library, so a client component can call it without
 * shipping several hundred tasks of static text to the browser. That every code here exists in the
 * library is proved by `navigation.test.ts`, not checked at run time.
 *
 * Null for a path that is not a step, or a step with no area (Project Details) – no link, rather
 * than one to the model's front page that explains nothing in particular.
 */
export function processHrefOf(module: string): string | null {
  const item = PROJECT_NAV.flatMap((group) => group.items).find((i) => i.href === module);
  const area = item?.process?.split("·")[0]?.trim();
  return area ? `/process?area=${encodeURIComponent(area)}` : null;
}
