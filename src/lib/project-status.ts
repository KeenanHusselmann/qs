/**
 * Project statuses and how they read.
 *
 * Kept out of the server-action file: a `"use server"` module may only export async functions, and
 * exporting this map from there failed at runtime with
 * *"A 'use server' file can only export async functions, found object."*
 *
 * Which is the right constraint — everything exported from such a file is a callable endpoint, and
 * a lookup table is not one.
 */

export const PROJECT_STATUSES = [
  "estimating",
  "tendering",
  "in_contract",
  "final_account",
  "closed",
  "archived",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** The enum values are snake_case; nobody should ever see that. */
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  estimating: "Estimating",
  tendering: "Tendering",
  in_contract: "In contract",
  final_account: "Final account",
  closed: "Closed",
  archived: "Archived",
};
