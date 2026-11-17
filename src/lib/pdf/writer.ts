/**
 * A small PDF writer.
 *
 * ── Why not a library ──────────────────────────────────────────────────────────────────────
 *
 * The platform reads PDFs with `unpdf`, which is a parser. Writing one needs a renderer, and the
 * candidates all bring a font stack and a layout engine to put text on a page — a dependency
 * production loads on every cold start, to do something the format describes in a few hundred
 * lines. This writes them directly.
 *
 * It is deliberately narrow: one font family, A4 only, no images, no line breaking beyond words.
 * That is the whole of what a cost plan, a specification or a viability report needs to be, and
 * every feature not written cannot rot.
 *
 * ── One writer, two callers ────────────────────────────────────────────────────────────────
 *
 * It started in `scripts/` for the test corpus and now renders the viability report as well. It
 * lives here rather than there because the application is the caller that matters, and a second
 * copy under `scripts/` would be the thing this codebase keeps refusing to have — two records of
 * one convention, drifting apart.
 *
 * ── WinAnsiEncoding, and why the text is transcoded ────────────────────────────────────────
 *
 * A QS document is full of `m²`, `–` and `·`, none of which are ASCII. The base-14 fonts are
 * single-byte, so the content stream must carry cp1252 and the font must declare
 * `/WinAnsiEncoding` — declare nothing and a reader may assume StandardEncoding, where `²` is not
 * present at all. Wrong in the worst way here: "48 m2" and "48 m²" are the same to a person and
 * different to an assertion.
 */

import { deflateSync } from "node:zlib";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 56;

/**
 * How far above the cursor a rule sits.
 *
 * The cursor rests on the *next* line's baseline, so a rule drawn at it is struck through the row
 * that follows. That is exactly how the cost plan first rendered — a line through "Substructure"
 * under the column headings and another through "Total construction cost", which on a cost plan
 * reads as a strikethrough on the two rows that matter most.
 *
 * Nothing caught it, because text extraction cannot see a line. It was visible only once the PDF
 * was rasterised and looked at.
 */
const RULE_LIFT = 5;

/** Characters outside cp1252 that a QS document plausibly carries, and what to write instead. */
const TRANSLITERATE = new Map<string, string>([
  ["‘", "'"],
  ["’", "'"],
  ["“", '"'],
  ["”", '"'],
  ["−", "-"],
  ["⁄", "/"],
  [" ", " "],
  [" ", " "],
  ["✓", "x"],
  ["—", "-"],
]);

/** cp1252's 0x80–0x9F window — the punctuation Latin-1 lacks, and why an en dash survives. */
const CP1252_HIGH: Readonly<Record<number, number>> = {
  0x2013: 0x96,
  0x2022: 0x95,
  0x20ac: 0x80,
  0x2026: 0x85,
};

function encode(text: string): Uint8Array {
  const out: number[] = [];

  for (const char of [...text].map((c) => TRANSLITERATE.get(c) ?? c).join("")) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (code <= 0xff) out.push(code);
    else out.push(CP1252_HIGH[code] ?? 0x3f); // '?' — visible, not a hole in the sentence
  }

  return Uint8Array.from(out);
}

/**
 * A PDF *text string* for the document information dictionary – the title a viewer shows in its
 * title bar and tab.
 *
 * The title was written as raw UTF-8 inside a literal string, and PDF reads a text string as
 * PDFDocEncoding unless it starts with a UTF-16BE byte-order mark (ISO 32000-1 §7.9.2.2). So every
 * report whose title carried an en dash showed "â€“" in the title bar. Plain ASCII stays a literal,
 * which every viewer reads; anything else becomes a hex string in UTF-16BE behind FE FF. Hex rather
 * than an escaped literal because it needs no escaping at all.
 */
export function pdfTextString(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return `(${text.replace(/[()\\]/g, (c) => `\\${c}`)})`;
  let hex = "FEFF";
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  return `<${hex}>`;
}

