/**
 * The guided path — where a reader is in the platform, and what the next move produces.
 *
 * ── Derived, never remembered ──────────────────────────────────────────────────────────────
 *
 * There is no "current step" stored anywhere. The position is read from what the project actually
 * has: documents filed, criteria met, a run in flight, a signature, a report. That is the whole
 * design — a wizard that remembers where it thinks you are starts lying the first time you do
 * something outside it, and this one cannot, because it has no memory to be wrong.
 *
 * It also means the path is right on a fresh browser, on somebody else's machine, and on a project
 * three people have been working on for a week. A remembered step would be right for one of those.
 *
 * ── It names what you get, not what it does ────────────────────────────────────────────────
 *
 * Each step carries `produces` — the thing the reader ends up holding — because the audience for
 * this is not always a quantity surveyor. "Classified and parsed into a searchable corpus" is a
 * mechanism; "every requirement that a document satisfies ticks itself" is an outcome. Somebody
 * evaluating whether this platform is worth having reads the second and not the first.
 *
 * And `achieved` is the same sentence once it is true, with the project's own figures in it. A step
 * that says "15 documents filed · 18 of 40 requirements met" is telling a reader something they can
 * check, which is the only kind of progress worth showing.
 */

export type StepState = "done" | "current" | "later";

export interface GuidedStep {
  no: number;
  /** What the reader does. */
  title: string;
  /** What they end up holding. Written for somebody deciding whether this is worth having. */
  produces: string;
  state: StepState;
  /** What actually happened, in this project's own figures. Null until it has. */
  achieved: string | null;
  action: { label: string; href: string } | null;
}

/** Everything the path needs to know, counted by the caller from the database. */
export interface PathState {
  projects: number;
  /** The project the path is following, where there is one. */
  project: { id: string; name: string } | null;
  documents: number;
  requirementsMet: number;
  requirementsTotal: number;
  /** Steps that have produced a run, signed or not. */
  runsStarted: number;
  signedSteps: number;
  /** Sections of the viability report established by what is signed. */
  reportSections: number;
  reportTotal: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The five moves, in the order the work happens.
 *
 * Five and not thirteen: this is the shape of the job, not the chain. A reader meeting the platform
 * for the first time needs to know that documents go in and a defensible report comes out — the
 * thirteen modules are what they find once they are inside, and showing them here would answer a
 * question nobody has asked yet.
 */
export function guidedPath(state: PathState): GuidedStep[] {
  const at = (id: string) => (state.project ? `/projects/${state.project.id}${id}` : "/projects");

  const steps: Omit<GuidedStep, "state">[] = [
    {
      no: 1,
      title: "Open a project",
      produces:
        "A place for the documents, and a checklist sized to the stage the job is at — twenty " +
        "requirements for a feasibility, two for a procurement. Never a blank form.",
      achieved: state.projects > 0 ? `${plural(state.projects, "project")} open` : null,
      action: state.projects > 0 ? { label: "All projects", href: "/projects" } : { label: "Add a project", href: "/projects" },
    },
    {
      no: 2,
      title: "File the documents you already have",
      produces:
        "Drop the folder in. Each document is classified by name and folder, read into passages, " +
        "and every requirement a document satisfies ticks itself — with the passage that satisfied it.",
      achieved:
        state.documents > 0
          ? `${plural(state.documents, "document")} filed · ${state.requirementsMet} of ${state.requirementsTotal} requirements met`
          : null,
      action: { label: "Open the corpus", href: at("/corpus") },
    },
    {
      no: 3,
      title: "Run the step",
      produces:
        "The agent reads the filed documents and returns each figure the step needs, with the " +
        "document and passage it came from. What it cannot find, it says — never a nought standing " +
        "in for a gap.",
      achieved: state.runsStarted > 0 ? `${plural(state.runsStarted, "step")} run` : null,
      action: { label: "Feasibility Estimate", href: at("/feasibility") },
    },
    {
      no: 4,
      title: "Review the figures and sign",
      produces:
        "You correct what the agent got wrong, and your signature freezes the rest. Frozen figures " +
        "are the only ones the next step reads, and the only ones that reach a report.",
      achieved: state.signedSteps > 0 ? `${plural(state.signedSteps, "step")} signed off` : null,
      action: { label: "Feasibility Estimate", href: at("/feasibility") },
    },
    {
      no: 5,
      title: "Take the report",
      produces:
        "A QS viability report, as a document — cover, contents, page numbers, limiting conditions. " +
        "Every figure on it traces to a document and a signature, and every section without one " +
        "says so rather than being left out. Issue it and a copy of exactly what you sent is kept, " +
        "with the signatures it was generated from.",
      achieved:
        state.signedSteps > 0
          ? `${state.reportSections} of ${state.reportTotal} sections established`
          : null,
      action: { label: "Open the report", href: at("/report") },
    },
  ];

  /**
   * The current step is the first that has not happened.
   *
   * Not "the last one done plus one" — a reader who signs a step before filing every optional
   * document has not skipped anything, and a path that insisted otherwise would be arguing with
   * work that is already finished.
   */
  const firstUndone = steps.findIndex((step) => step.achieved === null);

  return steps.map((step, i) => ({
    ...step,
    state:
      step.achieved !== null
        ? "done"
        : i === (firstUndone === -1 ? steps.length : firstUndone)
          ? "current"
          : "later",
    // A step nobody can reach yet offers no action; the one to take is the current one's.
    action: step.achieved !== null || i === firstUndone ? step.action : null,
  }));
}

/** Where the reader is, in one sentence, for the card that offers the path. */
export function pathSummary(steps: readonly GuidedStep[]): string {
  const done = steps.filter((step) => step.state === "done").length;
  const current = steps.find((step) => step.state === "current");

  if (done === steps.length) return "Every step done — the report is ready.";
  if (done === 0) return "Five steps from a folder of documents to a signed viability report.";

  return `${done} of ${steps.length} done. Next: ${current?.title.toLowerCase() ?? "the report"}.`;
}
