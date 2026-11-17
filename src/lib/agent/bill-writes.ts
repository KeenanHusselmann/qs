/**
 * The one way a bill row is written — PLATFORM.md §1.3.1, §2.5, §5, §6.3.
 *
 * ── Why this is not in `bill-actions.ts` ───────────────────────────────────────────────────
 *
 * It was, and it was the only caller. §4.8's pricing screen is the second, and a server action file
 * cannot lend a helper to another one: every export of a `"use server"` module **is** a server
 * action, reachable from any browser that can guess its identifier. Copying the writer instead
 * would have given two implementations of "what a correction is" — one that stamps the session's
 * name and moves `quantity_source`, and one that a future edit forgets to.
 *
 * So the acts live in the action files, where they can revalidate and where the session is checked,
 * and the *writing* lives here. §2.5 asks for one path per task; this is the sentence underneath
 * that, which is that there is one path per **write**.
 *
 * ── Every figure crosses `readQuantity` / `readRate` ───────────────────────────────────────
 *
 * Including the ones a QS types. §5 is the one place in the product to be paranoid and the typing
 * hand is not exempt: `1,234` pasted out of a spreadsheet is a thousand-fold ambiguity here exactly
 * as it is when a model reads it. A cell that cannot be read with certainty is refused in words and
 * left empty, never guessed at.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { runItems, runs } from "@/db/schema";
import type { EditableCell } from "@/lib/agent/bill";
import { readQuantity, readRate } from "@/domain/amount";
import { nameOf } from "@/lib/signers";
import { runState } from "@/lib/agent/run";
import { quantityToNumeric } from "@/domain/money";

/** Done, or refused with a sentence a QS can act on. */
export type BillAction = { ok: true } | { ok: false; reason: string };

/**
 * How a figure got onto the row — §6.3.
 *
 * A boolean was enough while typing and pasting were the only two ways in. §4.8 adds two more: a
 * rate a build-up computed, and a rate taken from the firm's library — neither of which a reader
 * looking at the row could tell from a typed one, and the second of which is the difference between
 * a figure somebody chose and a figure the practice published.
 */
export type Via = "typed" | "pasted" | "build_up" | "library" | "takeoff";

/** The run, if it is this project's and still open to change. */
export async function openBill(projectId: string, runId: string) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.projectId, projectId), isNull(runs.deletedAt)))
    .limit(1);

  if (!run) return { run: null, reason: "That run is not on this project." } as const;
  if (run.signedAt) {
    return {
      run: null,
      reason: `This bill was signed off by ${await nameOf(run.signedBy)}. A signed bill cannot be changed – revise it to open a new draft that carries these figures forward.`,
    } as const;
  }

  return { run, reason: null } as const;
}

/**
 * The draft a hand-entered or measured row lands in, opened if the step has none – §1.3.3.
 *
 * "Manual entry never disappears" held for every row of a bill but not for the bill itself: the only
 * way to get one was the agent, and the agent will not start without a filed specification. So a QS
 * who measured a wall in Take-off was told to go and draft a bill, and the bill page would not let
 * them – the audit's first blocker (C1). A bill opened here is a run like any other, in `review`,
 * with no `proposed_*` on any row and no token count, because nothing read any document.
 *
 * Under an advisory lock, so two sends or a double-click open one draft rather than two – the newer
 * of two would silently become "the bill" and strand whatever was written to the other.
 *
 * A signed bill is refused rather than revised from here. Revising is a deliberate act with its own
 * button: it opens Revision B and moves the bill a downstream step will eventually read.
 */
