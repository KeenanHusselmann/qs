/**
 * Project management items – what they are, what each kind asks for, and how an input is read.
 *
 * ── Why construction kinds, and not a generic ticket ───────────────────────────────────────
 *
 * A QS or project manager does not chase "tickets". They chase an RFI the architect has not answered,
 * a snag the contractor has not closed, an instruction nobody has priced, a risk on the programme,
 * a submittal waiting for review. Each is a task at heart – a title, an owner, a date, a status – and
 * each carries the two or three facts that make it that kind of thing. Those facts are declared here
 * once, so the form, the list and the validation agree about them.
 *
 * Pure: no database and no React. `work-actions.ts` writes; the views render; this decides.
 */

export const WORK_ITEM_TYPES = ["task", "rfi", "snag", "instruction", "risk", "submittal"] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export const WORK_ITEM_STATUSES = ["todo", "in_progress", "waiting", "done"] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

export const TYPE_LABEL: Readonly<Record<WorkItemType, string>> = {
  task: "Task",
  rfi: "RFI",
  snag: "Snag / defect",
  instruction: "Instruction to action",
  risk: "Risk",
  submittal: "Submittal",
};

export const STATUS_LABEL: Readonly<Record<WorkItemStatus, string>> = {
  todo: "To do",
  in_progress: "In progress",
  // The column construction work actually sits in: with the architect, the contractor, the client.
  waiting: "Waiting on others",
  done: "Done",
};

export const PRIORITY_LABEL: Readonly<Record<WorkItemPriority, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/** One extra fact a kind of item carries. */
export interface DetailField {
  key: string;
  label: string;
  kind: "text" | "longtext" | "date" | "choice";
  choices?: readonly { value: string; label: string }[];
  required?: boolean;
  hint?: string;
}

const LEVEL = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

/** What each kind asks for beyond a title. The form, the detail view and `readItemInput` read this. */
export const DETAIL_FIELDS: Readonly<Record<WorkItemType, readonly DetailField[]>> = {
  task: [],
  rfi: [
    { key: "question", label: "Question", kind: "longtext", required: true, hint: "What needs answering, in the words you would send." },
    { key: "raisedTo", label: "Raised to", kind: "text", hint: "The consultant or party who must answer, e.g. Architect." },
    { key: "response", label: "Response", kind: "longtext" },
    { key: "answeredOn", label: "Answered on", kind: "date" },
  ],
  snag: [
    { key: "location", label: "Location", kind: "text", required: true, hint: "Block, unit and room, e.g. Block C, unit 14, kitchen." },
    { key: "trade", label: "Trade", kind: "text", hint: "E.g. Tiling, Electrical." },
  ],
  instruction: [
    { key: "reference", label: "Instruction reference", kind: "text", required: true, hint: "E.g. CI-017 or SI-004." },
    { key: "issuedBy", label: "Issued by", kind: "text" },
  ],
  risk: [
    { key: "likelihood", label: "Likelihood", kind: "choice", choices: LEVEL, required: true },
    { key: "impact", label: "Impact", kind: "choice", choices: LEVEL, required: true },
    { key: "mitigation", label: "Mitigation", kind: "longtext" },
  ],
  submittal: [
    { key: "reference", label: "Submittal reference", kind: "text", required: true },
    {
      key: "outcome",
      label: "Review outcome",
      kind: "choice",
      choices: [
        { value: "pending", label: "Pending review" },
        { value: "approved", label: "Approved" },
        { value: "approved_with_comments", label: "Approved with comments" },
        { value: "rejected", label: "Rejected – resubmit" },
      ],
    },
  ],
};

/** A risk's rating, likelihood by impact – the one derived figure an item carries. */
export function riskRating(details: Readonly<Record<string, string>>): "low" | "medium" | "high" | null {
  const score = { low: 1, medium: 2, high: 3 } as const;
  const l = score[details.likelihood as keyof typeof score];
  const i = score[details.impact as keyof typeof score];
  if (!l || !i) return null;
  const product = l * i;
  return product >= 6 ? "high" : product >= 3 ? "medium" : "low";
}

/** What a form sends, before it is trusted. */
export interface ItemInput {
  type: string;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  /** "user:<email>" or "contact:<uuid>", or empty for nobody. One field, so both can never be set. */
  assignee?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  module?: string | null;
  documentId?: string | null;
  details?: Readonly<Record<string, unknown>> | null;
}

/** A checked item, ready to write. */
export interface CheckedItem {
  type: WorkItemType;
  title: string;
  description: string | null;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeEmail: string | null;
  assigneeContactId: string | null;
  startDate: string | null;
  dueDate: string | null;
  module: string | null;
  documentId: string | null;
  details: Record<string, string>;
}

