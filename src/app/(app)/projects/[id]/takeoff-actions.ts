"use server";

/**
 * Dimension sheets, and sending what they measure to the bill – D1.2.
 *
 * Every dimension crosses `readQuantity` with no unit to settle it: a dimension of `1,250` in
 * metres may be one and a quarter metres or twelve hundred and fifty, and nothing about a length
 * says which – so it is refused in words, as a bill cell refuses it. Sending writes the measured
 * total into the linked bill row through `writeOverrides`, the one path a bill row is written by,
 * with its source recorded as a take-off.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { documents, runItems, runs, takeoffDimensions, takeoffItems } from "@/db/schema";
import { measureMark, readMark } from "@/domain/drawing-marks";
import { readQuantity } from "@/domain/amount";
import { dimensionsFor, measure } from "@/domain/dimensions";
import { parseQuantity, quantityToNumeric } from "@/domain/money";
import { draftBillFor, writeOverrides } from "@/lib/agent/bill-writes";
import { workingRow, type PersistedBill } from "@/lib/agent/bill";
import { loadLatestBill, nextSeq } from "@/lib/agent/persist-bill";

export type TakeoffAction = { ok: true } | { ok: false; reason: string; errors?: Record<string, string> };

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const done = (projectId: string): TakeoffAction => {
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
};

async function ownItem(projectId: string, itemId: string) {
  const [item] = await db
    .select()
    .from(takeoffItems)
    .where(and(eq(takeoffItems.id, itemId), eq(takeoffItems.projectId, projectId), isNull(takeoffItems.deletedAt)))
    .limit(1);
  return item ?? null;
}

// ── Items ──────────────────────────────────────────────────────────────────────────────────

export async function addTakeoffItem(projectId: string, input: { section: string; description: string; unit: string }): Promise<TakeoffAction> {
  const session = await requireSession();
  const description = clean(input.description, 500);
  const unit = clean(input.unit, 20);
  const errors: Record<string, string> = {};
  if (!description) errors.description = "Describe what is being measured.";
  if (!unit) errors.unit = "Give the unit it is measured in – m, m², m³, no.";
  if (Object.keys(errors).length) return { ok: false, reason: "Some fields need attention.", errors };

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`takeoff:${projectId}`}))`);
    const [row] = await tx.select({ max: sql<number | null>`max(${takeoffItems.number})` }).from(takeoffItems).where(eq(takeoffItems.projectId, projectId));
    await tx.insert(takeoffItems).values({
      projectId,
      number: (row?.max ?? 0) + 1,
      section: clean(input.section, 120) || null,
      description,
      unit,
      createdBy: session.email,
    });
  });
  return done(projectId);
}

export async function deleteTakeoffItem(projectId: string, itemId: string): Promise<TakeoffAction> {
  await requireSession();
  await db.update(takeoffItems).set({ deletedAt: new Date() }).where(and(eq(takeoffItems.id, itemId), eq(takeoffItems.projectId, projectId)));
  return done(projectId);
}

// ── Dimension lines ────────────────────────────────────────────────────────────────────────

export async function addDimension(
  projectId: string,
  itemId: string,
  input: { location: string; timesing: string; length: string; width: string; depth: string; deduct: boolean },
): Promise<TakeoffAction> {
  await requireSession();
  const item = await ownItem(projectId, itemId);
  if (!item) return { ok: false, reason: "That item is not on this project." };

  const errors: Record<string, string> = {};
  const read = (text: string, key: string, required: boolean): string | null => {
    const t = text.trim();
    if (t === "") {
      if (required) errors[key] = "Required.";
      return null;
    }
    const r = readQuantity(t);
    if (!r.ok) {
      errors[key] = r.reason;
      return null;
    }
    if (r.quantity <= 0n) {
      errors[key] = "A dimension is more than nought – a deduction is ticked, not negative.";
      return null;
    }
    return quantityToNumeric(r.quantity);
  };

  const timesing = input.timesing.trim() === "" ? "1.0000" : read(input.timesing, "timesing", true);
  const wanted = dimensionsFor(item.unit);
  const length = read(input.length, "length", wanted !== null && wanted >= 1);
  const width = read(input.width, "width", wanted !== null && wanted >= 2);
  const depth = read(input.depth, "depth", wanted !== null && wanted >= 3);
  if (width && !length) errors.width = "Fill dimensions from the left – a width needs a length.";
  if (depth && !width) errors.depth = "Fill dimensions from the left – a depth needs a width.";
  if (Object.keys(errors).length) return { ok: false, reason: "The line needs attention.", errors };

  const [last] = await db.select({ max: sql<number | null>`max(${takeoffDimensions.seq})` }).from(takeoffDimensions).where(eq(takeoffDimensions.itemId, itemId));
  await db.insert(takeoffDimensions).values({
    itemId,
    seq: (last?.max ?? 0) + 1,
    location: clean(input.location, 200) || null,
    timesing: timesing!,
    length,
    width,
    depth,
    deduct: input.deduct,
  });
  await db.update(takeoffItems).set({ updatedAt: new Date() }).where(eq(takeoffItems.id, itemId));
  return done(projectId);
}

/**
 * A line measured on a drawing: the mark is read, the drawing checked to be this project's, and the
 * figure worked again here from the points and scale – never taken from the browser. It then goes
 * through `addDimension`, so a measured line is refused on exactly the terms a typed one is.
 *
 * How a mark fills the line follows the item's unit:
 *   · a length fills the length; a wall in m² asks for its height, a volume for the rest;
 *   · an area is measured direct – the area, by one – with a depth asked for a volume;
 *   · a count is the timesing of an item measured in number.
 */
