"use client";

/**
 * Quotations – an RFQ, the responses to it, and which to prefer (D1.3).
 *
 * The recommendation first, because it is what the page is for; the comparison under it, responses
 * side by side, with every corrected figure beside the one the response printed; each response's
 * arithmetic line by line; and the decision the QS takes on the recommendation, which is theirs.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ClipboardCheck, Download, FileText, FilePlus2, Paperclip, Plus, RefreshCw, Table2, Trash2 } from "lucide-react";

import { addResponses, attachSupporting, decide, detachSupporting, evaluateResponse, nameResponse, removeResponse, saveRfq } from "@/app/(app)/projects/[id]/rfq-actions";
import { issueDocument } from "@/app/(app)/projects/[id]/document-actions";
import type { CheckedLine, CheckedResponse } from "@/domain/quote-check";
import { fileDocument } from "@/lib/ingest/file-document";
import { formatDate } from "@/lib/dates";
import type { QuotationOption, ResponseView, RfqView } from "@/lib/rfq";
import { DEFAULT_REQUIREMENTS } from "@/lib/rfq-defaults";

const R = (cents: number | null) => {
  if (cents === null) return "–";
  const [w, f] = (Math.abs(cents) / 100).toFixed(2).split(".");
  return `${cents < 0 ? "−" : ""}R ${w!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${f}`;
};
const pct = (n: number | null) => (n === null ? "" : `${n.toFixed(2).replace(".", ",")}%`);
const field = "t-sm w-full rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 py-1.5 text-[var(--n-800)]";
const button = "t-sm inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-40";
const dark = "t-sm inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white hover:bg-[var(--n-900)] disabled:opacity-40";
const th = "t-xs border-b border-[var(--n-200)] px-3 py-2 text-left font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase";

const TONE = {
  included: "text-[var(--ok-700)]",
  met: "text-[var(--ok-700)]",
  excluded: "text-[var(--err-700)]",
  "not met": "text-[var(--err-700)]",
  "not stated": "text-[var(--warn-700)]",
} as const;

export function RfqWorkspace({ projectId, projectName, rfqs, quotations, corpus }: { projectId: string; projectName: string; rfqs: readonly RfqView[]; quotations: readonly QuotationOption[]; corpus: readonly QuotationOption[] }) {
  const [creating, setCreating] = useState(rfqs.length === 0);
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 py-6">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="t-xl text-[var(--n-800)]">Quotations</h1>
          <p className="t-md mt-0.5 text-[var(--n-600)]">{projectName} · Procurement &amp; Tender · D1.3</p>
          <p className="t-sm mt-2 max-w-[92ch] text-[var(--n-600)]">
            Each response is read, its arithmetic rechecked, and compared like for like. The platform recommends by a stated rule; you decide.
          </p>
        </div>
        {!creating && (
          <button type="button" data-action="new-rfq" onClick={() => setCreating(true)} className={button}>
            <Plus aria-hidden size={13} /> New RFQ
          </button>
        )}
      </header>
      {creating && <RfqForm projectId={projectId} onDone={() => setCreating(false)} cancellable={rfqs.length > 0} />}
      {[...rfqs].reverse().map((rfq) => (
        <RfqSection key={rfq.id} projectId={projectId} rfq={rfq} quotations={quotations} corpus={corpus} />
      ))}
    </div>
  );
}

function RfqForm({ projectId, rfq, onDone, cancellable }: { projectId: string; rfq?: RfqView; onDone: () => void; cancellable: boolean }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: rfq?.title ?? "",
    scope: rfq?.scope.join("\n") ?? "",
    requirements: (rfq?.requirements ?? DEFAULT_REQUIREMENTS).join("\n"),
  });
  return (
    <form
      data-region="rfq-form"
      onSubmit={(e) => {
        e.preventDefault();
        act(async () => {
          const r = await saveRfq(projectId, { id: rfq?.id, ...form });
          if (!r.ok) return setSaid(r.reason);
          onDone();
          router.refresh();
        });
      }}
      className="flex flex-col gap-3 rounded-[var(--r-lg)] border border-[var(--n-200)] p-4"
    >
      <p className="t-base font-semibold text-[var(--n-800)]">{rfq ? "Edit the RFQ" : "Start an RFQ evaluation"}</p>
      <label className="flex flex-col gap-1">
        <span className="t-xs text-[var(--n-500)]">What is being procured</span>
        <input name="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Civil and structural engineering services" className={field} />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="t-xs text-[var(--n-500)]">Scope every response must cover – one item per line</span>
          <textarea name="scope" rows={5} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} placeholder={"Civil engineering design of internal services\nStructural engineering design\nConstruction monitoring (stage 5)"} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-xs text-[var(--n-500)]">Requirements every response must show – one per line</span>
          <textarea name="requirements" rows={5} value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} className={field} />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" data-action="save-rfq" disabled={pending} className={dark}>
          {rfq ? "Save" : "Start"}
        </button>
        {cancellable && (
          <button type="button" onClick={onDone} className="t-sm px-2 text-[var(--n-600)]">
            Cancel
          </button>
        )}
        {said && (
          <p role="alert" className="t-sm text-[var(--err-700)]">
            {said}
          </p>
        )}
      </div>
    </form>
  );
}

function RfqSection({ projectId, rfq, quotations, corpus }: { projectId: string; rfq: RfqView; quotations: readonly QuotationOption[]; corpus: readonly QuotationOption[] }) {
  /*
    What may be attached to a response: everything filed except the other responses.

    A supporting document is the rest of one firm's submission. Another respondent's priced
    proposal is not that, and attaching one would show a reader a single firm's name over two
    firms' money. Kept out of the list here and refused by the action as well, because a picker is
    a convenience and the rule is not.
  */
  const responseDocuments = new Set(rfq.responses.map((r) => r.documentId));
  const attachable = corpus.filter((d) => !responseDocuments.has(d.id));
  const router = useRouter();
  const [pending, act] = useTransition();
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ id: string; title: string } | null>(null);

  /**
   * Read and check each response, saying which one is being read.
   *
   * ── Not inside a transition ────────────────────────────────────────────────────────────
   *
   * It was, and `setWorking` is therefore a transition update: low priority, and in practice on
   * production it never painted at all. So an evaluation that takes five minutes showed nothing
   * whatsoever — no line, no spinner, no change — and the only honest reading of the screen was
   * that the button had not worked. That is exactly what two people concluded, in turn, while a
   * real fault sat underneath it.
   *
   * `working` is what disables the buttons, so nothing is lost by setting it at normal priority.
   *
   * ── And a server that stops answering ──────────────────────────────────────────────────
   *
   * A server action that dies mid-flight — the function crashing rather than returning an error —
   * rejects this await. Unhandled, the rejection was swallowed and the page simply stayed as it
   * was: no message, no change of state, nothing to distinguish it from a button that does
   * nothing. OCR crashing the function did precisely this on production, and it is why that bug
   * survived as long as it did. A failure nobody can see is worse than a failure.
   */
  const evaluate = async (responses: readonly ResponseView[]) => {
    setSaid(null);
    for (const r of responses) {
      setWorking(`Reading and checking ${r.name}…`);
      try {
        const out = await evaluateResponse(projectId, rfq.id, r.id);
        if (!out.ok) setSaid(`${r.name}: ${out.reason}`);
      } catch {
        // The words a reader can act on. What actually happened is in the server's log, which is
        // the only place it could be — by the time this runs, the function that knew is gone.
        setSaid(`${r.name}: the server stopped before it answered, so nothing was read or saved. Try again; if it keeps happening the server's log will say why.`);
        setWorking(null);
        return;
      }
      router.refresh();
    }
    setWorking(null);
  };

  /** File each document, then do something with the names that took. */
  const file = async (files: File[], what: string) => {
    const names: string[] = [];
    for (const f of files) {
      setWorking(`${what} ${f.name}…`);
      const out = await fileDocument({ projectId, file: f, kind: "Quotation" });
      if (!out.ok) setSaid(`${f.name}: ${out.error}`);
      else names.push(f.name);
    }
    return names;
  };

  const attach = (responseId: string, files: File[]) =>
    act(async () => {
      setSaid(null);
      const names = await file(files, "Filing");
      if (names.length) await attachSupporting(projectId, rfq.id, responseId, { filenames: names });
      setWorking(null);
      router.refresh();
    });

  const upload = (files: FileList) =>
    act(async () => {
      setSaid(null);
      const names: string[] = [];
      for (const file of Array.from(files)) {
        setWorking(`Filing ${file.name}…`);
        const out = await fileDocument({ projectId, file, kind: "Quotation" });
        if (!out.ok) setSaid(`${file.name}: ${out.error}`);
        else names.push(file.name);
      }
      if (names.length) await addResponses(projectId, rfq.id, { filenames: names });
      setWorking(null);
      router.refresh();
    });

  const rec = rfq.recommendation;
  const preferred = rec && rec.preferred !== null ? rfq.evaluated[rec.preferred] : null;
  const unevaluated = rfq.responses.filter((r) => !r.evaluated);

  return (
    <section data-rfq={rfq.id} className="flex flex-col gap-4 rounded-[var(--r-lg)] border border-[var(--n-200)] p-4">
      {editing ? (
        <RfqForm projectId={projectId} rfq={rfq} onDone={() => setEditing(false)} cancellable />
      ) : (
        <header className="flex flex-wrap items-start gap-3">
          <ClipboardCheck aria-hidden size={18} className="mt-0.5 text-[var(--a-600)]" />
          <div className="min-w-0 flex-1">
            <h2 className="t-lg font-semibold text-[var(--n-800)]">{rfq.title}</h2>
            <p className="t-xs mt-0.5 text-[var(--n-500)]">
              {rfq.scope.length} scope items · {rfq.requirements.length} requirements · started {formatDate(rfq.createdAt)}
            </p>
            <ul className="t-sm mt-2 flex flex-wrap gap-1.5">
              {rfq.scope.map((s) => (
                <li key={s} className="rounded-[var(--r-full)] bg-[var(--n-100)] px-2 py-0.5 text-[var(--n-700)]">
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={() => setEditing(true)} className={button}>
            Edit
          </button>
        </header>
      )}

      {/* ── Responses ──────────────────────────────────────────────────────────────────── */}
      <div data-region="rfq-responses" className="rounded-[var(--r-md)] border border-[var(--n-200)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--n-100)] px-3 py-2">
          <p className="t-sm flex-1 font-medium text-[var(--n-800)]">Responses ({rfq.responses.length})</p>
          <label className={`${button} cursor-pointer`}>
            <Paperclip aria-hidden size={13} /> File quotations
            <input type="file" multiple data-action="file-quotations" accept=".pdf,.docx,.xlsx,.xlsm,.txt,.csv" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
          </label>
          {quotations.length > 0 && (
            <select
              aria-label="Add a response already filed"
              value=""
              onChange={(e) => e.target.value && act(async () => (await addResponses(projectId, rfq.id, { documentIds: [e.target.value] }), router.refresh()))}
              className="t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-700)]"
            >
              <option value="">Add one already filed…</option>
              {quotations.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          )}
          <button type="button" data-action="evaluate-all" disabled={pending || working !== null || rfq.responses.length === 0} onClick={() => evaluate(unevaluated.length ? unevaluated : rfq.responses)} className={dark}>
            <RefreshCw aria-hidden size={13} /> {unevaluated.length ? `Evaluate ${unevaluated.length === rfq.responses.length ? "all" : `${unevaluated.length} new`}` : "Evaluate again"}
          </button>
        </div>
        {working && <p className="t-sm px-3 py-2 text-[var(--n-600)]">{working} A response takes up to a minute.</p>}
        {said && (
          <p role="alert" className="t-sm px-3 py-2 text-[var(--err-700)]">
            {said}
          </p>
        )}
        {rfq.responses.length === 0 ? (
          <p className="t-sm px-3 py-4 text-[var(--n-500)]">No responses yet – file each quotation received (PDF, Word or Excel).</p>
        ) : (
          <ul>
            {rfq.responses.map((r) => (
              <ResponseRow
                key={r.id}
                projectId={projectId}
                rfqId={rfq.id}
                response={r}
                busy={pending || working !== null}
                onEvaluate={() => evaluate([r])}
                onAttach={(files) => attach(r.id, files)}
                corpus={attachable}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── The recommendation ─────────────────────────────────────────────────────────── */}
      {rec && (
        <div data-region="rfq-recommendation" className={`rounded-[var(--r-md)] border p-4 ${rec.comparable ? "border-[#8DB86B] bg-[var(--a-50)]" : "border-[var(--warn-500)] bg-[var(--warn-50)]"}`}>
          <p className="t-xs font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase">Recommendation</p>
          <p data-region="rfq-headline" className="t-base mt-1 font-semibold text-[var(--n-900)]">
            {rec.headline}
          </p>
          <ul className="t-sm mt-2 flex list-disc flex-col gap-1 pl-5 text-[var(--n-800)]">
            {rec.reasons.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          {rec.risks.length > 0 && (
            <div className="mt-3">
              <p className="t-sm font-medium text-[var(--n-800)]">Risks noted in the responses</p>
              <ul className="t-sm mt-1 flex list-disc flex-col gap-0.5 pl-5 text-[var(--n-700)]">
                {rec.risks.map((k, i) => (
                  <li key={i}>
                    <span className="font-medium">{k.supplier}:</span> {k.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rec.clarifications.length > 0 && (
            <div className="mt-3">
              <p className="t-sm font-medium text-[var(--n-800)]">Clarifications before appointment ({rec.clarifications.length})</p>
              <ol data-region="rfq-clarifications" className="t-sm mt-1 flex list-decimal flex-col gap-0.5 pl-5 text-[var(--n-700)]">
                {rec.clarifications.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
            </div>
          )}
          <Decision projectId={projectId} rfq={rfq} preferredId={preferred?.id ?? null} />
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--n-200)] pt-3">
            <button
              type="button"
              data-action="issue-rfq-report"
              disabled={pending}
              onClick={() =>
                act(async () => {
                  const r = await issueDocument(projectId, "rfq_evaluation", rfq.id);
                  if (!r.ok) return setSaid(r.reason);
                  setIssued({ id: r.id, title: r.title });
                  router.refresh();
                })
              }
              className={button}
            >
              <FileText aria-hidden size={14} /> Issue the evaluation report
            </button>
            <button
              type="button"
              data-action="issue-rfq-workbook"
              disabled={pending}
              onClick={() =>
                act(async () => {
                  const r = await issueDocument(projectId, "rfq_comparison", rfq.id);
                  if (!r.ok) return setSaid(r.reason);
                  setIssued({ id: r.id, title: r.title });
                  router.refresh();
                })
              }
              className={button}
            >
              <Table2 aria-hidden size={14} /> Issue the comparative workbook
            </button>
            {issued && (
              <a data-action="download-rfq-report" href={`/projects/${projectId}/report/pdf?issued=${issued.id}`} className="t-sm inline-flex items-center gap-1 font-medium text-[var(--a-700)] underline underline-offset-2">
                <Download aria-hidden size={12} /> {issued.title}
              </a>
            )}
          </div>
        </div>
      )}

      {rfq.evaluated.length > 0 && <Comparison rfq={rfq} />}
    </section>
  );
}

function ResponseRow({ projectId, rfqId, response, busy, onEvaluate, onAttach, corpus }: { projectId: string; rfqId: string; response: ResponseView; busy: boolean; onEvaluate: () => void; onAttach: (files: File[]) => void; corpus: readonly QuotationOption[] }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [name, setName] = useState(response.name);
  const unnamed = response.result && !response.result.named;
  // Neither the response's own priced document nor anything already attached: attaching either
  // would read the same words twice and say nothing new.
  const attached = new Set([response.documentId, ...response.supporting.map((s) => s.documentId)]);
  const attachable = corpus.filter((d) => !attached.has(d.id));
  return (
    <li data-response={response.name} className="flex flex-wrap items-center gap-2 border-b border-[var(--n-100)] px-3 py-2 last:border-0">
      <input
        aria-label="Respondent"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== response.name && act(async () => (await nameResponse(projectId, rfqId, response.id, name), router.refresh()))}
        className={`t-sm h-8 w-64 rounded-[var(--r-md)] border px-2 font-medium ${unnamed ? "border-[var(--warn-500)] bg-[var(--warn-50)]" : "border-transparent hover:border-[var(--n-200)]"}`}
      />
      <span className="t-xs min-w-0 flex-1 truncate text-[var(--n-500)]">{response.documentName}</span>
      {unnamed && <span className="t-xs text-[var(--warn-700)]">The firm&rsquo;s name is not in its text – name it here</span>}
      <span className="t-xs text-[var(--n-600)]">
        {response.error ? (
          <span className="text-[var(--err-700)]">{response.error}</span>
        ) : response.evaluated ? (
          <span className="inline-flex items-center gap-1 text-[var(--ok-700)]">
            <Check aria-hidden size={12} /> checked {response.evaluatedAt ? formatDate(response.evaluatedAt) : ""}
            {response.result!.errors.length ? <span className="ml-1 text-[var(--err-700)]">· {response.result!.errors.length} arithmetic error{response.result!.errors.length === 1 ? "" : "s"}</span> : null}
          </span>
        ) : (
          "not evaluated"
        )}
      </span>
      <button type="button" data-action="evaluate-response" disabled={busy || pending} onClick={onEvaluate} className={button}>
        {response.evaluated ? "Evaluate again" : "Evaluate"}
      </button>
      {/*
        The rest of the submission.

        A firm sends a fee proposal, a technical proposal and an organogram; the price is in one of
        them and the registrations in another. Attached here they are read together, as one
        response – filed as three they would be three respondents, two of them priceless.
      */}
      <label className={`${button} cursor-pointer`} title="A technical proposal, an organogram, a schedule – read with the priced document">
        <FilePlus2 aria-hidden size={13} /> Supporting
        <input
          type="file"
          multiple
          data-action="file-supporting"
          accept=".pdf,.docx,.xlsx,.xlsm,.txt,.csv"
          className="hidden"
          onChange={(e) => e.target.files && onAttach(Array.from(e.target.files))}
        />
      </label>

      {/*
        The same paper, picked rather than filed twice.

        A firm's technical proposal is usually already in the corpus – it arrived with everything
        else and was filed with it. Offering only an upload here meant attaching it created a
        second copy, and a reader looking at the project then had two of them with nothing to say
        which one the evaluation read.
      */}
      {attachable.length > 0 && (
        <select
          aria-label={`Attach a filed document to ${response.name}`}
          data-action="attach-filed"
          value=""
          disabled={busy || pending}
          onChange={(e) =>
            e.target.value &&
            act(async () => (await attachSupporting(projectId, rfqId, response.id, { documentIds: [e.target.value] }), router.refresh()))
          }
          className="t-sm h-8 max-w-[15rem] rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-700)]"
        >
          <option value="">Attach one already filed…</option>
          {attachable.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
      <button type="button" aria-label={`Remove ${response.name}`} disabled={busy || pending} onClick={() => act(async () => (await removeResponse(projectId, rfqId, response.id), router.refresh()))} className="text-[var(--n-400)] hover:text-[var(--err-700)]">
        <Trash2 aria-hidden size={14} />
      </button>

      {response.supporting.length > 0 && (
        <ul data-region="supporting" className="t-xs flex w-full flex-wrap gap-1.5 pl-2 text-[var(--n-600)]">
          {response.supporting.map((s) => (
            <li key={s.documentId} className="inline-flex items-center gap-1 rounded-[var(--r-full)] bg-[var(--n-100)] px-2 py-0.5">
              {s.name}
              <button
                type="button"
                aria-label={`Detach ${s.name}`}
                disabled={busy || pending}
                onClick={() => act(async () => (await detachSupporting(projectId, rfqId, response.id, s.documentId), router.refresh()))}
                className="text-[var(--n-400)] hover:text-[var(--err-700)]"
              >
                ×
              </button>
            </li>
          ))}
          <li className="text-[var(--n-500)]">read with the priced document · evaluate again to take them in</li>
        </ul>
      )}
    </li>
  );
}

function Decision({ projectId, rfq, preferredId }: { projectId: string; rfq: RfqView; preferredId: string | null }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [choice, setChoice] = useState(rfq.decision?.responseId ?? preferredId ?? "");
  const [reason, setReason] = useState(rfq.decision?.reason ?? "");
  const [said, setSaid] = useState<string | null>(null);
  const against = choice !== "" && choice !== preferredId;
  return (
    <div data-region="rfq-decision" className="mt-3 border-t border-[var(--n-200)] pt-3">
      {rfq.decision && (
        <p className="t-sm mb-2 text-[var(--n-800)]">
          <span className="font-semibold">Decided:</span> {rfq.decision.name}, by {rfq.decision.by} on {formatDate(rfq.decision.at)}
          {rfq.decision.followsRecommendation ? " – as recommended" : " – against the recommendation"}
          {rfq.decision.reason ? `: ${rfq.decision.reason}` : "."}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="t-xs text-[var(--n-500)]">Appoint</span>
          <select name="decision" value={choice} onChange={(e) => setChoice(e.target.value)} className="t-sm h-8 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2">
            {rfq.evaluated.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.id === preferredId ? " (recommended)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[18rem] flex-1 flex-col gap-0.5">
          <span className="t-xs text-[var(--n-500)]">{against ? "Why this response over the recommended one (required)" : "Note (optional)"}</span>
          <input name="reason" value={reason} onChange={(e) => setReason(e.target.value)} className={`${field} h-8`} />
        </label>
        <button
          type="button"
          data-action="decide"
          disabled={pending || !choice}
          onClick={() =>
            act(async () => {
              const r = await decide(projectId, rfq.id, { responseId: choice, reason, againstRecommendation: against });
              if (!r.ok) return setSaid(r.reason);
              setSaid(null);
              router.refresh();
            })
          }
          className={dark}
        >
          {against ? "Record the decision" : "Accept the recommendation"}
        </button>
      </div>
      {said && (
        <p role="alert" className="t-sm mt-1 text-[var(--err-700)]">
          {said}
        </p>
      )}
    </div>
  );
}

function Comparison({ rfq }: { rfq: RfqView }) {
  const rows = rfq.evaluated.map((e) => e.result!);
  const rec = rfq.recommendation!;
  const cell = "t-sm border-b border-[var(--n-100)] px-3 py-2 align-top text-[var(--n-800)]";
  const head = "t-sm border-b border-[var(--n-100)] px-3 py-2 align-top font-medium text-[var(--n-600)] w-56";
  return (
    <div className="flex flex-col gap-4">
      <div data-region="rfq-comparison" className="overflow-x-auto rounded-[var(--r-md)] border border-[var(--n-200)]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Compared</th>
              {rows.map((r, i) => (
                <th key={i} className={`${th} ${rec.preferred === i ? "bg-[var(--a-50)] text-[var(--a-700)]" : ""}`}>
                  {r.supplier}
                  {rec.preferred === i ? " · preferred" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={head}>Reference, date</td>
              {rows.map((r, i) => (
                <td key={i} className={cell}>
                  {[r.reference, r.date].filter(Boolean).join(" · ") || <span className="text-[var(--warn-700)]">not stated</span>}
                </td>
              ))}
            </tr>
            <tr>
              <td className={head}>Price excl. VAT – as stated</td>
              {rows.map((r, i) => (
                <td key={i} className={`${cell} num`}>
                  {R(r.statedTotal)}
                </td>
              ))}
            </tr>
            <tr className="total-row">
              <td className={head}>Price excl. VAT – arithmetic corrected</td>
              {rows.map((r, i) => (
                <td key={i} data-corrected={r.supplier} className={`${cell} num`}>
                  {R(r.correctedTotal)}
                  {r.correctedTotal !== r.statedTotal && r.statedTotal !== null && r.correctedTotal !== null && <span className="t-xs block font-normal text-[var(--err-700)]">{R(r.correctedTotal - r.statedTotal)} on the stated price</span>}
                </td>
              ))}
            </tr>
            {rec.likeForLike.map((l) => (
              <tr key={l.item}>
                <td className={head}>Like for like – {l.item}</td>
                {l.prices.map((p, i) => (
                  <td key={i} className={`${cell} num`}>
                    {p.net !== null ? `${p.derived ? "about " : ""}${R(p.net)}` : "not priced separately"}
                    {p.rate !== null && <span className="t-xs block text-[var(--n-500)]">{pct(p.rate)} of {R(p.basis)}</span>}
                    {p.derived && <span className="t-xs block text-[var(--warn-700)]">derived from its breakdown – not a price it offers</span>}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className={head}>Arithmetic</td>
              {rows.map((r, i) => (
                <td key={i} className={cell}>
                  <Arithmetic r={r} />
                </td>
              ))}
            </tr>
            {rfq.scope.map((item, s) => (
              <tr key={item}>
                <td className={head}>Scope – {item}</td>
                {rows.map((r, i) => {
                  const x = r.scope[s];
                  return (
                    <td key={i} className={`${cell} ${x ? TONE[x.status] : ""}`}>
                      {x?.status ?? "not stated"}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className={head}>Queries on the document</td>
              {rows.map((r, i) => (
                <td key={i} className={`${cell} t-xs`}>
                  {r.observations.length ? (
                    <ul className="flex list-disc flex-col gap-0.5 pl-4">
                      {r.observations.map((o, k) => (
                        <li key={k} title={o.quotes.join(" … ")}>
                          {o.text}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "–"
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <td className={head}>Priced beyond the RFQ</td>
              {rows.map((r, i) => (
                <td key={i} className={cell}>
                  {r.extraScope.join("; ") || "–"}
                </td>
              ))}
            </tr>
            <tr>
              <td className={head}>Exclusions</td>
              {rows.map((r, i) => (
                <td key={i} className={`${cell} t-xs`}>
                  {r.exclusions.join("; ") || "–"}
                </td>
              ))}
            </tr>
            {rfq.requirements.map((req, q) => (
              <tr key={req}>
                <td className={head}>{req}</td>
                {rows.map((r, i) => {
                  const x = r.requirements[q];
                  return (
                    <td key={i} className={`${cell} ${x ? TONE[x.status] : ""}`} title={x?.evidence ?? undefined}>
                      {x?.status ?? "not stated"}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rec.differences.map((d) => (
              <tr key={d.fact}>
                <td className={head}>
                  <AlertTriangle aria-hidden size={12} className="mr-1 inline text-[var(--warn-700)]" />
                  {d.fact}
                </td>
                {rows.map((r, i) => (
                  <td key={i} className={`${cell} text-[var(--warn-700)]`}>
                    {d.values.find((v) => v.supplier === r.supplier)?.value ?? "not stated"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.map((r, i) => (
        <LineCheck key={i} r={r} />
      ))}
    </div>
  );
}

function Arithmetic({ r }: { r: CheckedResponse }) {
  const consequential = r.lines.filter((l) => l.verdict === "consequential").length;
  return (
    <div className="flex flex-col gap-0.5">
      {r.errors.length === 0 ? <span className="text-[var(--ok-700)]">Checks</span> : <span className="font-medium text-[var(--err-700)]">{r.errors.length} error{r.errors.length === 1 ? "" : "s"}</span>}
      {r.errors.map((e) => (
        <span key={e.id} className="t-xs text-[var(--err-700)]">
          {e.label}: {R(e.stated)} stated, {R(e.computed)} by its own figures
        </span>
      ))}
      {consequential > 0 && <span className="t-xs text-[var(--n-600)]">{consequential} line{consequential === 1 ? "" : "s"} below change once corrected</span>}
      {r.feeImpact && (
        <span className="t-xs text-[var(--err-700)]">
          Fee on the corrected cost of works: {R(r.feeImpact.netOnCorrected)} ({r.feeImpact.change >= 0 ? "+" : "−"}
          {R(Math.abs(r.feeImpact.change))})
        </span>
      )}
      {r.basisMismatch && (
        <span className="t-xs text-[var(--warn-700)]">
          Fee worked on {R(r.basisMismatch.used)}, not its own estimate of {R(r.basisMismatch.stated)}
        </span>
      )}
      {r.tallies
        .filter((t) => t.verdict === "error")
        .map((t) => (
          <span key={t.id} className="t-xs text-[var(--warn-700)]">
            {t.label}: {t.stated} stated, {t.computed} by the figures it totals (a count – no effect on the price)
          </span>
        ))}
      {r.unseen.map((u) => (
        <span key={u} className="t-xs text-[var(--warn-700)]">
          Not checked – {u} is not in the text
        </span>
      ))}
    </div>
  );
}

const VERDICT: Record<CheckedLine["verdict"], string> = {
  agrees: "text-[var(--ok-700)]",
  rounding: "text-[var(--n-600)]",
  error: "font-semibold text-[var(--err-700)]",
  consequential: "text-[var(--warn-700)]",
  "not found": "text-[var(--warn-700)]",
  unchecked: "text-[var(--n-500)]",
  unreadable: "text-[var(--warn-700)]",
  "check by eye": "font-medium text-[var(--warn-700)]",
};

function LineCheck({ r }: { r: CheckedResponse }) {
  return (
    <details data-line-check={r.supplier} className="rounded-[var(--r-md)] border border-[var(--n-200)]">
      <summary className="t-sm cursor-pointer px-3 py-2 font-medium text-[var(--n-800)]">
        {r.supplier} – every price line, checked ({r.lines.length})
      </summary>
      <div className="overflow-x-auto border-t border-[var(--n-100)]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Line", "As the response states", "By its own figures", "Corrected", "Check", "Working"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.id} data-verdict={l.verdict} className="border-b border-[var(--n-100)] align-top">
                <td className="t-sm px-3 py-1.5 text-[var(--n-800)]">
                  <span className="num t-xs mr-2 text-[var(--n-400)]">{l.id}</span>
                  {l.label}
                </td>
                <td className="num t-sm px-3 py-1.5 text-right">{R(l.stated)}</td>
                <td className="num t-sm px-3 py-1.5 text-right">{R(l.computed)}</td>
                <td className="num t-sm px-3 py-1.5 text-right">{R(l.corrected)}</td>
                <td className={`t-xs px-3 py-1.5 ${VERDICT[l.verdict]}`}>
                  {l.verdict}
                  {l.note && <span className="block text-[var(--n-500)]">{l.note}</span>}
                </td>
                <td className="num t-xs px-3 py-1.5 text-[var(--n-500)]">{l.working ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
