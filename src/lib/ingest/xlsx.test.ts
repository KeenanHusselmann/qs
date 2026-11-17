/**
 * What a workbook must never turn into.
 *
 * Every case here is a way a spreadsheet reader produces a figure that looks right and is not: a
 * superseded total from a hidden column, a formula error read as a value, a date serial sitting in
 * a column of costs as a five-digit number. A run quotes what this produces, and a QS defends it.
 */

import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { forTesting, readSheetXml, readWorkbook, sheetGrid } from "./xlsx";

const { fromSerial, presentations, sharedStrings } = forTesting;

// ── Sheets ──────────────────────────────────────────────────────────────────────────────────

const sheet = (rows: string) => `<worksheet><sheetData>${rows}</sheetData></worksheet>`;

describe("what a sheet is read as", () => {
  it("puts the sheet and the cell on every line, so a split passage still knows where it is", () => {
    const text = readSheetXml(
      sheet(
        `<row r="9"><c r="I9" t="s"><v>0</v></c><c r="J9"><v>9701795</v></c></row>` +
          `<row r="10"><c r="I10" t="s"><v>1</v></c><c r="J10"><v>27785508.59</v></c></row>`,
      ),
      "Summary",
      { shared: ["Sewer", "Water"] },
    );

    expect(text).toBe(
      "Summary!I9=Sewer | J9=9701795\nSummary!I10=Water | J10=27785508.59",
    );
  });

  it("keeps a number's own characters rather than printing a float back", () => {
    // 9852717.982 does not survive a round trip through a formatter unchanged, and the figure a run
    // quotes has to be the figure in the file.
    const text = readSheetXml(sheet(`<row r="5"><c r="C5"><v>9852717.982</v></c></row>`), "Water");
    expect(text).toBe("Water!C5=9852717.982");
  });

  it("joins the runs of a rich-text cell", () => {
    // Real: someone superscripted the 2 in "Area(m²)", so the heading is three runs. Reading the
    // first one calls that column "Area(m".
    const rich =
      `<row r="10"><c r="L10" t="s"><v>0</v></c></row>`;
    const shared = sharedStrings(
      `<sst><si><r><t>Area(m</t></r><r><t>2</t></r><r><t>)</t></r></si></sst>`,
    );

    expect(readSheetXml(sheet(rich), "Roads", { shared })).toBe("Roads!L10=Area(m2)");
  });

  it("decodes the entities a label arrives escaped as", () => {
    const shared = sharedStrings(`<sst><si><t>Roads &amp; Stormwater</t></si></sst>`);
    expect(readSheetXml(sheet(`<row r="8"><c r="I8" t="s"><v>0</v></c></row>`), "Summary", { shared }))
      .toBe("Summary!I8=Roads & Stormwater");
  });

  it("reads an inline string, which is where some exports put their text", () => {
    const text = readSheetXml(
      sheet(`<row r="3"><c r="G3" t="inlineStr"><is><t>2026-02-21</t></is></c></row>`),
      "Invoices",
    );
    expect(text).toBe("Invoices!G3=2026-02-21");
  });

  it("folds a cell's own line breaks into its row", () => {
    // A header cell holding three lines would otherwise produce two lines with no address on them.
    const shared = sharedStrings(`<sst><si><t>IT-Guru Online\nAR Aging Summary\n\nAs of 03/07/2026</t></si></sst>`);
    expect(readSheetXml(sheet(`<row r="1"><c r="A1" t="s"><v>0</v></c></row>`), "Aging", { shared }))
      .toBe("Aging!A1=IT-Guru Online AR Aging Summary As of 03/07/2026");
  });

  it("reads a boolean as a word", () => {
    expect(readSheetXml(sheet(`<row r="2"><c r="B2" t="b"><v>1</v></c></row>`), "S")).toBe("S!B2=TRUE");
  });

  it("skips the padding an export writes around the used range", () => {
    // Google Sheets pads 1 000 rows × 26 columns with styled empty cells: 26 000 cells for 201
    // values on the reference workbook. Joined blindly, the text is 99% separators.
    const padded = sheet(
      `<row r="1"><c r="A1" s="1"/><c r="B1" s="1"/><c r="C1" s="1"/></row>` +
        `<row r="2"><c r="A2" s="1"/><c r="B2"><v>42</v></c><c r="C2" s="1"/></row>`,
    );
    expect(readSheetXml(padded, "S")).toBe("S!B2=42");
  });

  it("does not merge two rows when one of them is self-closing", () => {
    const text = readSheetXml(
      sheet(`<row r="1"/><row r="2"><c r="A2"><v>1</v></c></row><row r="3"><c r="A3"><v>2</v></c></row>`),
      "S",
    );
    expect(text).toBe("S!A2=1\nS!A3=2");
  });

  it("falls back to position where a writer omits cell references", () => {
    const text = readSheetXml(sheet(`<row r="4"><c><v>10</v></c><c><v>20</v></c></row>`), "S");
    expect(text).toBe("S!A4=10 | B4=20");
  });
});

