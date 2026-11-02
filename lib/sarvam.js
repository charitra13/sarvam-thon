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
Ignore header, total and signature lines. Quantities and rates are numbers on the same line; if the rate is missing use null.
Reply with JSON only:
{"customer_name": string, "customer_phone": string, "invoice_no": string, "invoice_date": "YYYY-MM-DD" or "",
 "items": [{"raw": original line text, "sku": string|null, "qty": number, "unit_price": number|null, "confidence": 0..1}]}
Inventory (sku|name|unit|price):
${catalog}`,
      },
      { role: "user", content: text },
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
    items: (Array.isArray(json.items) ? json.items : []).map((line) => {
      const item = bySku.get(line.sku);
      return {
        raw: String(line.raw ?? ""),
        item_id: item?.id ?? null,
        sku: item?.sku ?? null,
        name: item?.name ?? String(line.raw ?? ""),
        qty: Math.max(1, Math.round(Number(line.qty) || 1)),
        unit_price: Number(line.unit_price) || item?.sell_price || 0,
        confidence: item ? Math.min(1, Math.max(0, Number(line.confidence) || 0.5)) : 0,
      };
    }),
  };
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
