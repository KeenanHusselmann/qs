/**
 * The process model — the generic construction delivery model, L0 to L4.
 *
 * The selection lives in the query string so every level is a URL; see `process-model-view.tsx`.
 * Static data, identical for everyone, and no project in it: which of a project's steps can start is
 * `readinessOfModule`'s job on the module page, not this page's.
 */

import { requireSession } from "@/lib/auth";
import { ProcessModelView, type Selection } from "@/components/process/process-model-view";

export const metadata = { title: "Process model" };

export default async function ProcessPage({ searchParams }: PageProps<"/process">) {
  await requireSession();
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const selection: Selection = {
    phase: one(params.phase),
    domain: one(params.domain),
    area: one(params.area),
    sp: one(params.sp),
    task: one(params.task),
    q: one(params.q),
  };

  return <ProcessModelView selection={selection} />;
}
