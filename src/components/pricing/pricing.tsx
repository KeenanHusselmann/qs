/**
 * Pricing — PLATFORM.md §4.8, over the bill §4.7 produced.
 *
 * ── What this screen is for, and what the bill is for ──────────────────────────────────────
 *
 * They are the same rows. The bill is where a job is **read** — described, sectioned, measured,
 * each row against the passage it came from. This is where it is **priced**: the rate column, the
 * count of what is still unpriced, a build-up behind a row, and a rate applied to forty rows at
 * once. §4.8 asks for exactly those and no more.
 *
 * Splitting them was not free, and the alternative was worse. §4.7 calls the bill "the most
 * important screen in the app"; hanging a selection model, a bulk bar and a five-row component
 * editor off every one of its rows would crowd out reading, which is what that screen exists for.
 *
 * §2.5 — one path per task — is honoured where it decides anything: **there is one write path.** A
 * rate corrected here goes through `correctCell`, the same server action the bill grid calls. The
 * two screens cannot come to disagree about what a correction is, because neither of them knows.
 *
 * ── No run, no signature ───────────────────────────────────────────────────────────────────
 *
 * Pricing produces nothing of its own to sign. It edits the bill's rows, and the bill's signature
 * freezes them — which is also why a signed bill renders here read-only rather than offering a
 * second signature over the same figures. The gate is already right: §4.7's sign-off refuses a bill
 * while any item has no rate, so a signed bill is a priced bill by construction.
 *
 * ── Research, honestly ─────────────────────────────────────────────────────────────────────
 *
 * There was no reference build for this screen. The Mzilikazi portal has a Rate Library page and no
 * pricing overview and no build-up; v3 had neither. So the shape here comes from §4.8's own
 * sentences, §7.4's grid requirements, and this platform's existing bill grid — which is the
 * idiom a QS on this product has already learned.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";

import { formatDate } from "@/lib/dates";
import { PricingGrid } from "@/components/pricing/pricing-grid";
import { FromLibrary } from "@/components/pricing/from-library";
import { MarketCheck } from "@/components/pricing/market-check";
import { marketFindings } from "@/lib/market-rates";
import { listRates } from "@/app/(app)/rates/actions";
import { loadBuildUps, loadLatestBill } from "@/lib/agent/persist-bill";
import { runState } from "@/lib/agent/run";
import { requireSession } from "@/lib/auth";
import { labelOf } from "@/lib/chain";
import { pricingTally } from "@/lib/pricing";
import { formatMoney } from "@/domain/money";
import { getProject } from "@/app/(app)/projects/actions";

/** The bill this prices. One module today; the constant is here so it is not a literal in four places. */
const BILL = "/bill";

const on = formatDate;

