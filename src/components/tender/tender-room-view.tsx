"use client";

/**
 * The Tender Room – D1.3, before the comparison.
 *
 * One tender at a time, on the signed bill: who is invited, what they were sent, which addenda each
 * has acknowledged, when each return arrived and for how much, and the opening. The page states the
 * tender's position in words – draft, issued and open, closed and waiting to be opened, opened – and
 * offers only what that position allows.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, FileText, Handshake, Lock, Plus, X } from "lucide-react";

import { issueDocument } from "@/app/(app)/projects/[id]/document-actions";
import {
  addInvitee,
  issueAddendum,
  issueTender,
  markDeclined,
  openTenders,
  recordReturn,
  removeInvitee,
  setAcknowledged,
  startTender,
} from "@/app/(app)/projects/[id]/tender-room-actions";
import { formatMoney, money } from "@/domain/money";
import { formatDate } from "@/lib/dates";
import type { InviteeView, TenderRoomData, TenderView } from "@/lib/tender-room";

const field = "t-sm h-8 w-full rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)]";
const label = "t-xs mb-0.5 block text-[var(--n-500)]";
const button = "t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-50";
const primary = "t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white hover:bg-[var(--a-600)] disabled:opacity-50";
const dark = "t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white hover:bg-[var(--n-900)] disabled:opacity-50";

const R = (minor: string) => `R ${formatMoney(money(BigInt(minor)))}`;
/** South African time, as the tender box keeps it. */
const sast = (iso: string) => {
  const local = new Date(new Date(iso).getTime() + 2 * 3_600_000).toISOString();
  return `${formatDate(local.slice(0, 10))} ${local.slice(11, 16)}`;
};

export function TenderRoomView({ projectId, projectName, projectCode, data, now }: { projectId: string; projectName: string; projectCode: string | null; data: TenderRoomData; now: string }) {
  return (
    <div className="mx-auto flex max-w-[1180px] flex-col px-8 py-6">
      <header>
        <h1 className="t-xl text-[var(--n-800)]">Tender Room</h1>
        <p className="t-md mt-0.5 text-[var(--n-600)]">{projectName} · Procurement · D1.3</p>
      </header>

      {!data.bill ? (
        <div data-region="tender-no-bill" className="mt-6 rounded-[var(--r-lg)] border border-dashed border-[var(--n-200)] px-6 py-8 text-center">
          <p className="t-base font-medium text-[var(--n-800)]">A tender is issued on a signed bill</p>
          <p className="t-sm mx-auto mt-1 max-w-[56ch] text-[var(--n-600)]">Sign the Bill of Quantities first; its quantities are what every tenderer prices.</p>
          <Link href={`/projects/${projectId}/bill`} className="t-sm mt-3 inline-flex items-center gap-1 text-[var(--a-600)] underline underline-offset-2">
            Bill of Quantities <ArrowRight aria-hidden size={12} />
          </Link>
        </div>
      ) : !data.tender || data.tender.openedAt ? (
        <>
          {data.tender?.openedAt && <Opened projectId={projectId} tender={data.tender} />}
          <StartTender projectId={projectId} projectCode={projectCode} bill={data.bill} again={Boolean(data.tender)} />
        </>
      ) : (
        <Tender projectId={projectId} tender={data.tender} contractors={data.contractors} bill={data.bill} now={now} />
      )}
    </div>
  );
}

