/**
 * What a project covers — the stages it runs through.
 *
 * ── There is no new vocabulary here, and that is the point ─────────────────────────────────
 *
 * `process-model.ts` already carries **L0, the seven-phase construction value chain**, and every
 * process area declares the phase it belongs to. Every module already declares its process area
 * through its entry criteria. So `module → area → phase` resolves today, and a project's stages are
 * *those phases*, not a fourth list of names beside the nav groups, the process areas and the
 * domains.
 *
 * A second list would be the same domain fact written twice, and the two would drift the first time
 * somebody renamed one. Everything below is derived; nothing is declared.
 *
 * ── Pure data, so the dialog can import it ─────────────────────────────────────────────────
 *
 * This imports the process model, the criteria and the nav and nothing else. `chain.ts` knows the
 * same mapping but reaches it through the agent's field sets, which is a great deal of server code
 * to drag into a client component that wants a list of checkboxes.
 */

import { criteriaForModule, DEFAULT_CRITERIA } from "@/lib/entry-criteria";
import { PHASES, PROCESS_AREAS, type Phase } from "@/lib/process-model";
import { PROJECT_NAV } from "@/lib/navigation";

/** Every phase L0 names. A stored stage is one of these numbers. */
export const ALL_PHASES: readonly number[] = PHASES.map((phase) => phase.number);

const PHASE_OF_AREA = new Map(PROCESS_AREAS.map((area) => [area.code, area.phase]));

/** The process area a module executes, taken from its criteria — the same source `chain.ts` uses. */
const PROCESS_OF_MODULE = new Map(DEFAULT_CRITERIA.map((c) => [c.module, c.process]));

/**
 * Which phase a module belongs to, or nothing where it belongs to none.
 *
 * A module with no entry criteria — Project Corpus, Project Data, Pricing — has no process area and
 * therefore no phase. Those are places a project *has* rather than stages it runs through, and they
 * are never filtered away.
 */
export function phaseOfModule(module: string): number | undefined {
  const process = PROCESS_OF_MODULE.get(module);
  return process === undefined ? undefined : PHASE_OF_AREA.get(process);
}

const LABEL_OF = new Map(PROJECT_NAV.flatMap((g) => g.items).map((i) => [i.href, i.label]));

/** A stage a project can be said to cover, with the work it actually carries. */
export interface Stage extends Phase {
  /** The modules that fall in this phase, by their menu label. One list owns those spellings. */
  covers: readonly string[];
}

/**
 * The stages worth offering, which is not all seven.
 *
 * A phase carrying no built module would be a box somebody could tick to no effect — L0's *Asset &
 * Warranty* is real work and this platform does none of it yet. Offering it would promise a step
 * that does not exist, and §7.5's rule against a control that appears to do something applies to a
 * checkbox as much as to a button.
 */
export const STAGES: readonly Stage[] = PHASES.flatMap((phase) => {
  const covers = PROJECT_NAV.flatMap((group) => group.items)
    .filter((item) => item.built && phaseOfModule(item.href) === phase.number)
    .map((item) => LABEL_OF.get(item.href) ?? item.href);

  return covers.length === 0 ? [] : [{ ...phase, covers }];
});

/** Every stage this platform can run, which is what a new project covers unless somebody says less. */
export const DEFAULT_STAGES: readonly number[] = STAGES.map((stage) => stage.number);

/**
 * A project's stages, as the rest of the application should read them.
 *
 * **Null means every stage.** A project created before the column existed said nothing about which
 * stages it covered, and the honest reading of that silence is "all of them" — which is also what
 * the migration's own note records, and why there is no backfill and no phase list duplicated into
 * SQL.
 */
export function stagesOf(stored: readonly number[] | null | undefined): readonly number[] {
  return stored == null || stored.length === 0 ? DEFAULT_STAGES : stored;
}

/** Whether a module's work falls inside the stages a project covers. */
export function withinStages(
  module: string,
  stored: readonly number[] | null | undefined,
): boolean {
  const phase = phaseOfModule(module);
  // No phase means no stage gates it — Project Corpus and Project Data are always reachable.
  if (phase === undefined) return true;
  return stagesOf(stored).includes(phase);
}

/** Read a form's checked stages back into phase numbers, ignoring anything that is not one. */
export function readStages(values: readonly string[]): number[] {
  const chosen = values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && DEFAULT_STAGES.includes(value));

  // A project that covers nothing is not a project. Silence falls back to everything, which is the
  // same reading `stagesOf` gives a null column.
  return chosen.length === 0 ? [...DEFAULT_STAGES] : [...new Set(chosen)].sort((a, b) => a - b);
}

/** Kept honest: every criterion's module must resolve to a phase, or a stage would hide it. */
export const modulesWithoutAPhase = (): string[] =>
  [...new Set(DEFAULT_CRITERIA.map((c) => c.module))].filter(
    (module) => criteriaForModule(module).length > 0 && phaseOfModule(module) === undefined,
  );
