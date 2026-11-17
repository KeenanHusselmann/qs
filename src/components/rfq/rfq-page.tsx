/**
 * Quotations for one project – RFQs and their responses, loaded on the server.
 */

import { notFound } from "next/navigation";

import { getProject } from "@/app/(app)/projects/actions";
import { RfqWorkspace } from "@/components/rfq/rfq-view";
import { requireSession } from "@/lib/auth";
import { loadRfqs } from "@/lib/rfq";

export async function RfqPage({ projectId }: { projectId: string }) {
  await requireSession();
  const project = await getProject(projectId);
  if (!project) notFound();
  const { rfqs, quotations, corpus } = await loadRfqs(projectId);
  return <RfqWorkspace projectId={projectId} projectName={project.name} rfqs={rfqs} quotations={quotations} corpus={corpus} />;
}
