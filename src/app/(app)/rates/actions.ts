"use server";

/**
 * Reading and adding to the firm's rate library — PLATFORM.md §4.5, §4.8, §6.3.
 *
 * ── Only async functions live here ─────────────────────────────────────────────────────────
 *
 * A `"use server"` module may export nothing else. A synchronous predicate beside the actions
 * broke the module at load once already and returned 500 on every page including login, so the
 * shape and the rules are in `lib/rates.ts` — which also keeps them reachable from the client half
 * without dragging `db` into the browser bundle.
 *
 * ── Appended, never overwritten ────────────────────────────────────────────────────────────
 *
 * The same model as `assumptions`, for the same reason and one more: a price is a fact about a
 * date, and the rate a signed bill was priced against has to stay readable to argue a certificate
 * two years later. So there is no update action. Repricing an item files a new row; withdrawing
 * one stamps `deleted_at`.
 */

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { rates, resourceFactors } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { displayRate, parseRate, problemsWith, type LibraryRate } from "@/lib/rates";
import { readCsv, readRateSheet } from "@/lib/rate-import";
import type { ResourceFactor } from "@/lib/factors";
import { COMPONENT_KINDS, type ComponentKind } from "@/lib/pricing";
import { readWorkbookGrids } from "@/lib/ingest/xlsx";
import { SIMULATED_DATE, SIMULATED_RATES, SIMULATED_SOURCE } from "@/lib/simulated-rates";

/** Every rate on file, newest first. The screen narrows it; the rule for "in force" is shared. */
export async function listRates(): Promise<LibraryRate[]> {
  await requireSession();

  const rows = await db
    .select()
    .from(rates)
    .where(isNull(rates.deletedAt))
    .orderBy(desc(rates.effectiveDate), desc(rates.createdAt));

  return rows.map((r) => ({
    id: r.id,
    trade: r.trade,
    description: r.description,
    unit: r.unit,
    rate: r.rate,
    ratePrecision: r.ratePrecision,
    region: r.region,
    source: r.source,
    effectiveDate: r.effectiveDate,
    createdBy: r.createdBy,
  }));
}

/**
 * File a rate.
 *
 * Refuses rather than guesses, and the refusal names what to do — the same `problemsWith` the form
 * shows before submitting, so the client cannot be the only thing enforcing it.
 */
export async function fileRate(form: FormData): Promise<{ error?: string }> {
  const session = await requireSession();

  const draft = {
    description: String(form.get("description") ?? ""),
    unit: String(form.get("unit") ?? ""),
    rate: String(form.get("rate") ?? ""),
    source: String(form.get("source") ?? ""),
    effectiveDate: String(form.get("effectiveDate") ?? ""),
  };

  const problems = problemsWith(draft);
  if (problems.length > 0) return { error: problems.join(" ") };

  const parsed = parseRate(draft.rate);
  if (!parsed) return { error: "Enter the rate as a number — 1 850, or 1 850,25." };

  const trade = String(form.get("trade") ?? "").trim();
  const region = String(form.get("region") ?? "").trim();

  await db.insert(rates).values({
    // Empty means unclassified, which is a fact — not an empty string pretending to be a trade.
    trade: trade === "" ? null : trade,
    description: draft.description.trim(),
    unit: draft.unit.trim(),
    rate: parsed.value,
    ratePrecision: parsed.precision,
    region: region === "" ? null : region,
    source: draft.source.trim(),
    effectiveDate: draft.effectiveDate,
    createdBy: session.email,
  });

  revalidatePath("/rates");
  return {};
}

/**
 * Withdraw a rate — stop offering it, without pretending it was never used.
 *
 * §6.1: never hard-delete. A bill priced from this rate still cites it, and the row is what that
 * citation resolves against.
 */
export async function withdrawRate(id: string): Promise<void> {
  await requireSession();

  await db
    .update(rates)
    .set({ deletedAt: new Date() })
    .where(and(sql`${rates.id} = ${id}`, isNull(rates.deletedAt)));

  revalidatePath("/rates");
}

/** One row of a preview, already display-shaped so no bigint crosses the boundary. */
export interface PreviewRow {
  line: number;
  trade: string;
  description: string;
  unit: string;
  rate: string;
  region: string;
  source: string;
  effectiveDate: string;
  problems: string[];
}

export interface Preview {
  sheets: { name: string; rows: PreviewRow[]; importable: number }[];
  warning?: string;
}

/**
 * Read a schedule and say what it would file — without filing any of it.
 *
 * ── Why the file is parsed twice ───────────────────────────────────────────────────────────
 *
 * This returns rows to look at; `commitImport` re-reads the same file and writes what *it* parses.
 * The client never hands back drafts. A preview is a claim about a file, and letting the browser
 * post the rows it says it saw would make the writing path trust a number nobody re-checked —
 * which is the whole thing §1.3.1 is built to prevent, arriving through a side door.
 */
