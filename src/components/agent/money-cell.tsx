/**
 * §7.4's money cell: right-aligned, tabular, 2dp, negatives as `(1 234,56)` in `--err-500`.
 *
 * One definition, because two screens render amounts off the same rows — the bill (§4.7) and
 * pricing (§4.8) — and a column of money that is set in proportional digits on one of them is the
 * kind of defect no browser suite has any text to fail on. `globals.test.ts` records the last time
 * that happened: `.num` was asked for by twenty-four elements and declared nowhere.
 */

import { formatMoney, money } from "@/domain/money";

export function MoneyCell({ minorUnits, bold = false }: { minorUnits: string | null; bold?: boolean }) {
  if (minorUnits === null) {
    // Not nought. An item nobody has measured and an item measured at zero are different facts, and
    // the sign-off gate refuses the first by name.
    return <span className="t-sm text-[var(--n-400)]">—</span>;
  }

  const amount = money(BigInt(minorUnits));

  return (
    <span
      className={`num ${bold ? "font-semibold" : ""} ${
        amount < 0n ? "text-[var(--err-500)]" : "text-[var(--n-800)]"
      }`}
    >
      {formatMoney(amount, { accounting: true })}
    </span>
  );
}
