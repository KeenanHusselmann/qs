"use server";

/**
 * Measure the drawings, and carry what they measure to the bill – D1.2.
 *
 * The agent (`lib/agent/measure-drawings.ts`) proposes; `domain/drawing-takeoff.ts` checks; this
 * writes. What it writes is the same thing a QS writes by hand – take-off items and dimension
 * lines – with two additions a hand-typed sheet does not need: the working of each line, and the
 * figures the sheet rests on, each read (with its quote), derived (with its expression) or assumed
 * (with the reason). Then each measured item goes to the bill as a row whose quantity came from a
 * take-off, grouped under its element.
 *
 * Measuring again replaces what the last measurement wrote – its sheets, its figures and the bill
 * rows it added – and leaves alone anything a person measured or typed.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { billElements, runItems, runs, takeoffDimensions, takeoffItems, takeoffParameters } from "@/db/schema";
import type { ElementId } from "@/domain/elemental-plan";
import { measure } from "@/domain/dimensions";
import { parseQuantity, quantity, quantityToNumeric } from "@/domain/money";
import { toNumeric } from "@/domain/measure-expression";
import { costOf, ModelUnavailable } from "@/lib/agent/deepseek";
import { measureDrawingsFor } from "@/lib/agent/measure-drawings";
import { loadLatestBill, SEQ_STEP } from "@/lib/agent/persist-bill";
import { forProject } from "@/lib/egress/scope";

export type MeasureOutcome =
  | {
      ok: true;
      items: number;
      lines: number;
      read: number;
      derived: number;
      assumed: { label: string; figure: string | null; unit: string; assumption: string }[];
      refused: { what: string; reason: string }[];
      /** What the drawings require that the measurement could not reach. */
      gaps: string[];
      /** Rows added to the bill, or why none were. */
      billed: number;
      billReason: string | null;
      spend: number | null;
      partial: boolean;
    }
  | { ok: false; reason: string };

// Stored ASCII, as every unit is – `displayUnit` writes m² on screen and on paper.
const BILL_UNIT: Record<string, string> = { "m²": "m2", "m³": "m3", sqm: "m2", cum: "m3", nr: "no", each: "no" };
const billUnit = (unit: string) => BILL_UNIT[unit.trim().toLowerCase()] ?? unit.trim();

/**
 * The quantity a bill carries: two places, half away from nought.
 *
 * The sheet keeps the measurement exact – 203,2947 m³ is what the dimensions multiply to – and the
 * bill carries it as a bill does, to two places, so the extension a contractor checks is the
 * quantity they read.
 */
function billQuantity(numeric: string): string {
  const q = parseQuantity(numeric);
  const rounded = ((q < 0n ? q - 50n : q + 50n) / 100n) * 100n;
  return quantityToNumeric(quantity(rounded));
}

/**
 * Measure the project's drawings, or the sheets chosen from them.
 *
 * ── Why a choice, and not just "all of them" ───────────────────────────────────────────────
 *
 * A reply has a length limit, and a real corpus runs past it. Marshall Dam's five drawings did:
 * the model described as much as it could, stopped mid-structure, and none of it could be used.
 * The refusal said so and told the reader to measure a smaller selection of sheets - which the
 * platform then gave them no way to do. This is that way.
 *
 * It is also how a quantity surveyor works. A bill is measured element by element, off the sheets
 * that show that element, and a boundary wall is not measured off the site layout and the
 * electrical servitude at the same time.
 */
