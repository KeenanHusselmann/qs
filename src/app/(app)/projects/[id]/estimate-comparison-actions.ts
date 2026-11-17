"use server";

/**
 * Estimate comparison – adding estimates and their lines, deriving a corrected one, clarifications.
 *
 * Every edit names its comparison and project and is refused unless both agree, as in the design
 * review. Figures cross `domain/amount.ts`: "1,234" is refused rather than read either way, and a
 * percentage is typed as people say it ("12") and held as the fraction.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getProject } from "@/app/(app)/projects/actions";
import { db } from "@/db/client";
import {
  comparisonClarifications,
  comparisonCorrections,
  comparisonEstimates,
  comparisonLines,
  estimateComparisons,
} from "@/db/schema";
import { readPercent, readQuantity, readRate } from "@/domain/amount";
import {
  CLARIFICATION_STATUSES,
  type ClarificationStatus,
} from "@/domain/estimate-comparison";
import { requireSession } from "@/lib/auth";
import { importLines } from "@/lib/estimate-lines-import";
import { readWorkbookGrids } from "@/lib/ingest/xlsx";

export type ComparisonAction =
  | { ok: true; id?: string; message?: string; notes?: string[] }
  | { ok: false; reason: string };

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const optional = (v: unknown, max: number) => clean(v, max) || null;
const path = (projectId: string) => `/projects/${projectId}/estimates`;

const scaled = (value: bigint, precision: number) => {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const d = 10n ** BigInt(precision);
  return `${neg ? "-" : ""}${abs / d}.${(abs % d).toString().padStart(precision, "0")}`;
};

async function owned(projectId: string, comparisonId: string) {
  const [row] = await db
    .select({
      id: estimateComparisons.id,
      elements: estimateComparisons.elements,
    })
    .from(estimateComparisons)
    .where(
      and(
        eq(estimateComparisons.id, comparisonId),
        eq(estimateComparisons.projectId, projectId),
        isNull(estimateComparisons.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function estimateOf(
  projectId: string,
  comparisonId: string,
  estimateId: string,
) {
  if (!(await owned(projectId, comparisonId))) return null;
  const [row] = await db
    .select()
    .from(comparisonEstimates)
    .where(
      and(
        eq(comparisonEstimates.id, estimateId),
        eq(comparisonEstimates.comparisonId, comparisonId),
      ),
    )
    .limit(1);
  return row ?? null;
}

const touch = (comparisonId: string) =>
  db
    .update(estimateComparisons)
    .set({ updatedAt: new Date() })
    .where(eq(estimateComparisons.id, comparisonId));

/** A percentage as typed, to the fraction a column holds; null where blank, an error string where unreadable. */
function percent(
  raw: unknown,
  label: string,
  band: { min: number; max: number },
): { value: string | null } | { error: string } {
  const text = clean(raw, 20);
  if (text === "") return { value: null };
  const r = readPercent(text, band);
  return r.ok
    ? { value: scaled(r.percent, 4) }
    : { error: `${label}: ${r.reason}` };
}

/** A rand figure as typed, to a decimal string; negative allowed where `signed`. */
function rands(
  raw: unknown,
  label: string,
  signed = false,
): { value: string | null } | { error: string } {
  const text = clean(raw, 30);
  if (text === "") return { value: null };
  const negative = signed && /^-/.test(text);
  const r = readRate(negative ? text.slice(1) : text);
  if (!r.ok) return { error: `${label}: ${r.reason}` };
  if (r.rate.value < 0n && !signed) return { error: `${label}: not negative` };
  return {
    value: scaled(
      negative ? -r.rate.value : r.rate.value,
      Math.max(2, r.rate.precision),
    ),
  };
}

function units(
  raw: unknown,
  label: string,
): { value: string | null } | { error: string } {
  const text = clean(raw, 30);
  if (text === "") return { value: null };
  const r = readQuantity(text);
  return r.ok
    ? { value: scaled(r.quantity, 4) }
    : { error: `${label}: ${r.reason}` };
}

// ── The comparison ────────────────────────────────────────────────────────────────────────

const DEFAULT_ELEMENTS = [
  "Earthworks and platforms",
  "Retaining walls",
  "Roads and parking",
  "Stormwater",
  "Sewer",
  "Water",
];