export type ItemReading = { ok: true; item: CheckedItem } | { ok: false; errors: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const isDate = (value: string) => ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * Read an item from a form, or say every field that is wrong.
 *
 * `modules` is the list of step paths an item may link to – passed in, so this stays free of the
 * navigation and a test can name its own. Every error is returned at once, keyed by field, so a form
 * can mark all of them rather than one per submit.
 */
export function readItemInput(input: ItemInput, modules: readonly string[]): ItemReading {
  const errors: Record<string, string> = {};

  const type = input.type as WorkItemType;
  if (!WORK_ITEM_TYPES.includes(type)) errors.type = "Choose what kind of item this is.";

  const title = clean(input.title, 200);
  if (!title) errors.title = "Give the item a title.";

  const status = (input.status || "todo") as WorkItemStatus;
  if (!WORK_ITEM_STATUSES.includes(status)) errors.status = "That is not a status.";

  const priority = (input.priority || "medium") as WorkItemPriority;
  if (!WORK_ITEM_PRIORITIES.includes(priority)) errors.priority = "That is not a priority.";

  let assigneeEmail: string | null = null;
  let assigneeContactId: string | null = null;
  const assignee = clean(input.assignee, 320);
  if (assignee.startsWith("user:")) assigneeEmail = assignee.slice(5).toLowerCase() || null;
  else if (assignee.startsWith("contact:") && UUID.test(assignee.slice(8))) assigneeContactId = assignee.slice(8);
  else if (assignee) errors.assignee = "Choose somebody from the list.";

  const startDate = clean(input.startDate, 10) || null;
  const dueDate = clean(input.dueDate, 10) || null;
  if (startDate && !isDate(startDate)) errors.startDate = "That is not a date.";
  if (dueDate && !isDate(dueDate)) errors.dueDate = "That is not a date.";
  if (startDate && dueDate && isDate(startDate) && isDate(dueDate) && startDate > dueDate) {
    errors.dueDate = "The due date is before the start date.";
  }

  const step = clean(input.module, 80) || null;
  if (step && !modules.includes(step)) errors.module = "That is not a step in this platform.";

  const documentId = clean(input.documentId, 40) || null;
  if (documentId && !UUID.test(documentId)) errors.documentId = "That is not a document.";

  // Only the fields this kind declares are kept; anything else a form sends is dropped.
  const details: Record<string, string> = {};
  for (const field of WORK_ITEM_TYPES.includes(type) ? DETAIL_FIELDS[type] : []) {
    const value = clean(input.details?.[field.key], field.kind === "longtext" ? 4000 : 200);
    if (!value) {
      if (field.required) errors[`details.${field.key}`] = `${field.label} is needed for this kind of item.`;
      continue;
    }
    if (field.kind === "date" && !isDate(value)) {
      errors[`details.${field.key}`] = "That is not a date.";
      continue;
    }
    if (field.kind === "choice" && !field.choices?.some((c) => c.value === value)) {
      errors[`details.${field.key}`] = "Choose from the list.";
      continue;
    }
    details[field.key] = value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    item: {
      type,
      title,
      description: clean(input.description, 8000) || null,
      status,
      priority,
      assigneeEmail,
      assigneeContactId,
      startDate,
      dueDate,
      module: step,
      documentId,
      details,
    },
  };
}

/**
 * Where a card lands between two others on a board: the midpoint of their ranks.
 *
 * A double gives roughly fifty halvings between two neighbours before they collide, far more than a
 * column is ever reordered by hand – and a collision only means two cards share a rank and sort by
 * number, which is harmless.
 */
export function rankBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}

/** Whether an open item is past its due date, on a given day (ISO date). */
export const isOverdue = (item: { status: WorkItemStatus; dueDate: string | null }, today: string): boolean =>
  item.status !== "done" && item.dueDate !== null && item.dueDate < today;

/** Days between two ISO dates. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** An ISO date plus a number of days. */
export const addDays = (from: string, days: number): string =>
  new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The window a timeline draws: from the earliest date to the latest, padded to whole weeks starting
 * on a Monday, and never narrower than four weeks so a single item is not a bar the width of the page.
 */
export function timelineWindow(
  items: readonly { startDate: string | null; dueDate: string | null }[],
  today: string,
): { from: string; to: string; weeks: number } {
  const dates = items.flatMap((i) => [i.startDate, i.dueDate]).filter((d): d is string => d !== null);
  const earliest = [today, ...dates].sort()[0];
  const latest = [today, ...dates].sort().at(-1)!;

  const weekday = (new Date(`${earliest}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const from = addDays(earliest, -weekday);
  const span = daysBetween(from, latest) + 1;
  const weeks = Math.max(4, Math.ceil(span / 7));
  return { from, to: addDays(from, weeks * 7 - 1), weeks };
}