export async function previewImport(form: FormData): Promise<Preview> {
  await requireSession();
  return read(form);
}

/** Both paths read the file exactly one way. */
async function read(form: FormData): Promise<Preview> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { sheets: [], warning: "Choose a file to import." };
  }

  const defaults = {
    source: String(form.get("source") ?? "").trim(),
    effectiveDate: String(form.get("effectiveDate") ?? "").trim(),
  };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const csv = /\.csv$/i.test(file.name);

  const grids = csv
    ? { sheets: [{ name: file.name, grid: readCsv(new TextDecoder().decode(bytes)) }] }
    : readWorkbookGrids(bytes);

  if ("warning" in grids && grids.warning) return { sheets: [], warning: grids.warning };

  const sheets = grids.sheets
    .map(({ name, grid }) => {
      const { header, rows } = readRateSheet(grid, defaults);
      if (!header) return null;

      return {
        name,
        importable: rows.filter((r) => r.draft).length,
        rows: rows.map((r) => ({
          line: r.line,
          trade: r.draft?.trade ?? "",
          description: r.draft?.description ?? (grid[r.line - 1]?.[header.columns.indexOf("description")] ?? ""),
          unit: r.draft?.unit ?? "",
          rate: r.draft ? displayRate(r.draft) : "",
          region: r.draft?.region ?? "",
          source: r.draft?.source ?? "",
          effectiveDate: r.draft?.effectiveDate ?? "",
          problems: r.problems,
        })),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (sheets.length === 0) {
    return {
      sheets: [],
      // §7.7 — say what to do next. "No header row" alone sends nobody anywhere.
      warning:
        "No sheet here has a row naming a description and a rate. The header can sit under a title " +
        "or a blank line, but those two columns have to be named.",
    };
  }

  return { sheets };
}

/**
 * File the rows a schedule yields.
 *
 * Only the readable ones. A row the preview refused is left out rather than filed with a gap —
 * §1.3, an item nobody could read is never written as though somebody had.
 */
export async function commitImport(form: FormData): Promise<{ filed: number; error?: string }> {
  const session = await requireSession();

  const preview = await read(form);
  if (preview.warning) return { filed: 0, error: preview.warning };

  const wanted = String(form.get("sheet") ?? "");
  const sheet = preview.sheets.find((s) => s.name === wanted) ?? preview.sheets[0];
  if (!sheet) return { filed: 0, error: "Nothing in that file could be read as a rate schedule." };

  // Re-read rather than trust the preview's shaping: this is the path that writes.
  const file = form.get("file") as File;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const defaults = {
    source: String(form.get("source") ?? "").trim(),
    effectiveDate: String(form.get("effectiveDate") ?? "").trim(),
  };

  const grids = /\.csv$/i.test(file.name)
    ? [{ name: file.name, grid: readCsv(new TextDecoder().decode(bytes)) }]
    : readWorkbookGrids(bytes).sheets;

  const grid = grids.find((g) => g.name === sheet.name)?.grid ?? [];
  const drafts = readRateSheet(grid, defaults).rows.flatMap((r) => (r.draft ? [r.draft] : []));

  if (drafts.length === 0) return { filed: 0, error: "No row in that sheet could be filed." };

  await db.insert(rates).values(drafts.map((d) => ({ ...d, createdBy: session.email })));

  revalidatePath("/rates");
  return { filed: drafts.length };
}

/**
 * Every resource factor on file, newest first — what the practice has written down about how much
 * of a resource a unit of work consumes.
 *
 * Beside the rates rather than in a module of its own because they are read together and answer
 * halves of one question: the factor says *how much*, the rate says *what it costs*. The rule for
 * which factors are in force lives in `lib/factors.ts`, out of this `"use server"` module, for the
 * reason given at the top of this file.
 */
export async function listFactors(): Promise<ResourceFactor[]> {
  await requireSession();

  const rows = await db
    .select()
    .from(resourceFactors)
    .where(isNull(resourceFactors.deletedAt))
    .orderBy(desc(resourceFactors.effectiveDate), desc(resourceFactors.createdAt));

  return rows.map((r) => ({
    id: r.id,
    work: r.work,
    workUnit: r.workUnit,
    kind: r.kind,
    resource: r.resource,
    resourceUnit: r.resourceUnit,
    quantity: r.quantity,
    wasteRate: r.wasteRate,
    region: r.region,
    source: r.source,
    effectiveDate: r.effectiveDate,
  }));
}

/** What went wrong with a factor somebody typed, in their words. Empty means it is fit to file. */
function factorProblems(f: NewFactor): string[] {
  const problems: string[] = [];

  if (f.work.trim().length < 3) problems.push("Say what work this is a factor for.");
  if (f.workUnit.trim().length === 0) problems.push("Give the unit that work is measured in.");
  if (f.resource.trim().length < 2) problems.push("Name the resource.");
  if (f.resourceUnit.trim().length === 0) problems.push("Give the resource's unit.");
  if (!COMPONENT_KINDS.includes(f.kind)) problems.push("Choose what kind of resource it is.");

  // A quantity is the whole point of the row, and a nought factor consumes nothing — which is a
  // statement nobody means to file. §1.3: refuse it rather than storing a row that does nothing.
  const quantity = Number(String(f.quantity).replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    problems.push("The quantity must be a figure greater than nought.");
  }

  if (f.wasteRate.trim() !== "") {
    const waste = Number(f.wasteRate.replace(",", "."));
    // Entered as a percentage, held as a fraction. Over a hundred is a decimal in the wrong form.
    if (!Number.isFinite(waste) || waste < 0 || waste > 100) {
      problems.push("Waste is a percentage between nought and a hundred.");
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.effectiveDate)) problems.push("Give the date it applies from.");
  // §6.3 — a factor nobody can attribute is a factor nobody can defend.
  if (f.source.trim().length < 2) problems.push("Say where the factor came from.");

  return problems;
}

export interface NewFactor {
  work: string;
  workUnit: string;
  kind: ComponentKind;
  resource: string;
  resourceUnit: string;
  quantity: string;
  /** As a percentage the way somebody types it — "5". Stored as the fraction 0,0500. */
  wasteRate: string;
  region: string;
  source: string;
  effectiveDate: string;
}

export type FactorOutcome = { ok: true } | { ok: false; problems: string[] };

/**
 * File a factor.
 *
 * An insert, never an update — the same rule the rates follow (§6.3). Revising a factor files a
 * new row with a later effective date, so a take-off done last March can still be reproduced on
 * the assumptions that applied then.
 */
export async function addFactor(factor: NewFactor): Promise<FactorOutcome> {
  const session = await requireSession();

  const problems = factorProblems(factor);
  if (problems.length > 0) return { ok: false, problems };

  await db.insert(resourceFactors).values({
    work: factor.work.trim(),
    workUnit: factor.workUnit.trim(),
    kind: factor.kind,
    resource: factor.resource.trim(),
    resourceUnit: factor.resourceUnit.trim(),
    quantity: String(Number(String(factor.quantity).replace(",", "."))),
    /*
      Typed as a percentage, stored as the fraction §5.1 asks for: 5 becomes 0,0500.

      Empty stays null rather than becoming nought — "no allowance stated" and "no allowance" are
      different claims, and only the first should fall back to the method's own.
    */
    wasteRate:
      factor.wasteRate.trim() === ""
        ? null
        : String(Number(factor.wasteRate.replace(",", ".")) / 100),
    region: factor.region.trim() === "" ? null : factor.region.trim(),
    source: factor.source.trim(),
    effectiveDate: factor.effectiveDate,
    createdBy: session.email,
  });

  revalidatePath("/rates");
  return { ok: true };
}

/** Withdraw a factor. Marked, never removed — §6.1, and it is a different act from revising one. */
export async function withdrawFactor(id: string): Promise<void> {
  await requireSession();

  await db
    .update(resourceFactors)
    .set({ deletedAt: new Date() })
    .where(and(eq(resourceFactors.id, id), isNull(resourceFactors.deletedAt)));

  revalidatePath("/rates");
}

/**
 * Load the simulated rate set – for testing the advisor, pricing and take-off before a practice has
 * filed its own. Rows already loaded are not loaded twice; every row carries SIMULATED_SOURCE.
 */
export async function loadSimulatedRates(): Promise<{ loaded: number }> {
  const session = await requireSession();
  const held = await db
    .select({ description: rates.description, region: rates.region })
    .from(rates)
    .where(and(eq(rates.source, SIMULATED_SOURCE), isNull(rates.deletedAt)));
  const key = (d: string, r: string | null) => `${d}|${r ?? ""}`;
  const have = new Set(held.map((h) => key(h.description, h.region)));
  const rows = SIMULATED_RATES.filter((r) => !have.has(key(r.description, r.region))).flatMap((r) => {
    const parsed = parseRate(r.rate);
    return parsed
      ? [{ trade: r.trade, description: r.description, unit: r.unit, rate: parsed.value, ratePrecision: parsed.precision, region: r.region, source: SIMULATED_SOURCE, effectiveDate: SIMULATED_DATE, createdBy: session.email }]
      : [];
  });
  if (rows.length > 0) await db.insert(rates).values(rows);
  revalidatePath("/rates");
  return { loaded: rows.length };
}

/** Withdraw every simulated rate – marked withdrawn, never deleted, like any other rate. */
export async function withdrawSimulatedRates(): Promise<{ withdrawn: number }> {
  await requireSession();
  const done = await db
    .update(rates)
    .set({ deletedAt: new Date() })
    .where(and(eq(rates.source, SIMULATED_SOURCE), isNull(rates.deletedAt)))
    .returning({ id: rates.id });
  revalidatePath("/rates");
  return { withdrawn: done.length };
}
