/**
 * Reading a rate schedule — PLATFORM.md §5.4, §12.
 *
 * This is the path every external price takes into the platform, because none of the industry
 * sources offers an API. A column read one place to the left files a rate under the wrong province
 * at the wrong price, and nothing on screen would say so — which is why the header detection and
 * the refusals are asserted rather than eyeballed.
 */

import { describe, expect, it } from "vitest";

import { fieldOf, findHeader, readCsv, readRateSheet } from "./rate-import";

const DEFAULTS = { source: "SAFCEC Q4 2025", effectiveDate: "2026-01-01" };

describe("what a header column names", () => {
  it("reads the spellings a real schedule uses", () => {
    expect(fieldOf("Rate (ZAR)")).toBe("rate");
    expect(fieldOf("  UNIT  ")).toBe("unit");
    expect(fieldOf("Item Description")).toBe("description");
    expect(fieldOf("Province")).toBe("region");
  });

  /** An unrecognised column is unrecognised. Assigning it by position is how a file imports wrong. */
  it("returns nothing for a column it does not know", () => {
    expect(fieldOf("Notes for the estimator")).toBeNull();
    expect(fieldOf("")).toBeNull();
  });
});

describe("finding the header", () => {
  /** A real schedule opens with a title and a blank line. Row one is not the header. */
  it("skips the preamble a real workbook carries", () => {
    const grid = [
      ["Ridgeview rate schedule 2026", "", ""],
      ["", "", ""],
      ["Description", "Unit", "Rate"],
      ["25 MPa concrete", "m3", "1850"],
    ];

    expect(findHeader(grid)?.at).toBe(2);
  });

  /**
   * A stray label above the table must not be taken for the header — the whole file would import
   * one row late, which reads as the schedule simply having one fewer rate.
   */
  it("refuses a row that does not name both a description and a rate", () => {
    const grid = [
      ["Region", "", ""],
      ["Description", "Unit", "Rate"],
    ];

    expect(findHeader(grid)?.at).toBe(1);
  });

  it("finds nothing where there is no header at all", () => {
    expect(findHeader([["a", "b"], ["c", "d"]])).toBeNull();
  });
});

