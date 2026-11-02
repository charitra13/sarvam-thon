// Shared by the review form and the server action. Validation never drops a line,
// supplies a missing number, or writes to the database.
import { amountsAgree, checkRow, checkTotals, parseSlip, parseSourceRow } from "./slip.js";
import { aliasKey, aliasLearnable } from "./catalog.js";

const MAX_QTY = 2147483647; // PostgreSQL int
const MAX_RATE = 99999999.99; // numeric(10,2)
const MAX_TOTAL = 9999999999.99; // numeric(12,2)
const round2 = (value) => Math.round(value * 100) / 100;

function numberCell(value, whole = false, max = MAX_TOTAL) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !(whole ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(value.trim())) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) return null;
  if (whole ? !Number.isInteger(number) : Number(number.toFixed(2)) !== number) return null;
  return number;
}

const originalRaw = (line) => line.original_raw ?? line.source_raw ?? line.raw_text ?? line.raw ?? "";
const isScanned = (line) => line.source === "ocr" || (line.source !== "manual" && Boolean(originalRaw(line)));

// Acknowledgements describe these exact values. Both sides canonicalise numeric
// input strings, so changing transport types cannot invalidate a genuine check.
export function lineReviewKey(line) {
  return JSON.stringify([
    isScanned(line), String(originalRaw(line)), String(line.raw ?? line.raw_text ?? ""),
    line.item_id ?? null, String(line.name ?? ""), String(line.description ?? ""), String(line.context ?? ""),
    numberCell(line.qty, true, MAX_QTY), numberCell(line.unit_price, false, MAX_RATE),
    line.amount == null ? null : numberCell(line.amount),
  ]);
}

export const lineReviewed = (line) => line.reviewed === true && line.review_key === lineReviewKey(line);

export function invoiceWarningsKey(payload) {
  return JSON.stringify([String(payload.ocr_text ?? ""), (payload.lines ?? []).map((line) => line && typeof line === "object" ? lineReviewKey(line) : null), payload.warnings ?? []]);
}

// Recompute from retained OCR, including each page independently. Client warning
// metadata is useful for display but is never the only source of a required check.
function sourceWarnings(text) {
  return String(text ?? "").split(/(?:^|\n)— Slip \d+ —\n/).filter((page) => page.trim()).flatMap((page) => {
    const slip = parseSlip(page);
    return checkTotals(slip.rows.map((row) => ({ ...row, ...checkRow(row) })), slip.figures);
  });
}

export function invoiceLineTotal(line) {
  const qty = numberCell(line.qty, true, MAX_QTY);
  const rate = numberCell(line.unit_price, false, MAX_RATE);
  if (qty === null || rate === null) return null;
  const computed = qty * Math.round(rate * 100) / 100;
  const written = numberCell(line.amount);
  return written !== null && amountsAgree(computed, written) ? written : computed;
}

export function lineReview(line) {
  const messages = [];
  const qty = numberCell(line.qty, true, MAX_QTY);
  const rate = numberCell(line.unit_price, false, MAX_RATE);
  const written = numberCell(line.amount);
  if (qty !== null && rate !== null && written !== null && !amountsAgree(qty * rate, written)) {
    messages.push(`Current quantity × rate is ${round2(qty * rate)}, but the slip amount is ${written}. Confirm the corrected figures against the photo; saving uses ${invoiceLineTotal(line)}.`);
  }
  let originalNeedsReview = false;
  if (isScanned(line)) {
    const raw = String(originalRaw(line));
    const row = parseSlip(raw).rows[0] ?? parseSourceRow(raw);
    const extracted = row && checkRow(row);
    originalNeedsReview = !row || row.layout === "model" || extracted.issues.some((issue) => issue.level === "check");
    if (row && (qty !== row.qty || rate !== extracted.unit_price || written !== extracted.amount ||
      String(line.raw ?? line.raw_text ?? raw) !== raw ||
      (line.description != null && line.description !== row.description))) {
      messages.push("Current values differ from the original OCR. Check the corrected line against the photo.");
    }
    if (!line.item_id) messages.push("Confirm this as an unmatched / custom item. It will not deduct inventory stock.");
    if (line.edited) messages.push("This line was edited. Check the current figures and item before confirming again.");
  }
  return { required: line.needs_review === true || originalNeedsReview || messages.length > 0, messages };
}

const REVIEW_FIELDS = new Set(["qty", "unit_price", "item_id", "name", "raw", "description", "context", "amount"]);
export function editInvoiceLine(line, patch) {
  const changed = Object.keys(patch).some((key) => REVIEW_FIELDS.has(key) && patch[key] !== line[key]);
  const result = { ...line, ...patch };
  if (changed) {
    result.reviewed = false;
    result.review_key = null;
    if (isScanned(line)) result.edited = true;
    if (["item_id", "raw", "description", "context", "name"].some((key) => Object.hasOwn(patch, key) && patch[key] !== line[key])) result.remember = false;
    if (Object.hasOwn(patch, "raw") || Object.hasOwn(patch, "description")) result.picked = false;
  } else if (Object.hasOwn(patch, "reviewed")) result.review_key = patch.reviewed === true ? lineReviewKey(result) : null;
  return result;
}

