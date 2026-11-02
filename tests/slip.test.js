// Row structure and money checks on captured Sarvam Vision OCR text (tests/fixtures/slips.json).
// Numeric expectations for Ankur and Sanjeev 1.2 were checked against the photos; other slips are not ground-truthed.
import { describe, expect, test } from "bun:test";
import { checkRow, checkTotals, parseSlip, readFigure } from "../lib/slip.js";
import slips from "./fixtures/slips.json";

const read = (text) => {
  const slip = parseSlip(text);
  const lines = slip.rows.map((row) => ({ ...row, ...checkRow(row) }));
  return { ...slip, lines, warnings: checkTotals(lines, slip.figures), bySno: new Map(lines.map((l) => [l.sno, l])) };
};
const checks = (line) => line.issues.filter((i) => i.level === "check");

describe("readFigure", () => {
  test("reads rupee/paise handwriting and keeps true zeroes", () => {
    expect(readFigure("4/10").value).toBe(4.1);
    expect(readFigure("2812-50").value).toBe(2812.5);
    expect(readFigure("25/-").value).toBe(25);
    expect(readFigure("3130-").value).toBe(3130);
    expect(readFigure("410 =")).toBeNull(); // one cell at a time; the row splitter separates "=" first
    expect(readFigure("S0").value).toBe(50);
    expect(readFigure("0").value).toBe(0);
    expect(readFigure("")).toBeNull();
    expect(readFigure("16x26")).toBeNull();
  });
});

describe("Sanjeev 1.2 (Hindi OCR)", () => {
  const slip = read(slips["sanjeev-hi"]);

  test("keeps exactly the five product rows; totals and the 80 charge are figures, not items", () => {
    expect(slip.lines.map((l) => l.sno)).toEqual([1, 2, 3, 4, 5]);
    expect(slip.lines.map((l) => l.qty)).toEqual([100, 100, 100, 75, 200]);
    expect(slip.figures.map((f) => f.value)).toEqual([6902, 11414, 18316, 80, 18396]);
    expect(slip.invoice_no).toBe("232");
  });

  test("a misread rate is flagged with a suggestion from the amount, never silently replaced", () => {
    const first = slip.bySno.get(1);
    expect(first.rate_text).toBe("25/30");
    expect(first.unit_price).toBe(3.2);
    expect(first.amount).toBe(320);
    expect(checks(first)[0].message).toContain("25/30");
    expect(checks(slip.bySno.get(2))[0].message).toContain("7/20");
    expect(checks(slip.bySno.get(3))).toEqual([]);
  });

  test("paise survive: 75 × 37.50 = 2812.50 and 200 × 15.65 = 3130", () => {
    expect(slip.bySno.get(4)).toMatchObject({ unit_price: 37.5, line_total: 2812.5, issues: [] });
    expect(slip.bySno.get(5)).toMatchObject({ unit_price: 15.65, line_total: 3130, issues: [] });
  });

  test("the written total 6902 agrees with 6902.50 within rounding; other figures are listed", () => {
    expect(slip.warnings[0]).toMatchObject({ level: "info" });
    expect(slip.warnings[0].message).toContain("6902.50");
    expect(slip.warnings[1].message).toContain("11414");
    expect(slip.warnings[1].message).toContain("80-");
  });
});