export async function addMarkedDimension(
  projectId: string,
  itemId: string,
  input: { mark: unknown; location: string; width: string; depth: string; deduct: boolean },
): Promise<TakeoffAction> {
  await requireSession();
  const read = readMark(input.mark);
  if (!read.ok) return { ok: false, reason: read.reason };
  const { mark } = read;

  const item = await ownItem(projectId, itemId);
  if (!item) return { ok: false, reason: "That item is not on this project." };
  const [drawing] = await db
    .select({ id: documents.id, name: documents.filename })
    .from(documents)
    .where(and(eq(documents.id, mark.documentId), eq(documents.projectId, projectId)))
    .limit(1);
  if (!drawing) return { ok: false, reason: "That drawing is not filed on this project." };

  const wanted = dimensionsFor(item.unit);
  const figure = measureMark(mark);
  // Centimetres for a length, the square of it for an area: what a QS writes on dim paper.
  const two = (n: number) => n.toFixed(2);
  const where = input.location.trim() || `${drawing.name}, sheet ${mark.page}`;

  let line: { timesing: string; length: string; width: string; depth: string };
  let working: string;
  if (mark.kind === "count") {
    if (wanted !== 0) return { ok: false, reason: "A count measures an item in number. This item is measured in " + item.unit + "." };
    line = { timesing: String(figure), length: "", width: "", depth: "" };
    working = `counted ${figure} on the drawing`;
  } else if (mark.kind === "length") {
    if (wanted === null || wanted === 0) return { ok: false, reason: "A length does not measure an item in " + item.unit + "." };
    line = { timesing: "", length: two(figure), width: wanted >= 2 ? input.width : "", depth: wanted >= 3 ? input.depth : "" };
    working = `${two(figure)} m measured on the drawing`;
  } else {
    if (wanted === null || wanted < 2) return { ok: false, reason: "An area measures an item in m² or m³. This item is measured in " + item.unit + "." };
    line = { timesing: "", length: two(figure), width: "1", depth: wanted >= 3 ? input.depth : "" };
    working = `${two(figure)} m² outline on the drawing, measured direct`;
  }

  const added = await addDimension(projectId, itemId, { location: where, ...line, deduct: input.deduct });
  if (!added.ok) return added;

  // The line just written is this item's last; the mark and its working go on it.
  const [last] = await db
    .select({ id: takeoffDimensions.id })
    .from(takeoffDimensions)
    .where(eq(takeoffDimensions.itemId, itemId))
    .orderBy(desc(takeoffDimensions.seq))
    .limit(1);
  if (last) await db.update(takeoffDimensions).set({ mark, working }).where(eq(takeoffDimensions.id, last.id));
  return done(projectId);
}

export async function deleteDimension(projectId: string, itemId: string, lineId: string): Promise<TakeoffAction> {
  await requireSession();
  if (!(await ownItem(projectId, itemId))) return { ok: false, reason: "That item is not on this project." };
  await db.delete(takeoffDimensions).where(and(eq(takeoffDimensions.id, lineId), eq(takeoffDimensions.itemId, itemId)));
  return done(projectId);
}

// ── The bill ───────────────────────────────────────────────────────────────────────────────

