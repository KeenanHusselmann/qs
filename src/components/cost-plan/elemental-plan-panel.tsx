"use client";

/**
 * The elemental cost plan, from the bill – D1.1 Cost Plan Revision.
 *
 * The totals first and large, because they are what the plan is read for; then the elements, each
 * opening onto the bill items it is made of, where an item can be moved to another element; then
 * what is added to the measured work, with the allowances a QS sets. Typical allowances are shown
 * until somebody sets their own, and said to be typical – the same rule as an assumed figure in
 * the take-off.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Layers } from "lucide-react";

import { setAllowances, setElement, setElementQuantity } from "@/app/(app)/projects/[id]/cost-plan-actions";
import { issueDocument } from "@/app/(app)/projects/[id]/document-actions";
import { ELEMENTS, inSentence, type ElementId } from "@/domain/elemental-plan";
import { displayUnit, formatMoney, formatQuantity, money, parseQuantity } from "@/domain/money";
import { formatDate } from "@/lib/dates";
import type { ElementalPlanView } from "@/lib/elemental-plan";

const R = (cents: string) => formatMoney(money(BigInt(cents)), { symbol: "R" });
const share = (bp: number) => `${(bp / 100).toFixed(1).replace(".", ",")}%`;
const field = "t-sm h-8 w-full rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)]";

export function ElementalPlanPanel({ projectId, view }: { projectId: string; view: ElementalPlanView }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [said, setSaid] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ id: string; title: string } | null>(null);
  const [form, setForm] = useState({
    preliminaries: view.allowances.preliminaries,
    contingency: view.allowances.contingency,
    escalation: view.allowances.escalation,
    vat: view.allowances.vat,
    measureLabel: view.measure?.label ?? "",
    measureValue: view.measure ? formatQuantity(parseQuantity(view.measure.value)) : "",
  });
  const { plan } = view;
  const typical = view.allowances.set === null;
  const per = view.measure ? ` per ${displayUnit(view.measure.label)}` : "";
  const guessed = view.items.filter((i) => i.assignedBy === "words").length;

  return (
    <section data-region="elemental-plan" className="rounded-[var(--r-lg)] border border-[var(--n-200)]">
      <header className="flex flex-wrap items-start gap-3 border-b border-[var(--n-100)] px-4 py-3">
        <Layers aria-hidden size={16} strokeWidth={1.75} className="mt-0.5 text-[var(--a-600)]" />
        <div className="min-w-0 flex-1">
          <h2 className="t-base font-semibold text-[var(--n-800)]">Elemental cost plan – from the Bill of Quantities</h2>
          <p data-region="plan-source" className="t-sm mt-0.5 text-[var(--n-600)]">
            {view.bill.signed ? (
              <>
                From the bill signed off by {view.bill.by} on {formatDate(view.bill.at!)}.
              </>
            ) : (
              <span className="text-[var(--warn-700)]">From the draft bill – it is not signed off, so this plan moves with every change to it until it is.</span>
            )}{" "}
            Each measured item is grouped into its element; what the bill does not carry is added below.
          </p>
        </div>
        <a href={`/projects/${projectId}/bill`} className="t-sm font-medium text-[var(--a-700)] underline underline-offset-2">
          Open the bill
        </a>
      </header>

      {/* ── The totals, first and large ─────────────────────────────────────────────────── */}
      <div data-region="plan-totals" className="grid grid-cols-1 gap-px bg-[var(--n-100)] sm:grid-cols-3">
        {[
          { label: "Measured work", value: plan.net, note: `${view.items.length} bill items${plan.unpriced ? `, ${plan.unpriced} not priced` : ""}` },
          { label: "Total excluding VAT", value: plan.excludingVat, note: plan.perMeasure ? `${R(plan.perMeasure.excludingVat)}${per}` : "with preliminaries, contingency and escalation" },
          { label: "Total including VAT", value: plan.includingVat, note: plan.perMeasure ? `${R(plan.perMeasure.includingVat)}${per}` : `VAT at ${view.allowances.vat}%`, strong: true },
        ].map((t) => (
          <div key={t.label} className={`px-4 py-3 ${t.strong ? "bg-[var(--a-50)]" : "bg-[var(--n-0)]"}`}>
            <p className="t-xs font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase">{t.label}</p>
            <p data-total={t.label} className={`num mt-0.5 font-semibold text-[var(--n-900)] ${t.strong ? "text-[1.6rem] leading-tight" : "text-[1.25rem] leading-tight"}`}>
              {R(t.value)}
            </p>
            <p className="t-xs mt-0.5 text-[var(--n-500)]">{t.note}</p>
          </div>
        ))}
      </div>

      {plan.unpriced > 0 && (
        <p className="t-sm border-t border-[var(--n-100)] bg-[var(--warn-50)] px-4 py-2 text-[var(--warn-700)]">
          {plan.unpriced} {plan.unpriced === 1 ? "item is" : "items are"} not priced yet, so {plan.unpriced === 1 ? "it is" : "they are"} not in these totals. Price them under Pricing.
        </p>
      )}

      {/* ── The elements ────────────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto border-t border-[var(--n-100)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="t-xs text-left font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase">
              <th className="px-4 py-2">Element</th>
              <th className="px-2 py-2 text-right">Items</th>
              <th className="px-2 py-2 text-right">Element quantity</th>
              <th className="px-2 py-2 text-right">Element rate</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="px-2 py-2 text-right">Share</th>
              {view.measure && <th className="px-4 py-2 text-right">Per {displayUnit(view.measure.label)}</th>}
            </tr>
          </thead>
          <tbody>
            {plan.elements.map((e) => (
              <ElementRows key={e.id} projectId={projectId} element={e} items={view.items.filter((i) => i.element === e.id)} measured={Boolean(view.measure)} />
            ))}
            <tr className="border-t-2 border-[var(--n-300)]">
              <td className="t-base px-4 py-2 font-semibold text-[var(--n-800)]">Measured work</td>
              <td className="num t-sm px-2 py-2 text-right">{view.items.length}</td>
              <td />
              <td />
              <td data-region="plan-net" className="num t-base px-2 py-2 text-right font-semibold">{R(plan.net)}</td>
              <td className="num t-sm px-2 py-2 text-right text-[var(--n-500)]">100%</td>
              {view.measure && <td />}
            </tr>
          </tbody>
        </table>
      </div>
      {guessed > 0 && (
        <p className="t-xs border-t border-[var(--n-100)] px-4 py-2 text-[var(--n-500)]">
          {guessed} {guessed === 1 ? "item was" : "items were"} grouped by {guessed === 1 ? "its" : "their"} description – open an element to move an item to another.
        </p>
      )}

      {/* ── What the bill does not carry ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 border-t border-[var(--n-100)] px-4 py-4 lg:grid-cols-[1fr_22rem]">
        <table data-region="plan-build-up" className="w-full border-collapse self-start">
          <tbody className="t-base">
            {[
              ["Measured work", plan.net, null],
              [`Preliminaries and general (${view.allowances.preliminaries}%)`, plan.preliminaries, "+"],
              [`Contingency (${view.allowances.contingency}%)`, plan.contingency, "+"],
              [`Escalation (${view.allowances.escalation}%)`, plan.escalation, "+"],
            ].map(([label, value, sign]) => (
              <tr key={label as string} className="border-b border-[var(--n-100)]">
                <td className="py-1.5 text-[var(--n-700)]">
                  {sign ? <span className="mr-1 text-[var(--n-400)]">{sign}</span> : null}
                  {label}
                </td>
                <td className="num py-1.5 text-right">{R(value as string)}</td>
              </tr>
            ))}
            <tr className="border-b border-[var(--n-300)]">
              <td className="py-2 font-semibold text-[var(--n-800)]">Total excluding VAT</td>
              <td data-region="plan-excl" className="num py-2 text-right font-semibold">{R(plan.excludingVat)}</td>
            </tr>
            <tr className="border-b border-[var(--n-100)]">
              <td className="py-1.5 text-[var(--n-700)]">
                <span className="mr-1 text-[var(--n-400)]">+</span>VAT ({view.allowances.vat}%)
              </td>
              <td className="num py-1.5 text-right">{R(plan.vat)}</td>
            </tr>
            <tr>
              <td className="py-2 text-[1.05rem] font-bold text-[var(--n-900)]">Total including VAT</td>
              <td data-region="plan-incl" className="num py-2 text-right text-[1.05rem] font-bold text-[var(--n-900)]">{R(plan.includingVat)}</td>
            </tr>
          </tbody>
        </table>

        <form
          data-region="plan-allowances"
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              const r = await setAllowances(projectId, form);
              if (!r.ok) {
                setErrors(r.errors ?? {});
                setSaid(r.reason);
                return;
              }
              setErrors({});
              setSaid("Allowances saved.");
              router.refresh();
            });
          }}
          className="flex flex-col gap-2 rounded-[var(--r-md)] border border-[var(--n-200)] p-3"
        >
          <p className="t-sm font-medium text-[var(--n-800)]">Allowances and measure</p>
          {typical && (
            <p data-region="plan-typical" className="t-xs rounded-[var(--r-sm)] bg-[var(--warn-50)] px-2 py-1 text-[var(--warn-700)]">
              Typical figures, not set for this project – set your own and save.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["preliminaries", "Preliminaries %"],
                ["contingency", "Contingency %"],
                ["escalation", "Escalation %"],
                ["vat", "VAT %"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex flex-col gap-0.5">
                <span className="t-xs text-[var(--n-500)]">{label}</span>
                <input name={key} inputMode="decimal" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className={`${field} num text-right`} />
                {errors[key] && <span className="t-xs text-[var(--err-700)]">{errors[key]}</span>}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="t-xs text-[var(--n-500)]">Measure (optional)</span>
              <input name="measureLabel" value={form.measureLabel} onChange={(e) => setForm({ ...form, measureLabel: e.target.value })} placeholder="m of boundary wall" className={field} />
              {errors.measureLabel && <span className="t-xs text-[var(--err-700)]">{errors.measureLabel}</span>}
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="t-xs text-[var(--n-500)]">How many</span>
              <input name="measureValue" inputMode="decimal" value={form.measureValue} onChange={(e) => setForm({ ...form, measureValue: e.target.value })} placeholder="491,05" className={`${field} num text-right`} />
              {errors.measureValue && <span className="t-xs text-[var(--err-700)]">{errors.measureValue}</span>}
            </label>
          </div>
          <button type="submit" data-action="save-allowances" disabled={pending} className="t-sm h-8 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white hover:bg-[var(--n-900)] disabled:opacity-50">
            Save
          </button>
          {said && (
            <p role="status" className="t-xs text-[var(--n-600)]">
              {said}
            </p>
          )}
          {view.allowances.set && <p className="t-xs text-[var(--n-500)]">Set by {view.allowances.set.by} on {formatDate(view.allowances.set.at)}.</p>}
        </form>
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-[var(--n-100)] px-4 py-3">
        <button
          type="button"
          data-action="issue-elemental-plan"
          disabled={pending}
          onClick={() =>
            act(async () => {
              const r = await issueDocument(projectId, "elemental_cost_plan");
              if (!r.ok) return setSaid(r.reason);
              setIssued({ id: r.id!, title: r.title });
              router.refresh();
            })
          }
          className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-40"
        >
          <FileText aria-hidden size={14} strokeWidth={1.75} />
          Issue the elemental cost plan
        </button>
        {issued && (
          <a data-action="download-elemental-plan" href={`/projects/${projectId}/report/pdf?issued=${issued.id}`} className="t-sm flex items-center gap-1 font-medium text-[var(--a-700)] underline underline-offset-2">
            <Download aria-hidden size={12} /> {issued.title}
          </a>
        )}
        <span className="t-xs ml-auto text-[var(--n-500)]">Issued documents are kept on the project&rsquo;s Report page.</span>
      </footer>
    </section>
  );
}

/** Set the element's unit quantity, or go back to its principal measured item. */
function QuantityRow({ projectId, element, measured }: { projectId: string; element: ElementalPlanView["plan"]["elements"][number]; measured: boolean }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    quantity: element.quantity?.set ? formatQuantity(parseQuantity(element.quantity.value)) : "",
    unit: element.quantity?.set ? element.quantity.unit : "",
    label: element.quantity?.set ? element.quantity.basis : "",
  });
  const save = (input: typeof form) =>
    act(async () => {
      const r = await setElementQuantity(projectId, element.id, input);
      if (!r.ok) return setErrors(r.errors ?? {});
      setErrors({});
      router.refresh();
    });

  return (
    <tr data-euq-form={element.id} className="border-b border-[var(--n-100)] bg-[var(--n-25)]">
      <td colSpan={measured ? 7 : 6} className="px-4 py-2 pl-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(form);
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <span className="t-xs self-center text-[var(--n-600)]">
            Element quantity – {element.quantity && !element.quantity.set ? `taken from its principal item, ${inSentence(element.quantity.basis)}. Set another:` : element.quantity?.set ? "set by hand:" : "none measured. Set one:"}
          </span>
          <input aria-label="Element quantity" name="euq" inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="491,05" className={`${field} num w-24 text-right`} />
          <input aria-label="Element unit" name="euq-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="m" className={`${field} w-16`} />
          <input aria-label="What it measures" name="euq-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="length of wall" className={`${field} w-48`} />
          <button type="submit" data-action="set-euq" disabled={pending} className="t-xs h-8 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-40">
            Set
          </button>
          {element.quantity?.set && (
            <button type="button" data-action="reset-euq" disabled={pending} onClick={() => save({ quantity: "", unit: "", label: "" })} className="t-xs h-8 px-1 text-[var(--a-700)] underline underline-offset-2">
              Back to the measured item
            </button>
          )}
          {Object.values(errors).length > 0 && <span className="t-xs w-full text-[var(--err-700)]">{Object.values(errors).join(" ")}</span>}
        </form>
      </td>
    </tr>
  );
}