describe("Ankur (Hindi OCR)", () => {
  const slip = read(slips["ankur-hi"]);

  test("reads all 18 rows with header fields", () => {
    expect(slip.lines).toHaveLength(18);
    expect(slip).toMatchObject({ customer_name: "अंकुर स्टोर मडावरा", invoice_no: "205", invoice_date: "2026-10-08" });
  });

  test("row 16 keeps qty 24; '241' is 24/- confirmed by 576", () => {
    const row = slip.bySno.get(16);
    expect(row).toMatchObject({ qty: 24, unit_price: 24, amount: 576 });
    expect(checks(row)).toEqual([]);
    expect(row.issues[0].message).toContain("24/-");
  });

  test("row 5 '2140,' is 2/40, never 2140 per pen", () => {
    expect(slip.bySno.get(5)).toMatchObject({ qty: 200, unit_price: 2.4, amount: 480 });
  });

  test("'/-' read as a digit is recovered only when the amount confirms it", () => {
    expect(slip.bySno.get(7).unit_price).toBe(90);
    expect(slip.bySno.get(15).unit_price).toBe(450);
    expect(slip.bySno.get(18).unit_price).toBe(70);
  });

  test("rows whose rate disagrees with the amount need a check", () => {
    for (const sno of [2, 3, 4, 12, 13]) expect(checks(slip.bySno.get(sno))).toHaveLength(1);
    expect(slip.bySno.get(2).unit_price).toBe(3.5);
    expect(slip.bySno.get(13).unit_price).toBe(340);
  });

  test("the misread total 9716 is reported against the 9216 the lines add up to", () => {
    expect(slip.warnings[0]).toMatchObject({ level: "check" });
    expect(slip.warnings[0].message).toContain("9716");
    expect(slip.warnings[0].message).toContain("9216");
  });

  test("printed sizes stay in the description", () => {
    expect(slip.bySno.get(15).description).toContain("16x26");
    expect(slip.bySno.get(17).description).toContain("(100)");
  });
});

describe("rows with missing or odd cells", () => {
  const rows = (text) => read(`M/s. Test 9\n${text}`).lines;

  test("missing qty stays empty, never 1", () => {
    const [line] = rows("3 Doms pencil 4/10 820");
    expect(line.qty).toBeNull();
    expect(checks(line)[0].message).toContain("Quantity");
  });

  test("no rate and no amount leaves the price empty for the person to enter", () => {
    const [line] = rows("7 25 Pencil box");
    expect(line).toMatchObject({ qty: 25, unit_price: null, amount: null });
    expect(checks(line)[0].message).toContain("No rate or amount");
  });

  test("a single trailing figure could be a printed price, so it needs a check", () => {
    const [line] = rows("5 30 पीस प्रिंसिपल 20-");
    expect(line.unit_price).toBeCloseTo(0.67);
    expect(checks(line)[0].message).toContain("printed price");
  });

  test("an explicitly empty rate cell in a table is worked out from the amount", () => {
    const [line] = rows("| 1 | 100 | Doms pencil |  | 410 |");
    expect(line).toMatchObject({ qty: 100, unit_price: 4.1, line_total: 410 });
    expect(checks(line)).toEqual([]);
  });

  test("true zeroes are kept", () => {
    const [line] = rows("4 10 Free sample 0 0");
    expect(line).toMatchObject({ unit_price: 0, amount: 0, line_total: 0 });
  });

  test("rounding residue keeps the written amount: 3 × 333.33 = 1000", () => {
    const [line] = rows("2 3 Register 333/33 1000");
    expect(line).toMatchObject({ unit_price: 333.33, line_total: 1000 });
  });

  test("dash rows continue the item above and bracket notes attach to it", () => {
    const lines = rows("1 10 Doms gel pen blue 5 50\n2 5 - red 5 25\n(5 - 100 पीस)\n3 2 Natraj 621 2/50 5");
    expect(lines.map((l) => l.sno)).toEqual([1, 2, 3]);
    expect(lines[1]).toMatchObject({ continued: true, description: "red" });
    expect(lines[1].notes).toEqual(["(5 - 100 पीस)"]);
  });

  test("circled marks beside S.No are bookkeeping, a circled S.No is still the S.No", () => {
    const slip = read("① 4 75 Copy 37/50 2812-50\n⑨ 80-");
    expect(slip.lines[0]).toMatchObject({ sno: 4, mark: "①", qty: 75 });
    expect(slip.figures[0]).toMatchObject({ sno: 9, value: 80 });
  });
});
