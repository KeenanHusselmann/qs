/**
 * The generic construction process model, drilled level by level — L0 phase to L4 task.
 *
 * ── What changed, and why ──────────────────────────────────────────────────────────────────
 *
 * This page rendered `process-model.ts` — the platform's own chain — as bands that expanded to a
 * list of areas, with buttons linking into this platform's modules. The feedback was direct: the
 * process model should be the generic BPMN model of how construction projects are delivered, drilling
 * into the next level with the information at each, not a map of what this platform happens to
 * implement. So it reads `lib/process-library` and links to nothing but its own levels.
 *
 * ── Every level is a URL ───────────────────────────────────────────────────────────────────
 *
 * Each click is a link with the selection in the query string (?phase=1&domain=D1&area=D1.1&sp=…
 * &task=T03). Back goes up a level, a level can be bookmarked or sent to somebody, and the page is a
 * server component — the library is several hundred tasks of static text and none of it needs to
 * ship to the browser. Search is a GET form for the same reason.
 *
 * ── Drill order ────────────────────────────────────────────────────────────────────────────
 *
 * Phase (when) and domain (who) are two ways into the same areas, so either may be chosen first and
 * the other second. Below the area the path is single: sub-process, then task.
 */

import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronRight, Search } from "lucide-react";

import {
  AREAS,
  DOMAINS,
  PHASES,
  ROLES,
  areaOf,
  areasWhere,
  countsOf,
  domainOf,
  phaseOf,
  searchLibrary,
  subProcessOf,
  type Area,
  type Counts,
  type DomainCode,
  type PhaseNumber,
  type SubProcess,
  type Task,
} from "@/lib/process-library";

export interface Selection {
  phase?: string;
  domain?: string;
  area?: string;
  sp?: string;
  task?: string;
  q?: string;
}

type Params = Omit<Selection, "q">;

function href(params: Params): string {
  const query = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  ).toString();
  return query ? `/process?${query}` : "/process";
}

