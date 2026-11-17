import { describe, expect, it } from "vitest";

import { importLines } from "./estimate-lines-import";

describe("reading an estimate's lines", () => {
  it("reads measured lines and lump sums under section headings, leaving totals and markups out", () => {
    const result = importLines([
      {
        name: "Cost model",
        grid: [
          ["High-level civil cost estimate"],
          ["No", "Description", "Qty", "Unit", "Rate", "Amount"],
          ["1", "Earthworks"],
          ["1.1", "Cut to fill, platforms", "44074", "m3", "95", "4187030"],
          ["1.2", "Rock allowance", "", "", "", "500000"],
          ["", "Subtotal earthworks", "", "", "", "4687030"],
          ["2", "Sewer"],
          ["2.1", "160 mm uPVC", "1931", "m", "1800", "3475800"],
          ["", "Preliminary and General (12%)", "", "", "", "100"],
          ["", "Contingency 15%", "", "", "", "100"],
          ["", "TOTAL", "", "", "", "9999"],
        ],
      },
    ]);
    if (!result.ok) throw new Error(result.reason);
    expect(result.lines.map((l) => [l.element, l.description, l.quantity, l.rate, l.lumpSum])).toEqual([
      ["Earthworks", "Cut to fill, platforms", "44074.0000", "95.00", null],
      ["Earthworks", "Rock allowance", null, null, "500000.00"],
      ["Sewer", "160 mm uPVC", "1931.0000", "1800.00", null],
    ]);
    expect(result.notes.join(" ")).toMatch(/2 total rows were left out/);
    expect(result.notes.join(" ")).toMatch(/markups are the estimate's percentages/);
  });

  it("uses an element column where there is one", () => {
    const result = importLines([{ name: "S", grid: [["Element", "Description", "Amount"], ["Water", "Looped network", "5450000"]] }]);
    expect(result.ok && result.lines[0]).toMatchObject({ element: "Water", lumpSum: "5450000.00" });
  });

  it("refuses a workbook with nothing that reads as lines", () => {
    expect(importLines([{ name: "S", grid: [["a", "b"]] }]).ok).toBe(false);
  });
});