export async function startComparison(
  projectId: string,
  input: {
    title: string;
    subject?: string;
    elements?: string;
    commonUnits?: string;
    unitLabel?: string;
  },
): Promise<ComparisonAction> {
  const session = await requireSession();
  if (!(await getProject(projectId)))
    return { ok: false, reason: "That project is not available." };
  const title = clean(input.title, 200);
  if (!title)
    return {
      ok: false,
      reason: "Give the comparison a title – what works the estimates are for.",
    };
  const common = units(input.commonUnits, "common unit count");
  if ("error" in common) return { ok: false, reason: common.error };
  const typed = clean(input.elements, 1000)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const [row] = await db
    .insert(estimateComparisons)
    .values({
      projectId,
      title,
      subject: optional(input.subject, 300),
      elements: typed.length ? [...new Set(typed)] : DEFAULT_ELEMENTS,
      commonUnits: common.value,
      unitLabel: optional(input.unitLabel, 30) ?? "units",
      createdBy: session.email,
    })
    .returning({ id: estimateComparisons.id });
  revalidatePath(path(projectId));
  return {
    ok: true,
    id: row.id,
    message: "The comparison is started. Add the estimates to compare.",
  };
}

export async function setComparison(
  projectId: string,
  comparisonId: string,
  input: {
    commonUnits?: string;
    unitLabel?: string;
    alternativeContingency?: string;
    elements?: string;
  },
): Promise<ComparisonAction> {
  await requireSession();
  if (!(await owned(projectId, comparisonId)))
    return {
      ok: false,
      reason: "That comparison is no longer on this project.",
    };
  const common = units(input.commonUnits, "common unit count");
  const alt = percent(input.alternativeContingency, "alternative contingency", {
    min: 0,
    max: 60,
  });
  const errors = [common, alt].flatMap((x) => ("error" in x ? [x.error] : []));
  if (errors.length)
    return { ok: false, reason: `Not saved – ${errors.join("; ")}.` };
  const elements = clean(input.elements, 1000)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  await db
    .update(estimateComparisons)
    .set({
      commonUnits: (common as { value: string | null }).value,
      alternativeContingency: (alt as { value: string | null }).value,
      ...(input.unitLabel !== undefined
        ? { unitLabel: optional(input.unitLabel, 30) ?? "units" }
        : {}),
      ...(elements.length ? { elements: [...new Set(elements)] } : {}),
      updatedAt: new Date(),
    })
    .where(eq(estimateComparisons.id, comparisonId));
  revalidatePath(path(projectId));
  return { ok: true, message: "Saved." };
}

export async function withdrawComparison(
  projectId: string,
  comparisonId: string,
): Promise<ComparisonAction> {
  await requireSession();
  const [row] = await db
    .update(estimateComparisons)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(estimateComparisons.id, comparisonId),
        eq(estimateComparisons.projectId, projectId),
        isNull(estimateComparisons.deletedAt),
      ),
    )
    .returning({ id: estimateComparisons.id });
  if (!row)
    return {
      ok: false,
      reason: "That comparison is no longer on this project.",
    };
  revalidatePath(path(projectId));
  return { ok: true };
}

// ── Estimates ─────────────────────────────────────────────────────────────────────────────

type EstimateInput = {
  name: string;
  preparedBy?: string;
  dated?: string;
  basis?: string;
  units?: string;
  preliminaries?: string;
  contingency?: string;
};

function readEstimate(
  input: EstimateInput,
):
  | {
      values: {
        name: string;
        preparedBy: string | null;
        dated: string | null;
        basis: string | null;
        units: string | null;
        preliminaries: string;
        contingency: string;
      };
    }
  | { error: string } {
  const name = clean(input.name, 120);
  if (!name) return { error: "Name the estimate – whose it is." };
  const u = units(input.units, "units");
  const pg = percent(input.preliminaries, "P&G", { min: 0, max: 40 });
  const cont = percent(input.contingency, "contingency", { min: 0, max: 60 });
  const errors = [u, pg, cont].flatMap((x) => ("error" in x ? [x.error] : []));
  if (errors.length) return { error: errors.join("; ") };
  return {
    values: {
      name,
      preparedBy: optional(input.preparedBy, 120),
      dated: optional(input.dated, 40),
      basis: optional(input.basis, 300),
      units: (u as { value: string | null }).value,
      preliminaries: (pg as { value: string | null }).value ?? "0.1000",
      contingency: (cont as { value: string | null }).value ?? "0.1000",
    },
  };
}

async function nextPosition(comparisonId: string) {
  const [m] = await db
    .select({ max: sql<number | null>`max(${comparisonEstimates.position})` })
    .from(comparisonEstimates)
    .where(eq(comparisonEstimates.comparisonId, comparisonId));
  return (m?.max ?? 0) + 1;
}

