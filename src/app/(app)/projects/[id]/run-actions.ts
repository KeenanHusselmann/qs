"use server";

/**
 * Correcting a run, and signing it — PLATFORM.md §1.3.1.
 *
 * ── The three acts, and why they are only three ────────────────────────────────────────────
 *
 * A run proposes, a person corrects, a signature freezes. There is deliberately no fourth act for
 * "accept this row as it stands": §1.3.1's table has four maps and none of them is an approval per
 * field, and a per-row tick would be state with no consumer — ten clicks a QS must make before the
 * one click that means something. Signing the run *is* accepting what is not corrected.
 *
 * ── Everything here refuses in words ───────────────────────────────────────────────────────
 *
 * The database refuses too, with triggers, and that is the guarantee — an application check is
 * something a future writer can forget to make. But a trigger's refusal is a stack trace, and the
 * person reading it came here to sign a cost model. So both: a sentence for the reader, a constraint
 * for the system.
 *
 * ── The signer's name comes from the session ───────────────────────────────────────────────
 *
 * Never from the form, for the same reason a criterion tick does not take one: a signature's whole
 * value is that it names somebody, and a name a client can post is a name anyone can put in someone
 * else's mouth.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { after } from "next/server";
import { toldSignedOff } from "@/lib/notifications";
import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { db } from "@/db/client";
import { runFields, runs } from "@/db/schema";
import { fieldRow, loadLatestRun, signedModules } from "@/lib/agent/persist";
import { carryField } from "@/lib/agent/carry";
import { blockingFields, reconciliationGap, workingValue } from "@/lib/agent/run";
import { checkFieldValue, kindOf } from "@/lib/agent/field-kinds";
import { nameOf } from "@/lib/signers";
import { fieldsFor, upstreamPending } from "@/lib/chain";

/**
 * Done, or refused with a sentence a QS can act on. `needsNote` marks the one refusal a written
 * reason clears: money that does not reconcile (audit C3).
 */
export type RunAction = { ok: true } | { ok: false; reason: string; needsNote?: boolean };

/** The run, if it is this project's and still open to change. */
async function openFor(projectId: string, runId: string) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.projectId, projectId), isNull(runs.deletedAt)))
    .limit(1);

  if (!run) return { run: null, reason: "That run is not on this project." } as const;
  if (run.signedAt) {
    return {
      run: null,
      reason: `This run was signed off by ${await nameOf(run.signedBy)}. A signed run cannot be changed — run the step again to propose new figures.`,
    } as const;
  }

  return { run, reason: null } as const;
}

/**
 * The QS's own figure for a field.
 *
 * It lands in `overrides` and the agent's proposal stays exactly where it was — which is the point
 * of there being two maps. The screen shows the human's value because `working` is human-wins, and
 * the machine's answer stays visible underneath it so a reviewer can see what was changed and by
 * how much.
 */
