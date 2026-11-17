/**
 * The construction cash flow, assembled from the project's signed steps – D1.7.
 *
 * ── A lens, not a run ─────────────────────────────────────────────────────────────────────
 *
 * Nothing here is read from a document or proposed by a model. The three lines come from three
 * signatures – the Contract's sum and dates, the Programme's baseline and progress, and every
 * signed Valuation – and this file only fetches them and hands them to `constructionCashFlow`.
 * Where one is missing the page says which, and phases nothing rather than something.
 *
 * ── Every signed valuation, not the latest ─────────────────────────────────────────────────
 *
 * `loadSignedFigures` reads the signature *in force* per step, which is right for a carried
 * figure. A cash flow's actuals are the history: certificate 1, then 2, then 3, each a signed run
 * of the same step. So this reads all of them, in order, and a certificate that was signed and
 * then superseded by a re-run still counts for the month it certified.
 */

import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { runFields, runs } from "@/db/schema";
import { readAmount } from "@/domain/amount";
import { readDate } from "@/domain/date-reading";
import { constructionCashFlow, type CashFlow, type Certified } from "@/domain/construction-cash-flow";
import { grossValuation } from "@/domain/certificates";
import { money, type Money } from "@/domain/money";
import type { Activity, Progress } from "@/domain/programme";
import { loadSignedOutput } from "@/lib/agent/persist";
import { loadSignedProgramme } from "@/lib/agent/persist-programme";

export interface CashFlowInputs {
  contract: { sum: Money | null; sumText: string | null; signedOn: string | null; completion: string | null; by: string | null };
  programme: { by: string; at: string; activities: Activity[]; progressOf: (id: string) => Progress | null; baselineFinish: string | null } | null;
  certificates: (Certified & { by: string; unread: string[] })[];
}

/** Every signed valuation as a certificate, oldest first; figures that could not be read are named. */
export async function loadSignedValuations(projectId: string): Promise<CashFlowInputs["certificates"]> {
  const signed = await db
    .select({ id: runs.id, signedBy: runs.signedBy, signedAt: runs.signedAt })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.module, "/valuations"), isNotNull(runs.signedAt), isNull(runs.deletedAt)))
    .orderBy(asc(runs.signedAt));
  if (signed.length === 0) return [];

  const fields = await db
    .select()
    .from(runFields)
    .where(and(inArray(runFields.runId, signed.map((r) => r.id)), isNotNull(runFields.outputValue)));
  const byRun = new Map<string, Map<string, string>>();
  for (const f of fields) {
    const m = byRun.get(f.runId) ?? new Map<string, string>();
    m.set(f.fieldId, f.outputValue!);
    byRun.set(f.runId, m);
  }

  return signed.flatMap((run) => {
    const f = byRun.get(run.id) ?? new Map<string, string>();
    const unread: string[] = [];
    const period = readDate(f.get("vl-period") ?? "");
    if (!period.ok) {
      unread.push(`valuation period end – ${period.reason}`);
      return [];
    }
    const executed = readAmount(f.get("vl-work-executed") ?? "");
    if (!executed.ok) {
      unread.push(`value of work executed – ${executed.reason}`);
      return [];
    }
    // The same gross a payment certificate prints – one definition, in domain/certificates.ts.
    const optional = (id: string, label: string) => {
      if (!f.has(id)) return null;
      const read = readAmount(f.get(id)!);
      if (!read.ok) unread.push(`${label} – ${read.reason}`);
      return read.ok ? read.amount : null;
    };
    const materials = optional("vl-materials", "materials on site");
    const variations = optional("vl-variations", "approved variations");
    const dayworks = optional("vl-dayworks", "dayworks");
    return [
      {
        number: f.get("vl-number") ?? null,
        period: period.date,
        gross: grossValuation({ workExecuted: executed.amount, variations, dayworks, materialsOnSite: materials }),
        by: run.signedBy ?? "",
        unread,
      },
    ];
  });
}

export async function loadCashFlowInputs(projectId: string): Promise<CashFlowInputs> {
  const [contract, programme, certificates] = await Promise.all([
    loadSignedOutput(projectId, "/contract"),
    loadSignedProgramme(projectId),
    loadSignedValuations(projectId),
  ]);

  const sumText = contract.get("ct-sum")?.value ?? null;
  const sum = sumText ? readAmount(sumText) : null;
  const asDate = (text: string | null | undefined) => {
    if (!text) return null;
    const read = readDate(text);
    return read.ok ? read.date : null;
  };

  const activities: Activity[] =
    programme?.rows.flatMap((row) => {
      const base = row.output;
      if (!base?.start || !base.finish) return [];
      return [{ id: row.id, name: base.name ?? "", start: base.start, finish: base.finish, milestone: base.milestone, value: row.value === null ? null : money(BigInt(row.value)) }];
    }) ?? [];
  const progress = new Map<string, Progress>(
    (programme?.rows ?? []).flatMap((row) =>
      row.progress ? [[row.id, { activityId: row.id, asAt: row.progress.asAt, start: row.progress.start, finish: row.progress.finish, percent: row.progress.percent }]] : [],
    ),
  );

  return {
    contract: {
      sum: sum?.ok ? sum.amount : null,
      sumText,
      signedOn: asDate(contract.get("ct-signed")?.value),
      completion: asDate(contract.get("ct-completion")?.value),
      by: contract.get("ct-sum")?.signedBy ?? null,
    },
    programme: programme
      ? {
          by: programme.by,
          at: programme.at,
          activities,
          progressOf: (id) => progress.get(id) ?? null,
          baselineFinish: activities.reduce<string | null>((max, a) => (max === null || a.finish > max ? a.finish : max), null),
        }
      : null,
    certificates,
  };
}

/** The flow, or the reason there is none. */
export function cashFlowOf(inputs: CashFlowInputs): { flow: CashFlow | null; why: string | null } {
  if (inputs.contract.sum === null) {
    return {
      flow: null,
      why: inputs.contract.sumText
        ? `The contract sum was signed as “${inputs.contract.sumText}”, which cannot be read as a figure. Correct it on the Contract step.`
        : "There is no signed contract sum to phase. Sign the Contract step first.",
    };
  }
  const span =
    inputs.contract.signedOn && inputs.contract.completion && inputs.contract.completion > inputs.contract.signedOn
      ? { start: inputs.contract.signedOn, finish: inputs.contract.completion }
      : null;
  const flow = constructionCashFlow({
    contractSum: inputs.contract.sum,
    activities: inputs.programme?.activities ?? [],
    progressOf: inputs.programme?.progressOf ?? (() => null),
    certificates: inputs.certificates,
    contractSpan: span,
  });
  if (!flow) {
    return {
      flow: null,
      why: "There is nothing to phase the contract sum over: no signed programme, and the contract's date signed and completion date are not both established. Sign the Programme, or establish both dates on the Contract step.",
    };
  }
  return { flow, why: null };
}