function ElementRows({
  projectId,
  element,
  items,
  measured,
}: {
  projectId: string;
  element: ElementalPlanView["plan"]["elements"][number];
  items: ElementalPlanView["items"];
  measured: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, act] = useTransition();
  const covers = ELEMENTS.find((e) => e.id === element.id)?.covers;

  return (
    <>
      <tr data-element={element.id} className="border-b border-[var(--n-100)] align-top">
        <td className="px-4 py-2">
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="t-base text-left font-medium text-[var(--n-800)] hover:text-[var(--a-700)]">
            <span className="mr-1 inline-block w-3 text-[var(--n-400)]">{open ? "▾" : "▸"}</span>
            {element.label}
          </button>
          <span className="t-xs block pl-4 text-[var(--n-500)]">{covers}</span>
        </td>
        <td className="num t-sm px-2 py-2 text-right text-[var(--n-600)]">
          {element.items}
          {element.unpriced ? <span className="t-xs block text-[var(--warn-700)]">{element.unpriced} unpriced</span> : null}
        </td>
        <td data-euq={element.id} className="num t-sm px-2 py-2 text-right text-[var(--n-800)]">
          {element.quantity ? (
            <>
              {formatQuantity(parseQuantity(element.quantity.value))} {displayUnit(element.quantity.unit)}
              <span className={`t-xs block max-w-[14rem] truncate ${element.quantity.set ? "text-[var(--a-700)]" : "text-[var(--n-500)]"}`} title={element.quantity.basis}>
                {element.quantity.set ? element.quantity.basis : `of ${inSentence(element.quantity.basis)}`}
              </span>
            </>
          ) : (
            <span className="text-[var(--n-400)]">–</span>
          )}
        </td>
        <td data-eur={element.id} className="num t-sm px-2 py-2 text-right text-[var(--n-800)]">
          {element.rate && element.quantity ? (
            <>
              {R(element.rate)}
              <span className="t-xs block text-[var(--n-500)]">per {displayUnit(element.quantity.unit)}</span>
            </>
          ) : (
            <span className="text-[var(--n-400)]">–</span>
          )}
        </td>
        <td className="num t-base px-2 py-2 text-right font-medium text-[var(--n-800)]">{R(element.amount)}</td>
        <td className="num t-sm px-2 py-2 text-right text-[var(--n-600)]">{share(element.share)}</td>
        {measured && <td className="num t-sm px-4 py-2 text-right text-[var(--n-600)]">{element.perMeasure ? R(element.perMeasure) : ""}</td>}
      </tr>
      {open && <QuantityRow projectId={projectId} element={element} measured={measured} />}
      {open &&
        items.map((i) => (
          <tr key={i.id} data-plan-item={i.ref} className="border-b border-[var(--n-100)] bg-[var(--n-25)]">
            <td className="t-sm py-1.5 pr-2 pl-8 text-[var(--n-700)]">
              <span className="num mr-2 text-[var(--n-500)]">{i.ref}</span>
              {i.description}
              <span className="t-xs ml-2 text-[var(--n-500)]">
                {i.quantity ? `${formatQuantity(parseQuantity(i.quantity))} ${displayUnit(i.unit ?? "")}` : "not measured"}
              </span>
            </td>
            <td className="px-2 py-1.5 text-right" colSpan={3}>
              <select
                aria-label={`Element of ${i.ref}`}
                data-move={i.ref}
                value={i.element}
                disabled={pending}
                onChange={(e) =>
                  act(async () => {
                    await setElement(projectId, i.id, e.target.value as ElementId);
                    router.refresh();
                  })
                }
                className="t-xs h-7 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-1 text-[var(--n-700)]"
              >
                {ELEMENTS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
              <span className="t-xs block text-[var(--n-400)]">{i.assignedBy === "agent" ? "as measured" : i.assignedBy === "person" ? "moved by hand" : "by its words"}</span>
            </td>
            <td className="num t-sm px-2 py-1.5 text-right text-[var(--n-700)]">{i.amount ? R(i.amount) : "–"}</td>
            <td />
            {measured && <td />}
          </tr>
        ))}
    </>
  );
}
