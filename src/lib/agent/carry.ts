/**
 * Carrying one figure from an upstream step's signature – PLATFORM.md §1.3.1.
 *
 * A carried field is never read again: it comes from the upstream run's frozen `output`, with the
 * citation it was originally read from. Two ways open a field run – the agent and hand entry – and
 * both carry through here, so a cost plan's unit count is the feasibility estimate's signed figure
 * whichever way the cost plan was started.
 *
 * `loadSignedOutput` filters on `signed_at is not null`, so an unsigned upstream has nothing to give.
 * Both callers refuse to start while one is unsigned, which is exactly why it is worth the query
 * saying so as well.
 */

import { labelOf } from "@/lib/chain";
import { loadSignedOutput } from "@/lib/agent/persist";
import type { FieldResult, FieldSpec } from "@/lib/agent/run";

export interface Carried {
  result: FieldResult;
  /** Where it travelled from – absent when the upstream signed without establishing it. */
  carried?: { via: string; fromRunId: string };
}

export async function carryField(projectId: string, field: FieldSpec & { carriedFrom: NonNullable<FieldSpec["carriedFrom"]> }): Promise<Carried> {
  const { module, fieldId } = field.carriedFrom;
  const figure = (await loadSignedOutput(projectId, module)).get(fieldId);

  if (!figure) {
    return {
      result: {
        field,
        state: "not_found",
        value: null,
        citation: null,
        confidence: 0,
        note: `${labelOf(module)} was signed off without establishing this, so there is nothing to carry. Correct it by hand here, or run that step again.`,
      },
    };
  }

  return {
    result: {
      field,
      state: "found",
      value: figure.value,
      citation: figure.citation,
      // Not the model's confidence: a person signed this. Re-reporting a machine's uncertainty over
      // a figure that has been approved would understate it.
      confidence: 1,
    },
    carried: { via: module, fromRunId: figure.runId },
  };
}
