/**
 * The Tender Room's rules – issuing a tender, its addenda, receiving returns and opening them
 * (D1.3, the part before the comparison).
 *
 * ── The closing time is the rule everything else follows ───────────────────────────────────
 *
 * A tender received after the closing time is late, and a late tender is not opened with the
 * others – it is recorded, unopened, and the practice decides what the conditions of tender allow
 * (usually: returned unopened). So lateness is a fact computed from two timestamps, never a box
 * somebody ticks, and it is decided to the minute: 12:00 closing, 12:01 received is late.
 *
 * Tenders are opened once, and only at or after the closing time: opening early would let a price
 * leak before every tenderer has had their chance. The opening register lists the on-time sums
 * lowest first, which is the order an adjudication reads them in.
 *
 * ── An addendum binds only a tenderer who has acknowledged it ──────────────────────────────
 *
 * Every tenderer is sent every addendum; each acknowledgement is recorded. A return from a
 * tenderer who has not acknowledged every addendum is flagged – it may have been priced on the
 * documents before the change, and the adjudication has to know that.
 */

export interface Receipt {
  inviteeId: string;
  company: string;
  /** ISO timestamp, or null where nothing has been received. */
  receivedAt: string | null;
  /** Minor units, or null where the return stated no sum (or has not arrived). */
  sum: bigint | null;
  declined: boolean;
  /** Addenda this tenderer acknowledged, by number. */
  acknowledged: readonly number[];
}

export function isLate(receivedAt: string | null, closingAt: string): boolean {
  return receivedAt !== null && Date.parse(receivedAt) > Date.parse(closingAt);
}

/** Whether tenders may be opened now – at or after the closing time, and not already opened. */
export function canOpen(closingAt: string, openedAt: string | null, now: Date = new Date()): { ok: true } | { ok: false; reason: string } {
  if (openedAt) return { ok: false, reason: "The tenders were opened already." };
  if (now.getTime() < Date.parse(closingAt)) return { ok: false, reason: "Tenders cannot be opened before the closing time – every tenderer is entitled to the full period." };
  return { ok: true };
}

/** Addenda a tenderer has not acknowledged, by number. */
export function unacknowledged(addenda: readonly number[], acknowledged: readonly number[]): number[] {
  return addenda.filter((n) => !acknowledged.includes(n));
}

export interface OpeningRegister {
  /** On-time returns with a sum, lowest first – what is opened and read out. */
  opened: (Receipt & { rank: number; missingAddenda: number[] })[];
  /** On time but with no sum stated – opened, and recorded as not stating one. */
  noSum: Receipt[];
  /** Received after the closing time – recorded, not opened. */
  late: Receipt[];
  declined: Receipt[];
  /** Invited and never heard from. */
  noReturn: Receipt[];
}

export function openingRegister(receipts: readonly Receipt[], closingAt: string, addenda: readonly number[]): OpeningRegister {
  const onTime = receipts.filter((r) => !r.declined && r.receivedAt !== null && !isLate(r.receivedAt, closingAt));
  const opened = onTime
    .filter((r) => r.sum !== null)
    .sort((a, b) => (a.sum! < b.sum! ? -1 : a.sum! > b.sum! ? 1 : a.company.localeCompare(b.company)))
    .map((r, i) => ({ ...r, rank: i + 1, missingAddenda: unacknowledged(addenda, r.acknowledged) }));
  return {
    opened,
    noSum: onTime.filter((r) => r.sum === null),
    late: receipts.filter((r) => !r.declined && isLate(r.receivedAt, closingAt)),
    declined: receipts.filter((r) => r.declined),
    noReturn: receipts.filter((r) => !r.declined && r.receivedAt === null),
  };
}