export async function draftBillFor(
  projectId: string,
  module: string,
  by: string,
): Promise<{ ok: true; runId: string; created: boolean } | { ok: false; reason: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`bill:${projectId}:${module}`}))`);

    const [latest] = await tx
      .select({ id: runs.id, status: runs.status, signedAt: runs.signedAt, createdAt: runs.createdAt })
      .from(runs)
      .where(and(eq(runs.projectId, projectId), eq(runs.module, module), isNull(runs.deletedAt)))
      .orderBy(desc(runs.createdAt))
      .limit(1);

    if (latest?.signedAt) {
      return {
        ok: false,
        reason: "The bill is signed off. Revise it under Bill of Quantities to open a new draft, then send again.",
      } as const;
    }
    if (latest?.status === "running") {
      const [last] = await tx
        .select({ at: sql<Date | null>`max(${runItems.createdAt})` })
        .from(runItems)
        .where(eq(runItems.runId, latest.id));
      const lastWriteAt = new Date(last?.at ?? latest.createdAt).toISOString();

      if (runState({ status: "running", lastWriteAt, signedAt: null }) === "running") {
        return {
          ok: false,
          reason: "The bill is being drafted from the documents right now. Wait for it to finish, then send again.",
        } as const;
      }

      // Stalled: nothing has written to it for minutes and nothing ever will. Left "running" it would
      // refuse hand entry for good, so it is closed as what it is – a draft that stopped – and the
      // rows it did read stay, correctable and signable like any other.
      await tx
        .update(runs)
        .set({ status: "failed", error: "This draft stopped without finishing. The documents after the last row shown were not read." })
        .where(eq(runs.id, latest.id));
      return { ok: true, runId: latest.id, created: false } as const;
    }
    if (latest) return { ok: true, runId: latest.id, created: false } as const;

    const [created] = await tx
      .insert(runs)
      .values({ projectId, module, status: "review", createdBy: by })
      .returning({ id: runs.id });
    return { ok: true, runId: created!.id, created: true } as const;
  });
}

/** What one cell's value becomes in the database, or why it could not be read. */
export type CellWrite =
  | { ok: true; columns: Partial<typeof runItems.$inferInsert> }
  | { ok: false; reason: string };

/**
 * Turn what somebody typed into the columns it sets.
 *
 * An empty string **clears** the override and the agent's figure comes back — §7.4 maps `Delete` to
 * "clear cell contents", and in a grid emptying a cell is how a person says "not this". The field
 * panel refuses the same gesture because there it is a lone box where clearing could only be an
 * accident; here it is the fastest correct action in the interface.
 */
export function cellWrite(cell: EditableCell, typed: string, unit?: string | null): CellWrite {
  const value = typed.trim();

  if (value === "") {
    switch (cell) {
      case "description":
        return { ok: true, columns: { overrideDescription: null } };
      case "unit":
        return { ok: true, columns: { overrideUnit: null } };
      case "quantity":
        return { ok: true, columns: { overrideQuantity: null } };
      case "rate":
        // Paired by a check constraint: a rate without its scale is 185000 meaning either
        // R1 850,00 or R18,5000, and nothing on the row would say which.
        return { ok: true, columns: { overrideRate: null, overrideRatePrecision: null } };
    }
  }

  if (cell === "description") return { ok: true, columns: { overrideDescription: value } };
  if (cell === "unit") return { ok: true, columns: { overrideUnit: value } };

  if (cell === "quantity") {
    // The row's unit settles `12,940` on an m² row: nothing measured to whole units has three decimals.
    const reading = readQuantity(value, { unit });
    if (!reading.ok) return { ok: false, reason: reading.reason };
    return { ok: true, columns: { overrideQuantity: quantityToNumeric(reading.quantity) } };
  }

  const reading = readRate(value);
  if (!reading.ok) return { ok: false, reason: reading.reason };
  return {
    ok: true,
    columns: {
      overrideRate: reading.rate.value,
      overrideRatePrecision: reading.rate.precision,
    },
  };
}

/**
 * Write one row's overrides, keeping the attribution and both sources honest.
 *
 * `override_by` is cleared when the last override on a row goes, so a row that has been corrected
 * and then fully reverted does not go on claiming somebody touched it. And each source follows its
 * own **figure** rather than the gesture: reverting a hand-typed quantity gives the agent's back,
 * and the row should say so (§6.3). The two are tracked apart because they move apart — a QS pastes
 * a column of quantities and builds up the rates.
 *
 * Nothing here computes an amount. §5.2's single rounding point is the trigger in
 * `0010_run_items.sql`, so the extension arrives with the row it belongs to.
 */
export async function writeOverrides(
  itemId: string,
  columns: Partial<typeof runItems.$inferInsert>,
  by: string,
  via: Via,
): Promise<boolean> {
  const [before] = await db.select().from(runItems).where(eq(runItems.id, itemId)).limit(1);
  if (!before) return false;

  const after = { ...before, ...columns };

  const stillOverridden =
    after.overrideDescription !== null ||
    after.overrideUnit !== null ||
    after.overrideQuantity !== null ||
    after.overrideRate !== null;

  // A build-up never writes a quantity, so it can never be a quantity's source. If one ever did,
  // the honest answer would still be one of these two, which is why this is not `via` passed on.
  const handSource = via === "pasted" ? ("imported" as const) : ("manual" as const);

  // A quantity sent from dimension sheets is measured – a different claim from typed. A write that
  // does not touch the quantity (a rate typed later) keeps whatever source the quantity already had.
  const quantitySource =
    columns.overrideQuantity === undefined && after.overrideQuantity !== null
      ? before.quantitySource
      : after.overrideQuantity !== null
      ? via === "takeoff"
        ? ("takeoff" as const)
        : handSource
      : after.proposedQuantity !== null
        ? ("ai_derived" as const)
        : before.quantitySource;

  const rateSource =
    after.overrideRate !== null
      ? via === "build_up"
        ? ("build_up" as const)
        : via === "library"
          ? ("library" as const)
          : handSource
      : after.proposedRate !== null
        ? ("ai_derived" as const)
        : before.rateSource;

  await db
    .update(runItems)
    .set({
      ...columns,
      quantitySource,
      rateSource,
      overrideBy: stillOverridden ? by : null,
      overrideAt: stillOverridden ? new Date() : null,
    })
    .where(eq(runItems.id, itemId));

  return true;
}