const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : /(s|ch)$/.test(word) ? "es" : "s"}`;
const countLine = (c: Counts) =>
  `${plural(c.areas, "area")} · ${plural(c.subProcesses, "sub-process")} · ${plural(c.tasks, "task")}`;

export function ProcessModelView({ selection }: { selection: Selection }) {
  // Resolve from the deepest selection upward, so a link to a task needs only its sub-process code.
  const found = selection.sp ? subProcessOf(selection.sp) : null;
  const area = found?.area ?? (selection.area ? areaOf(selection.area) : null);
  const subProcess = found?.subProcess ?? null;
  const task =
    subProcess && selection.task
      ? (subProcess.tasks.find((t) => t.code === selection.task) ?? null)
      : null;

  const phase = area
    ? phaseOf(area.phase)
    : selection.phase
      ? phaseOf(Number(selection.phase))
      : null;
  const domain = area
    ? domainOf(area.domain)
    : selection.domain
      ? domainOf(selection.domain)
      : null;

  const query = selection.q?.trim() ?? "";
  const total = countsOf(AREAS);

  return (
    <div
      data-region="process-model"
      className="mx-auto max-w-[1180px] px-4 py-6 sm:px-8"
    >
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="t-xl text-[var(--n-800)]">Process model</h1>
          <p className="t-md mt-0.5 max-w-[85ch] text-[var(--n-500)]">
            How a construction project is delivered, as a BPMN hierarchy —{" "}
            {PHASES.length} phases (L0), {DOMAINS.length} professional domains
            (L1), {total.areas} process areas (L2), {total.subProcesses}{" "}
            sub-processes (L3) and {total.tasks} tasks (L4). Choose a phase or a
            domain and drill down; every level says what happens, who does it,
            what goes in and what comes out.
          </p>
        </div>

        <form
          action="/process"
          method="get"
          role="search"
          className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto"
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search the process model</span>
            <Search
              aria-hidden
              size={14}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--n-400)]"
            />
            <input
              name="q"
              defaultValue={query}
              placeholder="Search areas, processes, tasks…"
              className="t-sm h-8 w-full min-w-0 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] pr-2.5 pl-8 sm:w-[260px] text-[var(--n-800)] placeholder:text-[var(--n-400)] focus:border-[var(--a-500)] focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)]"
          >
            Search
          </button>
        </form>
      </header>

      {query ? (
        <SearchResults query={query} />
      ) : (
        <>
          <Breadcrumb
            phase={phase?.number}
            domain={domain?.code}
            area={area}
            subProcess={subProcess}
            task={task}
          />

          <div className="mt-4">
            {task && subProcess && area ? (
              <TaskLevel area={area} subProcess={subProcess} task={task} />
            ) : subProcess && area ? (
              <SubProcessLevel area={area} subProcess={subProcess} />
            ) : area ? (
              <AreaLevel area={area} />
            ) : phase && domain ? (
              <AreaList phase={phase.number} domain={domain.code} />
            ) : phase ? (
              <PhaseLevel phase={phase.number} />
            ) : domain ? (
              <DomainLevel domain={domain.code} />
            ) : (
              <Overview />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Chrome ──────────────────────────────────────────────────────────────────────────────────

function Breadcrumb({
  phase,
  domain,
  area,
  subProcess,
  task,
}: {
  phase?: PhaseNumber;
  domain?: DomainCode;
  area: Area | null;
  subProcess: SubProcess | null;
  task: Task | null;
}) {
  if (!phase && !domain) return null;

  const crumbs: { label: string; to: string; level: string }[] = [
    { label: "All phases", to: href({}), level: "" },
  ];
  if (phase)
    crumbs.push({
      label: `Phase ${phase} · ${phaseOf(phase)!.name}`,
      to: href({ phase: String(phase) }),
      level: "L0",
    });
  if (domain) {
    crumbs.push({
      label: `${domain} · ${domainOf(domain)!.name}`,
      to: href({ phase: phase ? String(phase) : undefined, domain }),
      level: "L1",
    });
  }
  if (area)
    crumbs.push({
      label: `${area.code} · ${area.name}`,
      to: href({ area: area.code }),
      level: "L2",
    });
  if (subProcess)
    crumbs.push({
      label: `${subProcess.code} · ${subProcess.name}`,
      to: href({ sp: subProcess.code }),
      level: "L3",
    });
  if (task && subProcess)
    crumbs.push({
      label: `${task.code} · ${task.name}`,
      to: href({ sp: subProcess.code, task: task.code }),
      level: "L4",
    });

  return (
    <nav
      aria-label="Process model level"
      data-region="process-breadcrumb"
      className="mt-4 overflow-x-auto"
    >
      <ol className="t-sm flex items-center gap-1 whitespace-nowrap text-[var(--n-500)]">
        {crumbs.map((crumb, i) => (
          <li key={crumb.to + i} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight aria-hidden size={13} className="shrink-0" />
            )}
            {i === crumbs.length - 1 ? (
              <span
                aria-current="page"
                className="font-medium text-[var(--n-800)]"
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.to}
                className="hover:text-[var(--a-600)] hover:underline"
              >
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function LevelTag({ level }: { level: string }) {
  return (
    <span className="t-xs num shrink-0 rounded-[var(--r-sm)] bg-[var(--n-100)] px-1.5 py-0.5 font-semibold text-[var(--n-600)]">
      {level}
    </span>
  );
}

function Card({
  to,
  children,
  data,
}: {
  to: string;
  children: React.ReactNode;
  data?: Record<string, string>;
}) {
  return (
    <Link
      href={to}
      {...Object.fromEntries(
        Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]),
      )}
      className="group flex flex-col rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] p-4 transition-colors hover:border-[var(--a-500)] hover:bg-[var(--a-50)]"
      style={{ transitionDuration: "var(--m-fast)" }}
    >
      {children}
    </Link>
  );
}

function DrillHint({ children }: { children: React.ReactNode }) {
  return (
    <span className="t-xs mt-auto flex items-center gap-1 pt-3 font-medium text-[var(--a-600)]">
      {children}
      <ArrowRight
        aria-hidden
        size={12}
        className="transition-transform group-hover:translate-x-0.5"
      />
    </span>
  );
}

function Detail({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
      <dt className="t-sm shrink-0 text-[var(--n-500)] sm:w-[9.5rem]">{term}</dt>
      <dd className="t-sm min-w-0 flex-1 text-[var(--n-700)]">{children}</dd>
    </div>
  );
}

function Pills({
  items,
  tone = "neutral",
}: {
  items: readonly string[];
  tone?: "neutral" | "in" | "out";
}) {
  const skin =
    tone === "in"
      ? "bg-[var(--n-50)] border-[var(--n-200)] text-[var(--n-700)]"
      : tone === "out"
        ? "bg-[var(--ok-50)] border-[var(--ok-500)]/25 text-[var(--ok-700)]"
        : "bg-[var(--n-100)] border-transparent text-[var(--n-700)]";
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item}
          className={`t-xs rounded-[var(--r-sm)] border px-1.5 py-0.5 ${skin}`}
        >
          {item}
        </span>
      ))}
    </span>
  );
}

function References({ items }: { items?: readonly string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <Detail term="Sources">
      <ul className="flex flex-col gap-0.5">
        {items.map((r) => (
          <li key={r} className="t-sm text-[var(--n-600)]">
            {r}
          </li>
        ))}
      </ul>
    </Detail>
  );
}

// ── L0 — the value chain and the domains ───────────────────────────────────────────────────

function Overview() {
  return (
    <>
      <section data-level="L0" className="mt-2">
        <h2 className="t-base flex items-center gap-2 font-semibold text-[var(--n-800)]">
          <LevelTag level="L0" /> The value chain — choose a phase
        </h2>
        <ol className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-2">
          {PHASES.map((phase) => (
            <li key={phase.number} className="flex">
              <Card
                to={href({ phase: String(phase.number) })}
                data={{ phase: String(phase.number) }}
              >
                <span className="t-xs num font-semibold text-[var(--n-500)]">
                  Phase {phase.number}
                </span>
                <span className="t-base mt-0.5 font-semibold text-[var(--n-800)]">
                  {phase.name}
                </span>
                <span className="t-sm mt-1 line-clamp-3 text-[var(--n-600)]">
                  {phase.purpose}
                </span>
                <span className="t-xs mt-2 text-[var(--n-500)]">
                  {countLine(countsOf(areasWhere({ phase: phase.number })))}
                </span>
                <DrillHint>Open phase</DrillHint>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section data-level="L1" className="mt-8">
        <h2 className="t-base flex items-center gap-2 font-semibold text-[var(--n-800)]">
          <LevelTag level="L1" /> Or start from a professional domain
        </h2>
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-2">
          {DOMAINS.map((domain) => (
            <li key={domain.code} className="flex">
              <Card
                to={href({ domain: domain.code })}
                data={{ domain: domain.code }}
              >
                <span className="t-xs num font-semibold text-[var(--n-500)]">
                  {domain.code}
                </span>
                <span className="t-base mt-0.5 font-semibold text-[var(--n-800)]">
                  {domain.name}
                </span>
                <span className="t-sm mt-1 line-clamp-3 text-[var(--n-600)]">
                  {domain.purpose}
                </span>
                <span className="t-xs mt-2 text-[var(--n-500)]">
                  {countLine(countsOf(areasWhere({ domain: domain.code })))}
                </span>
                <DrillHint>Open domain</DrillHint>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** A phase: what it is for, how it maps to PROCSA and the FIDPM, its gate — and the domains working in it. */
function PhaseLevel({ phase: number }: { phase: PhaseNumber }) {
  const phase = phaseOf(number)!;
  const inPhase = DOMAINS.map((domain) => ({
    domain,
    areas: areasWhere({ phase: number, domain: domain.code }),
  }));

  return (
    <div data-level="L0-detail">
      <LevelHeader
        level="L0"
        code={`Phase ${phase.number}`}
        name={phase.name}
        purpose={phase.purpose}
      />
      <dl className="mt-4 flex flex-col gap-2 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-25)] p-4">
        <Detail term="PROCSA / SACQSP">{phase.procsa}</Detail>
        <Detail term="FIDPM">{phase.fidpm}</Detail>
        <Detail term="Gate">
          <span className="font-medium text-[var(--n-800)]">
            {phase.gate.deliverable}
          </span>
          <span className="text-[var(--n-500)]">
            {" "}
            — approved by {ROLES[phase.gate.approvedBy].toLowerCase()}
          </span>
          <ul className="mt-1 list-disc pl-4">
            {phase.gate.criteria.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Detail>
        <Detail term="Key deliverables">
          <Pills items={phase.keyDeliverables} tone="out" />
        </Detail>
        <References items={phase.references} />
      </dl>

      <PhaseNavigator current={number} />

      <h2 className="t-base mt-6 flex items-center gap-2 font-semibold text-[var(--n-800)]">
        <LevelTag level="L1" /> Domains working in this phase
      </h2>
      <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-2">
        {inPhase.map(({ domain, areas }) =>
          areas.length === 0 ? (
            <li
              key={domain.code}
              className="rounded-[var(--r-lg)] border border-dashed border-[var(--n-200)] p-4"
            >
              <span className="t-xs num font-semibold text-[var(--n-400)]">
                {domain.code}
              </span>
              <span className="t-base mt-0.5 block font-semibold text-[var(--n-500)]">
                {domain.name}
              </span>
              <span className="t-sm mt-1 block text-[var(--n-400)]">
                No process area of this domain sits in this phase.
              </span>
            </li>
          ) : (
            <li key={domain.code} className="flex">
              <Card
                to={href({ phase: String(number), domain: domain.code })}
                data={{ domain: domain.code }}
              >
                <span className="t-xs num font-semibold text-[var(--n-500)]">
                  {domain.code}
                </span>
                <span className="t-base mt-0.5 font-semibold text-[var(--n-800)]">
                  {domain.name}
                </span>
                <ul className="mt-2 flex flex-col gap-0.5">
                  {areas.map((a) => (
                    <li key={a.code} className="t-sm text-[var(--n-600)]">
                      <span className="num text-[var(--n-500)]">{a.code}</span>{" "}
                      {a.name}
                    </li>
                  ))}
                </ul>
                <DrillHint>{plural(areas.length, "process area")}</DrillHint>
              </Card>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** Previous and next phase, because the value chain is read in order. */
function PhaseNavigator({ current }: { current: PhaseNumber }) {
  const previous = phaseOf(current - 1);
  const next = phaseOf(current + 1);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      {previous ? (
        <Link
          href={href({ phase: String(previous.number) })}
          className="t-sm flex items-center gap-1 text-[var(--a-600)] hover:underline"
        >
          <ArrowLeft aria-hidden size={13} /> Phase {previous.number} ·{" "}
          {previous.name}
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link
          href={href({ phase: String(next.number) })}
          className="t-sm flex items-center gap-1 text-[var(--a-600)] hover:underline"
        >
          Phase {next.number} · {next.name} <ArrowRight aria-hidden size={13} />
        </Link>
      )}
    </div>
  );
}

// ── L1 — a domain ───────────────────────────────────────────────────────────────────────────

function DomainLevel({ domain: code }: { domain: DomainCode }) {
  const domain = domainOf(code)!;
  return (
    <div data-level="L1-detail">
      <LevelHeader
        level="L1"
        code={domain.code}
        name={domain.name}
        purpose={domain.purpose}
      />
      <dl className="mt-4 flex flex-col gap-2 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-25)] p-4">
        <Detail term="Led by">
          {domain.leads.map((r) => ROLES[r]).join(", ")}
        </Detail>
        <Detail term="Covers">
          {countLine(countsOf(areasWhere({ domain: code })))}
        </Detail>
      </dl>

      <h2 className="t-base mt-6 flex items-center gap-2 font-semibold text-[var(--n-800)]">
        <LevelTag level="L0" /> This domain&rsquo;s work, phase by phase
      </h2>
      <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-2">
        {PHASES.map((phase) => {
          const areas = areasWhere({ phase: phase.number, domain: code });
          if (areas.length === 0) return null;
          return (
            <li key={phase.number} className="flex">
              <Card
                to={href({ domain: code, phase: String(phase.number) })}
                data={{ phase: String(phase.number) }}
              >
                <span className="t-xs num font-semibold text-[var(--n-500)]">
                  Phase {phase.number}
                </span>
                <span className="t-base mt-0.5 font-semibold text-[var(--n-800)]">
                  {phase.name}
                </span>
                <ul className="mt-2 flex flex-col gap-0.5">
                  {areas.map((a) => (
                    <li key={a.code} className="t-sm text-[var(--n-600)]">
                      <span className="num text-[var(--n-500)]">{a.code}</span>{" "}
                      {a.name}
                    </li>
                  ))}
                </ul>
                <DrillHint>{plural(areas.length, "process area")}</DrillHint>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── L2 — process areas ──────────────────────────────────────────────────────────────────────

function AreaList({
  phase,
  domain,
}: {
  phase: PhaseNumber;
  domain: DomainCode;
}) {
  const areas = areasWhere({ phase, domain });
  return (
    <div data-level="L2-list">
      <h2 className="t-base flex items-center gap-2 font-semibold text-[var(--n-800)]">
        <LevelTag level="L2" /> {domainOf(domain)!.name} in{" "}
        {phaseOf(phase)!.name}
      </h2>
      {areas.length === 0 ? (
        <p className="t-sm mt-3 text-[var(--n-500)]">
          No process area of this domain sits in this phase.
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-2">
          {areas.map((area) => (
            <li key={area.code} className="flex">
              <AreaCard area={area} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AreaCard({ area }: { area: Area }) {
  return (
    <Card to={href({ area: area.code })} data={{ area: area.code }}>
      <span className="t-xs num font-semibold text-[var(--n-500)]">
        {area.code}
      </span>
      <span className="t-base mt-0.5 font-semibold text-[var(--n-800)]">
        {area.name}
      </span>
      <span className="t-sm mt-1 text-[var(--n-600)]">{area.purpose}</span>
      <ul className="mt-2 flex flex-col gap-0.5">
        {area.subProcesses.map((s) => (
          <li key={s.code} className="t-sm text-[var(--n-600)]">
            <span className="num text-[var(--n-500)]">
              {s.code.split("-").slice(1).join("-")}
            </span>{" "}
            {s.name}
          </li>
        ))}
      </ul>
      <DrillHint>{plural(area.subProcesses.length, "sub-process")}</DrillHint>
    </Card>
  );
}

function AreaLevel({ area }: { area: Area }) {
  const siblings = areasWhere({ phase: area.phase, domain: area.domain });
  return (
    <div data-level="L2-detail">
      <LevelHeader
        level="L2"
        code={area.code}
        name={area.name}
        purpose={area.purpose}
      />
      <dl className="mt-4 flex flex-col gap-2 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-25)] p-4">
        <Detail term="Phase">
          <Link
            href={href({ phase: String(area.phase) })}
            className="text-[var(--a-600)] hover:underline"
          >
            Phase {area.phase} · {phaseOf(area.phase)!.name}
          </Link>
        </Detail>
        <Detail term="Domain">
          <Link
            href={href({ domain: area.domain })}
            className="text-[var(--a-600)] hover:underline"
          >
            {area.domain} · {domainOf(area.domain)!.name}
          </Link>
        </Detail>
        <Detail term="Contains">{countLine(countsOf([area]))}</Detail>
        {siblings.length > 1 && (
          <Detail term="Alongside">
            {siblings
              .filter((s) => s.code !== area.code)
              .map((s, i) => (
                <span key={s.code}>
                  {i > 0 && ", "}
                  <Link
                    href={href({ area: s.code })}
                    className="text-[var(--a-600)] hover:underline"
                  >
                    {s.code} {s.name}
                  </Link>
                </span>
              ))}
          </Detail>
        )}
      </dl>

      <h2 className="t-base mt-6 flex items-center gap-2 font-semibold text-[var(--n-800)]">
        <LevelTag level="L3" /> Sub-processes
      </h2>
      <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-2">
        {area.subProcesses.map((s) => (
          <li key={s.code} className="flex">
            <Card to={href({ sp: s.code })} data={{ "sub-process": s.code }}>
              <span className="t-xs num font-semibold text-[var(--n-500)]">
                {s.code}
              </span>
              <span className="t-base mt-0.5 font-semibold text-[var(--n-800)]">
                {s.name}
              </span>
              <span className="t-sm mt-1 text-[var(--n-600)]">{s.purpose}</span>
              <span className="t-xs mt-2 text-[var(--n-500)]">
                Owner: {ROLES[s.owner]} · {plural(s.tasks.length, "task")}
                {s.gateway ? " · 1 decision" : ""}
              </span>
              <DrillHint>Open the process flow</DrillHint>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LevelHeader({
  level,
  code,
  name,
  purpose,
}: {
  level: string;
  code: string;
  name: string;
  purpose: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-2">
        <LevelTag level={level} />
        <span className="t-sm num font-semibold text-[var(--n-500)]">
          {code}
        </span>
      </p>
      <h2 className="t-lg mt-1 font-semibold text-[var(--n-800)]">{name}</h2>
      <p className="t-md mt-1 max-w-[90ch] text-[var(--n-600)]">{purpose}</p>
    </div>
  );
}

// ── L3 — the BPMN flow ──────────────────────────────────────────────────────────────────────

function SubProcessLevel({
  area,
  subProcess,
}: {
  area: Area;
  subProcess: SubProcess;
}) {
  const roles = [
    ...new Set(
      subProcess.tasks.flatMap((t) => [t.performer, ...(t.with ?? [])]),
    ),
  ];
  const inputs = [...new Set(subProcess.tasks[0]?.inputs ?? [])];
  const outputs = [...new Set(subProcess.tasks.at(-1)?.outputs ?? [])];

  return (
    <div data-level="L3-detail">
      <LevelHeader
        level="L3"
        code={subProcess.code}
        name={subProcess.name}
        purpose={subProcess.purpose}
      />

      <Flow subProcess={subProcess} />

      <dl className="mt-4 flex flex-col gap-2 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-25)] p-4">
        <Detail term="Starts when">{subProcess.trigger}</Detail>
        <Detail term="Ends with">{subProcess.outcome}</Detail>
        <Detail term="Process owner">{ROLES[subProcess.owner]}</Detail>
        <Detail term="Participants">
          {roles.map((r) => ROLES[r]).join(", ")}
        </Detail>
        <Detail term="Inputs">
          <Pills items={inputs} tone="in" />
        </Detail>
        <Detail term="Outputs">
          <Pills items={outputs} tone="out" />
        </Detail>
        {subProcess.gateway && (
          <Detail term="Decision">
            <span className="font-medium text-[var(--n-800)]">
              {subProcess.gateway.question}
            </span>
            <span className="mt-1 block">
              <span className="font-medium text-[var(--ok-700)]">Yes:</span>{" "}
              {subProcess.gateway.yes}
            </span>
            <span className="block">
              <span className="font-medium text-[var(--warn-700)]">No:</span>{" "}
              {subProcess.gateway.no}
            </span>
          </Detail>
        )}
        <References items={subProcess.references} />
        <Detail term="Part of">
          <Link
            href={href({ area: area.code })}
            className="text-[var(--a-600)] hover:underline"
          >
            {area.code} · {area.name}
          </Link>
        </Detail>
      </dl>

      <h2 className="t-base mt-6 flex items-center gap-2 font-semibold text-[var(--n-800)]">
        <LevelTag level="L4" /> Tasks
      </h2>
      <ol className="mt-3 flex flex-col gap-2">
        {subProcess.tasks.map((task) => (
          <li key={task.code}>
            <Link
              href={href({ sp: subProcess.code, task: task.code })}
              data-task={task.code}
              className="group flex flex-wrap items-start gap-x-4 gap-y-1 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-4 py-3 transition-colors hover:border-[var(--a-500)] hover:bg-[var(--a-50)]"
              style={{ transitionDuration: "var(--m-fast)" }}
            >
              <span className="t-sm num w-9 shrink-0 font-semibold text-[var(--n-500)]">
                {task.code}
              </span>
              <span className="min-w-0 flex-1">
                <span className="t-base block font-medium text-[var(--n-800)]">
                  {task.name}
                </span>
                <span className="t-sm block text-[var(--n-600)]">
                  {task.does}
                </span>
              </span>
              <span className="t-xs rounded-[var(--r-sm)] bg-[var(--n-100)] px-1.5 py-0.5 text-[var(--n-700)]">
                {ROLES[task.performer]}
              </span>
              <ArrowRight
                aria-hidden
                size={14}
                className="mt-1 shrink-0 text-[var(--a-600)]"
              />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The sub-process as BPMN: start event, tasks in sequence, the exclusive gateway after the task it
 * follows, end event. Drawn with boxes rather than SVG so every task is a real link and the flow
 * wraps inside its own horizontal scroller on a narrow screen.
 */
function Flow({ subProcess }: { subProcess: SubProcess }) {
  const gateway = subProcess.gateway;

  return (
    <div
      data-region="bpmn-flow"
      className="mt-4 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]"
    >
      <p className="t-xs flex items-center justify-between gap-2 border-b border-[var(--n-100)] px-4 py-2 text-[var(--n-500)]">
        <span>
          Process flow · {subProcess.tasks.length} tasks
          {gateway ? " · 1 decision" : ""}
        </span>
        <span>Scroll sideways to follow it; select a task to open it</span>
      </p>
      <div className="overflow-x-auto p-4">
        <ol className="flex min-w-max items-stretch">
          <li className="flex items-center">
            <span className="flex flex-col items-center gap-1">
              <span
                aria-hidden
                className="size-7 rounded-full border-2 border-[var(--ok-500)] bg-[var(--ok-50)]"
              />
              <span className="t-xs max-w-[9rem] text-center text-[var(--n-600)]">
                {subProcess.trigger}
              </span>
            </span>
          </li>

          {subProcess.tasks.map((task) => (
            <li key={task.code} className="flex items-stretch">
              <Arrow />
              <Link
                href={href({ sp: subProcess.code, task: task.code })}
                className="flex w-[10.5rem] flex-col rounded-[var(--r-md)] border border-[var(--n-300)] bg-[var(--n-25)] p-2 hover:border-[var(--a-500)] hover:bg-[var(--a-50)]"
              >
                <span className="t-xs num font-semibold text-[var(--n-500)]">
                  {task.code}
                </span>
                <span className="t-sm font-medium text-[var(--n-800)]">
                  {task.name}
                </span>
                <span className="t-xs mt-auto pt-1 text-[var(--n-500)]">
                  {ROLES[task.performer]}
                </span>
              </Link>

              {gateway?.after === task.code && (
                <>
                  <Arrow />
                  <span className="flex w-[11rem] flex-col items-center justify-center gap-1.5">
                    <span
                      aria-hidden
                      className="grid size-8 rotate-45 place-items-center border-2 border-[var(--warn-500)] bg-[var(--warn-50)]"
                    >
                      <span className="t-xs -rotate-45 font-bold text-[var(--warn-700)]">
                        ×
                      </span>
                    </span>
                    <span className="t-xs text-center font-medium text-[var(--n-800)]">
                      {gateway.question}
                    </span>
                    <span className="t-xs text-center text-[var(--warn-700)]">
                      No → {gateway.no}
                    </span>
                  </span>
                </>
              )}
            </li>
          ))}

          <li className="flex items-center">
            <Arrow />
            <span className="flex flex-col items-center gap-1">
              <span
                aria-hidden
                className="size-7 rounded-full border-[3px] border-[var(--n-700)] bg-[var(--n-100)]"
              />
              <span className="t-xs max-w-[9rem] text-center text-[var(--n-600)]">
                {subProcess.outcome}
              </span>
            </span>
          </li>
        </ol>
      </div>
    </div>
  );
}

/** A BPMN sequence flow between two shapes. */
function Arrow() {
  return (
    <span
      aria-hidden
      className="h-px w-5 shrink-0 self-center bg-[var(--n-300)]"
    />
  );
}

// ── L4 — a task ─────────────────────────────────────────────────────────────────────────────

function TaskLevel({
  area,
  subProcess,
  task,
}: {
  area: Area;
  subProcess: SubProcess;
  task: Task;
}) {
  const index = subProcess.tasks.indexOf(task);
  const previous = subProcess.tasks[index - 1];
  const next = subProcess.tasks[index + 1];
  const decision =
    subProcess.gateway?.after === task.code ? subProcess.gateway : null;

  return (
    <div data-level="L4-detail">
      <LevelHeader
        level="L4"
        code={`${subProcess.code}-${task.code}`}
        name={task.name}
        purpose={task.does}
      />

      <dl className="mt-4 flex flex-col gap-2 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-25)] p-4">
        <Detail term="Performed by">
          <span className="font-medium text-[var(--n-800)]">
            {ROLES[task.performer]}
          </span>
        </Detail>
        {task.with && task.with.length > 0 && (
          <Detail term="With">
            {task.with.map((r) => ROLES[r]).join(", ")}
          </Detail>
        )}
        <Detail term="Inputs">
          <Pills items={task.inputs} tone="in" />
        </Detail>
        <Detail term="Outputs">
          <Pills items={task.outputs} tone="out" />
        </Detail>
        {decision && (
          <Detail term="Then decide">
            <span className="font-medium text-[var(--n-800)]">
              {decision.question}
            </span>
            <span className="mt-1 block">
              <span className="font-medium text-[var(--ok-700)]">Yes:</span>{" "}
              {decision.yes}
            </span>
            <span className="block">
              <span className="font-medium text-[var(--warn-700)]">No:</span>{" "}
              {decision.no}
            </span>
          </Detail>
        )}
        <References items={task.references} />
        <Detail term="Step">
          {index + 1} of {subProcess.tasks.length} in{" "}
          <Link
            href={href({ sp: subProcess.code })}
            className="text-[var(--a-600)] hover:underline"
          >
            {subProcess.code} · {subProcess.name}
          </Link>{" "}
          ({area.code} {area.name})
        </Detail>
      </dl>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {previous ? (
          <Link
            href={href({ sp: subProcess.code, task: previous.code })}
            data-action="previous-task"
            className="t-sm flex items-center gap-1 rounded-[var(--r-md)] border border-[var(--n-200)] px-3 py-1.5 text-[var(--n-700)] hover:bg-[var(--n-50)]"
          >
            <ArrowLeft aria-hidden size={13} /> {previous.code} ·{" "}
            {previous.name}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={href({ sp: subProcess.code, task: next.code })}
            data-action="next-task"
            className="t-sm flex items-center gap-1 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 py-1.5 font-medium text-white hover:bg-[var(--a-600)]"
          >
            {next.code} · {next.name} <ArrowRight aria-hidden size={13} />
          </Link>
        ) : (
          <span className="t-sm text-[var(--n-500)]">
            Ends with: {subProcess.outcome}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Search ──────────────────────────────────────────────────────────────────────────────────

function SearchResults({ query }: { query: string }) {
  const hits = searchLibrary(query);
  return (
    <section data-region="process-search" className="mt-5">
      <p className="t-sm text-[var(--n-600)]">
        {hits.length === 0
          ? "Nothing in the process model matches"
          : `${plural(hits.length, "match")} for`}{" "}
        <span className="font-medium text-[var(--n-800)]">
          &ldquo;{query}&rdquo;
        </span>{" "}
        ·{" "}
        <Link href="/process" className="text-[var(--a-600)] hover:underline">
          clear
        </Link>
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {hits.map((hit) => (
          <li key={hit.code}>
            <Link
              href={
                hit.level === "L2"
                  ? href({ area: hit.area.code })
                  : hit.level === "L3"
                    ? href({ sp: hit.subProcess!.code })
                    : href({ sp: hit.subProcess!.code, task: hit.task!.code })
              }
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-[var(--r-md)] border border-[var(--n-200)] px-3 py-2 hover:border-[var(--a-500)] hover:bg-[var(--a-50)]"
            >
              <LevelTag level={hit.level} />
              <span className="t-sm num text-[var(--n-500)]">{hit.code}</span>
              <span className="t-base font-medium text-[var(--n-800)]">
                {hit.name}
              </span>
              <span className="t-xs text-[var(--n-500)]">
                Phase {hit.area.phase} · {domainOf(hit.area.domain)!.name} ·{" "}
                {hit.area.name}
                {hit.subProcess && hit.level === "L4"
                  ? ` · ${hit.subProcess.name}`
                  : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
