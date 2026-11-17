/**
 * Forget a saved web finding – the "Forget this" button under a remembered answer.
 *
 * A note can be wrong, or out of date in a way its date does not show, and the reader who sees it
 * is the one placed to say so. Soft-deleted (`forgetNote`): it stops being recalled, and what the
 * advisor once said from it is still on record.
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { forgetNote } from "@/lib/memory/notes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "No such note" }, { status: 404 });

  const forgotten = await forgetNote(id);
  return forgotten
    ? NextResponse.json({ forgotten: true })
    : NextResponse.json({ error: "No such note, or it was already forgotten" }, { status: 404 });
}