export async function correctField(
  projectId: string,
  runId: string,
  fieldId: string,
  value: string,
  reason: string,
): Promise<RunAction> {
  const session = await requireSession();

  const corrected = value.trim();
  if (!corrected) {
    // Not the same act. Clearing a correction restores the agent's figure, which is a decision
    // somebody might not mean to make by emptying a box.
    return { ok: false, reason: "A correction needs a value. To go back to the agent's figure, revert it." };
  }

  const { run, reason: refusal } = await openFor(projectId, runId);
  if (!run) return { ok: false, reason: refusal };

  // Typed like the field it fills (C4): "421000" is not a list of tenderers.
  const spec = fieldsFor(run.module).find((field) => field.id === fieldId);
  const check = checkFieldValue(kindOf(fieldId), corrected, spec?.unit);
  if (!check.ok) return { ok: false, reason: check.reason };

  const written = await db
    .update(runFields)
    .set({
      overrideValue: corrected,
      overrideReason: reason.trim() || null,
      overrideBy: session.email,
      overrideAt: new Date(),
    })
    .where(and(eq(runFields.runId, runId), eq(runFields.fieldId, fieldId)))
    .returning({ id: runFields.id });

  if (written.length === 0) {
    return { ok: false, reason: "That field is not part of this run." };
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/** Drop a correction and go back to what the agent said. The proposal was never touched. */
export async function revertField(
  projectId: string,
  runId: string,
  fieldId: string,
): Promise<RunAction> {
  await requireSession();

  const { run, reason } = await openFor(projectId, runId);
  if (!run) return { ok: false, reason };

  await db
    .update(runFields)
    .set({ overrideValue: null, overrideReason: null, overrideBy: null, overrideAt: null })
    .where(and(eq(runFields.runId, runId), eq(runFields.fieldId, fieldId)));

  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * Open a run to fill by hand – no document, no agent (audit C2).
 *
 * Every step could only be fed by uploading and running extraction, so a QS who had the unit count
 * from a client call, or wanted to type a certificate, could not. This opens the same run the agent
 * would – `review`, one row per field, the same correct-and-sign path – with nothing proposed: each
 * row is a gap that says it was entered by hand, and the QS's figure lands in `overrides` with their
 * name on it, exactly as a correction does. No token count, because nothing was read.
 *
 * Two gates still hold. A figure **carried** from an upstream step comes from that step's signature
 * and is never typed again (§1.3.1), so an unsigned upstream refuses this as it refuses the agent.
 * And a draft already open is corrected in place rather than replaced by an empty one.
 *
 * One transaction under an advisory lock: the run and all its fields arrive together, so a reader
 * never meets a hand-entry run with half its rows, and a double-click opens one run.
 */
export async function enterByHand(projectId: string, module: string): Promise<RunAction> {
  const session = await requireSession();

  const specs = fieldsFor(module);
  if (specs.length === 0) return { ok: false, reason: "This step has no figures to enter." };

  const waiting = upstreamPending(module, await signedModules(projectId));
  if (waiting.length > 0) {
    return {
      ok: false,
      reason: `This step carries figures from ${waiting.join(", ")}, which ${waiting.length === 1 ? "is" : "are"} not signed off yet. Sign ${waiting.length === 1 ? "it" : "them"} first.`,
    };
  }

  // Read before the transaction: carrying is a read of other runs, and holding the lock across it
  // would only make a second click wait longer for the same refusal.
  const results = await Promise.all(
    specs.map(async (field) =>
      field.carriedFrom
        ? carryField(projectId, { ...field, carriedFrom: field.carriedFrom })
        : {
            result: {
              field,
              state: "not_found" as const,
              value: null,
              citation: null,
              confidence: 0,
              note: "Entered by hand – no document was read for this run.",
            },
            carried: undefined,
          },
    ),
  );

  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`run:${projectId}:${module}`}))`);

    const [latest] = await tx
      .select({ signedAt: runs.signedAt })
      .from(runs)
      .where(and(eq(runs.projectId, projectId), eq(runs.module, module), isNull(runs.deletedAt)))
      .orderBy(desc(runs.createdAt))
      .limit(1);
    if (latest && !latest.signedAt) {
      return { ok: false, reason: "This step already has a draft. Correct its figures in place." } as const;
    }

    const [run] = await tx
      .insert(runs)
      .values({ projectId, module, status: "review", createdBy: session.email })
      .returning({ id: runs.id });
    await tx.insert(runFields).values(results.map(({ result, carried }, seq) => fieldRow(run!.id, seq, result, carried)));
    return { ok: true } as const;
  });

  if (!outcome.ok) return outcome;
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/**
 * Freeze the run — §1.3.1, the act the whole chain hangs from.
 *
 * `working` is copied into `output` for every field and the run is stamped with the signer's name.
 * From that moment the row is immutable and a downstream step can read it, which are the same fact
 * stated twice: what makes the output safe to read is that nobody can change it afterwards.
 *
 * ── The order inside the transaction is load-bearing ───────────────────────────────────────
 *
 * Outputs first, signature last. The freeze trigger on `run_fields` refuses any write to a field
 * whose run is signed, so stamping the run first would lock the outputs out of their own sign-off.
 * One transaction, because a run that is signed with half its outputs written is worse than one
 * that is not signed at all.
 *
 * ── Two people signing at once ─────────────────────────────────────────────────────────────
 *
 * The check below reads before it writes, so it can be raced. The trigger is what actually settles
 * it: the second transaction's update to `runs` finds a row that is already signed and raises, and
 * everything it wrote rolls back with it. The check exists to give the first-past reader a sentence
 * instead of an exception, not to be the guarantee.
 */
export async function signOffRun(projectId: string, runId: string, note = ""): Promise<RunAction> {
  const session = await requireSession();

  const { run, reason } = await openFor(projectId, runId);
  if (!run) return { ok: false, reason };

  if (run.status === "running") {
    return { ok: false, reason: "This run is still reading. Wait for it to finish before signing it." };
  }

  const loaded = await loadLatestRun(projectId, run.module);
  if (!loaded || loaded.id !== runId) {
    // A newer run exists. Signing the older one would freeze figures the reader is not looking at.
    return { ok: false, reason: "A newer run has been started for this step. Reload to see it." };
  }

  /**
   * §1.3's integrity rule, at the point where it costs something. A required field with no working
   * value would freeze a gap that every downstream step reads as an approved answer, so the
   * signature is refused and the fields are named — the fix is to correct them by hand or to file
   * the missing document and run again, and both are in the reader's hands.
   */
  // Judged against the step's **own** field set. Defaulting to the feasibility one would let a cost
  // plan be signed with its total missing, because "total construction cost" is not a field the
  // feasibility estimate has and a check that cannot see a field cannot block on it.
  const blocked = blockingFields(loaded.fields, fieldsFor(run.module));
  if (blocked.length > 0) {
    const names = blocked.map((b) => b.label).join(", ");
    return {
      ok: false,
      reason: `${names} ${blocked.length === 1 ? "has" : "have"} no value. Correct ${blocked.length === 1 ? "it" : "them"} by hand, or file the document and run the step again — a signed output with a gap in it reads downstream as an approved figure.`,
    };
  }

  /*
    Money that does not add up is signed only with a reason (audit C3). The reason is part of what
    is signed – written in the same update as the signature, frozen with it, printed with it – so a
    reader of the report sees why R392 800 is missing rather than discovering it.
  */
  const gap = reconciliationGap(loaded.fields, fieldsFor(run.module));
  const written = note.trim().slice(0, 1000);
  if (gap && !written) {
    return { ok: false, needsNote: true, reason: `${gap} Correct a figure, or sign with a written reason – it prints with the signature.` };
  }

  try {
    await db.transaction(async (tx) => {
      for (const field of loaded.fields) {
        await tx
          .update(runFields)
          .set({ outputValue: workingValue(field) })
          .where(and(eq(runFields.runId, runId), eq(runFields.fieldId, field.fieldId)));
      }

      await tx
        .update(runs)
        // A note on a run that reconciles is not stored: there is nothing it explains.
        .set({ signedBy: session.email, signedAt: new Date(), signoffNote: gap ? written : null })
        .where(eq(runs.id, runId));
    });
  } catch (error) {
    // The trigger's own words, which name the run and its signer, are more use than "failed".
    return {
      ok: false,
      reason: `The run was not signed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  revalidatePath(`/projects/${projectId}`, "layout");
  // The team hears it was signed – after the response, so telling them never costs the signature.
  after(() => toldSignedOff(projectId, run.module, session.email).catch((e) => console.error("[notifications]", e)));
  return { ok: true };
}
