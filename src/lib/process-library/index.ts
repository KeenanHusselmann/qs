/**
 * The generic process library — see `types.ts` for what it is and where it comes from.
 */

import { D1 } from "./d1-cost";
import { D2 } from "./d2-project";
import { D3 } from "./d3-design";
import { D4 } from "./d4-engineering";
import { D5 } from "./d5-construction";
import { D6 } from "./d6-contract";
import { D7 } from "./d7-compliance";
import { D8 } from "./d8-procurement";
import { DOMAINS, PHASES } from "./levels";
import type { Area, DomainCode, PhaseNumber, SubProcess, Task } from "./types";

export { DOMAINS, PHASES };
export { ROLES } from "./types";
export type { Area, Domain, DomainCode, Gateway, Phase, PhaseNumber, RoleCode, SubProcess, Task } from "./types";

/** Every L2 area, in domain then code order. */
export const AREAS: readonly Area[] = [...D1, ...D2, ...D3, ...D4, ...D5, ...D6, ...D7, ...D8];

export const phaseOf = (number: number) => PHASES.find((p) => p.number === number) ?? null;
export const domainOf = (code: string) => DOMAINS.find((d) => d.code === code) ?? null;
export const areaOf = (code: string) => AREAS.find((a) => a.code === code) ?? null;

export function subProcessOf(code: string): { area: Area; subProcess: SubProcess } | null {
  for (const area of AREAS) {
    const subProcess = area.subProcesses.find((s) => s.code === code);
    if (subProcess) return { area, subProcess };
  }
  return null;
}

/** Areas at the intersection of a phase and a domain; either may be omitted. */
export function areasWhere({ phase, domain }: { phase?: PhaseNumber; domain?: DomainCode }): Area[] {
  return AREAS.filter((a) => (phase === undefined || a.phase === phase) && (domain === undefined || a.domain === domain));
}

export interface Counts {
  areas: number;
  subProcesses: number;
  tasks: number;
}

export function countsOf(areas: readonly Area[]): Counts {
  const subProcesses = areas.flatMap((a) => a.subProcesses);
  return {
    areas: areas.length,
    subProcesses: subProcesses.length,
    tasks: subProcesses.reduce((n, s) => n + s.tasks.length, 0),
  };
}

/** One searchable node, with the path a reader follows to reach it. */
export interface SearchHit {
  level: "L2" | "L3" | "L4";
  code: string;
  name: string;
  area: Area;
  subProcess?: SubProcess;
  task?: Task;
}

/**
 * Everything whose name or description contains every word of the query.
 *
 * Words, not the phrase: "final account agree" should find "Final Account Agreement & Final Payment".
 */
export function searchLibrary(query: string, limit = 40): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const matches = (...texts: string[]) => {
    const haystack = texts.join(" ").toLowerCase();
    return words.every((w) => haystack.includes(w));
  };

  const hits: SearchHit[] = [];
  for (const area of AREAS) {
    if (matches(area.code, area.name, area.purpose)) hits.push({ level: "L2", code: area.code, name: area.name, area });
    for (const subProcess of area.subProcesses) {
      if (matches(subProcess.code, subProcess.name, subProcess.purpose)) {
        hits.push({ level: "L3", code: subProcess.code, name: subProcess.name, area, subProcess });
      }
      for (const task of subProcess.tasks) {
        if (matches(task.name, task.does, ...task.inputs, ...task.outputs)) {
          hits.push({ level: "L4", code: `${subProcess.code}-${task.code}`, name: task.name, area, subProcess, task });
        }
      }
    }
  }
  return hits.slice(0, limit);
}
