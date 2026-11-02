import { describe, expect, test, mock } from "bun:test";
import { editInvoiceLine, invoiceLineTotal, invoiceWarningsKey, lineReview, lineReviewed, toInvoiceLine, validateInvoice } from "../lib/invoice.js";
import { aliasKey } from "../lib/catalog.js";

const manual = (patch = {}) => ({ source: "manual", item_id: null, name: "Custom pencil", qty: "10", unit_price: "3.20", ...patch });
const payload = (lines) => ({ customer: { name: "Test shop" }, lines });
const confirm = (line) => editInvoiceLine(line, { reviewed: true });
const confirmWarnings = (value) => ({ ...value, warnings_reviewed: true, warnings_review_key: invoiceWarningsKey(value) });
const scanned = (patch = {}) => {
  const line = {
    source: "ocr", raw: "1 10 Doms Fusion Pencil 3/20 32", original_raw: "1 10 Doms Fusion Pencil 3/20 32",
    item_id: 1750, name: "DOMS FUSION PENCIL 12%", description: "Doms Fusion Pencil",
    qty: 10, unit_price: 3.2, amount: 32, needs_review: false, reviewed: false, ...patch,
  };
  return line.reviewed ? confirm(line) : line;
};

describe("invoice review and validation", () => {
  test("rejects every invalid line instead of saving a filtered invoice", () => {
    for (const qty of ["", null, true, "1.5", 2.5, "2pcs", Infinity, "2147483648"]) {
      expect(validateInvoice(payload([manual(), manual({ qty })])).error).toBeTruthy();
    }
    for (const unit_price of ["", null, false, "1e2", "0x10", -1, NaN, Infinity, "0.001", 100000000]) {
      expect(validateInvoice(payload([manual({ unit_price })])).error).toBeTruthy();
    }
    expect(validateInvoice(payload([null])).error).toBeTruthy();
    expect(validateInvoice(payload([manual({ item_id: -2 })])).error).toBeTruthy();
    expect(validateInvoice(payload([manual({ qty: 2147483647, unit_price: 99 })])).error).toBeTruthy();
  });

  test("explicit manual values including true zero save without inferred figures", () => {
    const result = validateInvoice(payload([manual({ unit_price: "0" })]));
    expect(result.error).toBeUndefined();
    expect(result.invoice.lines[0]).toMatchObject({ qty: 10, unit_price: 0, line_total: 0, item_id: null });
    expect(validateInvoice(payload([manual({ qty: "" })])).error).toBeTruthy();
  });

  test("the server requires acknowledgement of OCR numeric and matching issues", () => {
    const flagged = scanned({ needs_review: true });
    expect(validateInvoice(payload([toInvoiceLine(flagged)])).error).toBeTruthy();
    expect(validateInvoice(payload([toInvoiceLine(confirm(flagged))])).error).toBeUndefined();
    const missingRate = scanned({ original_raw: "| 1 | 10 | Doms Fusion Pencil | | 32 |", needs_review: false });
    expect(validateInvoice(payload([toInvoiceLine(missingRate)])).error).toBeTruthy();
    expect(validateInvoice(payload([toInvoiceLine(scanned({ item_id: null }))])).error).toBeTruthy();
    expect(validateInvoice(payload([toInvoiceLine(scanned({ item_id: null, reviewed: true }))])).error).toBeUndefined();
  });

  test("a new arithmetic disagreement requires a fresh check at UI and server", () => {
    const changed = editInvoiceLine(scanned({ reviewed: true }), { qty: "20" });
    expect(changed.reviewed).toBe(false);
    expect(lineReview(changed).required).toBe(true);
    expect(lineReview(changed).messages.join(" ")).toContain("32");
    expect(validateInvoice(payload([toInvoiceLine(changed)])).error).toBeTruthy();
    const confirmed = confirm(changed);
    const valid = validateInvoice(payload([toInvoiceLine(confirmed)]));
    expect(valid.error).toBeUndefined();
    expect(valid.invoice.lines[0].line_total).toBe(64);
  });

  test("quantity, rate, match, raw and custom-name edits invalidate acknowledgement", () => {
    for (const patch of [{ qty: "11" }, { unit_price: "4.00" }, { amount: "40" }, { item_id: null }, { raw: "corrected" }, { name: "Corrected name" }]) {
      const result = editInvoiceLine(scanned({ reviewed: true, remember: true }), patch);
      expect(result.reviewed).toBe(false);
      expect(lineReview(result).required).toBe(true);
    }
    expect(editInvoiceLine(scanned({ reviewed: true }), { remember: true }).reviewed).toBe(true);
  });

  test("UI, server and saved totals keep a tolerated written rounding residual", () => {
    const row = scanned({ original_raw: "1 3 Register 333/33 1000", raw: "1 3 Register 333/33 1000", description: "Register", qty: 3, unit_price: 333.33, amount: 1000 });
    expect(invoiceLineTotal(row)).toBe(1000);
    const saved = validateInvoice(payload([toInvoiceLine(row)]));
    expect(saved.error).toBeUndefined();
    expect(saved.invoice.lines[0].line_total).toBe(1000);
    expect(validateInvoice(payload([manual({ qty: 3, unit_price: 333.33, line_total: 900, reviewed: true })])).error).toBeTruthy();
  });

  test("a corrected written amount resets review and true zero remains explicit", () => {
    const changed = editInvoiceLine(scanned({ reviewed: true }), { amount: "32.01" });
    expect(changed.reviewed).toBe(false);
    expect(validateInvoice(payload([toInvoiceLine(changed)])).error).toBeTruthy();
    const saved = validateInvoice(payload([toInvoiceLine(confirm(changed))]));
    expect(saved.invoice.lines[0].line_total).toBe(32.01);
    const free = manual({ qty: 3, unit_price: 0, amount: 0 });
    expect(invoiceLineTotal(free)).toBe(0);
    expect(validateInvoice(payload([free])).invoice.lines[0].line_total).toBe(0);
  });

  test("only an explicit saved manual pick can teach an alias", () => {
    const row = toInvoiceLine(scanned({ picked: true, remember: true, reviewed: true }));
    expect(validateInvoice(payload([row])).invoice.aliases).toHaveLength(1);
    expect(validateInvoice(payload([{ ...row, picked: false }])).error).toBeTruthy();
    expect(validateInvoice(payload([row, manual({ qty: "" })])).error).toBeTruthy();
    expect(validateInvoice(payload([{ ...row, item_id: null }])).error).toBeTruthy();
  });

  test("original OCR survives an edited transcription and whole-slip warnings need review", () => {
    const row = editInvoiceLine(scanned(), { raw: "Corrected handwriting" });
    const result = validateInvoice(payload([toInvoiceLine(confirm(row))]));
    expect(result.invoice.lines[0].raw_text).toContain(row.original_raw);
    expect(result.invoice.lines[0].raw_text).toContain(row.raw);
    const warningPayload = { ...payload([manual()]), warnings: [{ level: "check", message: "Total mismatch" }] };
    expect(validateInvoice(warningPayload).error).toBeTruthy();
    expect(validateInvoice(confirmWarnings(warningPayload)).error).toBeUndefined();
  });

  test("the server detects changed source values even when edit metadata is absent", () => {
    const original = scanned();
    const changed = { ...toInvoiceLine(original), qty: 20, amount: 64, line_total: 64, edited: false, needs_review: false };
    expect(validateInvoice(payload([changed])).error).toBeTruthy();
    expect(validateInvoice(payload([toInvoiceLine(confirm(changed))])).error).toBeUndefined();
    const reviewed = toInvoiceLine(confirm(original));
    const stale = { ...reviewed, qty: 20, amount: 64, line_total: 64 };
    expect(lineReviewed(stale)).toBe(false);
    expect(validateInvoice(payload([stale])).error).toBeTruthy();
    expect(validateInvoice(payload([{ ...reviewed, item_id: 2658 }])).error).toBeTruthy();
    expect(validateInvoice(payload([{ ...reviewed, name: "A different product" }])).error).toBeTruthy();
    expect(lineReviewed({ ...reviewed, qty: "10", unit_price: "3.20", amount: "32.00" })).toBe(true);
  });

  test("whole-slip checks come from OCR even when the client omits warnings", () => {
    const value = { ...payload([toInvoiceLine(scanned())]), ocr_text: "1 10 Doms Fusion Pencil 3/20 32\nTotal 33" };
    expect(validateInvoice(value).error).toContain("whole-slip");
    expect(validateInvoice({ ...value, warnings: [], warnings_reviewed: true }).error).toContain("whole-slip");
    const checked = confirmWarnings(value);
    expect(validateInvoice(checked).error).toBeUndefined();
    expect(validateInvoice({ ...checked, lines: [toInvoiceLine(scanned()), manual()] }).error).toContain("whole-slip");
    const twoPages = { ...payload([toInvoiceLine(scanned()), toInvoiceLine(scanned())]),
      ocr_text: "— Slip 1 —\n1 10 Doms Fusion Pencil 3/20 32\nTotal 32\n\n— Slip 2 —\n1 10 Doms Fusion Pencil 3/20 32\nTotal 32" };
    expect(validateInvoice(twoPages).error).toBeUndefined();
  });

  test("learning a continuation saves the parent identity and rejects a fragment without context", () => {
    const row = scanned({ raw: "2 10 - blue 0.7 5 50", original_raw: "2 10 - blue 0.7 5 50", description: "blue 0.7",
      context: "Doms Inxon Pen", item_id: 2658, name: "DOMS INXON PEN BLUE", qty: 10, unit_price: 5, amount: 50,
      picked: true, reviewed: true, remember: true });
    const result = validateInvoice(payload([toInvoiceLine(row)]));
    expect(result.error).toBeUndefined();
    expect(result.invoice.aliases).toEqual([{ alias: aliasKey("blue 0.7", "Doms Inxon Pen"), item_id: 2658 }]);
    expect(result.invoice.aliases[0].alias).not.toBe(aliasKey("blue 0.7"));
    expect(validateInvoice(payload([toInvoiceLine(confirm({ ...row, context: "" }))])).error).toBeTruthy();
  });
});