export function toInvoiceLine(line) {
  return {
    source: isScanned(line) ? "ocr" : "manual", source_raw: originalRaw(line), raw_text: line.raw ?? line.raw_text ?? "",
    item_id: line.item_id ?? null, name: line.name, qty: line.qty, unit_price: line.unit_price,
    amount: line.amount ?? null, line_total: invoiceLineTotal(line), description: line.description ?? "", context: line.context ?? "",
    needs_review: lineReview(line).required, reviewed: line.reviewed === true, edited: line.edited === true,
    review_key: line.review_key ?? null,
    picked: line.picked === true, remember: line.remember === true,
  };
}

export function validateInvoice(payload) {
  const name = typeof payload?.customer?.name === "string" ? payload.customer.name.trim() : "";
  if (!name) return { error: "Add the customer name." };
  if (!Array.isArray(payload.lines) || !payload.lines.length) return { error: "Add at least one item with a quantity and rate." };
  if (payload.warnings != null && !Array.isArray(payload.warnings)) return { error: "Check the slip warnings before saving." };
  if ([...(payload.warnings ?? []), ...sourceWarnings(payload.ocr_text)].some((warning) => warning?.level === "check") &&
    (payload.warnings_reviewed !== true || payload.warnings_review_key !== invoiceWarningsKey(payload))) {
    return { error: "Check the whole-slip total warnings against the photos before saving." };
  }
  const lines = [];
  const aliases = [];
  let total = 0;
  for (const [index, row] of payload.lines.entries()) {
    const error = (message) => ({ error: `Line ${index + 1}: ${message}` });
    if (!row || typeof row !== "object" || typeof row.name !== "string" || !row.name.trim()) return error("add the item name.");
    const qty = numberCell(row.qty, true, MAX_QTY);
    const unit_price = numberCell(row.unit_price, false, MAX_RATE);
    if (qty === null || qty <= 0) return error("enter a whole quantity above zero.");
    if (unit_price === null) return error("enter a valid rate in rupees and paise, including 0 for a free item.");
    if (row.item_id != null && (!Number.isInteger(row.item_id) || row.item_id <= 0 || row.item_id > MAX_QTY)) return error("choose a valid inventory item or a custom item.");
    const amount = row.amount == null ? null : numberCell(row.amount);
    if (row.amount != null && amount === null) return error("check the written amount.");
    const current = { ...row, qty, unit_price, amount };
    if ((lineReview(current).required || row.reviewed === true) && !lineReviewed(current)) return error("check the amber notes against the photo and confirm this line.");
    const line_total = invoiceLineTotal(current);
    if (line_total === null || line_total > MAX_TOTAL) return error("the amount is too large. Check the quantity and rate.");
    if (row.line_total != null && (numberCell(row.line_total) === null || Math.abs(Number(row.line_total) - line_total) > 0.001)) {
      return error("the submitted amount disagrees with the current quantity and rate. Correct the figures before saving.");
    }
    total = round2(total + line_total);
    if (total > MAX_TOTAL) return error("the bill total is too large. Check the figures.");
    const raw = String(row.raw_text ?? "");
    const original = String(originalRaw(row));
    lines.push({
      item_id: row.item_id ?? null, name: row.name.trim().slice(0, 200), qty, unit_price, line_total,
      raw_text: original && original !== raw ? `${original}\nReviewed transcription: ${raw}` : raw || original || null,
    });
    if (row.remember === true) {
      const source = parseSlip(String(originalRaw(row))).rows[0];
      const context = typeof row.context === "string" ? row.context : "";
      const key = aliasKey(typeof row.description === "string" ? row.description : "", context);
      if (row.picked !== true || !row.item_id || !lineReviewed(current) || !aliasLearnable(key) ||
        (source?.continued && !context.trim())) {
        return error("remember a name only after choosing the item yourself and checking this line.");
      }
      aliases.push({ alias: key, item_id: row.item_id });
    }
  }
  const date = payload.invoice_date || null;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
    return { error: "Enter a valid bill date." };
  }
  return { invoice: {
    customer: { name: name.slice(0, 200), phone: String(payload.customer.phone ?? "").trim().slice(0, 30) },
    invoice_no: String(payload.invoice_no ?? "").trim().slice(0, 40) || null, invoice_date: date,
    ocr_text: payload.ocr_text ? String(payload.ocr_text) : null, lines, aliases,
  } };
}
