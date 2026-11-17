/**
 * Measuring on a drawing – what a mark is, and the figure it stands for.
 *
 * A mark is clicked on a sheet: a run of points for a length, a closed outline for an area, a set of
 * points for a count. It is stored in the sheet's own coordinates (PDF points, 1/72 inch) with the
 * scale that turns them into metres, so the figure can always be worked again from the marks – and
 * the server does work it again, rather than trusting a number sent from a browser.
 *
 * Each mark becomes an ordinary dimension line, so the sheet's arithmetic, its checks and "Send to
 * bill" are the ones that already exist. The line keeps its mark, which is what lets a QS click a
 * line and see what on the drawing it was measured from.
 */

export type MarkKind = "length" | "area" | "count";

export interface Mark {
  documentId: string;
  /** One-based, as a reader names a sheet. */
  page: number;
  kind: MarkKind;
  /** Sheet coordinates in PDF points, y downwards as drawn on screen. */
  points: readonly (readonly [number, number])[];
  /** Metres on site per PDF point – from the sheet's scale or a two-point calibration. */
  metresPerUnit: number;
}

/** One PDF point, in metres on the paper. */
export const PDF_POINT_METRES = 0.0254 / 72;

/** The metres a PDF point stands for on a sheet plotted at 1:`scale`. */
export const metresPerUnitAtScale = (scale: number): number => PDF_POINT_METRES * scale;

/** From two points a known real distance apart – for a scan, or a sheet whose stated scale is wrong. */
export function calibrate(a: readonly [number, number], b: readonly [number, number], metres: number): number | null {
  const units = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return units > 0 && metres > 0 ? metres / units : null;
}

export function polylineLength(points: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return total;
}

/** The shoelace area of a closed outline, whichever way round it was clicked. */
export function polygonArea(points: readonly (readonly [number, number])[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

/** Metres, square metres, or a count – the figure the mark stands for on site. */
export function measureMark(mark: Pick<Mark, "kind" | "points" | "metresPerUnit">): number {
  const s = mark.metresPerUnit;
  if (mark.kind === "length") return polylineLength(mark.points) * s;
  if (mark.kind === "area") return polygonArea(mark.points) * s * s;
  return mark.points.length;
}

const MIN_POINTS: Record<MarkKind, number> = { length: 2, area: 3, count: 1 };
const MAX_POINTS = 2000;

/** A mark as posted from a browser, checked before anything is worked from it. */
export function readMark(input: unknown): { ok: true; mark: Mark } | { ok: false; reason: string } {
  const refuse = (reason: string) => ({ ok: false as const, reason });
  if (typeof input !== "object" || input === null) return refuse("No mark was sent.");
  const m = input as Record<string, unknown>;

  if (typeof m.documentId !== "string" || !/^[0-9a-f-]{36}$/i.test(m.documentId)) return refuse("The mark names no drawing.");
  if (!Number.isInteger(m.page) || (m.page as number) < 1) return refuse("The mark names no sheet.");
  if (m.kind !== "length" && m.kind !== "area" && m.kind !== "count") return refuse("A mark is a length, an area or a count.");
  if (typeof m.metresPerUnit !== "number" || !Number.isFinite(m.metresPerUnit) || m.metresPerUnit <= 0 || m.metresPerUnit > 1) {
    return refuse("Set the drawing's scale before measuring.");
  }
  if (!Array.isArray(m.points) || m.points.length > MAX_POINTS) return refuse("The mark's points could not be read.");
  const points: [number, number][] = [];
  for (const p of m.points) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return refuse("The mark's points could not be read.");
    }
    points.push([p[0] as number, p[1] as number]);
  }
  if (points.length < MIN_POINTS[m.kind]) {
    return refuse(m.kind === "length" ? "A length needs two points." : m.kind === "area" ? "An area needs three points." : "Click what you are counting.");
  }

  return { ok: true, mark: { documentId: m.documentId, page: m.page as number, kind: m.kind, points, metresPerUnit: m.metresPerUnit } };
}
