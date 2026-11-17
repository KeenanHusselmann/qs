"use server";

/**
 * Turning two-step sign-in on and off (audit C7). Every action reads who is asking from the
 * session; nobody can change another person's two-step except an administrator clearing it for a
 * lost phone, which only turns it off – it never sees or sets a key.
 */

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { canManagePeople, findActive } from "@/lib/users";
import { checkTwoStep, clearTwoStep, confirmTwoStep, startTwoStep } from "@/lib/two-step";

export type TwoStepAction = { ok: true } | { ok: false; reason: string };

async function me() {
  const session = await requireSession();
  return findActive(session.email);
}

const NO_ROW = "The environment credential has no account to add two-step sign-in to.";

export async function startMyTwoStep(): Promise<{ ok: true; key: string; qr: string } | { ok: false; reason: string }> {
  const person = await me();
  if (!person) return { ok: false, reason: NO_ROW };
  if (person.totpEnabledAt) return { ok: false, reason: "Two-step sign-in is already on." };
  return { ok: true, ...(await startTwoStep(person.id, person.email)) };
}

export async function confirmMyTwoStep(code: string): Promise<TwoStepAction> {
  const person = await me();
  if (!person) return { ok: false, reason: NO_ROW };
  if (!(await confirmTwoStep(person.id, code))) return { ok: false, reason: "That code is not right. Check the app shows this account, then try the newest code." };
  revalidatePath("/settings");
  return { ok: true };
}

/** Off again – only with a current code, so a borrowed open session cannot quietly remove it. */
export async function turnOffMyTwoStep(code: string): Promise<TwoStepAction> {
  const person = await me();
  if (!person?.totpEnabledAt) return { ok: false, reason: "Two-step sign-in is not on." };
  if (!(await checkTwoStep(person, code))) return { ok: false, reason: "That code is not right." };
  await clearTwoStep(person.id);
  revalidatePath("/settings");
  return { ok: true };
}

/** An administrator clears it for someone who lost their phone; they set it up again after. */
export async function resetTwoStepFor(id: string): Promise<TwoStepAction> {
  const session = await requireSession();
  if (!(await canManagePeople(session.email))) return { ok: false, reason: "Only an administrator can do that." };
  await clearTwoStep(id);
  revalidatePath("/settings");
  return { ok: true };
}