// The actual server action and transaction code run against a recording SQL seam.
// No PostgreSQL connection, credentials, schema or live shop data are used by these tests.
const queries = [];
let aliasesAvailable = false;
const sql = async (parts, ...values) => {
  const text = parts.join("?").replace(/\s+/g, " ").trim();
  queries.push({ text, values });
  if (text.includes("count(*)::int as n from items")) return [{ n: 3950 }];
  if (text.includes("to_regclass")) return [{ present: aliasesAvailable }];
  if (text.startsWith("select alias, item_id")) return [{ alias: "doms fusion pencil", item_id: 1750 }];
  if (text.startsWith("select id from customers")) return [{ id: 77 }];
  if (text.startsWith("insert into invoices")) return [{ id: 123 }];
  return [];
};
sql.begin = async (callback) => callback(sql);
mock.module("next/cache", () => ({ revalidatePath() {} }));
mock.module("../lib/db.js", () => ({ sql }));
const { saveInvoiceAction } = await import("../app/actions.js");
const { getAliasSupport } = await import("../lib/data.js");

test("saveInvoiceAction validates the whole payload before its first database call", async () => {
  const before = queries.length;
  for (const lines of [[manual(), manual({ qty: "2.9" })], [manual({ unit_price: "" })], [toInvoiceLine(scanned({ needs_review: true }))]]) {
    expect((await saveInvoiceAction(payload(lines))).error).toBeTruthy();
    expect(queries.length).toBe(before);
  }
  expect(await saveInvoiceAction(payload([manual()]))).toMatchObject({ id: 123 });
  expect(queries.filter((q) => q.text.startsWith("insert into invoices"))).toHaveLength(1);
  expect(queries.some((q) => q.text.startsWith("create table") && q.text.includes("item_aliases"))).toBe(false);
});