export async function linkToBill(projectId: string, itemId: string, billItemId: string | null): Promise<TakeoffAction> {
  await requireSession();
  if (!(await ownItem(projectId, itemId))) return { ok: false, reason: "That item is not on this project." };
  if (billItemId) {
    const [row] = await db
      .select({ id: runItems.id, projectId: runs.projectId, rowType: runItems.rowType })
      .from(runItems)
      .innerJoin(runs, eq(runs.id, runItems.runId))
      .where(eq(runItems.id, billItemId))
      .limit(1);
    if (!row || row.projectId !== projectId || row.rowType !== "item") return { ok: false, reason: "That is not an item of this project's bill." };
  }
  await db.update(takeoffItems).set({ billItemId, updatedAt: new Date() }).where(eq(takeoffItems.id, itemId));
  return done(projectId);
}

/** The measured quantity of an item, from its lines – the same arithmetic the page shows. */
async function measured(item: typeof takeoffItems.$inferSelect) {
  const lines = await db.select().from(takeoffDimensions).where(eq(takeoffDimensions.itemId, item.id));
  return measure(
    item.unit,
    lines.map((d) => ({
      timesing: parseQuantity(d.timesing),
      dimensions: [d.length, d.width, d.depth].flatMap((v) => (v === null ? [] : [parseQuantity(v)])),
      deduct: d.deduct,
    })),
  );
}

/**
 * The heading a new row from Take-off sits under: the bill's section of the same name, opened at the
 * end of the bill if it has none yet. An item measured with no section joins whatever section the
 * bill ends in, as `addRow` does – an orphan row at the foot of a bill is under no trade at all.
 */
async function headingFor(bill: PersistedBill, section: string | null, by: string): Promise<string | null> {
  const name = section?.trim() ?? "";

  if (!name) {
    const last = bill.rows[bill.rows.length - 1];
    return last ? (last.rowType === "heading" ? last.id : last.parentId) : null;
  }

  const same = bill.rows.find(
    (row) => row.rowType === "heading" && (workingRow(row).description ?? "").trim().toLowerCase() === name.toLowerCase(),
  );
  if (same) return same.id;

  const [heading] = await db
    .insert(runItems)
    .values({
      runId: bill.id,
      seq: await nextSeq(bill.id),
      rowType: "heading",
      overrideDescription: name,
      overrideBy: by,
      overrideAt: new Date(),
      quantitySource: "takeoff",
    })
    .returning({ id: runItems.id });
  return heading!.id;
}

/**
 * Send the measured quantity to the bill: into the linked row, or – where nothing is linked – as a
 * new row under its section, described and measured as the sheet says. Opens the bill if there is
 * none yet.
 */
export async function sendToBill(projectId: string, itemId: string): Promise<TakeoffAction> {
  const session = await requireSession();
  const item = await ownItem(projectId, itemId);
  if (!item) return { ok: false, reason: "That item is not on this project." };

  const sheet = await measured(item);
  if (sheet.total === 0n) return { ok: false, reason: "Nothing is measured yet – add a dimension line first." };
  if (sheet.negative) return { ok: false, reason: "More is deducted than measured. Check the deductions before sending." };
  if (sheet.mismatched.length > 0) return { ok: false, reason: `${sheet.mismatched[0]!.reason} Correct it before sending – a missing dimension would send the wrong unit of quantity.` };

  // No bill yet is not a refusal: measuring is how a bill starts, so the first send opens one (C1).
  const draft = await draftBillFor(projectId, "/bill", session.email);
  if (!draft.ok) return { ok: false, reason: draft.reason };
  const bill = await loadLatestBill(projectId, "/bill");
  if (!bill || bill.id !== draft.runId) return { ok: false, reason: "The bill changed while sending. Reload and send again." };

  const total = quantityToNumeric(sheet.total);
  let target = item.billItemId;

  // The link may point at a row of an earlier draft – the quantity goes to the bill being worked on.
  if (target && !bill.rows.some((r) => r.id === target)) target = null;

  if (!target) {
    const [created] = await db
      .insert(runItems)
      .values({
        runId: bill.id,
        seq: await nextSeq(bill.id),
        parentId: await headingFor(bill, item.section, session.email),
        rowType: "item",
        overrideDescription: item.description,
        overrideUnit: item.unit,
        overrideQuantity: total,
        overrideBy: session.email,
        overrideAt: new Date(),
        quantitySource: "takeoff",
      })
      .returning({ id: runItems.id });
    target = created!.id;
  } else {
    const written = await writeOverrides(target, { overrideQuantity: total }, session.email, "takeoff");
    if (!written) return { ok: false, reason: "That bill row no longer exists. Link the item to another." };
  }

  await db
    .update(takeoffItems)
    .set({ billItemId: target, sentQuantity: total, sentAt: new Date(), sentBy: session.email, updatedAt: new Date() })
    .where(eq(takeoffItems.id, itemId));
  return done(projectId);
}