/** A PDF string literal: the three characters that would otherwise end it early. */
function escapeBytes(bytes: Uint8Array): Buffer {
  const out: number[] = [];
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c);
    out.push(b);
  }
  return Buffer.from(out);
}

/** Helvetica's advance widths, /1000 em — enough to wrap a line without embedding a font. */
const WIDTHS = (() => {
  const ascii = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
    611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
    222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ];
  const map = new Map<number, number>();
  ascii.forEach((w, i) => map.set(32 + i, w));
  return map;
})();

/** Bold is wider; one factor is close enough for wrapping and keeps this honest about its scope. */
export function widthOf(text: string, size: number, bold = false): number {
  let units = 0;
  for (const b of encode(text)) units += WIDTHS.get(b) ?? 556;
  return (units / 1000) * size * (bold ? 1.06 : 1);
}

export interface Cell {
  text: string | number;
  /** Offset from the left margin. */
  x: number;
  width: number;
  align?: "left" | "right";
  bold?: boolean;
  /** 0–1 grey, for a cell that carries an aside rather than a figure. */
  grey?: number;
}

export interface TextOptions {
  size?: number;
  bold?: boolean;
  gap?: number;
  indent?: number;
  width?: number;
  align?: "left" | "centre";
  /** 0–1 grey. Omitted is near-black. */
  grey?: number;
}

/** One entry in the KPI band across a cover. */
export interface BandItem {
  label: string;
  value: string;
}

/** One bar in a breakdown chart. */
export interface Bar {
  label: string;
  value: number;
  /** Written at the end of the bar — the formatted figure, not the raw one. */
  shown: string;
}

/** Called once per page at build time, when the total is finally known. */
export type FooterRenderer = (page: number, total: number) => string;

