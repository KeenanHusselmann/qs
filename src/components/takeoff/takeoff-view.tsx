"use client";

/**
 * Take-off – dimension sheets, one per item, and the way each reaches the bill (D1.2).
 *
 * Laid out the way dim paper is: a timesing column, the dimensions, the line's quantity, and the
 * item's total under a rule. The totals are the server's – measured by `domain/dimensions.ts` –
 * and each item says what the bill row it feeds currently carries, so a sheet that has moved on
 * since it was sent is visible as exactly that.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileSpreadsheet, FileText, MapPin, Plus, Ruler, Trash2 } from "lucide-react";

import { addDimension, addTakeoffItem, deleteDimension, deleteTakeoffItem, linkToBill, sendToBill } from "@/app/(app)/projects/[id]/takeoff-actions";
import { dimensionsFor } from "@/domain/dimensions";
import { formatQuantity, parseQuantity } from "@/domain/money";
import type { Finding } from "@/domain/bill-rubric";
import type { BillRowOption, ParameterView, TakeoffItemView } from "@/lib/takeoff";
import { DrawingReader } from "@/components/takeoff/drawing-reader";
import { DrawingStudio } from "@/components/takeoff/drawing-studio";
import type { Mark } from "@/domain/drawing-marks";
import { MeasureDrawings } from "@/components/takeoff/measure-drawings";
import { documentHref } from "@/components/documents/document-link";
import { formatDate } from "@/lib/dates";

const q = (numeric: string | null, places = 2) => (numeric === null ? "" : formatQuantity(parseQuantity(numeric), places));
const field = "t-sm h-8 w-full rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)]";
const th = "t-xs border-b border-[var(--n-200)] px-2 py-1.5 text-left font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase";

export function TakeoffView({
  projectId,
  projectName,
  items,
  billRows,
  billSigned,
  billExists,
  parameters = [],
  drawings = [],
  review = [],
}: {
  projectId: string;
  projectName: string;
  items: readonly TakeoffItemView[];
  billRows: readonly BillRowOption[];
  billSigned: boolean;
  billExists: boolean;
  parameters?: readonly ParameterView[];
  drawings?: readonly { id: string; name: string }[];
  /** What the rubric asks of the take-off as it stands. */
  review?: readonly Finding[];
}) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [section, setSection] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("m2");
  // The drawing beside the sheets – offered whenever a PDF drawing is filed.
  const hasPdf = drawings.some((d) => d.name.toLowerCase().endsWith(".pdf"));
  const [studio, setStudio] = useState(false);
  const [focus, setFocus] = useState<{ lineId: string; mark: Mark } | null>(null);
  const showOnDrawing = (lineId: string, mark: Mark) => {
    setStudio(true);
    setFocus({ lineId, mark });
  };

  const sheets =
    items.length === 0 ? (
      <div className="mt-6 rounded-[var(--r-lg)] border border-dashed border-[var(--n-200)] px-6 py-10 text-center">
        <Ruler aria-hidden size={20} className="mx-auto text-[var(--n-400)]" />
        <p className="t-base mt-2 font-medium text-[var(--n-800)]">Nothing measured yet</p>
        <p className="t-sm mx-auto mt-1 max-w-[56ch] text-[var(--n-500)]">Add an item above – a description and its unit – then measure it line by line{hasPdf ? " or on the drawing" : ""}.</p>
      </div>
    ) : (
      <div className="mt-6 flex flex-col gap-5">
        {items.map((item) => (
          <Sheet key={item.id} projectId={projectId} item={item} billRows={billRows} billSigned={billSigned} onShow={showOnDrawing} focused={focus?.lineId ?? null} />
        ))}
      </div>
    );

  return (
    <div className={`mx-auto flex flex-col px-8 py-6 ${studio ? "max-w-[1800px]" : "max-w-[1280px]"}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="t-xl text-[var(--n-800)]">Take-off</h1>
          <p className="t-md mt-0.5 text-[var(--n-600)]">{projectName} · Design & Documentation</p>
        </div>
        {/*
          Plain links, not buttons: a download is a GET the browser handles, and it works without
          JavaScript. The workbook is the one to compare in – its quantities are live formulas.
        */}
        {hasPdf && (
          <button
            type="button"
            data-action="toggle-studio"
            aria-pressed={studio}
            onClick={() => setStudio((s) => !s)}
            className={`t-sm inline-flex items-center gap-1.5 rounded-[var(--r-md)] px-3 py-1.5 font-medium ${studio ? "bg-[var(--n-800)] text-white" : "bg-[var(--a-500)] text-white hover:bg-[var(--a-600)]"}`}
          >
            <Ruler aria-hidden size={14} /> {studio ? "Close the drawing" : "Measure on drawing"}
          </button>
        )}
        {items.length > 0 && (
          <div data-region="takeoff-export" className="flex items-center gap-2">
            <a
              href={`/projects/${projectId}/report/pdf?document=takeoff`}
              className="t-sm inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-300)] bg-[var(--n-0)] px-3 py-1.5 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)]"
            >
              <FileSpreadsheet aria-hidden size={14} /> Export to Excel
            </a>
            <a
              href={`/projects/${projectId}/report/pdf?document=takeoff&format=pdf`}
              className="t-sm inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-300)] bg-[var(--n-0)] px-3 py-1.5 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)]"
            >
              <FileText aria-hidden size={14} /> PDF
            </a>
          </div>
        )}
      </header>

      <p className="t-sm mt-3 max-w-[90ch] text-[var(--n-600)]">
        Measure on dimension sheets: each line is a timesing factor and up to three dimensions – length, width, depth – and a deduction takes its product away.
        The item&rsquo;s total is sent to the bill as a measured quantity.{" "}
        {!billExists
          ? "There is no bill yet – sending creates its rows."
          : billSigned
            ? "The bill is signed, so nothing can be sent to it until it is revised."
            : `Sending writes into the bill row it is linked to, or adds a row.`}
      </p>

      {drawings.length > 0 && !billSigned && (
        <div className="mt-5 overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)]">
          <MeasureDrawings projectId={projectId} drawings={drawings} measured={items.some((i) => i.origin === "drawings")} />
        </div>
      )}

      {/*
        Reading a drawing writes nothing, so unlike measuring it is offered on a signed bill too:
        checking a sheet's printed areas is as useful after the bill is signed as before.
      */}
      {drawings.length > 0 && (
        <div className="mt-5 rounded-[var(--r-lg)] border border-[var(--n-200)]">
          <DrawingReader projectId={projectId} drawings={drawings} />
        </div>
      )}

      {parameters.length > 0 && <Figures projectId={projectId} parameters={parameters} />}
      {review.length > 0 && <Review findings={review} />}

      {/* ── A new item ──────────────────────────────────────────────────────────────────── */}
      <form
        data-region="add-takeoff-item"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            const r = await addTakeoffItem(projectId, { section, description, unit });
            if (!r.ok) return setErrors(r.errors ?? {});
            setErrors({});
            setDescription("");
            router.refresh();
          });
        }}
        className="mt-5 flex flex-wrap items-end gap-2 rounded-[var(--r-lg)] border border-[var(--n-200)] px-4 py-3"
      >
        <label className="flex w-40 flex-col gap-0.5">
          <span className="t-xs text-[var(--n-500)]">Section</span>
          <input name="section" value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. Masonry" className={field} />
        </label>
        <label className="flex min-w-[18rem] flex-1 flex-col gap-0.5">
          <span className="t-xs text-[var(--n-500)]">What is measured</span>
          <input name="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. One-brick wall in stock brick, Block A" className={field} />
          {errors.description && <span className="t-xs text-[var(--err-700)]">{errors.description}</span>}
        </label>
        <label className="flex w-24 flex-col gap-0.5">
          <span className="t-xs text-[var(--n-500)]">Unit</span>
          <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={field}>
            {["m", "m2", "m3", "no", "kg", "t", "sum"].map((u) => (
              <option key={u} value={u}>
                {u.replace("2", "²").replace("3", "³")}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" data-action="add-takeoff-item" disabled={pending || !description.trim()} className="t-sm flex h-8 items-center gap-1 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white hover:bg-[var(--a-600)] disabled:opacity-50">
          <Plus aria-hidden size={13} /> Add item
        </button>
      </form>

      {studio ? (
        /* The drawing left, the sheets right – one screen, as a QS works with the plan beside the dim paper. */
        <div className="mt-6 grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
          <div className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] 2xl:sticky 2xl:top-4">
            <DrawingStudio projectId={projectId} drawings={drawings} items={items} focus={focus} />
          </div>
          <div className="min-w-0 [&>div:first-child]:mt-0">{sheets}</div>
        </div>
      ) : (
        sheets
      )}
    </div>
  );
}

/**
 * What the measurement rests on – every figure, and where it came from.
 *
 * Assumed figures first, because they are the ones a person has to do something about; then the
 * figures read from the drawings, each with the drawing's own words and the sheet it is on; then
 * the ones worked out from them, each with its working. A quantity on a sheet below can be traced
 * back through this table to the drawing, which is the point of it.
 */
/**
 * What a quantity surveyor would ask of this take-off before anybody priced it.
 *
 * Every finding is a question, never a correction: a wall genuinely built without piers has no
 * pier caps, and the rubric saying so costs a second to dismiss. What it is for is the other kind
 * of omission - the reinforcement, the blinding, the lintels over eighty-two openings - which a
 * bill hides perfectly, because the arithmetic of what is there is always right.
 */
function Review({ findings }: { findings: readonly Finding[] }) {
  const high = findings.filter((f) => f.severity === "high").length;
  const tone = { high: "text-[var(--err-700)]", medium: "text-[var(--warn-700)]", low: "text-[var(--n-600)]" } as const;
  return (
    <details data-region="takeoff-review" open={high > 0} className="mt-5 rounded-[var(--r-lg)] border border-[var(--n-200)]">
      <summary className="cursor-pointer px-4 py-3">
        <span className="t-base font-semibold text-[var(--n-800)]">Before this is priced</span>
        <span className="t-sm ml-2 text-[var(--n-500)]">
          {findings.length} question{findings.length === 1 ? "" : "s"} about what is measured
          {high > 0 ? ` – ${high} that change the price` : ""}
        </span>
      </summary>
      <ul className="border-t border-[var(--n-100)]">
        {findings.map((f) => (
          <li key={f.id} data-severity={f.severity} className="border-b border-[var(--n-100)] px-4 py-2.5 last:border-0">
            <p className={`t-sm font-medium ${tone[f.severity]}`}>{f.finding}</p>
            <p className="t-xs mt-0.5 max-w-[95ch] text-[var(--n-600)]">{f.matters}</p>
            <p className="t-xs mt-0.5 max-w-[95ch] text-[var(--n-700)]">{f.action}</p>
          </li>
        ))}
      </ul>
      <p className="t-xs px-4 py-2 text-[var(--n-500)]">
        These are questions, not corrections: nothing here changes a quantity. A finding that does not apply to this job is answered by
        saying so.
      </p>
    </details>
  );
}

function Figures({ projectId, parameters }: { projectId: string; parameters: readonly ParameterView[] }) {
  const assumed = parameters.filter((p) => p.status === "assumed").length;
  const chip = {
    read: "bg-[var(--ok-50)] text-[var(--ok-700)]",
    derived: "bg-[var(--n-100)] text-[var(--n-700)]",
    assumed: "bg-[var(--warn-50)] text-[var(--warn-700)]",
  } as const;
  const word = { read: "Read", derived: "Worked out", assumed: "Assumed" } as const;
  const shown = (p: ParameterView) => {
    const v = parseQuantity(p.value);
    return p.unit === "no" ? formatQuantity(v, 0) : formatQuantity(v, p.unit === "m" ? 3 : 2);
  };

  return (
    <details data-region="takeoff-figures" open={assumed > 0} className="mt-5 rounded-[var(--r-lg)] border border-[var(--n-200)]">
      <summary className="cursor-pointer px-4 py-3">
        <span className="t-base font-semibold text-[var(--n-800)]">What the measurement rests on</span>
        <span className="t-sm ml-2 text-[var(--n-500)]">
          {parameters.length} figures – {parameters.filter((p) => p.status === "read").length} read from the drawings,{" "}
          {parameters.filter((p) => p.status === "derived").length} worked out
          {assumed ? (
            <>
              , <span className="font-medium text-[var(--warn-700)]">{assumed} assumed – confirm before pricing</span>
            </>
          ) : null}
        </span>
      </summary>
      <div className="overflow-x-auto border-t border-[var(--n-100)]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Figure</th>
              <th className={`${th} text-right`}>Value</th>
              <th className={th}>How it is known</th>
              <th className={th}>From</th>
            </tr>
          </thead>
          <tbody>
            {parameters.map((p) => (
              <tr key={p.name} data-figure={p.name} data-status={p.status} className="border-b border-[var(--n-100)] align-top">
                <td className="t-sm px-2 py-1.5 text-[var(--n-800)]">
                  {p.label}
                  <span className="num t-xs block text-[var(--n-500)]">{p.name}</span>
                </td>
                <td className="num t-sm px-2 py-1.5 text-right whitespace-nowrap text-[var(--n-800)]">
                  {shown(p)} {p.unit}
                </td>
                <td className="px-2 py-1.5">
                  <span className={`t-xs rounded-[var(--r-sm)] px-1.5 py-0.5 font-medium ${chip[p.status]}`}>{word[p.status]}</span>
                </td>
                <td className="t-xs px-2 py-1.5 text-[var(--n-600)]">
                  {p.status === "derived" && <span className="num">{p.expression}</span>}
                  {p.assumption && <span className="text-[var(--warn-700)]">{p.assumption}</span>}
                  {p.quote && (
                    <span className="block">
                      &ldquo;{p.quote.replace(/\s+/g, " ").slice(0, 140)}&rdquo;
                      {p.source && (
                        <a href={`${documentHref(projectId, p.source.documentId, p.source.name)}${p.source.page ? `#page=${p.source.page}` : ""}`} target="_blank" rel="noreferrer" className="ml-1 text-[var(--a-700)] underline underline-offset-2">
                          {p.source.name}
                          {p.source.page ? `, sheet ${p.source.page}` : ""}
                        </a>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Sheet({
  projectId,
  item,
  billRows,
  billSigned,
  onShow,
  focused,
}: {
  projectId: string;
  item: TakeoffItemView;
  billRows: readonly BillRowOption[];
  billSigned: boolean;
  /** Show a measured line's mark on the drawing – click-to-trace. */
  onShow: (lineId: string, mark: Mark) => void;
  focused: string | null;
}) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [said, setSaid] = useState<string | null>(null);
  const empty = { location: "", timesing: "", length: "", width: "", depth: "", deduct: false };
  const [line, setLine] = useState(empty);
  const wanted = dimensionsFor(item.unit);
  const shows = { length: wanted === null || wanted >= 1, width: wanted === null || wanted >= 2, depth: wanted === null || wanted >= 3 };
  const unitShown = item.unit.replace("2", "²").replace("3", "³");

  const behind = item.bill && item.bill.quantity !== null && parseQuantity(item.bill.quantity) !== parseQuantity(item.total);
  const run = (fn: () => Promise<{ ok: boolean; reason?: string; errors?: Record<string, string> }>, after?: () => void) =>
    act(async () => {
      const r = await fn();
      if (!r.ok) {
        setErrors(r.errors ?? {});
        setSaid(r.reason ?? null);
        return;
      }
      setErrors({});
      setSaid(null);
      after?.();
      router.refresh();
    });

  return (
    <section data-takeoff={item.number} className="rounded-[var(--r-lg)] border border-[var(--n-200)]">
      <header className="flex flex-wrap items-start gap-3 border-b border-[var(--n-100)] px-4 py-3">
        <span className="num t-sm mt-0.5 text-[var(--n-500)]">{item.number}</span>
        <div className="min-w-0 flex-1">
          <h2 className="t-base font-semibold text-[var(--n-800)]">{item.description}</h2>
          <p className="t-xs mt-0.5 text-[var(--n-500)]">
            {[item.section, `measured in ${unitShown}`, `${item.lines.length} ${item.lines.length === 1 ? "line" : "lines"}`, item.origin === "drawings" ? "measured from the drawings" : null].filter(Boolean).join(" · ")}
          </p>
          {item.note && (
            <p data-region="takeoff-note" className="t-xs mt-1 inline-block rounded-[var(--r-sm)] bg-[var(--warn-50)] px-1.5 py-0.5 text-[var(--warn-700)]">
              {item.note}
            </p>
          )}
        </div>
        <div className="text-right">
          <p data-region="takeoff-total" className="num t-base font-semibold text-[var(--n-800)]">
            {q(item.total)} {unitShown}
          </p>
          {item.bill && (
            <p className={`t-xs ${behind ? "font-medium text-[var(--warn-700)]" : "text-[var(--n-500)]"}`}>
              bill {item.bill.ref}: {item.bill.quantity === null ? "no quantity" : `${q(item.bill.quantity)} ${unitShown}`}
              {item.bill.source === "takeoff" && !behind ? " · measured" : behind ? " · behind the sheet" : ""}
            </p>
          )}
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Where</th>
              <th className={`${th} text-right`}>Times</th>
              {shows.length && <th className={`${th} text-right`}>Length</th>}
              {shows.width && <th className={`${th} text-right`}>Width</th>}
              {shows.depth && <th className={`${th} text-right`}>Depth</th>}
              <th className={th}>Ddt</th>
              <th className={`${th} text-right`}>Quantity</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {item.lines.map((l, i) => (
              <tr key={l.id} data-line={i + 1} className={`border-b border-[var(--n-100)] ${focused === l.id ? "bg-[var(--a-50)]" : item.mismatched.some((m) => m.index === i) ? "bg-[var(--warn-50)]" : ""}`}>
                <td className="t-sm px-2 py-1.5 text-[var(--n-700)]">
                  {l.mark && (
                    <button type="button" data-action="show-mark" aria-label={`Show line ${i + 1} on the drawing`} title="Show on the drawing" onClick={() => onShow(l.id, l.mark!)} className="mr-1 align-[-2px] text-[var(--a-600)] hover:text-[var(--a-700)]">
                      <MapPin aria-hidden size={13} />
                    </button>
                  )}
                  {l.location ?? "–"}
                  {l.working && <span data-region="line-working" className="num t-xs block text-[var(--n-500)]">{l.working}</span>}
                </td>
                <td className="num t-sm px-2 py-1.5 text-right">{q(l.timesing, 0)}</td>
                {shows.length && <td className="num t-sm px-2 py-1.5 text-right">{q(l.length)}</td>}
                {shows.width && <td className="num t-sm px-2 py-1.5 text-right">{q(l.width)}</td>}
                {shows.depth && <td className="num t-sm px-2 py-1.5 text-right">{q(l.depth)}</td>}
                <td className="t-xs px-2 py-1.5 text-[var(--n-600)]">{l.deduct ? "ddt" : ""}</td>
                <td className={`num t-sm px-2 py-1.5 text-right ${l.deduct ? "text-[var(--err-700)]" : "text-[var(--n-800)]"}`}>{l.deduct ? `(${q(l.quantity.replace("-", ""))})` : q(l.quantity)}</td>
                <td className="px-2 py-1.5 text-right">
                  <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => run(() => deleteDimension(projectId, item.id, l.id))} className="text-[var(--n-400)] hover:text-[var(--err-700)]">
                    <Trash2 aria-hidden size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {/* The line being typed – Enter adds it. */}
            <tr data-region="new-line" className="bg-[var(--n-25)]">
              <td className="px-2 py-1.5">
                <input aria-label="Where" value={line.location} onChange={(e) => setLine({ ...line, location: e.target.value })} placeholder="Block A, grid 1–4" className={field} />
              </td>
              {(["timesing", "length", "width", "depth"] as const)
                .filter((k) => k === "timesing" || shows[k])
                .map((k) => (
                  <td key={k} className="px-2 py-1.5">
                    <input
                      aria-label={k}
                      data-dim={k}
                      inputMode="decimal"
                      value={line[k]}
                      placeholder={k === "timesing" ? "1" : ""}
                      onChange={(e) => setLine({ ...line, [k]: e.target.value })}
                      className={`${field} num w-24 text-right`}
                    />
                    {errors[k] && <span className="t-xs block max-w-[14rem] text-[var(--err-700)]">{errors[k]}</span>}
                  </td>
                ))}
              <td className="px-2 py-1.5">
                <input type="checkbox" aria-label="Deduction" data-dim="deduct" checked={line.deduct} onChange={(e) => setLine({ ...line, deduct: e.target.checked })} className="accent-[var(--a-500)]" />
              </td>
              <td className="px-2 py-1.5 text-right" colSpan={2}>
                <button
                  type="button"
                  data-action="add-line"
                  disabled={pending}
                  onClick={() => run(() => addDimension(projectId, item.id, line), () => setLine(empty))}
                  className="t-sm inline-flex h-8 items-center gap-1 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-50"
                >
                  <Plus aria-hidden size={12} /> Line
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {item.mismatched.length > 0 && (
        <p role="alert" className="t-sm border-t border-[var(--n-100)] px-4 py-2 text-[var(--warn-700)]">
          {item.mismatched.map((m) => m.reason).join(" ")}
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-3 border-t border-[var(--n-100)] px-4 py-3">
        <label className="t-xs flex items-center gap-2 text-[var(--n-600)]">
          Feeds bill row
          <select
            data-region="link-bill"
            value={item.bill?.itemId ?? ""}
            onChange={(e) => run(() => linkToBill(projectId, item.id, e.target.value || null))}
            className="t-sm h-8 max-w-[24rem] rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)]"
          >
            <option value="">A new row</option>
            {billRows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.ref} · {r.description.slice(0, 60)}
                {r.unit ? ` (${r.unit})` : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="flex-1" />
        {item.sent && (
          <span className="t-xs text-[var(--n-500)]">
            sent {q(item.sent.quantity)} {unitShown} on {formatDate(item.sent.at)} by {item.sent.by}
          </span>
        )}
        <button
          type="button"
          data-action="send-to-bill"
          disabled={pending || billSigned}
          title={billSigned ? "The bill is signed" : undefined}
          onClick={() => run(() => sendToBill(projectId, item.id))}
          className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white hover:bg-[var(--n-900)] disabled:opacity-40"
        >
          Send {q(item.total)} {unitShown} to the bill <ArrowRight aria-hidden size={13} />
        </button>
        <button type="button" aria-label="Remove item" onClick={() => run(() => deleteTakeoffItem(projectId, item.id))} className="text-[var(--n-400)] hover:text-[var(--err-700)]">
          <Trash2 aria-hidden size={14} />
        </button>
        {said && (
          <p role="alert" className="t-sm w-full text-[var(--err-700)]">
            {said}
          </p>
        )}
      </footer>
    </section>
  );
}
