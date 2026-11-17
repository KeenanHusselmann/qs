/**
 * What a directory entry can be — constants only, and no database import.
 *
 * ── Why this is not in `contacts.ts` ───────────────────────────────────────────────────────
 *
 * The form that files a contact is a client component and needs the list of kinds. `contacts.ts`
 * imports `db`, so importing the list from there pulled the database client into the browser
 * bundle and returned 500 on every page in the app, including login — a whole-app failure from a
 * constant. Anything a client component needs lives here, where nothing server-only can follow it.
 */

/** The kinds a practice actually distinguishes, in the order a directory is read. */
export const CONTACT_KINDS = [
  "client",
  "consultant",
  "contractor",
  "supplier",
  "authority",
] as const;

export type ContactKind = (typeof CONTACT_KINDS)[number];

export const KIND_LABEL: Readonly<Record<ContactKind, string>> = {
  client: "Client",
  consultant: "Consultant",
  contractor: "Contractor",
  supplier: "Supplier",
  authority: "Authority",
};

/** What each kind is for, so somebody filing an entry picks the right one. */
export const KIND_NOTE: Readonly<Record<ContactKind, string>> = {
  client: "Who the work is done for. A viability report is addressed to one.",
  consultant: "Architects, engineers, town planners — the professional team.",
  contractor: "Who builds it. Tender enquiries and payment certificates go here.",
  supplier: "Where rates and material prices come from.",
  authority: "Municipalities and statutory bodies. Approvals and tariffs.",
};

export const isContactKind = (value: string): value is ContactKind =>
  (CONTACT_KINDS as readonly string[]).includes(value);