/** An estimate as received. Its lines come from a workbook, or are added one at a time. */
export async function addEstimate(
  projectId: string,
  comparisonId: string,
  form: FormData,
): Promise<ComparisonAction> {
  await requireSession();
  if (!(await owned(projectId, comparisonId)))
    return {
      ok: false,
      reason: "That comparison is no longer on this project.",
    };
  const read = readEstimate(
    Object.fromEntries(
      [
        "name",
        "preparedBy",
        "dated",
        "basis",
        "units",
        "preliminaries",
        "contingency",
      ].map((k) => [k, String(form.get(k) ?? "")]),
    ) as EstimateInput,
  );
  if ("error" in read) return { ok: false, reason: read.error };

  let notes: string[] = [];
  let lines: {
    element: string;
    description: string;
    quantity: string | null;
    unit: string | null;
    rate: string | null;
    lumpSum: string | null;
  }[] = [];
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (!/\.xlsx$/i.test(file.name))
      return { ok: false, reason: "Lines import from an .xlsx workbook." };
    if (file.size > 15 * 1024 * 1024)
      return {
        ok: false,
        reason: "That workbook is larger than an estimate should be (15 MB).",
      };
    const grids = readWorkbookGrids(new Uint8Array(await file.arrayBuffer()));
    if (grids.warning) return { ok: false, reason: grids.warning };
    const got = importLines(grids.sheets);
    if (!got.ok) return got;
    lines = got.lines;
    notes = got.notes;
  }

  const id = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`comparison:${comparisonId}`}))`,
    );
    const position = await nextPosition(comparisonId);
    const [row] = await tx
      .insert(comparisonEstimates)
      .values({ comparisonId, position, ...read.values })
      .returning({ id: comparisonEstimates.id });
    if (lines.length)
      await tx
        .insert(comparisonLines)
        .values(
          lines.map((l, i) => ({ estimateId: row.id, position: i + 1, ...l })),
        );
    return row.id;
  });
  await touch(comparisonId);
  revalidatePath(path(projectId));
  return {
    ok: true,
    id,
    notes,
    message: `${read.values.name} is on the comparison${lines.length ? ` with ${lines.length} lines` : ""}.`,
  };
}

export async function updateEstimate(
  projectId: string,
  comparisonId: string,
  estimateId: string,
  input: EstimateInput,
): Promise<ComparisonAction> {
  await requireSession();
  if (!(await estimateOf(projectId, comparisonId, estimateId)))
    return {
      ok: false,
      reason: "That estimate is no longer on this comparison.",
    };
  const read = readEstimate(input);
  if ("error" in read) return { ok: false, reason: read.error };
  await db
    .update(comparisonEstimates)
    .set(read.values)
    .where(eq(comparisonEstimates.id, estimateId));
  await touch(comparisonId);
  revalidatePath(path(projectId));
  return { ok: true, message: `${read.values.name} is saved.` };
}

export async function removeEstimate(
  projectId: string,
  comparisonId: string,
  estimateId: string,
): Promise<ComparisonAction> {
  await requireSession();
  const e = await estimateOf(projectId, comparisonId, estimateId);
  if (!e)
    return {
      ok: false,
      reason: "That estimate is no longer on this comparison.",
    };
  await db
    .delete(comparisonEstimates)
    .where(eq(comparisonEstimates.id, estimateId));
  await touch(comparisonId);
  revalidatePath(path(projectId));
  return { ok: true, message: `${e.name} is off the comparison.` };
}

/**
 * A new estimate derived from another: a copy of its lines and markups, to be corrected.
 *
 * A copy rather than a view, so re-rating a line here does not change the estimate as received –
 * that one is the record of what was submitted. The lineage is kept, and every change beyond the
 * copied lines is a correction with its reason.
 */
export async function deriveEstimate(
  projectId: string,
  comparisonId: string,
  fromId: string,
  input: { name: string },
): Promise<ComparisonAction> {
  await requireSession();
  const from = await estimateOf(projectId, comparisonId, fromId);
  if (!from)
    return {
      ok: false,
      reason: "That estimate is no longer on this comparison.",
    };
  const name = clean(input.name, 120) || `${from.name}, corrected`;
  const id = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`comparison:${comparisonId}`}))`,
    );
    const position = await nextPosition(comparisonId);
    const [row] = await tx
      .insert(comparisonEstimates)
      .values({
        comparisonId,
        position,
        name,
        preparedBy: null,
        dated: null,
        basis: `Derived from ${from.name}, with the corrections listed`,
        units: from.units,
        preliminaries: from.preliminaries,
        contingency: from.contingency,
        derivedFrom: from.id,
      })
      .returning({ id: comparisonEstimates.id });
    const lines = await tx
      .select()
      .from(comparisonLines)
      .where(eq(comparisonLines.estimateId, from.id));
    if (lines.length)
      await tx
        .insert(comparisonLines)
        .values(
          lines.map(
            ({
              position,
              element,
              description,
              quantity,
              unit,
              rate,
              lumpSum,
            }) => ({
              estimateId: row.id,
              position,
              element,
              description,
              quantity,
              unit,
              rate,
              lumpSum,
            }),
          ),
        );
    return row.id;
  });
  await touch(comparisonId);
  revalidatePath(path(projectId));
  return {
    ok: true,
    id,
    message: `${name} is derived from ${from.name}. Add the corrections, each with its reason.`,
  };
}