export function createPdf({ title = "Document" }: { title?: string } = {}) {
  const pages: (string | Buffer)[][] = [];
  let ops: (string | Buffer)[] = [];
  let y = A4.height - MARGIN;
  let footer: FooterRenderer | null = null;

  const textWidth = A4.width - MARGIN * 2;

  const newPage = () => {
    if (ops.length) pages.push(ops);
    ops = [];
    y = A4.height - MARGIN;
  };

  const wrap = (text: string, size: number, bold: boolean, width: number): string[] => {
    const lines: string[] = [];
    let line = "";

    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (widthOf(candidate, size, bold) <= width) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }

    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };

  const draw = (text: string, x: number, size: number, bold: boolean, grey?: number) => {
    const font = bold ? "/F2" : "/F1";
    const colour = grey === undefined ? "" : `${grey} ${grey} ${grey} rg `;
    ops.push(`BT ${colour}${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (`);
    ops.push(escapeBytes(encode(text)));
    ops.push(") Tj ET\n");
    if (grey !== undefined) ops.push("0 0 0 rg\n");
  };

  /** A filled rectangle, in page coordinates. */
  const fill = (x: number, bottom: number, width: number, height: number, grey: number) => {
    ops.push(
      `${grey} ${grey} ${grey} rg ${x.toFixed(2)} ${bottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f 0 0 0 rg\n`,
    );
  };

  /**
   * A stroked polyline, in page coordinates.
   *
   * `fill` draws the rectangles a bar chart is made of; nothing here could draw a curve, which is
   * why the report had bars and no S-curve. PDF wants a moveto, a run of linetos and a stroke —
   * `m`, `l`, `S` — with the width and grey set first.
   */
  const stroke = (
    points: readonly { x: number; y: number }[],
    { grey = 0.35, width = 1.1 }: { grey?: number; width?: number } = {},
  ) => {
    if (points.length < 2) return;

    const path = points
      .map((p, i) => `${p.x.toFixed(2)} ${p.y.toFixed(2)} ${i === 0 ? "m" : "l"}`)
      .join(" ");

    ops.push(`${grey} ${grey} ${grey} RG ${width} w ${path} S 0 0 0 RG 1 w
`);
  };

  const api = {
    /** Where the cursor is, for a caller that needs to place something precisely. */
    get cursor() {
      return y;
    },

    text(content: string, options: TextOptions = {}) {
      const { size = 10, bold = false, gap = 4, indent = 0, align = "left", grey } = options;
      const usable = (options.width ?? textWidth) - indent;

      for (const line of wrap(content, size, bold, usable)) {
        if (y < MARGIN + size) newPage();
        const x =
          align === "centre"
            ? MARGIN + indent + (usable - widthOf(line, size, bold)) / 2
            : MARGIN + indent;
        draw(line, x, size, bold, grey);
        y -= size * 1.32;
      }

      y -= gap;
      return api;
    },

    heading(content: string, { size = 12.5, gap = 6 }: { size?: number; gap?: number } = {}) {
      if (y < MARGIN + 90) newPage();
      else y -= 8;
      return api.text(content, { size, bold: true, gap });
    },

    /**
     * A row of columns at fixed offsets.
     *
     * A cell that does not fit is wrapped and the row grows, because a truncated figure in a cost
     * document is a wrong figure.
     */
    row(cells: readonly Cell[], { size = 9.5, gap = 2, bold = false, shade = false } = {}) {
      const wrapped = cells.map((cell) => wrap(String(cell.text ?? ""), size, cell.bold ?? bold, cell.width));
      const height = Math.max(...wrapped.map((w) => w.length)) * size * 1.3;

      if (y - height < MARGIN) newPage();
      const top = y;

      // Zebra behind the text, so the text is not painted over.
      if (shade) fill(MARGIN - 4, top - height + size * 0.9, textWidth + 8, height + 2, 0.955);

      cells.forEach((cell, i) => {
        y = top;
        for (const line of wrapped[i]) {
          const x =
            cell.align === "right"
              ? MARGIN + cell.x + cell.width - widthOf(line, size, cell.bold ?? bold)
              : MARGIN + cell.x;
          draw(line, x, size, cell.bold ?? bold, cell.grey);
          y -= size * 1.3;
        }
      });

      y = top - height - gap;
      return api;
    },

    rule({ gap = 6, thickness = 0.6, grey = 0.4 }: { gap?: number; thickness?: number; grey?: number } = {}) {
      if (y < MARGIN + 12) newPage();
      const at = y + RULE_LIFT;
      ops.push(
        `${thickness} w ${grey} ${grey} ${grey} RG ${MARGIN} ${at.toFixed(2)} m ${(A4.width - MARGIN).toFixed(2)} ${at.toFixed(2)} l S\n`,
      );
      y -= gap;
      return api;
    },

    /**
     * Where the cursor is, so a caller can draw down the page from here to somewhere later.
     *
     * Paired with `verticals`: a table does not know how tall it is until it has been written, so
     * the column rules are drawn afterwards, between a remembered top and wherever the rows ended.
     */
    at(): number {
      return y + RULE_LIFT;
    },

    /**
     * Vertical rules down a table, from a remembered `top` to the cursor.
     *
     * ── Why a bill needs them ──────────────────────────────────────────────────────────────
     *
     * A bill of quantities is read as a ruled grid, and every bill a quantity surveyor has ever
     * been sent is boxed: the eye tracks down the amount column without re-reading the
     * description beside it. Horizontal rules alone make the same figures read as a web table —
     * correct, and not what the document is.
     *
     * `xs` are offsets from the left margin, matching the caller's own column geometry, so the
     * rules land on the boundaries the cells were laid out against rather than near them.
     */
    verticals(xs: readonly number[], top: number, { thickness = 0.6, grey = 0.55 }: { thickness?: number; grey?: number } = {}) {
      const bottom = y + RULE_LIFT;
      if (bottom >= top) return api;
      for (const x of xs) {
        const at = MARGIN + x;
        ops.push(
          `${thickness} w ${grey} ${grey} ${grey} RG ${at.toFixed(2)} ${top.toFixed(2)} m ${at.toFixed(2)} ${bottom.toFixed(2)} l S\n`,
        );
      }
      return api;
    },

    /**
     * The KPI band across a cover — v3's, and it is the first thing a reader looks at.
     *
     * A value that is not established is passed through as words by the caller, never as a nought.
     */
    band(items: readonly BandItem[], { height = 34 }: { height?: number } = {}) {
      if (items.length === 0) return api;
      if (y - height < MARGIN) newPage();

      const columnWidth = textWidth / items.length;
      const top = y;

      fill(MARGIN, top - height + 10, textWidth, height, 0.955);

      items.forEach((item, i) => {
        const centre = MARGIN + columnWidth * i + columnWidth / 2;

        y = top - 4;
        draw(item.value, centre - widthOf(item.value, 12, true) / 2, 12, true);

        y = top - 17;
        draw(item.label.toUpperCase(), centre - widthOf(item.label.toUpperCase(), 6.5, false) / 2, 6.5, false, 0.35);
      });

      y = top - height - 6;
      return api;
    },

    /**
     * A horizontal bar breakdown.
     *
     * Bars rather than a pie, and not for want of ambition: a reader compares lengths far more
     * accurately than angles, and an elemental cost analysis is exactly a comparison. It also draws
     * with rectangles, which can be asserted numerically — a pie drawn with bezier arcs could only
     * ever be checked by eye.
     */
    bars(rows: readonly Bar[], { labelWidth = 150, height = 11, gap = 5 } = {}) {
      const largest = Math.max(...rows.map((r) => r.value), 0);
      if (largest <= 0) return api;

      /*
        The chart moves to the next page whole rather than breaking across one.

        It first rendered with Substructure alone at the foot of a page and the other seven
        elements overleaf, which is not a chart — the whole value of bars is that the lengths are
        compared against each other in one glance, and a reader cannot compare across a page turn.
        Each bar is also measured against the largest, so half a chart is half a scale with
        nothing on the page to say so.
      */
      const needed = rows.length * (height + gap) + 8;
      if (y - needed < MARGIN) newPage();

      const shownWidth = 90;
      const track = textWidth - labelWidth - shownWidth - 12;

      for (const bar of rows) {
        if (y - height < MARGIN) newPage();

        const baseline = y - height + 3;
        draw(bar.label, MARGIN, 8.5, false);

        fill(MARGIN + labelWidth, baseline, track, height - 3, 0.93);
        fill(MARGIN + labelWidth, baseline, Math.max((bar.value / largest) * track, 1), height - 3, 0.55);

        draw(
          bar.shown,
          MARGIN + labelWidth + track + shownWidth + 12 - widthOf(bar.shown, 8.5, false),
          8.5,
          false,
        );

        y -= height + gap;
      }

      y -= 4;
      return api;
    },

    /**
     * Two series over time — the construction industry's own chart.
     *
     * Cumulative cost against cumulative revenue, where the vertical gap between the curves *is*
     * the funding requirement. A QS cost report is read on this before it is read on any table,
     * and the report had no way to draw one until `stroke` existed.
     *
     * Values arrive in minor units; the axis is labelled in millions, because a rand axis on a
     * R1bn scheme is nine digits repeated five times.
     */
    curves(
      series: readonly { name: string; points: readonly number[]; grey: number }[],
      { height = 150, label = (v: number) => String(v) }: { height?: number; label?: (v: number) => string } = {},
    ) {
      const longest = Math.max(...series.map((s) => s.points.length), 0);
      if (longest < 2) return api;

      // The chart moves whole, for `bars`'s reason: half a chart is half a scale.
      if (y - (height + 34) < MARGIN) newPage();

      const top = Math.max(...series.flatMap((s) => s.points), 0);
      if (top <= 0) return api;

      const plotLeft = MARGIN + 52;
      const plotWidth = textWidth - 52;
      const bottom = y - height;

      // Three gridlines and their labels. More would be a grid; fewer would be a scale nobody
      // can read a value off.
      for (const fraction of [0, 0.5, 1]) {
        const at = bottom + fraction * height;
        ops.push(`0.9 0.9 0.9 RG 0.5 w ${plotLeft} ${at.toFixed(2)} m ${(plotLeft + plotWidth).toFixed(2)} ${at.toFixed(2)} l S 0 0 0 RG 1 w
`);

        const was = y;
        y = at - 2.5;
        draw(label(top * fraction), MARGIN, 7.5, false, 0.45);
        y = was;
      }

      for (const line of series) {
        stroke(
          line.points.map((value, i) => ({
            x: plotLeft + (i / (longest - 1)) * plotWidth,
            y: bottom + (value / top) * height,
          })),
          { grey: line.grey, width: 1.2 },
        );
      }

      y = bottom - 12;

      // A key, because two unlabelled curves is a picture rather than a chart.
      let at = plotLeft;
      for (const line of series) {
        fill(at, y + 1.5, 10, 2, line.grey);
        const was = y;
        y = was;
        draw(line.name, at + 14, 8, false, 0.3);
        at += 14 + widthOf(line.name, 8, false) + 16;
      }

      y -= 14;
      return api;
    },

    /**
     * A tornado — variables ranked by how far they move the answer, widest first.
     *
     * Bars run left and right of a centre line. It is the chart a development appraisal is read
     * on, because a single NPV says nothing about which assumption it is hostage to, and the
     * sorted shape answers that at a glance.
     */
    tornado(
      rows: readonly { label: string; low: number; high: number; shown: string }[],
      { labelWidth = 150, height = 12, gap = 6 } = {},
    ) {
      const widest = Math.max(...rows.flatMap((r) => [Math.abs(r.low), Math.abs(r.high)]), 0);
      if (widest <= 0) return api;

      if (y - (rows.length * (height + gap) + 20) < MARGIN) newPage();

      const shownWidth = 84;
      const track = textWidth - labelWidth - shownWidth - 12;
      const centre = MARGIN + labelWidth + track / 2;
      const half = track / 2;

      const first = y;

      for (const row of rows) {
        const baseline = y - height + 3;
        draw(row.label, MARGIN, 8.5, false);

        // Adverse left in the darker grey, favourable right in the lighter — the same order the
        // screen uses, so a reader who has seen one recognises the other.
        const left = Math.min(row.low, 0) / widest * half;
        const right = Math.max(row.high, 0) / widest * half;

        if (left < 0) fill(centre + left, baseline, -left, height - 4, 0.42);
        if (right > 0) fill(centre, baseline, right, height - 4, 0.68);

        draw(
          row.shown,
          MARGIN + labelWidth + track + shownWidth + 12 - widthOf(row.shown, 8.5, false),
          8.5,
          false,
          0.35,
        );

        y -= height + gap;
      }

      // The centre line last, over the bars, so the base case is unmistakable.
      ops.push(`0.25 0.25 0.25 RG 0.7 w ${centre.toFixed(2)} ${(first + 2).toFixed(2)} m ${centre.toFixed(2)} ${(y + gap).toFixed(2)} l S 0 0 0 RG 1 w
`);

      y -= 4;
      return api;
    },

    /**
     * Break the page now if `height` will not fit on it.
     *
     * For a heading and the block it belongs to. The chart already moves whole, but its label was
     * written before it and stayed behind — a page ending with 'Elemental breakdown' and nothing
     * under it, and a chart overleaf with no title. Each part was doing the right thing alone.
     */
    reserve(height: number) {
      if (y - height < MARGIN) newPage();
      return api;
    },

    /**
     * How much vertical space is left on this page.
     *
     * Added for the Bill of Quantities, which cannot let `row()` break the page for it. A bill
     * carries its running total across every break — "Carried forward" at the foot, "Brought
     * forward" at the head — and those two lines have to be *drawn* at the break, which a caller
     * can only do if it decides where the break is. Everything else here is happy to be paginated
     * for it and still is.
     */
    remaining(): number {
      return y - MARGIN;
    },

    /**
     * What `row()` would take, without drawing it.
     *
     * The same wrap and the same arithmetic, so a caller measuring a row and then drawing it cannot
     * disagree with the drawing about how tall it was — which on a bill would put a carried-forward
     * line one row too early or one too late, and the two totals would not reconcile.
     */
    rowHeight(cells: readonly Cell[], { size = 9.5, bold = false } = {}): number {
      const wrapped = cells.map((cell) =>
        wrap(String(cell.text ?? ""), size, cell.bold ?? bold, cell.width),
      );
      return Math.max(...wrapped.map((w) => w.length)) * size * 1.3;
    },

    space(amount = 8) {
      y -= amount;
      return api;
    },

    page() {
      newPage();
      return api;
    },

    /**
     * A footer drawn on every page once the total is known.
     *
     * "Page 3 of 11" cannot be written while page 3 is being composed, because nothing yet knows
     * there are eleven. v3 solves this with a canvas subclass that defers the draw; this defers it
     * to `build`, which is the same trick with less machinery.
     */
    footerOnEveryPage(render: FooterRenderer) {
      footer = render;
      return api;
    },

    build(): Buffer {
      if (ops.length) pages.push(ops);

      const objects: (Buffer | null)[] = [];
      const add = (body: Buffer | null) => {
        objects.push(body);
        return objects.length; // 1-based, matching the object numbers written below
      };

      add(null); // 1 — catalog
      add(null); // 2 — page tree
      const font = add(
        Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
      );
      const fontBold = add(
        Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
      );

      const pageIds: number[] = [];

      pages.forEach((pageOps, index) => {
        const all = [...pageOps];

        if (footer) {
          const line = footer(index + 1, pages.length);
          const at = MARGIN - 22;
          all.push(
            `BT 0.45 0.45 0.45 rg /F1 7.5 Tf 1 0 0 1 ${MARGIN} ${at.toFixed(2)} Tm (`,
            escapeBytes(encode(line)),
            ") Tj ET 0 0 0 rg\n",
          );
        }

        const stream = deflateSync(
          Buffer.concat(all.map((op) => (Buffer.isBuffer(op) ? op : Buffer.from(op, "latin1")))),
        );

        const contentId = add(
          Buffer.concat([
            Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
            stream,
            Buffer.from("\nendstream"),
          ]),
        );

        pageIds.push(
          add(
            Buffer.from(
              `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width.toFixed(2)} ${A4.height.toFixed(2)}] ` +
                `/Resources << /Font << /F1 ${font} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`,
            ),
          ),
        );
      });

      objects[0] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");
      objects[1] = Buffer.from(
        `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
      );

      const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
      const offsets: number[] = [];
      let length = chunks[0].length;

      objects.forEach((body, i) => {
        offsets.push(length);
        const object = Buffer.concat([
          Buffer.from(`${i + 1} 0 obj\n`),
          body ?? Buffer.from("<< >>"),
          Buffer.from("\nendobj\n"),
        ]);
        chunks.push(object);
        length += object.length;
      });

      const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
      for (const offset of offsets) xref.push(`${String(offset).padStart(10, "0")} 00000 n \n`);

      chunks.push(
        Buffer.from(
          xref.join("") +
            `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info << /Title ${pdfTextString(title)} >> >>\n` +
            `startxref\n${length}\n%%EOF\n`,
        ),
      );

      return Buffer.concat(chunks);
    },
  };

  return api;
}

export type Pdf = ReturnType<typeof createPdf>;
export const PAGE = { ...A4, margin: MARGIN, textWidth: A4.width - MARGIN * 2 };