function StartTender({ projectId, projectCode, bill, again }: { projectId: string; projectCode: string | null; bill: NonNullable<TenderRoomData["bill"]>; again: boolean }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [said, setSaid] = useState<string | null>(null);
  return (
    <form
      data-region="start-tender"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const read = (k: string) => String(f.get(k) ?? "");
        act(async () => {
          const r = await startTender(projectId, { reference: read("reference"), closingAt: read("closingAt"), validityDays: read("validityDays"), briefingAt: read("briefingAt"), briefingVenue: read("briefingVenue") });
          if (!r.ok) {
            setErrors(r.errors ?? {});
            setSaid(r.reason);
            return;
          }
          router.refresh();
        });
      }}
      className="mt-6 grid grid-cols-1 gap-3 rounded-[var(--r-lg)] border border-[var(--n-200)] px-4 py-4 sm:grid-cols-4"
    >
      <p className="t-sm sm:col-span-4 text-[var(--n-600)]">
        {again ? "Start another tender" : "Start the tender"} on the signed bill – {bill.items} items, {R(bill.total)}, signed by {bill.by} on {formatDate(bill.at)}. Tenderers price the quantities; they never see the rates.
      </p>
      <label>
        <span className={label}>Reference</span>
        <input name="reference" defaultValue={`${projectCode ?? "TENDER"}/T/01`} className={field} />
        {errors.reference && <span className="t-xs text-[var(--err-700)]">{errors.reference}</span>}
      </label>
      <label>
        <span className={label}>Closing (SA time)</span>
        <input type="datetime-local" name="closingAt" className={field} />
        {errors.closingAt && <span className="t-xs text-[var(--err-700)]">{errors.closingAt}</span>}
      </label>
      <label>
        <span className={label}>Validity (days)</span>
        <input name="validityDays" inputMode="numeric" defaultValue="90" className={`${field} num`} />
        {errors.validityDays && <span className="t-xs text-[var(--err-700)]">{errors.validityDays}</span>}
      </label>
      <label>
        <span className={label}>Briefing (optional)</span>
        <input type="datetime-local" name="briefingAt" className={field} />
        {errors.briefingAt && <span className="t-xs text-[var(--err-700)]">{errors.briefingAt}</span>}
      </label>
      <label className="sm:col-span-3">
        <span className={label}>Briefing venue</span>
        <input name="briefingVenue" placeholder="Site office" className={field} />
      </label>
      <div className="flex items-end justify-end">
        <button type="submit" data-action="start-tender" disabled={pending} className={primary}>
          <Handshake aria-hidden size={13} /> {pending ? "Starting…" : "Start tender"}
        </button>
      </div>
      {said && (
        <p role="alert" className="t-sm sm:col-span-4 text-[var(--err-700)]">
          {said}
        </p>
      )}
    </form>
  );
}

function Tender({ projectId, tender, contractors, bill, now }: { projectId: string; tender: TenderView; contractors: TenderRoomData["contractors"]; bill: NonNullable<TenderRoomData["bill"]>; now: string }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const [issued, setIssued] = useState<Record<string, string>>({});
  const closed = Date.parse(now) >= Date.parse(tender.closingAt);
  const position = !tender.issuedAt ? "Draft – not yet issued" : closed ? "Closed – ready to open" : "Issued – open for tenders";

  const run = (fn: () => Promise<{ ok: boolean; reason?: string }>) =>
    act(async () => {
      const r = await fn();
      setSaid(r.ok ? null : (r.reason ?? null));
      router.refresh();
    });
  const issue = (kind: "tender_invitation" | "tender_bill") =>
    act(async () => {
      const r = await issueDocument(projectId, kind);
      if (r.ok) setIssued((x) => ({ ...x, [kind]: r.id }));
      setSaid(r.ok ? null : r.reason);
    });

  return (
    <>
      <dl data-region="tender-summary" className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 rounded-[var(--r-lg)] border border-[var(--n-200)] px-4 py-3 sm:grid-cols-4">
        <div>
          <dt className="t-xs text-[var(--n-500)]">Tender</dt>
          <dd className="t-sm font-semibold text-[var(--n-800)]">{tender.reference}</dd>
        </div>
        <div>
          <dt className="t-xs text-[var(--n-500)]">Closing</dt>
          <dd className="t-sm text-[var(--n-800)]">{sast(tender.closingAt)}</dd>
        </div>
        <div>
          <dt className="t-xs text-[var(--n-500)]">Position</dt>
          <dd data-region="tender-position" className={`t-sm font-medium ${closed ? "text-[var(--warn-700)]" : "text-[var(--n-800)]"}`}>
            {position}
          </dd>
        </div>
        <div>
          <dt className="t-xs text-[var(--n-500)]">On the bill</dt>
          <dd className="t-sm text-[var(--n-800)]">{bill.items} items · validity {tender.validityDays} days</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!tender.issuedAt && (
          <button type="button" data-action="issue-tender" disabled={pending || tender.invitees.length === 0} onClick={() => run(() => issueTender(projectId, tender.id))} className={dark}>
            <Lock aria-hidden size={13} /> Issue the tender
          </button>
        )}
        <button type="button" data-action="issue-invitation" disabled={pending || tender.invitees.length === 0} onClick={() => issue("tender_invitation")} className={button}>
          <FileText aria-hidden size={13} /> Invitation to tender
        </button>
        <button type="button" data-action="issue-tender-bill" disabled={pending} onClick={() => issue("tender_bill")} className={button}>
          <FileText aria-hidden size={13} /> Bill for pricing
        </button>
        {Object.entries(issued).map(([kind, id]) => (
          <a key={kind} data-action={`download-${kind}`} href={`/projects/${projectId}/report/pdf?issued=${id}`} className="t-sm text-[var(--a-600)] underline underline-offset-2">
            Download {kind === "tender_bill" ? "bill" : "invitation"}
          </a>
        ))}
        <span className="flex-1" />
        {tender.issuedAt && (
          <button type="button" data-action="open-tenders" disabled={pending || !closed} title={closed ? undefined : "Tenders open at the closing time"} onClick={() => run(() => openTenders(projectId, tender.id))} className={primary}>
            Open the tenders
          </button>
        )}
      </div>
      {said && (
        <p role="alert" className="t-sm mt-2 text-[var(--err-700)]">
          {said}
        </p>
      )}

      <Tenderers projectId={projectId} tender={tender} contractors={contractors} pending={pending} run={run} />
      {tender.issuedAt && <Addenda projectId={projectId} tender={tender} closed={closed} />}
      {tender.issuedAt && <Register tender={tender} title="What opening will record" />}
    </>
  );
}

