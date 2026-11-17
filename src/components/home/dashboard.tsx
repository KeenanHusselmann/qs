/**
 * The dashboard — PLATFORM.md §4.3, §7.1, §7.4, §14.
 *
 * ── Why this page was empty until now, and what changed ────────────────────────────────────
 *
 * `/home` shipped as a heading and nothing else, with a note on it naming the reason: §14 lists
 * **demo-driven development** — "building what looks good in a screenshot" — as one of the specific
 * ways this project fails, and a dashboard of invented KPIs is the canonical example. Nothing about
 * that judgement has changed. What changed is that the service chain now freezes figures a person
 * signed their name to, so there is something real to count.
 *
 * So the rule for this screen, and the only one that matters: **every tile traces.** Click it and
 * reach the signed run the figure came from. §1.3.1 is blunt about the alternative — *a figure that
 * cannot be traced is worse than a gap, because it survives review looking checked* — and a KPI
 * whose provenance nobody can reach is exactly that figure.
 *
 * Which means a tile has two states and not three. Either a figure, read out of `output_*` on a run
 * with `signed_at is not null`, or a **stated absence** naming what would supply it, with a link to
 * that step. Never a plausible number from unsigned data, and never a nought standing in for
 * "nobody has established this": a scheme that costs nothing and a scheme nobody has costed are
 * different facts, and the difference is the whole platform.
 *
 * ── The shape is the Mzilikazi build's ─────────────────────────────────────────────────────
 *
 * Four KPI cards, then the wide-beside-narrow pair, then the working section. Two things about that
 * build are deliberately not copied. Its tiles use Tailwind's default palette — `bg-blue-100`,
 * `text-green-600` — where §7.1 #5 says colour means exactly one thing; and its Project Progress and
 * Recent Activity are hard-coded arrays of plausible sentences, which is the anti-pattern this
 * screen exists to avoid. Progress here is signed steps counted, and the activity list is the
 * signatures themselves.
 *
 * ── There is no time-of-day greeting ───────────────────────────────────────────────────────
 *
 * §4.3 opens the dashboard with a greeting. A server-rendered "Good afternoon" is computed in the
 * deployment region — `lhr1` — and would read as a cheerful lie to a QS in Johannesburg at eight in
 * the evening. §7.7's voice has no room for that, so the orientation line says who is signed in and
 * what the portfolio holds, which is what a greeting is for.
 *
 * ── Formatting is here; arithmetic is not ──────────────────────────────────────────────────
 *
 * `dashboard.ts` reads the signed figures, refuses what it cannot read and does the sums. This file
 * turns the result into words. The split is the same one `project-data.tsx` keeps between its table
 * and its reconciliation block, and for the same reason: the moment a screen starts deriving its own
 * numbers, there are two definitions of every figure on it.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  Building2,
  ChevronRight,
  Lock,
  Ruler,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { formatDate } from "@/lib/dates";
import { KpiTile } from "@/components/home/kpi-tile";
import { Panel } from "@/components/shell/panel";
import { projectsByStage } from "@/components/home/stage-progress";
import { ElementalCost, SCurve, Tornado } from "@/components/charts/qs-charts";
import { cumulativeCurves, projectScenario } from "@/lib/report/scenario";
import { loadSignedFigures } from "@/lib/agent/persist";
import { loadPortfolioCost } from "@/lib/portfolio-cost";
import { requireSession } from "@/lib/auth";
import {
  loadPortfolio,
  showMoney,
  showQuantity,
  type Aggregate,
  type Flag,
  type Portfolio,
  type ProjectRow,
} from "@/lib/dashboard";
import { STATUS_LABEL, type ProjectStatus } from "@/lib/project-status";

/** Matches every other record of "who and when" in the platform, so two stamps read the same way. */
const on = formatDate;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * One project's dashboard, or the practice's.
 *
 * ── Why the same component ───────────────────────────────────────────────────────────────
 *
 * A project asks exactly the questions the practice does — what is this worth, what does it
 * cost per unit, what needs attention, what has been signed. The arithmetic is identical and
 * `loadPortfolio` already takes the scope, so a second component would be a second answer to
 * "cost per unit" on two screens where a QS asks the same question.
 *
 * What changes with the scope is only what is *worth showing*: a table of one project and a
 * count of projects-per-stage say nothing about a single job, so they are not rendered for one.
 * A panel that is technically correct and answers nothing is worse than an absent one.
 */