export async function measureDrawings(projectId: string, only?: readonly string[]): Promise<MeasureOutcome> {
  const session = await requireSession();

  let m;
  try {
    m = await forProject(projectId, () => measureDrawingsFor(projectId, undefined, only));
  } catch (error) {
    if (error instanceof ModelUnavailable) {
      /*
        The cause goes to the log, the consequence goes to the reader.

        `error.message` already says what happened and what to do about it, in a quantity
        surveyor's terms; `error.detail` is the status code, the provider's wording or the
        exception, which belongs where somebody is debugging rather than under a button somebody
        pressed. Appending "Nothing was measured." here is gone too: the messages say what was and
        was not changed themselves, and the pair of them read as two different sentences about the
        same failure.
      */
      if (error.detail) console.error(`measureDrawings(${projectId}): ${error.detail}`);
      return { ok: false, reason: error.message };
    }
    throw error;
  }
  if (m.drawings.length === 0) {
    return { ok: false, reason: "There are no drawings filed on this project. File the working drawings under Bill of Quantities or Documents, then measure." };
  }
  if (m.usage.input === 0) {
    return {
      ok: false,
      reason: `${m.drawings.length === 1 ? "The drawing has" : "The drawings have"} no text to measure from yet. A large set takes a minute to read after filing – try again shortly. A scanned drawing (an image with no text) cannot be measured; file the original PDF from the CAD package.`,
    };
  }
  if (m.items.length === 0) {
    const why = m.refused.slice(0, 3).map((r) => `${r.what}: ${r.reason}`).join(" ");
    return { ok: false, reason: `The drawings were read, but nothing on them could be measured and traced back to them.${why ? ` ${why}` : ""}` };
  }

  const labelOf = new Map(m.parameters.map((p) => [p.name, p]));
  const bill = await loadLatestBill(projectId, "/bill");
  const now = new Date();
  let billed = 0;
  let billReason: string | null = null;

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`takeoff:${projectId}`}))`);

    // ── What the last measurement wrote goes ─────────────────────────────────────────────
    const previous = await tx
      .select({ id: takeoffItems.id, billItemId: takeoffItems.billItemId })
      .from(takeoffItems)
      .where(and(eq(takeoffItems.projectId, projectId), eq(takeoffItems.origin, "drawings"), isNull(takeoffItems.deletedAt)));
    if (previous.length) {
      await tx.update(takeoffItems).set({ deletedAt: now }).where(inArray(takeoffItems.id, previous.map((p) => p.id)));
      const rowIds = previous.flatMap((p) => (p.billItemId ? [p.billItemId] : []));
      if (bill && !bill.signedAt && rowIds.length) {
        // Only rows it added itself – no agent proposal behind them – on the draft still open.
        await tx.delete(runItems).where(and(eq(runItems.runId, bill.id), inArray(runItems.id, rowIds), isNull(runItems.proposedDescription)));
      }
    }
    await tx.delete(takeoffParameters).where(eq(takeoffParameters.projectId, projectId));

    // ── The figures ───────────────────────────────────────────────────────────────────────
    if (m.parameters.length) {
      await tx.insert(takeoffParameters).values(
        m.parameters.map((p) => ({
          projectId,
          name: p.name,
          label: p.label,
          status: p.status,
          value: toNumeric(p.value),
          unit: p.unit,
          figure: p.figure ? `${p.figure} ${p.printedUnit}` : null,
          expression: p.expression,
          quote: p.quote,
          documentId: p.source?.documentId ?? null,
          page: p.source?.page ?? null,
          assumption: p.assumption,
        })),
      );
    }

    // ── The sheets ────────────────────────────────────────────────────────────────────────
    const [top] = await tx.select({ max: sql<number | null>`max(${takeoffItems.number})` }).from(takeoffItems).where(eq(takeoffItems.projectId, projectId));
    let number = top?.max ?? 0;
    const written: { id: string; section: string | null; element: ElementId | null; description: string; unit: string; total: string; note: string | null }[] = [];
    for (const item of m.items) {
      const note = item.assumptions.length
        ? `Rests on assumed ${item.assumptions.map((a) => { const p = labelOf.get(a); return p ? `${p.label.toLowerCase()} (${p.figure} ${p.printedUnit})` : a; }).join(", ")} – confirm before pricing.`
        : null;
      const unit = billUnit(item.unit);
      const [row] = await tx
        .insert(takeoffItems)
        .values({ projectId, number: ++number, section: item.section, description: item.description, unit, drawingId: m.drawings[0]?.id ?? null, origin: "drawings", note, createdBy: session.email })
        .returning({ id: takeoffItems.id });
      await tx.insert(takeoffDimensions).values(
        item.lines.map((line, i) => ({
          itemId: row!.id,
          seq: i + 1,
          location: line.location,
          timesing: line.timesing,
          length: line.dimensions[0] ?? null,
          width: line.dimensions[1] ?? null,
          depth: line.dimensions[2] ?? null,
          deduct: line.deduct,
          working: line.working,
        })),
      );
      const sheet = measure(
        unit,
        item.lines.map((l) => ({ timesing: parseQuantity(l.timesing), dimensions: l.dimensions.map(parseQuantity), deduct: l.deduct })),
      );
      written.push({ id: row!.id, section: item.section, element: item.element, description: item.description, unit, total: billQuantity(quantityToNumeric(sheet.total)), note });
    }

    // ── The bill ──────────────────────────────────────────────────────────────────────────
    if (bill?.signedAt) {
      billReason = "The bill is signed, so the measured items stay in Take-off until it is revised.";
      return;
    }
    let runId = bill?.id ?? null;
    if (!runId) {
      const [created] = await tx
        .insert(runs)
        .values({ projectId, module: "/bill", status: "review", inputTokens: m.usage.input, outputTokens: m.usage.output, createdBy: session.email })
        .returning({ id: runs.id });
      runId = created!.id;
    }

    // Headings left with nothing under them – the last measurement's elements – go too.
    await tx.execute(sql`
      delete from run_items h
      where h.run_id = ${runId} and h.row_type = 'heading' and h.proposed_description is null
        and not exists (select 1 from run_items c where c.parent_id = h.id)`);

    const [last] = await tx.select({ seq: sql<number | null>`max(${runItems.seq})` }).from(runItems).where(eq(runItems.runId, runId));
    let seq = last?.seq ?? 0;
    const sections = [...new Set(written.map((w) => w.section ?? "Measured from the drawings"))];
    for (const section of sections) {
      const [heading] = await tx
        .insert(runItems)
        .values({ runId, seq: (seq += SEQ_STEP), rowType: "heading", overrideDescription: section, overrideBy: session.email, overrideAt: now, quantitySource: "takeoff" })
        .returning({ id: runItems.id });
      for (const w of written.filter((x) => (x.section ?? "Measured from the drawings") === section)) {
        const [row] = await tx
          .insert(runItems)
          .values({
            runId,
            seq: (seq += SEQ_STEP),
            parentId: heading!.id,
            rowType: "item",
            overrideDescription: w.description,
            overrideUnit: w.unit,
            overrideQuantity: w.total,
            overrideBy: session.email,
            overrideAt: now,
            quantitySource: "takeoff",
          })
          .returning({ id: runItems.id });
        await tx.update(takeoffItems).set({ billItemId: row!.id, sentQuantity: w.total, sentAt: now, sentBy: session.email }).where(eq(takeoffItems.id, w.id));
        // The element the agent measured it as, for the elemental cost plan – a QS can reassign it there.
        if (w.element) await tx.insert(billElements).values({ runItemId: row!.id, element: w.element, setBy: "agent" });
        billed++;
      }
    }
  });

  revalidatePath(`/projects/${projectId}`, "layout");
  const count = (s: string) => m.parameters.filter((p) => p.status === s).length;
  return {
    ok: true,
    items: m.items.length,
    lines: m.items.reduce((n, i) => n + i.lines.length, 0),
    read: count("read"),
    derived: count("derived"),
    assumed: m.parameters.filter((p) => p.status === "assumed").map((p) => ({ label: p.label, figure: p.figure, unit: p.printedUnit, assumption: p.assumption ?? "" })),
    refused: m.refused,
    gaps: m.gaps,
    billed,
    billReason,
    spend: costOf(m.usage),
    partial: m.partial,
  };
}
