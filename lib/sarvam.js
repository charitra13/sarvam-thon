import { SarvamAIClient } from "sarvamai";

export const SHOP_NAME = "Track Desk Stationery";
const DONE = ["completed", "partially_completed", "failed", "rejected"];

function client() {
  if (!process.env.SARVAM_API_KEY) throw new Error("SARVAM_API_KEY is not set");
  return new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY, timeoutInSeconds: 40, maxRetries: 1 });
}

// Sarvam Vision (Doc AI parse) on a handwritten slip. Returns plain text.
export async function readSlip(file, language = "en-IN") {
  const c = client();
  const job = await c.docAi.parse({ file: [file], language, content_type: "handwritten" });
  const deadline = Date.now() + 45_000;
  let status = job.status;
  while (!DONE.includes(status)) {
    if (Date.now() > deadline) throw new Error("Sarvam Vision timed out");
    await new Promise((r) => setTimeout(r, 1200));
    status = (await c.docAi.getStatus(job.job_id)).status;
  }
  if (status === "failed" || status === "rejected") throw new Error(`Sarvam Vision job ${status}`);
  const result = await c.docAi.getResults(job.job_id);
  // The live API nests text in pages[].blocks[]; the SDK types describe pages[].content. Handle both.
  return (result.documents ?? [])
    .flatMap((d) => d.pages ?? [])
    .map((p) => p.content ?? [...(p.blocks ?? [])]
      .sort((a, b) => (a.reading_order ?? 0) - (b.reading_order ?? 0))
      .map((b) => b.text).join("\n"))
    .join("\n\n")
    .trim();
}