describe("what must not be read as a figure", () => {
  /**
   * The case that made this rule. Columns B–E of the reference estimate's Summary sheet are hidden
   * and hold a superseded copy: `#REF!` where a total belongs, and a primary-bulk figure of
   * 19 403 590 against the 103 966 787 in the visible columns beside it.
   */
  it("does not read a hidden column", () => {
    const xml =
      `<worksheet><cols><col min="2" max="5" hidden="1"/></cols><sheetData>` +
      `<row r="7"><c r="B7" t="s"><v>0</v></c><c r="E7"><v>19403590</v></c>` +
      `<c r="I7" t="s"><v>0</v></c><c r="L7"><v>103966786.6</v></c></row>` +
      `</sheetData></worksheet>`;

    const text = readSheetXml(xml, "Summary", { shared: ["PRIMARY BULK TOTAL"] });

    expect(text).toBe("Summary!I7=PRIMARY BULK TOTAL | L7=103966786.6");
    expect(text).not.toContain("19403590");
  });

  it("does not read a hidden row", () => {
    const xml = sheet(
      `<row r="1" hidden="1"><c r="A1"><v>111</v></c></row><row r="2"><c r="A2"><v>222</v></c></row>`,
    );
    expect(readSheetXml(xml, "S")).toBe("S!A2=222");
  });

  it("drops a formula error rather than quoting it as a total", () => {
    // Google's export writes these as `t="str"` with the error text cached, not as `t="e"`.
    const xml = sheet(
      `<row r="13"><c r="D13" t="str"><f>#REF!</f><v>#REF!</v></c>` +
        `<c r="E13" t="str"><f>SUM(D15:D20)</f><v>#ERROR!</v></c>` +
        `<c r="F13"><v>7</v></c></row>`,
    );
    expect(readSheetXml(xml, "Summary")).toBe("Summary!F13=7");
  });

  it("drops an error cell written the standard way too", () => {
    expect(readSheetXml(sheet(`<row r="1"><c r="A1" t="e"><v>#DIV/0!</v></c></row>`), "S")).toBe("");
  });
});

// ── Dates ───────────────────────────────────────────────────────────────────────────────────

/**
 * Not one of the six real workbooks read during this work has a date-formatted number in it, so
 * everything below is checked against Excel's own documented serials rather than against a file.
 * It stays because the failure it prevents is silent: a date cell holds a day count, and `45292`
 * written into a column of quantities is indistinguishable from one.
 */