export async function Dashboard({
  project,
  details,
  title = "Dashboard",
  actions,
  children,
  view = "executive",
}: {
  project?: { id: string; name: string };
  /**
   * Who the page is for. QS staff open Home to find their next job, not the practice's value and
   * rates per m², so the QS view leads with the work and leaves the figures to the executive view:
   * no KPI band, no projects-by-stage, and a projects table without its money columns. The
   * arithmetic is unchanged – the same figures are one click away.
   */
  view?: "qs" | "executive";
  /** A project's particulars under the title – its code, client and the stages it runs. */
  details?: ReactNode;
  /** "Home" when this is the practice's front page rather than a project's dashboard. */
  title?: string;
  /** The page's own buttons, beside the title – Home's "Add project" and "Ad hoc request". */
  actions?: ReactNode;
  /** Rendered under the figures and before "Needs attention" – Home's ad hoc requests. */
  children?: ReactNode;
} = {}) {
  // Still the auth gate — a page that forgot to check would be a page served to anyone. The email
  // itself is no longer in the header: the user menu says who you are, and repeating it in the
  // subtitle spent a line on something nobody came to find out.
  await requireSession();
  const portfolio = await loadPortfolio(project?.id);

  /*
    This job's own cost, for the charts below.

    Scoped to the one project rather than the portfolio: a project dashboard showing the practice's
    combined elemental cost was the fault this page was split to fix — the figures were true of
    nobody's job in particular.
  */
  const cost = project ? await loadPortfolioCost([project.id]) : null;

  /*
    The cash flow, where this job has signed enough to run one.

    Null the moment a selling price, an absorption rate, a programme or a unit count is missing —
    at which point the two charts below are simply absent rather than drawn from defaults. A
    funding curve built on invented inputs is the most persuasive wrong thing this page could show.
  */
  const scenario = project ? projectScenario(await loadSignedFigures(project.id)) : null;
  const curves = scenario ? cumulativeCurves(scenario) : null;

  const { projects, value, flags, recent, signableSteps, signableModules } = portfolio;

  if (projects.length === 0) {
    // §7.5 — every empty surface says what would fill it and offers the action. "No blank canvases
    // anywhere", and a dashboard is the most tempting place in any product to break that rule.
    return (
      <div className="mx-auto max-w-[1280px] px-8 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-xl text-[var(--n-800)]">{title}</h1>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        <div className="mt-6 rounded-[var(--r-lg)] border border-dashed border-[var(--n-200)] px-6 py-10 text-center">
          <h2 className="t-lg text-[var(--n-800)]">Nothing to summarise yet</h2>
          <p className="t-md mx-auto mt-1 max-w-[52ch] text-[var(--n-500)]">
            Every figure on this page comes from a run somebody has signed off. Create a project,
            file its documents and sign a step, and its approved figures appear here.
          </p>
          <Link
            href="/projects"
            className="t-base mt-4 inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)]"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            Open Projects
            <ArrowRight aria-hidden size={15} strokeWidth={1.75} />
          </Link>
        </div>
        {children && <div className="mt-6">{children}</div>}
      </div>
    );
  }

  // Whether every figure on the screen belongs to one project. It changes the words, not the
  // arithmetic — "across 1 project" on a project's own dashboard reads as the platform counting
  // to one.
  const scoped = Boolean(project);

  const signedAnything = projects.filter((project) => project.signedSteps > 0).length;
  const figures = view === "executive";

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col px-8 py-6">
      {/*
        ── One screen, one question: what do I work on next? ──────────────────────────────
        This page used to open with three paragraphs explaining how it reads figures, then four
        tiles, then a table, and only then the list of things actually wanting attention. Four
        sections competed and the to-do list came last. §7.1 is explicit — density over whitespace,
        screen space is for data — and a hundred and twenty words of the platform describing its own
        principles is the opposite of that on a screen somebody opens every morning.

        The explanation was worth writing and is not worth repeating daily, so it is a disclosure.
        What a reader wanted is now in the order they want it: what needs doing, then the jobs.
      */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="t-xl text-[var(--n-800)]">{title}</h1>
          <p className="t-md mt-0.5 text-[var(--n-500)]">
            {project ? (
              <>
                {project.name} ·{" "}
                <span className="num">{projects[0]?.signedSteps ?? 0}</span> of{" "}
                <span className="num">{signableSteps}</span> steps signed off
              </>
            ) : (
              <>
                <span className="num">{projects.length}</span> {plural(projects.length, "project")} ·{" "}
                <span className="num">{signedAnything}</span> with figures signed off
              </>
            )}
          </p>
          {details}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>

      {figures && (
      <details data-region="how-read" className="mt-3">
        <summary className="t-sm inline-flex cursor-pointer list-none items-center gap-1 text-[var(--n-500)] hover:text-[var(--n-700)]">
          <ChevronRight aria-hidden size={12} strokeWidth={2} className="transition-transform" />
          How these figures are read
        </summary>
        <p className="t-sm mt-1.5 max-w-[86ch] pl-4 text-[var(--n-600)]">
          Every figure below is one a person has{" "}
          <span className="font-medium">signed off</span>, read back from the run that froze it.
          Nothing here is estimated by this page — where a figure has not been approved, or could not
          be read as a plain number, it says so and names the step that would settle it.
        </p>
      </details>
      )}

      {/*
        §7.5's KPI band. Four across, two, or one – never more than five (§4.7).

        Sized by the band's own width (a container query), not the viewport's. A 1024px viewport
        with the sidebar open leaves the band about 800px, and four tiles in that clip a nine-figure
        signed total. Four across needs about 250px a tile, so it waits for a 64rem band.
      */}
      {figures && (
      <div className="@container mt-5">
      <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @5xl:grid-cols-4">
        <ValueTile aggregate={value} scoped={scoped} />
        <PerUnitTile portfolio={portfolio} scoped={scoped} />
        <PerM2Tile portfolio={portfolio} scoped={scoped} />
        <FlagsTile flags={flags} projects={projects} scoped={scoped} />
      </div>
      </div>
      )}

      {/*
        Wide beside narrow, as the reference lays it out. The projects table gets the two-thirds
        because it is the trace for three of the four tiles above it: every figure in it links to
        the signed run behind that figure, and every gap names the step that would fill it.
      */}
      {/*
        ── The order is the QS's own working order ──────────────────────────────────────────
         
        Where things stand (the band above) · what needs doing · the jobs · how far through. It read
        as four unrelated blocks because nothing separated them; each is a panel now, so a reader
        can see where one idea stops.
      */}
      {children && <div className="mt-6">{children}</div>}

      <div id="attention" data-region="attention" className="mt-6 scroll-mt-6">
        <Panel
          title="Needs attention"
          count={
            flags.length === 0
              ? "Nothing outstanding"
              : `${flags.length} ${plural(flags.length, "thing")}`
          }
          tone={flags.length === 0 ? undefined : "warn"}
          flush={flags.length > 0}
        >
          <Attention flags={flags} />
        </Panel>
      </div>

      <div
        className={`mt-6 grid grid-cols-1 items-start gap-5 ${
          project ? "" : "lg:grid-cols-3"
        }`}
      >
        {/* A table of one project, on that project's own dashboard, is a row it already knows. */}
        {!project && (
        <div id="projects" className="lg:col-span-2">
          <Panel
            title="Projects"
            count={`${projects.length}`}
            action={{ href: "/projects", label: "All projects" }}
            flush
          >
            <ProjectsTable projects={projects} signableSteps={signableSteps} figures={figures} />
          </Panel>
        </div>
        )}

        <div className="flex flex-col gap-5">
          {/*
            Projects by stage — where the practice's jobs are, not how far each has come.

            It summed `stageLines` across the portfolio, on the reasoning that with one project it
            is that project's progress and with several it is the practice's. The second half does
            not hold: two jobs at 100% and 0% add to 50%, which is true of neither, and the figure
            gets more confident and less true as projects are added. Progress is a ratio per job
            and lives on that job's own overview; a portfolio has a shape.
          */}
          {/* How many jobs sit where — a portfolio's shape. One job has a ratio instead, and it
              is on that job's own overview where it means something. */}
          {!project && figures && (
          <div data-region="progress">
            <Panel title="Projects by stage">
              <ul className="flex flex-col gap-2">
                {projectsByStage(signableModules, projects).map((stage) => (
                  <li key={stage.number} className="flex items-baseline justify-between gap-3">
                    <span className="t-sm truncate text-[var(--n-700)]">{stage.name}</span>
                    <span className="num t-sm shrink-0 text-[var(--n-600)]">
                      {stage.projects} {stage.projects === 1 ? "project" : "projects"}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
          )}

          {/*
            ── This job, drawn ───────────────────────────────────────────────────────────────

            Two questions a project lead asks and a table answers badly: how far through are we,
            and where is the money. The gauge is a ratio and needs no axis; the treemap is a
            part-to-whole with eight parts, which is more than any legend carries.

            Both are scoped to this project. The portfolio has its own shapes on the main page.
          */}
          {project && cost && cost.projects > 0 && (
            <div data-region="project-charts" className="grid grid-cols-1 gap-4">
              <Panel title="Where this job's money sits">
                <ElementalCost
                  elements={cost.elements.map((element) => ({
                    label: element.label,
                    amount: Number(element.amount),
                    shown: showMoney(element.amount),
                  }))}
                  caption={`${showMoney(cost.construction)} of signed elemental cost on this project.`}
                />
              </Panel>
            </div>
          )}

          {/*
            ── The two charts a development appraisal is actually read on ────────────────────

            The S-curve is the construction industry's own: cumulative cost against cumulative
            revenue, where the gap between the curves *is* the funding requirement. The tornado is
            the appraisal's — RICS notes residual valuations are hostage to small input changes,
            so the question worth answering is which input, and the widest bar answers it.

            Both are drawn from the signed figures through `projectScenario`, which refuses to run
            on anything it would have to invent.
          */}
          {scenario && curves && (
            <div data-region="appraisal-charts" className="flex flex-col gap-4">
              <Panel title="Cost against revenue, month by month">
                <SCurve
                  cost={curves.cost}
                  revenue={curves.revenue}
                  caption={
                    `The gap between the curves is what the scheme has to fund. It is deepest at ` +
                    `month ${scenario.scenarios.base.peakFundingMonth}, at ` +
                    `${showMoney(scenario.scenarios.base.peakFunding)}, and closes in month ` +
                    `${scenario.scenarios.base.paybackMonth ?? scenario.scenarios.base.months}. ` +
                    `Escalation at 5% a year and 3% selling commission are stated assumptions, not signed figures.`
                  }
                />
              </Panel>

              <Panel title="What the answer is hostage to">
                <Tornado
                  levers={scenario.levers.map((lever) => ({
                    variable: lever.variable,
                    range: lever.range,
                    low: Number(lever.low) - Number(scenario.scenarios.base.npvEquityAtHurdle),
                    high: Number(lever.high) - Number(scenario.scenarios.base.npvEquityAtHurdle),
                  }))}
                  baseLabel="Base case"
                  caption={
                    `Each input moved on its own, against equity NPV. ` +
                    `${scenario.levers[0]?.variable} moves the answer furthest, so it is the assumption ` +
                    `worth the most diligence — the narrow bars are the ones nobody need meet about again.`
                  }
                />
              </Panel>
            </div>
          )}

          <div data-region="signatures">
            <Panel title="Recent sign-offs" flush={recent.length > 0}>
              {recent.length === 0 ? (
                <p className="t-sm text-[var(--n-600)]">
                  No step on any project has been signed off yet, so there is nothing for this page
                  to read.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {recent.map((signature) => (
                    <li key={`${signature.href}-${signature.at}`}>
                      <Link
                        href={signature.href}
                        className="flex items-start gap-2 border-b border-[var(--n-100)] px-4 py-2.5 transition-colors last:border-0 hover:bg-[var(--a-50)]"
                        style={{ transitionDuration: "var(--m-fast)" }}
                      >
                        <Lock
                          aria-hidden
                          size={12}
                          strokeWidth={2}
                          className="mt-1 shrink-0 text-[var(--ok-500)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="t-base block font-medium text-[var(--n-800)]">
                            {signature.label}
                          </span>
                          <span className="t-sm block text-[var(--n-500)]">
                            {signature.projectName} · {signature.by} · {on(signature.at)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The four tiles ────────────────────────────────────────────────────────────────────────

/**
 * Where a tile's trace goes when several signed runs made it.
 *
 * One contributor is the easy case and the important one: the tile is a link to that run's step,
 * which is the requirement stated literally. With several, no single run is *the* source and picking
 * one would be arbitrary — so the trace goes to the table below, where every contributing project
 * has its own link to its own signed run. The tile still names how many, so a reader knows what they
 * are about to see rather than following an unlabelled arrow.
 */
function traceTo(from: readonly ProjectRow[]): { href: string; label: string } {
  const only = from.length === 1 ? from[0] : null;

  if (only && only.total.ok) {
    return {
      href: only.total.source.href,
      label: `From ${only.name} · ${only.total.source.label}`,
    };
  }

  return {
    href: "#projects",
    label: `From ${from.length} projects, listed below`,
  };
}

/**
 * Where a tile with nothing to show sends a reader.
 *
 * The step that would supply the missing figure, when exactly one project is in play and can be
 * asked for it. Otherwise the table, which names every project's gap individually — an arrow that
 * picked one project out of eight would be arbitrary, and arbitrary is how a reader stops trusting
 * the links on a page.
 */
function traceToGap(
  projects: readonly ProjectRow[],
  pick: (row: ProjectRow) => string | null,
): { href: string; label: string } {
  if (projects.length === 1) {
    const href = pick(projects[0]);
    if (href) return { href, label: `Open ${projects[0].name}` };
  }

  return { href: "#projects", label: "See where each project stands" };
}

/**
 * A figure the platform refused to read is not the same as one nobody signed, and the tile says so.
 *
 * `readAmount` refuses `"R186 420 000,00 excluding VAT"` because the qualifier changes what the
 * figure means, and `"1,234"` because the two readings are a factor of a thousand apart. Both are
 * approved figures sitting in a signed run — leaving them out silently would make the total quietly
 * short by a project, which is the confident wrong number this whole platform is arranged against.
 */
const refusalNote = (refused: Aggregate["refused"]): string => {
  if (refused.length === 0) return "";

  // One refusal gets its reason here; several would make the tile taller than the three beside it,
  // and every one of them is written out in full on its own row in the table below.
  if (refused.length === 1) {
    return ` ${refused[0].projectName} signed ${refused[0].text ?? "a total"}, which could not be read: ${refused[0].reason}`;
  }

  return ` ${refused.length} signed totals could not be read, each for a reason stated on its own row below.`;
};

/**
 * "across 3 projects", or nothing at all.
 *
 * On a project's own dashboard the clause is noise at best — every figure on the screen is that
 * project's, and "across 1 project" reads like the platform counting to one. It is only worth
 * saying where a figure is a roll-up and the reader needs to know how much it rolled up.
 */
const spanning = (count: number, scoped: boolean) =>
  scoped ? "" : ` across ${count} ${plural(count, "project")}`;

function ValueTile({ aggregate, scoped }: { aggregate: Aggregate; scoped: boolean }) {
  return (
    <KpiTile
      label="Total project value"
      icon={Banknote}
      figure={aggregate.amount === null ? null : showMoney(aggregate.amount)}
      // Nothing approved and nothing readable are different absences, and the headline says which.
      absent={aggregate.refused.length > 0 ? "Not read" : "Not signed off"}
      note={
        aggregate.amount === null
          ? aggregate.refused.length > 0
            ? `No signed total on this list could be read.${refusalNote(aggregate.refused)}`
            : scoped
              ? "This project has no signed cost plan total or signed bill."
              : "No project has a signed cost plan total or a signed bill."
          : `Signed${spanning(aggregate.from.length, scoped)}.${refusalNote(aggregate.refused)}`
      }
      trace={
        aggregate.amount === null
          ? {
              href: aggregate.refused[0]?.href ?? "#projects",
              label: aggregate.refused[0]
                ? `Open ${aggregate.refused[0].projectName}`
                : "See where each project stands",
            }
          : traceTo(aggregate.from)
      }
    />
  );
}

function PerUnitTile({ portfolio, scoped }: { portfolio: Portfolio; scoped: boolean }) {
  const { perUnit, projects } = portfolio;

  return (
    <KpiTile
      label="Cost per unit"
      icon={Building2}
      figure={perUnit.amount === null ? null : showMoney(perUnit.amount)}
      absent="Not established"
      note={
        perUnit.amount === null
          ? // Both inputs are named, because usually only one of them is the missing one and a
            // reader told "no data" has no way to know which step to open.
            "Needs a signed total and the unit count signed on the Feasibility Estimate."
          : // No refusal note here. A refusal is a refusal of a *total*, so it belongs on the tile
            // that shows totals; repeating it under a rate would say the unit count was the problem.
            `${showQuantity(perUnit.units)} units${spanning(perUnit.from.length, scoped)}.`
      }
      trace={
        perUnit.amount === null
          ? traceToGap(projects, (row) => (row.units.ok ? null : row.units.step.href))
          : traceTo(perUnit.from)
      }
    />
  );
}

function PerM2Tile({ portfolio, scoped }: { portfolio: Portfolio; scoped: boolean }) {
  const { perM2, projects } = portfolio;

  return (
    <KpiTile
      label="Cost per m² GFA"
      icon={Ruler}
      figure={perM2.amount === null ? null : showMoney(perM2.amount)}
      absent="Not established"
      note={
        perM2.amount === null
          ? "Needs a signed total, the unit count and the average unit area from the Feasibility Estimate."
          : `${showQuantity(perM2.gfa, "m²")}${spanning(perM2.from.length, scoped)} — unit count × average unit area.`
      }
      trace={
        perM2.amount === null
          ? traceToGap(projects, (row) => (row.area.ok ? null : row.area.step.href))
          : traceTo(perM2.from)
      }
    />
  );
}

/**
 * The fourth tile, and the one that has to earn its name.
 *
 * "QA flags" in the reference build is a number with nothing behind it. Here it counts four things
 * that already have rules — a step whose elements do not sum to its stated total, a signature
 * somebody owes, a finished run with a required figure missing, a bill row with no measure — and
 * every one of them is written out below with the step it is on and a link to it. A count nobody
 * can act on would be worse than no tile.
 */
function FlagsTile({
  flags,
  projects,
  scoped,
}: {
  flags: readonly Flag[];
  projects: readonly ProjectRow[];
  scoped: boolean;
}) {
  const affected = new Set(flags.map((flag) => flag.projectId)).size;

  return (
    <KpiTile
      label="Needs attention"
      icon={TriangleAlert}
      figure={String(flags.length)}
      absent="Nothing flagged"
      tone={flags.length === 0 ? "ok" : "warn"}
      note={
        flags.length === 0
          ? `Nothing outstanding${spanning(projects.length, scoped)}.`
          : `On ${affected} ${plural(affected, "project")} — unsigned upstreams, unanswered required figures, and totals that do not reconcile.`
      }
      trace={{
        href: "#attention",
        label: flags.length === 0 ? "What would appear here" : "Read them",
      }}
    />
  );
}

// ── The trace: one row per project ────────────────────────────────────────────────────────

function StatusPill({ status }: { status: ProjectStatus }) {
  // §7.5 — semantic 50-tint background with 500-tint text, and always with the word. Never colour
  // alone (§7.1 #5), which is why there is no version of this that is only a dot.
  const tone: Record<ProjectStatus, string> = {
    estimating: "bg-[var(--n-50)] text-[var(--n-600)]",
    tendering: "bg-[var(--a-50)] text-[var(--a-700)]",
    in_contract: "bg-[var(--a-50)] text-[var(--a-700)]",
    final_account: "bg-[var(--warn-50)] text-[var(--warn-700)]",
    closed: "bg-[var(--ok-50)] text-[var(--ok-700)]",
    archived: "bg-[var(--n-50)] text-[var(--n-500)]",
  };

  return (
    <span
      className={`t-xs inline-flex shrink-0 items-center rounded-[999px] px-2 py-0.5 font-medium ${tone[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const HEADINGS = ["Project", "Signed value", "Cost per unit", "Cost per m²", "Signed off"] as const;

function ProjectsTable({
  projects,
  signableSteps,
  figures,
}: {
  projects: readonly ProjectRow[];
  signableSteps: number;
  /** False in the QS view: the job and how far through it is, without the money columns. */
  figures: boolean;
}) {
  if (!figures) {
    return (
      <table data-region="projects" data-view="qs" className="w-full table-fixed">
        <colgroup>
          <col className="w-[62%]" />
          <col className="w-[38%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-[var(--n-200)]">
            {["Project", "Signed off"].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="t-sm px-4 py-2.5 text-left font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr
              key={project.id}
              data-project={project.id}
              className="border-b border-[var(--n-100)] align-top last:border-0 even:bg-[var(--n-25)] hover:bg-[var(--a-50)]"
            >
              <td className="px-4 py-2.5">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Link href={project.href} className="t-base font-medium text-[var(--a-600)] hover:underline">
                    {project.name}
                  </Link>
                  <StatusPill status={project.status} />
                </span>
                {project.client && <span className="t-sm mt-0.5 block text-[var(--n-500)]">{project.client}</span>}
              </td>
              <td className="px-4 py-2.5">
                <Progress signed={project.signedSteps} of={signableSteps} />
                {project.flags.length > 0 && (
                  <span className="t-xs mt-1 block text-[var(--warn-700)]">
                    {project.flags.length} {plural(project.flags.length, "thing")} to look at
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <table data-region="projects" data-view="executive" className="w-full table-fixed">
      {/* The value column carries a sentence when there is no figure, so it is the second widest.
          §7.3's design target is 1440 and §14 requires 1280, where these come to 300 / 210 / 125 /
          125 / 145 px against a 240px sidebar. */}
      <colgroup>
        <col className="w-[32%]" />
        <col className="w-[22%]" />
        <col className="w-[13%]" />
        <col className="w-[13%]" />
        <col className="w-[20%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-[var(--n-200)]">
          {HEADINGS.map((heading, index) => (
            <th
              key={heading}
              scope="col"
              className={`t-sm px-4 py-2.5 font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase ${
                // §7.4 — right-aligned tabular numerals in every numeric column, headers with them.
                index >= 1 && index <= 3 ? "text-right" : "text-left"
              }`}
            >
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {projects.map((project) => (
          <tr
            key={project.id}
            data-project={project.id}
            className="border-b border-[var(--n-100)] align-top last:border-0 even:bg-[var(--n-25)] hover:bg-[var(--a-50)]"
          >
            <td className="px-4 py-2.5">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Link
                  href={project.href}
                  className="t-base font-medium text-[var(--a-600)] hover:underline"
                >
                  {project.name}
                </Link>
                <StatusPill status={project.status} />
              </span>
              <Shape project={project} />
            </td>

            {/*
              §7.4 wants numerics right-aligned, and an absence in this column is a sentence rather
              than a numeric. Right-aligned prose wrapped over four lines is genuinely hard to read,
              so the figure is right-aligned and the absence is not — the alignment follows what the
              cell holds, which is the rule §7.4 is actually stating.
            */}
            <td className="px-4 py-2.5">
              {project.total.ok ? (
                <span className="block text-right">
                  <span className="num t-base block font-medium text-[var(--n-800)]">
                    {showMoney(project.total.value)}
                  </span>
                  <Link
                    href={project.total.source.href}
                    className="t-xs text-[var(--a-600)] underline decoration-[var(--n-300)] underline-offset-2 hover:decoration-[var(--a-600)]"
                  >
                    {project.total.source.label}
                  </Link>
                </span>
              ) : (
                <Absent reading={project.total} />
              )}
            </td>

            {/*
              Derived, and its inputs are both on this row — the total in the cell beside it and the
              unit count under the project's name. So a dash here needs no separate explanation:
              whichever of the two is missing is already saying so, in words, a few centimetres away.
            */}
            <td className="num t-base px-4 py-2.5 text-right text-[var(--n-800)]">
              {project.costPerUnit === null ? (
                <span className="text-[var(--n-300)]">—</span>
              ) : (
                showMoney(project.costPerUnit)
              )}
            </td>

            <td className="num t-base px-4 py-2.5 text-right text-[var(--n-800)]">
              {project.costPerM2 === null ? (
                <span className="text-[var(--n-300)]">—</span>
              ) : (
                showMoney(project.costPerM2)
              )}
            </td>

            <td className="px-4 py-2.5">
              <Progress signed={project.signedSteps} of={signableSteps} />
              {project.flags.length > 0 && (
                <span className="t-xs mt-1 block text-[var(--warn-700)]">
                  {project.flags.length} {plural(project.flags.length, "thing")} to look at
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The scheme's shape, under its name — the two divisors every rate on this row is computed from.
 *
 * They sit here rather than in columns of their own because this is where a reader looks for what
 * the project *is*, and because an absence needs room for a sentence: "the Feasibility Estimate has
 * been run and not signed off" is the fix, and it does not fit in a numeric column.
 */
function Shape({ project }: { project: ProjectRow }) {
  if (project.units.ok && project.area.ok) {
    return (
      <span className="t-sm mt-0.5 block text-[var(--n-500)]">
        {project.client ? `${project.client} · ` : ""}
        <span className="num">{showQuantity(project.units.value)}</span> units ·{" "}
        <span className="num">{showQuantity(project.area.value, "m²")}</span> average
        {project.gfa !== null && (
          <>
            {" · "}
            <span className="num">{showQuantity(project.gfa, "m²")}</span> GFA
          </>
        )}
      </span>
    );
  }

  const missing = !project.units.ok ? project.units : project.area;

  if (missing.ok) return null;

  return (
    <span className="t-sm mt-0.5 block text-[var(--n-500)]">
      {project.client ? `${project.client} · ` : ""}
      {/* The signed words first, where there are any, then why they were refused. A reader who is
          shown only the objection cannot tell whether the document is wrong or the reader is. */}
      {missing.text !== null && <span className="num">{missing.text} — </span>}
      {missing.reason}{" "}
      <Link
        href={missing.step.href}
        className="text-[var(--a-600)] underline decoration-[var(--n-300)] underline-offset-2 hover:decoration-[var(--a-600)]"
      >
        {/* "Open the step", not "Open Feasibility Estimate": the sentence in front of it has just
            named the step, and reading the name twice in one line is how a screen starts sounding
            like a form letter. */}
        Open the step
      </Link>
    </span>
  );
}

/**
 * A figure that is not there, said in words, with somewhere to go about it.
 *
 * The headline distinguishes the two absences because they send a reader to different work.
 * *Not signed off* means nobody has approved a figure here. *Not read* means somebody has, and the
 * reader refused it — a qualified amount, or a separator that could mean either of two things a
 * thousand apart. Telling a QS to go and sign a step they signed last week would be worse than
 * saying nothing.
 */
function Absent({ reading }: { reading: Extract<ProjectRow["total"], { ok: false }> }) {
  return (
    <span className="block text-left">
      <span className="t-sm block font-medium text-[var(--n-400)]">
        {reading.kind === "unsigned" ? "Not signed off" : "Not read"}
      </span>
      {/* The document's own characters, where a signed run said something the reader turned down.
          Without them a QS has the platform's objection and not the figure it objected to. */}
      {reading.text !== null && (
        <span className="num t-xs block text-[var(--n-600)]">{reading.text}</span>
      )}
      <span className="t-xs block text-[var(--n-500)]">{reading.reason}</span>
      <Link
        href={reading.step.href}
        className="t-xs text-[var(--a-600)] underline decoration-[var(--n-300)] underline-offset-2 hover:decoration-[var(--a-600)]"
      >
        Open {reading.step.label}
      </Link>
    </span>
  );
}

/** §7.5's progress bar — 4px, accent — with the count beside it, because colour is never alone. */
function Progress({ signed, of }: { signed: number; of: number }) {
  const percent = of === 0 ? 0 : Math.round((signed / of) * 100);

  return (
    <>
      {/*
        One text node with a real space in it, not two flex children separated by a `gap`. The gap
        renders identically and puts nothing between the words in the accessible text, so the count
        reads back as "0of 11 steps" — invisible on screen and wrong everywhere the text is read
        rather than looked at.
      */}
      <span className="t-sm block text-[var(--n-500)]">
        <span className="num font-medium text-[var(--n-800)]">{signed}</span> of {of} steps
      </span>
      {/* The count above already says this in words, so the bar is decoration for scanning and is
          hidden from a screen reader rather than announced twice. */}
      <span
        aria-hidden
        className="mt-1 block h-1 w-full overflow-hidden rounded-[999px] bg-[var(--n-100)]"
      >
        <span className="block h-full bg-[var(--a-500)]" style={{ width: `${percent}%` }} />
      </span>
    </>
  );
}

// ── The working section ───────────────────────────────────────────────────────────────────

const FLAG_LABEL: Record<Flag["kind"], { word: string; icon: LucideIcon }> = {
  reconciliation: { word: "Does not reconcile", icon: TriangleAlert },
  signature: { word: "Waiting on a signature", icon: Lock },
  fields: { word: "Required figure missing", icon: TriangleAlert },
  rows: { word: "Row with no measure", icon: TriangleAlert },
};

function Attention({ flags }: { flags: readonly Flag[] }) {
  return (
    <>
      {flags.length === 0 ? (
        <p className="t-sm max-w-[76ch] text-[var(--n-600)]">
          No signed step disagrees with its own arithmetic, no finished run is short of a required
          figure, no bill row is without a measure, and nothing is held up by a signature somebody
          has not given.
        </p>
      ) : (
        <ul className="flex flex-col">
          {flags.map((flag) => {
            const { word, icon: Icon } = FLAG_LABEL[flag.kind];

            return (
              <li key={`${flag.kind}-${flag.href}`} data-flag={flag.kind}>
                <Link
                  href={flag.href}
                  className="group flex items-start gap-3 border-b border-[var(--n-100)] px-4 py-3 transition-colors last:border-0 hover:bg-[var(--a-50)]"
                  style={{ transitionDuration: "var(--m-fast)" }}
                >
                  <Icon
                    aria-hidden
                    size={14}
                    strokeWidth={2}
                    className="mt-0.5 shrink-0 text-[var(--warn-500)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="t-base block font-medium text-[var(--n-800)]">
                      {flag.projectName} · {flag.label}
                    </span>
                    <span className="t-sm mt-0.5 block text-[var(--n-600)]">{flag.says}</span>
                  </span>
                  <span className="t-xs shrink-0 rounded-[var(--r-sm)] bg-[var(--warn-50)] px-1.5 py-0.5 font-medium text-[var(--warn-700)]">
                    {word}
                  </span>
                  <ArrowRight
                    aria-hidden
                    size={15}
                    strokeWidth={1.75}
                    className="mt-0.5 shrink-0 text-[var(--n-300)] transition-colors group-hover:text-[var(--n-500)]"
                    style={{ transitionDuration: "var(--m-fast)" }}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
