/**
 * The take-off – dimension sheets per project, measured on every read (D1.2).
 *
 * Each item's quantity is derived from its lines by `domain/dimensions.ts` here, never stored, and
 * handed to the page beside the bill row it feeds – so the page can say whether the bill still
 * carries what the sheet measures.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { documents, runItems, takeoffDimensions, takeoffItems, takeoffParameters } from "@/db/schema";
import { measure } from "@/domain/dimensions";
import { parseQuantity, quantityToNumeric, type Quantity } from "@/domain/money";
import { loadLatestBill } from "@/lib/agent/persist-bill";
import { itemReferences, workingRow } from "@/lib/agent/bill";
import type { Mark } from "@/domain/drawing-marks";
import { nameIn, signerNames } from "@/lib/signers";
import { isSpatial } from "@/lib/ingest/document-class";

export interface DimensionView {
  id: string;
  seq: number;
  location: string | null;
  timesing: string;
  length: string | null;
  width: string | null;
  depth: string | null;
  deduct: boolean;
  /** How the agent worked it out – "2 × panel_total × brickwork_height" – where it wrote the line. */
  working: string | null;
  /** This line's signed contribution, at four places. */
  quantity: string;
  /** What on a drawing it was measured from, where it was measured on one (0045). */
  mark?: Mark | null;
}

export interface TakeoffItemView {
  id: string;
  number: number;
  section: string | null;
  description: string;
  unit: string;
  drawingId: string | null;
  /** "manual", or "drawings" where the measuring agent wrote the sheet. */
  origin: string;
  /** The assumed figures its quantity rests on, in words. */
  note: string | null;
  lines: DimensionView[];
  /** The measured total, at four places. */
  total: string;
  mismatched: { index: number; reason: string }[];
  negative: boolean;
  bill: { itemId: string; ref: string; description: string; quantity: string | null; source: string } | null;
  sent: { quantity: string; at: string; by: string } | null;
}

/** A bill row an item can feed: the latest draft's items. */
export interface BillRowOption {
  id: string;
  ref: string;
  description: string;
  unit: string | null;
}

const toQ = (value: string | null): Quantity | null => (value === null ? null : parseQuantity(value));

export async function listTakeoff(projectId: string): Promise<TakeoffItemView[]> {
  const names = await signerNames();
  const items = await db
    .select()
    .from(takeoffItems)
    .where(and(eq(takeoffItems.projectId, projectId), isNull(takeoffItems.deletedAt)))
    .orderBy(asc(takeoffItems.number));
  if (items.length === 0) return [];

  const dims = await db
    .select()
    .from(takeoffDimensions)
    .where(inArray(takeoffDimensions.itemId, items.map((i) => i.id)))
    .orderBy(asc(takeoffDimensions.seq));

  const linkedIds = items.flatMap((i) => (i.billItemId ? [i.billItemId] : []));
  const linked = linkedIds.length ? await db.select().from(runItems).where(inArray(runItems.id, linkedIds)) : [];
  const bill = await loadLatestBill(projectId, "/bill");
  const refs = bill ? itemReferences(bill.rows) : new Map<string, string>();

  return items.map((item) => {
    const lines = dims.filter((d) => d.itemId === item.id);
    const sheet = measure(
      item.unit,
      lines.map((d) => ({
        timesing: parseQuantity(d.timesing),
        dimensions: [d.length, d.width, d.depth].flatMap((v) => (v === null ? [] : [toQ(v)!])),
        deduct: d.deduct,
      })),
    );
    const row = linked.find((r) => r.id === item.billItemId) ?? null;
    return {
      id: item.id,
      number: item.number,
      section: item.section,
      description: item.description,
      unit: item.unit,
      drawingId: item.drawingId,
      origin: item.origin,
      note: item.note,
      lines: lines.map((d, i) => ({
        id: d.id,
        seq: d.seq,
        location: d.location,
        timesing: d.timesing,
        length: d.length,
        width: d.width,
        depth: d.depth,
        deduct: d.deduct,
        working: d.working,
        quantity: quantityToNumeric(sheet.lines[i]!),
        mark: (d.mark as Mark | null) ?? null,
      })),
      total: quantityToNumeric(sheet.total),
      mismatched: sheet.mismatched,
      negative: sheet.negative,
      bill: row
        ? {
            itemId: row.id,
            ref: row.itemRef ?? refs.get(row.id) ?? "",
            description: row.overrideDescription ?? row.proposedDescription ?? "",
            quantity: row.overrideQuantity ?? row.proposedQuantity,
            source: row.quantitySource,
          }
        : null,
      sent: item.sentQuantity && item.sentAt ? { quantity: item.sentQuantity, at: item.sentAt.toISOString(), by: nameIn(names, item.sentBy ?? "") } : null,
    };
  });
}

/** A figure the last measurement from drawings rests on. */
export interface ParameterView {
  name: string;
  label: string;
  status: "read" | "derived" | "assumed";
  value: string;
  unit: string;
  figure: string | null;
  expression: string | null;
  quote: string | null;
  assumption: string | null;
  source: { documentId: string; name: string; page: number | null } | null;
}

/** What the project's measurement from drawings rests on – read first, then worked out, then assumed. */
export async function listParameters(projectId: string): Promise<ParameterView[]> {
  const rows = await db
    .select({ p: takeoffParameters, documentName: documents.filename })
    .from(takeoffParameters)
    .leftJoin(documents, eq(documents.id, takeoffParameters.documentId))
    .where(eq(takeoffParameters.projectId, projectId))
    .orderBy(asc(takeoffParameters.createdAt));
  const order = { assumed: 0, read: 1, derived: 2 } as const;
  return rows
    .map(({ p, documentName }) => ({
      name: p.name,
      label: p.label,
      status: p.status,
      value: p.value,
      unit: p.unit,
      figure: p.figure,
      expression: p.expression,
      quote: p.quote,
      assumption: p.assumption,
      source: p.documentId ? { documentId: p.documentId, name: documentName ?? "", page: p.page } : null,
    }))
    .sort((a, b) => order[a.status] - order[b.status]);
}

/** The drawings filed on a project – what the take-off agent measures. */
export async function projectDrawings(projectId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: documents.id, name: documents.filename, kind: documents.kind })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)));
  return rows.filter((r) => isSpatial(r.kind)).map(({ id, name }) => ({ id, name }));
}

/** The latest bill's item rows, for linking – or null where there is no bill, or it is signed. */
export async function billRowOptions(projectId: string): Promise<{ options: BillRowOption[]; signed: boolean; exists: boolean }> {
  const bill = await loadLatestBill(projectId, "/bill");
  if (!bill) return { options: [], signed: false, exists: false };
  const refs = itemReferences(bill.rows);
  return {
    exists: true,
    signed: Boolean(bill.signedAt),
    options: bill.rows
      .filter((r) => r.rowType === "item" && !r.omitted)
      .map((r) => {
        const w = workingRow(r);
        return { id: r.id, ref: r.itemRef ?? refs.get(r.id) ?? "", description: w.description ?? "", unit: w.unit };
      }),
  };
}
