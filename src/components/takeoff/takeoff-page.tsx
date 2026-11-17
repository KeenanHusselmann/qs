/**
 * Take-off for one project – the sheets and the bill rows they can feed, loaded on the server.
 */

import { notFound } from "next/navigation";

import { getProject } from "@/app/(app)/projects/actions";
import { TakeoffView } from "@/components/takeoff/takeoff-view";
import { requireSession } from "@/lib/auth";
import { billRowOptions, listParameters, listTakeoff, projectDrawings } from "@/lib/takeoff";
import { reviewBill } from "@/domain/bill-rubric";

export async function TakeoffPage({ projectId }: { projectId: string }) {
  await requireSession();
  const project = await getProject(projectId);
  if (!project) notFound();

  const [items, bill, parameters, drawings] = await Promise.all([listTakeoff(projectId), billRowOptions(projectId), listParameters(projectId), projectDrawings(projectId)]);

  /*
    What a quantity surveyor would ask, before anybody prices it.

    Run here rather than when the measurement is made, because it is a fact about what the take-off
    now holds – an item added by hand answers a finding as surely as one the agent measured, and a
    review that only ran once would go stale the moment somebody did.
  */
  const review = reviewBill(
    items.map((i) => ({ description: i.description, unit: i.unit, quantity: Number(i.total), section: i.section, assumed: i.note !== null })),
  );

  return (
    <TakeoffView
      projectId={projectId}
      projectName={project.name}
      items={items}
      billRows={bill.options}
      billSigned={bill.signed}
      billExists={bill.exists}
      parameters={parameters}
      drawings={drawings}
      review={review}
    />
  );
}