// ── Lines and corrections ─────────────────────────────────────────────────────────────────

export async function addLine(
  projectId: string,
  comparisonId: string,
  estimateId: string,
  input: {
    element: string;
    description: string;
    quantity?: string;
    unit?: string;
    rate?: string;
    lumpSum?: string;
  },
): Promise<ComparisonAction> {
  await requireSession();
  if (!(await estimateOf(projectId, comparisonId, estimateId)))
    return {
      ok: false,
      reason: "That estimate is no longer on this comparison.",
    };
  const element = clean(input.element, 120);
  const description = clean(input.description, 400);
  if (!element || !description)
    return { ok: false, reason: "A line needs its element and a description." };
  const qty = units(input.quantity, "quantity");
  const rate = rands(input.rate, "rate");
  const lump = rands(input.lumpSum, "lump sum");
  const errors = [qty, rate, lump].flatMap((x) =>
    "error" in x ? [x.error] : [],
  );
  if (errors.length)
    return { ok: false, reason: `Not added – ${errors.join("; ")}.` };
  const q = (qty as { value: string | null }).value;
  const r = (rate as { value: string | null }).value;
  const l = (lump as { value: string | null }).value;
  if ((q === null) !== (r === null))
    return {
      ok: false,
      reason:
        "A measured line needs both a quantity and a rate; an allowance needs only the lump sum.",
    };
  if (q === null && l === null)
    return { ok: false, reason: "Give a quantity and a rate, or a lump sum." };
  const [m] = await db
    .select({ max: sql<number | null>`max(${comparisonLines.position})` })
    .from(comparisonLines)
    .where(eq(comparisonLines.estimateId, estimateId));
  await db
    .insert(comparisonLines)
    .values({
      estimateId,
      position: (m?.max ?? 0) + 1,
      element,
      description,
      quantity: q,
      unit: optional(input.unit, 20),
      rate: r,
      lumpSum: l,
    });
  await touch(comparisonId);
  revalidatePath(path(projectId));
  return { ok: true, message: "The line is added." };
}

export async function removeLine(
  projectId: string,
  comparisonId: string,
  estimateId: string,
  lineId: string,
): Promise<ComparisonAction> {
  await requireSession();
  if (!(await estimateOf(projectId, comparisonId, estimateId)))
    return {
      ok: false,
      reason: "That estimate is no longer on this comparison.",
    };
  await db
    .delete(comparisonLines)
    .where(
      and(
        eq(comparisonLines.id, lineId),
        eq(comparisonLines.estimateId, estimateId),
      ),
    );
  await touch(comparisonId);
  revalidatePath(path(projectId));
  return { ok: true, message: "The line is removed." };
}