function Tenderers({
  projectId,
  tender,
  contractors,
  pending,
  run,
}: {
  projectId: string;
  tender: TenderView;
  contractors: TenderRoomData["contractors"];
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; reason?: string }>) => void;
}) {
  const [contactId, setContactId] = useState("");
  const [company, setCompany] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const invitedIds = new Set(tender.invitees.map((i) => i.company.toLowerCase()));

  return (
    <section data-region="tenderers" className="mt-5 rounded-[var(--r-lg)] border border-[var(--n-200)]">
      <header className="flex flex-wrap items-end gap-2 border-b border-[var(--n-100)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="t-base font-semibold text-[var(--n-800)]">Tenderers</h2>
          <p className="t-xs text-[var(--n-500)]">{tender.invitees.length} invited{tender.invitees.length > 0 && tender.invitees.length < 3 ? " – three or more is the norm for a competitive tender" : ""}</p>
        </div>
        <select aria-label="From the directory" value={contactId} onChange={(e) => setContactId(e.target.value)} className="t-sm h-8 max-w-[16rem] rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2">
          <option value="">From the directory…</option>
          {contractors
            .filter((c) => !invitedIds.has(c.organisation.toLowerCase()))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.organisation}
              </option>
            ))}
        </select>
        <input aria-label="Or type a company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="or type a company" className="t-sm h-8 w-48 rounded-[var(--r-md)] border border-[var(--n-200)] px-2" />
        <button
          type="button"
          data-action="add-tenderer"
          disabled={pending || (!contactId && !company.trim())}
          onClick={() => {
            run(() => addInvitee(projectId, tender.id, { contactId, company, contactName: "", email: "" }));
            setContactId("");
            setCompany("");
          }}
          className={button}
        >
          <Plus aria-hidden size={13} /> Invite
        </button>
      </header>
      {tender.invitees.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Tenderer", "Addenda", "Received (SA time)", "Tender sum", ""].map((h, i) => (
                  <th key={i} className="t-xs border-b border-[var(--n-200)] px-3 py-1.5 text-left font-semibold tracking-[0.03em] text-[var(--n-600)] uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tender.invitees.map((i) => (
                <InviteeRow key={i.id} projectId={projectId} tender={tender} invitee={i} pending={pending} run={run} recording={recording === i.id} onRecord={() => setRecording(recording === i.id ? null : i.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function InviteeRow({
  projectId,
  tender,
  invitee: i,
  pending,
  run,
  recording,
  onRecord,
}: {
  projectId: string;
  tender: TenderView;
  invitee: InviteeView;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; reason?: string }>) => void;
  recording: boolean;
  onRecord: () => void;
}) {
  const router = useRouter();
  const [busy, act] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <>
      <tr data-tenderer={i.company} className="border-b border-[var(--n-100)] align-top">
        <td className="px-3 py-2">
          <span className="t-sm font-medium text-[var(--n-800)]">{i.company}</span>
          {i.contactName && <span className="t-xs block text-[var(--n-500)]">{i.contactName}</span>}
        </td>
        <td className="px-3 py-2">
          {tender.addenda.length === 0 ? (
            <span className="t-xs text-[var(--n-400)]">none issued</span>
          ) : (
            <span className="flex flex-wrap gap-2">
              {tender.addenda.map((a) => (
                <label key={a.id} className="t-xs flex items-center gap-1 text-[var(--n-700)]">
                  <input
                    type="checkbox"
                    data-ack={`${i.company}|${a.number}`}
                    checked={i.acknowledged.includes(a.number)}
                    disabled={pending}
                    onChange={(e) => run(() => setAcknowledged(projectId, tender.id, a.id, i.id, e.target.checked))}
                    className="accent-[var(--a-500)]"
                  />
                  {a.number}
                </label>
              ))}
            </span>
          )}
        </td>
        <td className="t-sm px-3 py-2 whitespace-nowrap text-[var(--n-700)]">
          {i.declined ? <span className="text-[var(--n-500)]">declined</span> : i.receivedAt ? sast(i.receivedAt) : <span className="text-[var(--n-400)]">–</span>}
          {i.late && <span className="t-xs block font-medium text-[var(--err-700)]">late – will not be opened</span>}
          {i.receivedAt && i.missingAddenda.length > 0 && <span className="t-xs block text-[var(--warn-700)]">addendum {i.missingAddenda.join(", ")} not acknowledged</span>}
        </td>
        <td className="num t-sm px-3 py-2 whitespace-nowrap text-[var(--n-800)]">{i.sum ? R(i.sum) : <span className="text-[var(--n-400)]">–</span>}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {tender.issuedAt ? (
            <>
              <button type="button" data-action="record-return" onClick={onRecord} className="t-xs text-[var(--a-600)] underline underline-offset-2">
                {i.receivedAt ? "Correct return" : "Record return"}
              </button>
              {!i.receivedAt && !i.declined && (
                <button type="button" data-action="decline" onClick={() => run(() => markDeclined(projectId, tender.id, i.id))} className="t-xs ml-3 text-[var(--n-500)] underline underline-offset-2">
                  Declined
                </button>
              )}
            </>
          ) : (
            <button type="button" aria-label={`Remove ${i.company}`} onClick={() => run(() => removeInvitee(projectId, tender.id, i.id))} className="text-[var(--n-400)] hover:text-[var(--err-700)]">
              <X aria-hidden size={14} />
            </button>
          )}
        </td>
      </tr>
      {recording && (
        <tr className="border-b border-[var(--n-100)] bg-[var(--n-25)]">
          <td colSpan={5} className="px-3 py-3">
            <form
              data-region="record-return"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act(async () => {
                  const r = await recordReturn(projectId, tender.id, i.id, { receivedAt: String(f.get("receivedAt")), sum: String(f.get("sum")), qualifications: String(f.get("qualifications")) });
                  if (!r.ok) return setErrors(r.errors ?? { receivedAt: r.reason });
                  setErrors({});
                  onRecord();
                  router.refresh();
                });
              }}
              className="grid grid-cols-1 gap-3 sm:grid-cols-4"
            >
              <label>
                <span className={label}>Received (SA time)</span>
                <input type="datetime-local" name="receivedAt" className={field} />
                {errors.receivedAt && <span className="t-xs text-[var(--err-700)]">{errors.receivedAt}</span>}
              </label>
              <label>
                <span className={label}>Tender sum, as stated</span>
                <input name="sum" placeholder="R 0,00" className={`${field} num`} />
                {errors.sum && <span className="t-xs text-[var(--err-700)]">{errors.sum}</span>}
              </label>
              <label className="sm:col-span-2">
                <span className={label}>Qualifications</span>
                <input name="qualifications" className={field} />
              </label>
              <div className="flex justify-end sm:col-span-4">
                <button type="submit" data-action="save-return" disabled={busy} className={primary}>
                  {busy ? "Saving…" : "Save return"}
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function Addenda({ projectId, tender, closed }: { projectId: string; tender: TenderView; closed: boolean }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  return (
    <section data-region="addenda" className="mt-5 rounded-[var(--r-lg)] border border-[var(--n-200)]">
      <header className="border-b border-[var(--n-100)] px-4 py-3">
        <h2 className="t-base font-semibold text-[var(--n-800)]">Addenda</h2>
        <p className="t-xs text-[var(--n-500)]">Sent to every tenderer. Tick each tenderer’s acknowledgement above as it comes in.</p>
      </header>
      <ol className="px-4 py-2">
        {tender.addenda.map((a) => (
          <li key={a.id} data-addendum={a.number} className="t-sm border-b border-[var(--n-100)] py-2 last:border-0">
            <span className="font-medium text-[var(--n-800)]">
              Addendum {a.number}: {a.subject}
            </span>
            <span className="t-xs block text-[var(--n-500)]">
              {formatDate(a.issuedAt)} · {a.issuedBy}
            </span>
            <span className="t-sm block whitespace-pre-wrap text-[var(--n-700)]">{a.body}</span>
          </li>
        ))}
        {tender.addenda.length === 0 && <li className="t-sm py-2 text-[var(--n-500)]">None issued.</li>}
      </ol>
      {!closed && (
        <div className="grid grid-cols-1 gap-2 border-t border-[var(--n-100)] px-4 py-3">
          <input aria-label="Addendum subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject – e.g. Revised door schedule" className={field} />
          <textarea aria-label="What the addendum changes" value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="What it changes" className={`${field} h-auto py-1.5`} />
          <div className="flex items-center gap-2">
            {said && <span role="alert" className="t-sm text-[var(--err-700)]">{said}</span>}
            <span className="flex-1" />
            <button
              type="button"
              data-action="issue-addendum"
              disabled={pending}
              onClick={() =>
                act(async () => {
                  const r = await issueAddendum(projectId, tender.id, { subject, body });
                  setSaid(r.ok ? null : r.reason);
                  if (r.ok) {
                    setSubject("");
                    setBody("");
                  }
                  router.refresh();
                })
              }
              className={button}
            >
              <Plus aria-hidden size={13} /> Issue addendum
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Register({ tender, title }: { tender: TenderView; title: string }) {
  const r = tender.register;
  return (
    <section data-region="opening-register" className="mt-5 rounded-[var(--r-lg)] border border-[var(--n-200)] px-4 py-3">
      <h2 className="t-base font-semibold text-[var(--n-800)]">{title}</h2>
      {r.opened.length > 0 ? (
        <table className="mt-2 w-full border-collapse">
          <tbody>
            {r.opened.map((o) => (
              <tr key={o.company} data-opened={o.rank} className="border-b border-[var(--n-100)] last:border-0">
                <td className="num t-sm w-10 py-1.5 text-[var(--n-500)]">{o.rank}</td>
                <td className="t-sm py-1.5 text-[var(--n-800)]">
                  {o.company}
                  {o.missingAddenda.length > 0 && <span className="t-xs ml-2 text-[var(--warn-700)]">addendum {o.missingAddenda.join(", ")} not acknowledged</span>}
                </td>
                <td className={`num t-sm py-1.5 text-right ${o.rank === 1 ? "font-semibold" : ""}`}>{R(o.sum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="t-sm mt-1 text-[var(--n-500)]">No return with a sum received on time yet.</p>
      )}
      <p className="t-xs mt-2 text-[var(--n-600)]">
        {[
          r.late.length ? `Late, not opened: ${r.late.map((l) => l.company).join(", ")}` : null,
          r.noSum.length ? `No sum stated: ${r.noSum.join(", ")}` : null,
          r.declined.length ? `Declined: ${r.declined.join(", ")}` : null,
          r.noReturn.length ? `No return: ${r.noReturn.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </section>
  );
}

function Opened({ projectId, tender }: { projectId: string; tender: TenderView }) {
  const [pending, act] = useTransition();
  const [issued, setIssued] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div className="mt-6">
      <div data-region="tender-opened" className="flex flex-wrap items-center gap-2 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--ok-50)]/40 px-4 py-3">
        <Lock aria-hidden size={14} className="text-[var(--ok-700)]" />
        <p className="t-sm min-w-0 flex-1 text-[var(--n-700)]">
          <span className="font-medium text-[var(--ok-700)]">Tender {tender.reference} opened</span> {sast(tender.openedAt!)} by {tender.openedBy}. The on-time returns are in Tender Analysis for the arithmetic check and the recommendation.
        </p>
        <button
          type="button"
          data-action="issue-opening-record"
          disabled={pending}
          onClick={() =>
            act(async () => {
              const r = await issueDocument(projectId, "tender_opening");
              if (r.ok) setIssued(r.id);
              setSaid(r.ok ? null : r.reason);
            })
          }
          className={button}
        >
          <FileText aria-hidden size={13} /> Record of tenders opened
        </button>
        {issued && (
          <a data-action="download-opening-record" href={`/projects/${projectId}/report/pdf?issued=${issued}`} className="t-sm text-[var(--a-600)] underline underline-offset-2">
            Download
          </a>
        )}
        <Link href={`/projects/${projectId}/tender-analysis`} className="t-sm flex items-center gap-1 text-[var(--a-600)] underline underline-offset-2">
          Tender Analysis <ArrowRight aria-hidden size={12} />
        </Link>
        {said && <p role="alert" className="t-sm w-full text-[var(--err-700)]">{said}</p>}
      </div>
      <Register tender={tender} title="Opened" />
    </div>
  );
}