describe("a date is a number until its format says otherwise", () => {
  const dateStyle = presentations(
    `<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
  );

  it("reads a date-formatted serial as a date", () => {
    const xml = sheet(`<row r="2"><c r="A2" s="1"><v>45292</v></c><c r="B2" s="0"><v>45292</v></c></row>`);
    // Same number, two formats: one is 1 January 2024, the other is forty-five thousand of something.
    expect(readSheetXml(xml, "S", { formats: dateStyle })).toBe("S!A2=2024-01-01 | B2=45292");
  });

  it("agrees with Excel on the serials people check against", () => {
    expect(fromSerial(1, "date", false)).toBe("1900-01-01");
    expect(fromSerial(25569, "date", false)).toBe("1970-01-01");
    expect(fromSerial(45292, "date", false)).toBe("2024-01-01");
    expect(fromSerial(46023, "date", false)).toBe("2026-01-01");
  });

  it("keeps the 29 February 1900 that never happened, because every file counts it", () => {
    expect(fromSerial(59, "date", false)).toBe("1900-02-28");
    expect(fromSerial(60, "date", false)).toBe("1900-02-29");
    expect(fromSerial(61, "date", false)).toBe("1900-03-01");
  });

  it("counts from 1904 when the workbook says to", () => {
    expect(fromSerial(0, "date", true)).toBe("1904-01-01");
    // The two systems are 1 462 days apart: 45 292 − 1 462.
    expect(fromSerial(43830, "date", true)).toBe("2024-01-01");
  });

  it("carries the time when there is one", () => {
    expect(fromSerial(45292.5, "date", false)).toBe("2024-01-01 12:00");
    expect(fromSerial(0.75, "time", false)).toBe("18:00:00");
    // An elapsed format runs past a day, so hours are counted rather than wrapped.
    expect(fromSerial(1.5, "time", false)).toBe("36:00:00");
  });
});

describe("which formats mean a date", () => {
  const of = (code: string) =>
    presentations(
      `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="${code}"/></numFmts>` +
        `<cellXfs count="1"><xf numFmtId="164"/></cellXfs></styleSheet>`,
    )[0];

  it("does not mistake a South African currency format for one", () => {
    // Every one of these is on the reference estimate. Read as a date, R9 701 795 becomes a day in
    // the year 28 549.
    expect(of("&quot;R&quot;#,##0.00")).toBeNull();
    expect(of("&quot;R&quot;\\ #,##0.00")).toBeNull();
    expect(of("_-[$R-1C09]* #,##0.00_-;\\-[$R-1C09]* #,##0.00_-;_-[$R-1C09]* &quot;-&quot;??_-;_-@")).toBeNull();
    expect(of("_(* #,##0.00_);_(* \\(#,##0.00\\);_(* &quot;-&quot;??_);_(@_)")).toBeNull();
  });

  it("recognises the ones that are", () => {
    expect(of("dd/mm/yyyy")).toBe("date");
    expect(of("d mmm yyyy")).toBe("date");
    expect(of("mmm-yy")).toBe("date");
    expect(of("[$-en-ZA]d mmmm yyyy;@")).toBe("date");
  });

  it("reads an hours-and-minutes format as a duration, not a day in 1899", () => {
    expect(of("mm:ss")).toBe("time");
    expect(of("[h]:mm:ss")).toBe("time");
  });
});

describe("shared strings", () => {
  it("keeps the indexes aligned when one of them is empty", () => {
    // The index is a position in this list. A skipped entry shifts every label after it onto the
    // wrong cell, which reads as a plausible sheet with the wrong words on it.
    const shared = sharedStrings(`<sst><si><t>first</t></si><si/><si><t>third</t></si></sst>`);
    expect(shared).toEqual(["first", "", "third"]);
  });
});

// ── The container ───────────────────────────────────────────────────────────────────────────

/**
 * A workbook, built here.
 *
 * The zip walk is proven against six real workbooks by hand, which proves nothing a year from now.
 * These are genuine archives — real CRCs, real deflate — so the container is covered by `npm test`
 * rather than by somebody remembering to re-run a script.
 */
function zip(parts: Record<string, string>): Uint8Array {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(parts)) {
    const raw = Buffer.from(content, "utf8");
    const deflated = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(deflated.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc32(raw), 16);
    entry.writeUInt32LE(deflated.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);

    local.push(header, nameBytes, deflated);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + deflated.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

const workbookParts = (options: { hiddenSheet?: boolean } = {}) => ({
  "xl/workbook.xml":
    `<workbook><sheets>` +
    `<sheet name="Summary" sheetId="1" r:id="rId4"/>` +
    `<sheet name="Roads &amp; Stormwater" sheetId="2" r:id="rId5"${options.hiddenSheet ? ' state="hidden"' : ""}/>` +
    `</sheets></workbook>`,
  // Deliberately not in sheet order, and not numbered to match: the relationship is the mapping,
  // and reading `sheet1.xml` as "the first sheet" is a coin toss on a real export.
  "xl/_rels/workbook.xml.rels":
    `<Relationships>` +
    `<Relationship Id="rId5" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId4" Target="worksheets/sheet2.xml"/>` +
    `</Relationships>`,
  "xl/sharedStrings.xml": `<sst><si><t>Sewer</t></si></sst>`,
  "xl/styles.xml": `<styleSheet><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>`,
  "xl/worksheets/sheet1.xml": sheet(`<row r="2"><c r="A2"><v>41073018</v></c></row>`),
  "xl/worksheets/sheet2.xml": sheet(`<row r="9"><c r="I9" t="s"><v>0</v></c><c r="J9"><v>9701795</v></c></row>`),
  "xl/media/image1.png": "not xml, and never inflated",
});

describe("reading a whole workbook", () => {
  it("reads its sheets in the workbook's order, not the file numbering's", () => {
    const { sheets, warning } = readWorkbook(zip(workbookParts()));

    expect(warning).toBeUndefined();
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "Roads & Stormwater"]);
    expect(sheets[0]!.text).toBe("Summary!I9=Sewer | J9=9701795");
    expect(sheets[1]!.text).toBe("Roads & Stormwater!A2=41073018");
  });

  it("leaves a hidden sheet out, as it does a hidden column", () => {
    const { sheets } = readWorkbook(zip(workbookParts({ hiddenSheet: true })));
    expect(sheets.map((s) => s.name)).toEqual(["Summary"]);
  });

  it("says a protected workbook is protected, rather than failing at the zip", () => {
    // A password-protected .xlsx is not a zip at all — it is Microsoft's older compound file, which
    // a real .xls also is. One message covers both, and both have the same answer.
    const compound = new Uint8Array(600);
    compound.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

    expect(readWorkbook(compound).warning).toMatch(/password-protected|older \.xls/i);
  });

  it("says plainly when the file is not a workbook at all", () => {
    expect(readWorkbook(new Uint8Array(120)).warning).toMatch(/not a workbook/i);
  });

  it("says so when a zip carries no workbook part", () => {
    const { warning } = readWorkbook(zip({ "word/document.xml": "<document/>" }));
    expect(warning).toMatch(/no workbook inside/i);
  });

  it("warns rather than returning nothing when every sheet is empty", () => {
    const { sheets, warning } = readWorkbook(
      zip({
        "xl/workbook.xml": `<workbook><sheets><sheet name="Phasing Map" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
        "xl/worksheets/sheet1.xml": sheet(""),
      }),
    );

    expect(sheets).toEqual([]);
    expect(warning).toMatch(/no cell values/i);
  });
});

/**
 * The grid — what an import reads, as against what retrieval indexes.
 *
 * These matter more than they look. An import maps a *column position* to a field, so a grid that
 * quietly drops an empty cell shifts every later column one to the left: a rate lands in the region
 * column, the effective date lands in the source, and nothing on screen says so. The sheet is
 * sparse in the file and has to be dense here.
 */
describe("a sheet as a grid", () => {
  const grid = (rows: string) =>
    sheetGrid(sheet(rows), { shared: [], formats: [], epoch1904: false });

  it("lays cells out by their own column, in file order", () => {
    expect(
      grid(
        `<row r="1"><c r="A1" t="str"><v>Trade</v></c><c r="B1" t="str"><v>Rate</v></c></row>` +
          `<row r="2"><c r="A2" t="str"><v>Masonry</v></c><c r="B2"><v>485</v></c></row>`,
      ),
    ).toEqual([
      ["Trade", "Rate"],
      ["Masonry", "485"],
    ]);
  });

  /**
   * The assertion this function exists for. A row that skips a column must keep its shape, or the
   * columns after the gap all move left and the import reads the wrong field.
   */
  it("keeps a skipped column as a gap rather than closing it up", () => {
    expect(
      grid(`<row r="1"><c r="A1" t="str"><v>left</v></c><c r="C1" t="str"><v>right</v></c></row>`),
    ).toEqual([["left", "", "right"]]);
  });

  it("pads every row to the widest, so a column index means the same thing on all of them", () => {
    const rows = grid(
      `<row r="1"><c r="A1" t="str"><v>one</v></c></row>` +
        `<row r="2"><c r="A2" t="str"><v>a</v></c><c r="D2" t="str"><v>d</v></c></row>`,
    );

    expect(rows.map((r) => r.length)).toEqual([4, 4]);
    expect(rows[0]).toEqual(["one", "", "", ""]);
  });

  /**
   * A spreadsheet a practice actually sends has a title and a blank line above the header. Finding
   * the header is the caller's job — dropping rows here would hide the thing they need to look at.
   */
  it("does not trim the preamble a real workbook carries", () => {
    const rows = grid(
      `<row r="1"><c r="A1" t="str"><v>Rate schedule 2026</v></c></row>` +
        `<row r="3"><c r="A3" t="str"><v>Trade</v></c></row>`,
    );

    expect(rows).toEqual([["Rate schedule 2026"], ["Trade"]]);
  });

  /** Hidden rows and columns are excluded here exactly as they are from retrieval. */
  it("leaves out a hidden row", () => {
    expect(
      grid(
        `<row r="1"><c r="A1" t="str"><v>kept</v></c></row>` +
          `<row r="2" hidden="1"><c r="A2" t="str"><v>superseded</v></c></row>`,
      ),
    ).toEqual([["kept"]]);
  });

  it("is empty for a sheet with nothing in it", () => {
    expect(grid("")).toEqual([]);
  });
});