export async function Pricing({ projectId }: { projectId: string }) {
  await requireSession();

  const project = await getProject(projectId);
  if (!project) notFound();

  const bill = await loadLatestBill(projectId, BILL);
  const tally = bill ? pricingTally(bill.rows) : null;

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col px-8 py-6">
      <header>
        <h1 className="t-xl text-[var(--n-800)]">{labelOf("/pricing")}</h1>
        <p className="t-md mt-0.5 text-[var(--n-500)]">{project.name}</p>
      </header>

      {!bill || bill.rows.length === 0 ? (
        <Nothing projectId={projectId} drafted={Boolean(bill)} />
      ) : (
        <section data-region="pricing" className="mt-6 rounded-[var(--r-lg)] border border-[var(--n-200)]">
          {/*
            §4.8's "persistent unpriced count", and it is persistent in the sense that matters: it
            is on the screen while the work is being done rather than reported after it. Amber is
            §7.2's one meaning for unpriced, and §7.1 #5 requires the word beside the colour.
          */}
          <div
            data-region="tally"
            className="t-sm flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--n-100)] px-4 py-2"
          >
            <span className="text-[var(--n-700)]">
              {tally!.items} {tally!.items === 1 ? "item" : "items"}
            </span>
            {tally!.unpriced > 0 ? (
              <span data-unpriced className="font-medium text-[var(--warn-700)]">
                {tally!.unpriced} unpriced
              </span>
            ) : (
              <span data-unpriced className="font-medium text-[var(--ok-700)]">
                Every item is priced
              </span>
            )}
            {tally!.overridden > 0 && (
              <span className="text-[var(--a-600)]">{tally!.overridden} overridden</span>
            )}
            <span className="ml-auto text-[var(--n-600)]">
              Bill total{" "}
              <span className="num font-medium text-[var(--n-800)]">
                R {formatMoney(tally!.total)}
              </span>
            </span>
          </div>

          {bill.signedAt ? (
            <p className="t-sm flex flex-wrap items-center gap-2 border-b border-[var(--n-100)] bg-[var(--ok-50)]/40 px-4 py-2.5 text-[var(--n-700)]">
              <Lock aria-hidden size={14} strokeWidth={2} className="shrink-0 text-[var(--ok-700)]" />
              <span>
                <span className="font-medium text-[var(--ok-700)]">Signed off</span> by{" "}
                {bill.signedBy} on {on(bill.signedAt)}. These rates are frozen — repricing means
                drafting the bill again.
              </span>
            </p>
          ) : (
            runState(bill) === "running" && (
              <p className="t-sm border-b border-[var(--n-100)] px-4 py-2.5 text-[var(--n-600)]">
                This bill is still being drafted. Rows appear here as they settle, and pricing one
                that is still arriving would price a bill nobody has read yet.
              </p>
            )
          )}

          <PricingGrid
            projectId={projectId}
            runId={bill.id}
            rows={bill.rows}
            buildUps={Object.fromEntries(await loadBuildUps(bill.id))}
            frozen={Boolean(bill.signedAt)}
          />
        </section>
      )}

      {/*
        What the firm's library could price, under the grid it would price.

        Under rather than beside, for the reason the bill summary is: the grid needs its width, and
        at §14's 1280 with the advisor open the content column is about 700px. It renders nothing on
        a signed bill — those rates are frozen and repricing means drafting again.
      */}
      {/* Our rates against what tenderers priced the same items at on the practice's other jobs. */}
      {bill && bill.rows.length > 0 && (
        <div className="mt-6">
          <MarketCheck result={await marketFindings(projectId, bill.rows)} />
        </div>
      )}

      {bill && bill.rows.length > 0 && (
        <div className="mt-6">
          <FromLibrary
            projectId={projectId}
            projectRegion={project.region}
            runId={bill.id}
            rows={bill.rows}
            library={await listRates()}
            frozen={Boolean(bill.signedAt)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * §7.5 — "every list gets one. No blank canvases anywhere."
 *
 * Two different absences, said apart, because the action is different. No bill at all means go and
 * draft one; a bill that drafted nothing means the corpus described no work, which is a fact about
 * the documents rather than about this screen.
 */
function Nothing({ projectId, drafted }: { projectId: string; drafted: boolean }) {
  return (
    <div
      data-region="pricing-empty"
      className="mt-6 rounded-[var(--r-lg)] border border-[var(--n-200)] px-8 py-10 text-center"
    >
      <p className="t-lg text-[var(--n-800)]">
        {drafted ? "This bill has no rows to price" : "There is no bill to price yet"}
      </p>
      <p className="t-sm mx-auto mt-2 max-w-[46ch] text-[var(--n-600)]">
        {drafted
          ? "The bill was drafted and the filed documents described no item of measurable work. Add rows on the bill by hand, or file a specification and draft it again."
          : "Pricing is the bill's rate column: what each item costs, and what that rate is made of. Draft the bill first and every row it proposes appears here."}
      </p>
      <Link
        href={`/projects/${projectId}${BILL}`}
        className="t-base mt-4 inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)]"
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        Go to {labelOf(BILL)}
        <ArrowRight aria-hidden size={13} strokeWidth={2.25} />
      </Link>
    </div>
  );
}