// sarvam-105b turns OCR text into a structured invoice, matching lines to inventory SKUs.
export async function matchSlip(text, items) {
  const catalog = items.map((i) => `${i.sku}|${i.name}|${i.unit}|${i.sell_price}`).join("\n");
  const response = await client().chat.completions({
    model: "sarvam-105b",
    reasoning_effort: null, // reasoning off: ~7s instead of ~50s, same match quality in testing
    temperature: 0.1,
    max_tokens: 3000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You digitise handwritten invoice slips for an Indian stationery and book shop.
Read the OCR text, then match every line item to the closest inventory SKU. Shop spellings vary (e.g. "Natraj" = NATARAJ, "rim" = REAM, "cl 8" = CLASS 8). Use sku null if nothing fits.

Slip format (printed Hindi bill book, may arrive as a table or as plain lines):
- Header: "M/s. <customer name> <bill number>" and "दिनांक <DD-MM-YYYY>".
- Each item row has columns in this fixed order:
  1. S.No: the printed row number 1-18. It is NOT a quantity. Never use it as qty.
  2. संख्या: quantity (unit count). This is always the SECOND number in the row.
  3. विवरण: item description.
  4. दर: rate per unit.
  5. धनराशि: line amount (qty x rate).
  6. % and कमीशन: commission, ignore.
- Ticks, strikes or circled marks (e.g. "①") beside the S.No are bookkeeping marks; the row is still an item.
- Rows with a S.No but no quantity and no description are blank: skip them.
- Rows that only have a number in the धनराशि column (running totals, packing/freight additions) and signatures are not items: skip them.
- A description starting with "—" or "-" repeats the item name from the row above with a new variant.
- In plain-text rows the last number is धनराशि and the number before it is दर; keep them in separate fields.
- A row holding only a bracketed note (e.g. "(5 - 100 पीस)") describes the row above: skip it.
- Copy qty, rate and amount cells exactly as written (e.g. "S0", "3/80", "946-80"). Do not convert or calculate them; use "" if a cell is empty. Columns can be shifted when a cell is empty, so place each value by meaning.
Reply with JSON only:
{"customer_name": string, "customer_phone": string, "invoice_no": string, "invoice_date": "YYYY-MM-DD" or "",
 "items": [{"sno": number, "description": विवरण text, "qty": संख्या text, "rate": दर text, "amount": धनराशि text, "sku": string|null, "confidence": 0..1}]}
Inventory (sku|name|unit|price):
${catalog}`,
      },
      { role: "user", content: labelSlipTable(text) },
    ],
  });
  const content = response.choices?.[0]?.message?.content ?? "";
  const json = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  const bySku = new Map(items.map((i) => [i.sku, i]));
  return {
    customer_name: String(json.customer_name ?? "").trim(),
    customer_phone: String(json.customer_phone ?? "").trim(),
    invoice_no: String(json.invoice_no ?? "").trim(),
    invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(json.invoice_date ?? "") ? json.invoice_date : "",
    items: (Array.isArray(json.items) ? json.items : []).filter((line) => String(line.description ?? "").trim()).map((line) => {
      const item = bySku.get(line.sku);
      const qty = Math.max(1, Math.round(slipNumber(line.qty) || 1));
      const amount = slipNumber(line.amount);
      const raw = [line.sno, line.qty, line.description, line.rate, line.amount].filter((v) => String(v ?? "").trim()).join(" | ");
      return {
        raw,
        item_id: item?.id ?? null,
        sku: item?.sku ?? null,
        name: item?.name ?? String(line.description).trim(),
        qty,
        // The written amount is read more reliably than the rate (whose "/" OCR often reads as "1").
        unit_price: (amount ? Math.round((amount / qty) * 100) / 100 : slipNumber(line.rate)) || item?.sell_price || 0,
        confidence: item ? Math.min(1, Math.max(0, Number(line.confidence) || 0.5)) : 0,
      };
    }),
  };
}

// Doc AI's markdown table header has no S.No column, so every column looks shifted by one.
// Drop the header and label data rows by position so the model reads S.No and qty correctly.
function labelSlipTable(text) {
  return text.split("\n").filter((line) => !/^\|[\s|:-]+\|$/.test(line.trim()) && !/संख्या/.test(line)).map((line) => {
    if (!line.trim().startsWith("|")) return line;
    const [sno, qty = "", item = "", rate = "", amount = ""] = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    return /\d/.test(sno) ? `S.No ${sno} | qty ${qty} | item ${item} | rate ${rate} | amount ${amount}` : line;
  }).join("\n");
}

// Reads a handwritten slip cell: S=5, O=0, l/I/|=1; "/", "-" or "=" before 1-2 trailing digits marks paise.
export function slipNumber(cell) {
  const s = String(cell ?? "").replace(/[Ss]/g, "5").replace(/[Oo]/g, "0").replace(/[lI|]/g, "1")
    .replace(/(\d)\s*[/=-]\s*(\d{1,2})(?!\d)/, "$1.$2");
  return Number(s.match(/\d+(\.\d+)?/)?.[0] ?? 0);
}

const rupees = (n) => Math.round(n).toLocaleString("en-IN"); // commas keep Bulbul reading the whole number

export function callScript(kind, invoice) {
  const name = invoice.customer;
  const bill = invoice.invoice_no || invoice.id;
  if (kind === "dispatch") {
    const items = invoice.lines.slice(0, 2).map((l) => l.name.toLowerCase()).join(" aur ");
    return `Namaste ${name} ji! Main ${SHOP_NAME} se Simran bol rahi hoon. Aapke liye ek good news hai, aapka order, bill number ${bill}, aaj dispatch ho gaya hai. Isme ${invoice.lines.length} items hain, jaise ${items}. Total amount ${rupees(invoice.total)} rupaye hai. Delivery jaldi aap tak pahunch jayegi. Koi bhi sawaal ho toh isi number par call kar lijiye. Dhanyavaad!`;
  }
  const due = invoice.total - invoice.paid;
  return `Namaste ${name} ji, main ${SHOP_NAME} se Simran bol rahi hoon. Bas ek chhota sa reminder tha, bill number ${bill} ka ${rupees(due)} rupaye ka payment abhi pending hai. Jab aapko convenient ho, please UPI ya cash se clear kar dijiye. Agar payment already ho chuka hai, toh please is call ko ignore kariye. Thank you, aapka din shubh ho!`;
}

// Bulbul v4 female Hinglish voice. Returns a data URL the browser can play.
export async function speak(text) {
  const response = await client().textToSpeech.convert({
    model: "bulbul:v4-flash",
    speaker: "simran_enhi_customer",
    language_code: "hi-IN",
    text,
  });
  return `data:audio/wav;base64,${response.audios[0]}`;
}