describe("reading the rows", () => {
  const grid = [
    ["Trade", "Description", "Unit", "Rate", "Region"],
    ["Concrete Work", "25 MPa concrete in strip footings", "m3", "1850", "Gauteng"],
  ];

  it("reads a row into a draft, in minor units", () => {
    const { rows } = readRateSheet(grid, DEFAULTS);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.draft).toEqual({
      trade: "Concrete Work",
      description: "25 MPa concrete in strip footings",
      unit: "m3",
      rate: 185_000n,
      ratePrecision: 2,
      region: "Gauteng",
      source: "SAFCEC Q4 2025",
      effectiveDate: "2026-01-01",
    });
  });

  /** One publication, one origin and one date — asked once and applied to the sheet. */
  it("applies the file's source and date where the sheet carries none", () => {
    const { rows } = readRateSheet(grid, DEFAULTS);
    expect(rows[0]?.draft?.source).toBe("SAFCEC Q4 2025");
  });

  /** Where the file does carry them, the row wins: a schedule may collect several publications. */
  it("lets a column beat the file-wide default", () => {
    const { rows } = readRateSheet(
      [
        ["Description", "Unit", "Rate", "Source", "Effective date"],
        ["Brick walling", "m2", "485", "Supplier quote", "2025-06-01"],
      ],
      DEFAULTS,
    );

    expect(rows[0]?.draft?.source).toBe("Supplier quote");
    expect(rows[0]?.draft?.effectiveDate).toBe("2025-06-01");
  });

  /** Twelve trades would otherwise open the preview with twelve refusals to read past. */
  it("passes over a section heading without calling it a fault", () => {
    const { rows } = readRateSheet(
      [
        ["Description", "Unit", "Rate"],
        ["CONCRETE WORK", "", ""],
        ["25 MPa concrete", "m3", "1850"],
      ],
      DEFAULTS,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.draft?.description).toBe("25 MPa concrete");
  });

  /**
   * Found by driving a real schedule through the screen, not by a test.
   *
   * A schedule puts its section heading in the **trade** column and leaves the description empty.
   * Skipping only on "a description and nothing else" reported each heading as a row missing three
   * fields, so a nine-row file previewed four refusals where there were two — and the two that
   * mattered were buried among them.
   */
  it("passes over a heading that sits in the trade column", () => {
    const { rows } = readRateSheet(
      [
        ["Trade", "Description", "Unit", "Rate"],
        ["CONCRETE WORK", "", "", ""],
        ["Concrete Work", "35 MPa concrete in columns", "m3", "2150"],
      ],
      DEFAULTS,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.problems).toEqual([]);
  });

  it("skips a blank spacer row", () => {
    const { rows } = readRateSheet(
      [["Description", "Unit", "Rate"], ["", "", ""], ["Brick", "m2", "485"]],
      DEFAULTS,
    );
    expect(rows).toHaveLength(1);
  });

  /**
   * The assertion the preview exists for. A row that cannot be read is *returned*, with what is
   * wrong with it — dropping it would tell a practice its schedule imported cleanly.
   */
  it("returns an unreadable row rather than dropping it", () => {
    const { rows } = readRateSheet(
      [
        ["Description", "Unit", "Rate"],
        ["Brick walling", "m2", "about 485"],
      ],
      DEFAULTS,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.draft).toBeNull();
    expect(rows[0]?.problems).toEqual(['Could not read "about 485" as a rate.']);
    // And it says which line, because the reader has to go and look at it.
    expect(rows[0]?.line).toBe(2);
  });

  /** Filing a rate under the wrong province is worse than refusing the row, because it gets used. */
  it("refuses a province it cannot match exactly", () => {
    const { rows } = readRateSheet(
      [
        ["Description", "Unit", "Rate", "Region"],
        ["Brick walling", "m2", "485", "KZN"],
      ],
      DEFAULTS,
    );

    expect(rows[0]?.draft).toBeNull();
    expect(rows[0]?.problems[0]).toContain("not one of the nine provinces");
  });

  /**
   * A trade is a dimension, not a gate (§6.9) — an unknown one leaves the rate unclassified and
   * still imports it. That is the opposite of the province, and deliberately so: a wrong trade
   * mis-files a rate a reader can still see, a wrong province mis-prices a job.
   */
  it("imports a rate whose trade it does not recognise, unclassified", () => {
    const { rows } = readRateSheet(
      [
        ["Trade", "Description", "Unit", "Rate"],
        ["Brickwork & Blockwork", "Brick walling", "m2", "485"],
      ],
      DEFAULTS,
    );

    expect(rows[0]?.problems).toEqual([]);
    expect(rows[0]?.draft?.trade).toBeNull();
  });

  it("keeps a finer precision the sheet was written at", () => {
    const { rows } = readRateSheet(
      [
        ["Description", "Unit", "Rate"],
        ["PVC conduit 20mm", "m", "32,5000"],
      ],
      DEFAULTS,
    );

    expect(rows[0]?.draft?.rate).toBe(325_000n);
    expect(rows[0]?.draft?.ratePrecision).toBe(4);
  });

  it("has nothing to read when there is no header", () => {
    expect(readRateSheet([["a", "b"]], DEFAULTS)).toEqual({ header: null, rows: [] });
  });
});

describe("reading a CSV", () => {
  it("reads the ordinary case", () => {
    expect(readCsv("Description,Unit,Rate\nBrick,m2,485")).toEqual([
      ["Description", "Unit", "Rate"],
      ["Brick", "m2", "485"],
    ]);
  });

  /**
   * The commonest way this goes wrong. An Excel set to a comma decimal — the South African default
   * (§7.7) — writes semicolons, and the file then imports as a single column per row.
   */
  it("detects a semicolon delimiter rather than assuming a comma", () => {
    expect(readCsv("Description;Unit;Rate\nBrick walling, common;m2;485,25")).toEqual([
      ["Description", "Unit", "Rate"],
      ["Brick walling, common", "m2", "485,25"],
    ]);
  });

  it("reads a quoted field containing the delimiter", () => {
    expect(readCsv('Description,Rate\n"Brick walling, 220mm",485')).toEqual([
      ["Description", "Rate"],
      ["Brick walling, 220mm", "485"],
    ]);
  });

  it("reads a doubled quote inside a quoted field", () => {
    expect(readCsv('Description\n"He said ""no"""')).toEqual([["Description"], ['He said "no"']]);
  });

  it("survives Windows line endings", () => {
    expect(readCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  /** A byte-order mark on the first cell makes it match no known header word. */
  it("strips a byte-order mark", () => {
    const rows = readCsv("﻿Description,Rate\nBrick,485");
    expect(rows[0]?.[0]).toBe("Description");
  });

  /** Dense, for the same reason the grid is: a column index means the same on every row. */
  it("pads short rows so a column index is safe", () => {
    expect(readCsv("a,b,c\nd")).toEqual([
      ["a", "b", "c"],
      ["d", "", ""],
    ]);
  });
});