test("saved SQL amounts and the ledger use the same written rounding total as review", async () => {
  const row = scanned({ original_raw: "1 3 Register 333/33 1000", raw: "1 3 Register 333/33 1000", description: "Register", qty: 3, unit_price: 333.33, amount: 1000 });
  const before = queries.length;
  expect(await saveInvoiceAction(payload([toInvoiceLine(row)]))).toMatchObject({ id: 123 });
  const recent = queries.slice(before);
  expect(recent.find((q) => q.text.startsWith("insert into invoices")).values).toContain(1000);
  expect(recent.find((q) => q.text.startsWith("insert into invoice_items")).values.at(-1)).toBe(1000);
  expect(recent.find((q) => q.text.startsWith("insert into ledger")).values).toContain(1000);
});

test("alias capability is explicit and an unavailable remember request writes nothing", async () => {
  expect(await getAliasSupport()).toEqual({ available: false, aliases: [] });
  const before = queries.length;
  const remembered = toInvoiceLine(scanned({ picked: true, remember: true, reviewed: true }));
  expect(await saveInvoiceAction(payload([remembered]))).toMatchObject({ aliases_available: false, error: expect.any(String) });
  expect(queries.slice(before).some((q) => /^(insert|update|create)\b/.test(q.text))).toBe(false);
  aliasesAvailable = true;
  expect(await getAliasSupport()).toMatchObject({ available: true, aliases: [{ item_id: 1750 }] });
  const saveStart = queries.length;
  expect(await saveInvoiceAction(payload([remembered]))).toMatchObject({ id: 123 });
  expect(queries.slice(saveStart).filter((q) => q.text.startsWith("insert into item_aliases"))).toHaveLength(1);
  aliasesAvailable = false;
});