/** A correction is only for a derived estimate: an estimate as received is the record of what was submitted. */
export async function addCorrection(
  projectId: string,
  comparisonId: string,
  estimateId: string,
  input: {
    element: string;
    description: string;
    amount: string;
    basis?: string;
  },
): Promise<ComparisonAction> {
  const session = await requireSession();
  const e = await estimateOf(projectId, comparisonId, estimateId);
  if (!e)
    return {
      ok: false,
      reason: "That estimate is no longer on this comparison.",
    };
  if (!e.derivedFrom)
    return {
      ok: false,
      reason:
        "Corrections go on a derived estimate, so the estimate as received stays as it was submitted. Derive one first.",
    };
  const element = clean(input.element, 120);
  const description = clean(input.description, 400);
  if (!element || !description)
    return {
      ok: false,
      reason: "A correction needs its element and what it changes.",
    };
  const amount = rands(input.amount, "amount", true);
  if ("error" in amount) return { ok: false, reason: amount.error };
  if (amount.value === null)
    return {
      ok: false,
      reason: "Give the amount the correction adds (negative to take off).",
    };

  const ref = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`corrections:${estimateId}`}))`,
    );
    const [m] = await tx
      .select({
        max: sql<number | null>`max(${comparisonCorrections.position})`,
      })
      .from(comparisonCorrections)
      .where(eq(comparisonCorrections.estimateId, estimateId));
    const position = (m?.max ?? 0) + 1;
    // A, B, C … Z, then AA – the memo's lettering.
    const letter = (n: number): string =>
      n <= 26
        ? String.fromCharCode(64 + n)
        : letter(Math.floor((n - 1) / 26)) + letter(((n - 1) % 26) + 1);
    await tx
      .insert(comparisonCorrections)
      .values({
        estimateId,
        position,
        ref: letter(position),
        element,
        description,
        amount: amount.value!,
        basis: optional(input.basis, 600),
        createdBy: session.email,
      });
    return letter(position);
  });
  await touch(comparisonId);
  revalidatePath(path(projectId));
  return { ok: true, message: `Correction ${ref} is applied.` };
}

export async function removeCorrection(
  projectId: string,
  comparisonId: string,
  estimateId: string,
  correctionId: string,
): Promise<ComparisonAction> {
  await requireSession();
  if (!(await estimateOf(projectId, comparisonId, estimateId)))
    return {
      ok: false,
      reason: "That estimate is no longer on this comparison.",
    };
  await db
    .delete(comparisonCorrections)
    .where(
      and(
        eq(comparisonCorrections.id, correctionId),
        eq(comparisonCorrections.estimateId, estimateId),
      ),
    );
  await touch(comparisonId);
  revalidatePath(path(projectId));
  return { ok: true, message: "The correction is removed." };
}

// ── Clarifications ────────────────────────────────────────────────────────────────────────

export async function addClarification(
  projectId: string,
  comparisonId: string,
  input: {
    estimate?: string;
    observation: string;
    evidence?: string;
    consequence?: string;
  },
): Promise<ComparisonAction> {
  const session = await requireSession();
  if (!(await owned(projectId, comparisonId)))
    return {
      ok: false,
      reason: "That comparison is no longer on this project.",
    };
  const observation = clean(input.observation, 2000);
  if (!observation) return { ok: false, reason: "Say what was observed." };
  const number = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`clarifications:${comparisonId}`}))`,
    );
    const [m] = await tx
      .select({
        max: sql<number | null>`max(${comparisonClarifications.number})`,
      })
      .from(comparisonClarifications)
      .where(eq(comparisonClarifications.comparisonId, comparisonId));
    const n = (m?.max ?? 0) + 1;
    await tx
      .insert(comparisonClarifications)
      .values({
        comparisonId,
        number: n,
        estimate: optional(input.estimate, 120),
        observation,
        evidence: optional(input.evidence, 2000),
        consequence: optional(input.consequence, 2000),
        createdBy: session.email,
      });
    return n;
  });
  await touch(comparisonId);
  revalidatePath(path(projectId));
  return { ok: true, message: `C${number} is on the list.` };
}

export async function respondToClarification(
  projectId: string,
  comparisonId: string,
  clarificationId: string,
  input: { response: string; status: string },
): Promise<ComparisonAction> {
  const session = await requireSession();
  if (!(await owned(projectId, comparisonId)))
    return {
      ok: false,
      reason: "That comparison is no longer on this project.",
    };
  const status = CLARIFICATION_STATUSES.find((s) => s === input.status) as
    ClarificationStatus | undefined;
  if (!status)
    return {
      ok: false,
      reason: "That is not a status a clarification can be in.",
    };
  const response = optional(input.response, 2000);
  if (status !== "Open" && !response)
    return {
      ok: false,
      reason:
        "Write the response before marking it answered or closed – it is the record of what was said.",
    };
  const [row] = await db
    .update(comparisonClarifications)
    .set({
      response,
      status,
      answeredBy: status === "Open" ? null : session.email,
      answeredAt: status === "Open" ? null : new Date(),
    })
    .where(
      and(
        eq(comparisonClarifications.id, clarificationId),
        eq(comparisonClarifications.comparisonId, comparisonId),
      ),
    )
    .returning({ number: comparisonClarifications.number });
  if (!row)
    return {
      ok: false,
      reason: "That clarification is no longer on this comparison.",
    };
  await touch(comparisonId);
  revalidatePath(path(projectId));
  return { ok: true, message: `C${row.number} is ${status.toLowerCase()}.` };
}
