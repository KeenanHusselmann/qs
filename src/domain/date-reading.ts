/**
 * Reading a date out of a document's own words – the programme's counterpart to `amount.ts`.
 *
 * ── The failure this guards against is the same one, in a different column ──────────────────
 *
 * `08/12/2026` is the eighth of December to a South African reader and the twelfth of August to
 * an American one. A programme read the wrong way round is four months out, looks entirely
 * ordinary, and is what a liquidated damages claim is argued from. So the rule is the same as for
 * a separator: **read what is certain, refuse what is not, and say why in words.**
 *
 * What is certain:
 *   - ISO, `2026-08-12` – the one form with no convention to argue about.
 *   - A written month, `12 Aug 2026`, `12 August 2026`, `Aug 12, 2026`, `12-Aug-26` – the month is
 *     a word, so the two numbers can only be the day and the year.
 *   - Numeric day first, `12/08/2026`, `12.08.2026`, `12-08-2026` – the convention every South
 *     African contract, programme and certificate uses (§7.7 prints dates this way for that reason).
 *     A "month" over twelve is refused rather than swapped: a document that wrote `08/14/2026` is
 *     not using this convention, and reading it as if it were would be wrong on every other date
 *     in it too.
 *
 * A two-digit year reads as 2000–2099. No programme on this platform dates from the last century,
 * and MS Project exports write `12/08/26` by default.
 */

export type DateReading =
  | { readonly ok: true; readonly date: string; readonly text: string }
  | { readonly ok: false; readonly reason: string; readonly text: string };

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** `2026-08-12`, from parts that have been checked to exist. */
function assemble(day: number, month: number, year: number, text: string): DateReading {
  const fullYear = year < 100 ? 2000 + year : year;
  if (month < 1 || month > 12) {
    return { ok: false, reason: `"${text}" has a month of ${month}, and there are twelve.`, text };
  }
  if (day < 1 || day > daysIn(fullYear, month)) {
    return { ok: false, reason: `"${text}" names day ${day} of a month with ${daysIn(fullYear, month)} days.`, text };
  }
  const iso = `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { ok: true, date: iso, text };
}

/**
 * Read a date from text. The `date` returned is ISO `YYYY-MM-DD`, the form the database column
 * holds and the only one nothing downstream has to interpret.
 */
export function readDate(text: string | null | undefined): DateReading {
  const original = (text ?? "").trim();
  const refuse = (reason: string): DateReading => ({ ok: false, reason, text: original });
  if (original === "") return refuse("There is no date here.");

  // A weekday in front is decoration – "Mon 12/08/26" is how MS Project prints a date.
  const body = original.replace(/^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i, "").trim();

  // ISO first: nothing to decide.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(body);
  if (iso) return assemble(Number(iso[3]), Number(iso[2]), Number(iso[1]), original);

  // Day, written month, year: "12 Aug 2026", "12 August 2026", "12-Aug-26", "12 Aug '26".
  const dmy = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([a-z]+)\.?[\s\-/.,]+'?(\d{2}|\d{4})$/i.exec(body);
  if (dmy) {
    const month = MONTHS[dmy[2].toLowerCase()];
    if (month === undefined) return refuse(`"${dmy[2]}" is not a month this can read.`);
    return assemble(Number(dmy[1]), month, Number(dmy[3]), original);
  }

  // Written month first: "Aug 12, 2026", "August 12 2026".
  const mdy = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+'?(\d{2}|\d{4})$/i.exec(body);
  if (mdy) {
    const month = MONTHS[mdy[1].toLowerCase()];
    if (month === undefined) return refuse(`"${mdy[1]}" is not a month this can read.`);
    return assemble(Number(mdy[2]), month, Number(mdy[3]), original);
  }

  // Numeric, day first – the South African convention, and the only numeric order read.
  const numeric = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(body);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    if (month > 12 && day <= 12) {
      return refuse(
        `"${original}" reads month first – ${month} is not a month. Dates here are read day first, as South African documents write them, so this one is left for you to type.`,
      );
    }
    return assemble(day, month, Number(numeric[3]), original);
  }

  // Month and year only – "Aug 2026" – is a period, not a date, and a programme needs a day.
  if (/^[a-z]+\.?\s+\d{4}$/i.test(body)) return refuse(`"${original}" names a month, not a day.`);

  return refuse(`"${original}" is not a date this can read.`);
}

/** Whole days from one ISO date to another, negative when `to` is earlier. */
export function daysFrom(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/** An ISO date moved by whole days. */
export function plusDays(date: string, days: number): string {
  const at = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days));
  return at.toISOString().slice(0, 10);
}

/** The first day of the month an ISO date falls in. */
export const monthOf = (date: string): string => `${date.slice(0, 7)}-01`;

/** The first day of the month after. */
export function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
}
