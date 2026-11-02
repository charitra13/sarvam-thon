"use server";

import { revalidatePath } from "next/cache";
import * as data from "../lib/data.js";
import { readSlip, matchSlip, callScript, speak } from "../lib/sarvam.js";

// Logs the real error server-side and hands the UI a friendly message.
async function attempt(message, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error(message, error);
    return { error: message };
  }
}

const toInt = (v) => Number.parseInt(v, 10);
const toMoney = (v) => Math.round(Number(v) * 100) / 100;

export async function readSlipAction(formData) {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose a photo of the slip first." };
  if (!file.type.startsWith("image/")) return { error: "Upload a photo (JPG or PNG) of the slip." };
  const language = formData.get("language") === "hi-IN" ? "hi-IN" : "en-IN";
  return attempt("Sarvam Vision could not read this slip. Try a clearer, well-lit photo.", async () => {
    const text = await readSlip(file, language);
    return text ? { text } : { error: "No writing was found on this photo. Try a clearer one." };
  });
}

export async function matchSlipAction(text) {
  if (typeof text !== "string" || !text.trim()) return { error: "There is no slip text to match." };
  return attempt("Sarvam-105B could not match the items. Please try again.", async () =>
    matchSlip(text.slice(0, 8000), await data.listItems()));
}

export async function saveInvoiceAction(payload) {
  const name = String(payload?.customer?.name ?? "").trim();
  if (!name) return { error: "Add the customer name." };
  const lines = (Array.isArray(payload?.lines) ? payload.lines : [])
    .map((l) => ({
      item_id: Number.isInteger(l.item_id) ? l.item_id : null,
      raw_text: l.raw_text ? String(l.raw_text).slice(0, 500) : null,
      name: String(l.name ?? "").trim().slice(0, 200),
      qty: toInt(l.qty),
      unit_price: toMoney(l.unit_price),
    }))
    .filter((l) => l.name && l.qty > 0 && l.unit_price >= 0);
  if (!lines.length) return { error: "Add at least one item with a quantity." };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(payload.invoice_date ?? "") ? payload.invoice_date : null;
  return attempt("Could not save the invoice. Please try again.", async () => {
    const id = await data.createInvoice({
      customer: { name: name.slice(0, 200), phone: String(payload.customer.phone ?? "").trim().slice(0, 30) },
      invoice_no: String(payload.invoice_no ?? "").trim().slice(0, 40) || null,
      invoice_date: date,
      ocr_text: payload.ocr_text ? String(payload.ocr_text).slice(0, 10000) : null,
      lines,
    });
    revalidatePath("/", "layout");
    return { id };
  });
}

export async function dispatchAction(invoiceId) {
  const id = toInt(invoiceId);
  if (!id) return { error: "Unknown invoice." };
  return attempt("Could not mark this invoice dispatched.", async () => {
    await data.markDispatched(id);
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function paymentAction(_prev, formData) {
  const customer_id = toInt(formData.get("customer_id"));
  const invoice_id = toInt(formData.get("invoice_id")) || null;
  const amount = toMoney(formData.get("amount"));
  if (!customer_id) return { error: "Unknown customer." };
  if (!(amount > 0)) return { error: "Enter an amount above zero." };
  return attempt("Could not record the payment.", async () => {
    await data.recordPayment({ customer_id, invoice_id, amount, note: String(formData.get("note") ?? "").slice(0, 200) });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function callAction(invoiceId, kind) {
  const id = toInt(invoiceId);
  if (!id || !["dispatch", "payment"].includes(kind)) return { error: "Unknown call." };
  return attempt("Bulbul could not place the call. Please try again.", async () => {
    const invoice = await data.getInvoice(id);
    if (!invoice) return { error: "Invoice not found." };
    const script = callScript(kind, invoice);
    const audio = await speak(script);
    await data.logCall({ invoice_id: id, kind, script });
    revalidatePath("/", "layout");
    return { script, audio, customer: invoice.customer, phone: invoice.phone };
  });
}

export async function updateItemAction(_prev, formData) {
  const id = toInt(formData.get("id"));
  const stock_qty = toInt(formData.get("stock_qty"));
  const sell_price = toMoney(formData.get("sell_price"));
  if (!id || !Number.isInteger(stock_qty) || !(sell_price >= 0)) return { error: "Enter a valid stock and price." };
  return attempt("Could not update the item.", async () => {
    await data.updateItem({ id, stock_qty, sell_price });
    revalidatePath("/", "layout");
    return { ok: true };
  });
}

export async function addItemAction(_prev, formData) {
  const name = String(formData.get("name") ?? "").trim().toUpperCase();
  const item = {
    name,
    category: String(formData.get("category") ?? "").trim() || "Uncategorized",
    unit: String(formData.get("unit") ?? "").trim() || "pc",
    stock_qty: toInt(formData.get("stock_qty")) || 0,
    cost_price: toMoney(formData.get("cost_price")) || 0,
    sell_price: toMoney(formData.get("sell_price")) || 0,
  };
  if (!name) return { error: "Add the item name." };
  return attempt("Could not add the item.", async () => {
    await data.addItem(item);
    revalidatePath("/", "layout");
    return { ok: true };
  });
}
