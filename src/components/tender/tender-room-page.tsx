/**
 * The Tender Room for one project – loaded on the server.
 */

import { notFound } from "next/navigation";

import { getProject } from "@/app/(app)/projects/actions";
import { TenderRoomView } from "@/components/tender/tender-room-view";
import { requireSession } from "@/lib/auth";
import { loadTenderRoom } from "@/lib/tender-room";

export async function TenderRoomPage({ projectId }: { projectId: string }) {
  await requireSession();
  const project = await getProject(projectId);
  if (!project) notFound();
  return <TenderRoomView projectId={projectId} projectName={project.name} projectCode={project.code ?? null} data={await loadTenderRoom(projectId)} now={new Date().toISOString()} />;
}
