import { SarvamAIClient } from "sarvamai";
import { parseSlip, parseSourceRow, checkRow, checkTotals } from "./slip.js";
import { buildIndex, findCandidates, lookalikes, candidateConflict, contextualDescription } from "./catalog.js";

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

const MODEL_LINES = 18; // one printed slip page; keeps each prompt and reply small
const MODEL_TIMEOUT = { timeoutInSeconds: 25, maxRetries: 1 };

// The default model seam: one bounded sarvam-105b JSON call. Tests pass their own `complete`.
async function sarvamComplete(messages, maxTokens) {
  const response = await client().chat.completions({
    model: "sarvam-105b",
    reasoning_effort: null, // reasoning off: ~7s instead of ~50s
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages,
  }, MODEL_TIMEOUT);
  return response.choices?.[0]?.message?.content ?? "";
}

function parseJson(content) {
  const s = String(content ?? "");
  try {
    return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
  } catch {
    throw new Error("The slip response was incomplete. Please retry matching.");
  }
}

const PICK_PROMPT = `You match lines from a handwritten Indian stationery shop slip to inventory items.
Each line has its own short list of candidates. Pick the one candidate that is the same product: brand, product type, model or variant, size or printed price (e.g. 25/-) and pack (pcs, pkt, jar) must all fit.
Slip text may be Hindi, transliterated or shorthand: "Natraj" = NATRAJ, "rim" = a ream of paper, "कॉपी" = copy (notebook), "पीस" = pieces.
The rate is only a weak hint. It cannot establish pack size, product kind or identity on its own; do not infer pcs versus pkt from price.
If no candidate clearly fits, or two or more fit equally well, use null. Only use candidate ids listed under that line.
Reply with JSON only: {"lines":[{"line":<line number>,"pick":"<candidate id>"|null,"confidence":<0..1>}]}`;

// Asks the model to choose among each line's own candidates. Returns Map(line index → {key, confidence}).
async function pickCandidates(work, complete) {
  const picks = new Map();
  for (let start = 0; start < work.length; start += MODEL_LINES) {
    const chunk = work.slice(start, start + MODEL_LINES);
    const prompt = chunk.map((w) => {
      const facts = [w.row.qty !== null && `qty ${w.row.qty}`, w.numbers.unit_price !== null && `rate per unit ${w.numbers.unit_price}`].filter(Boolean).join(" · ");
      const context = w.context ? ` (continues the line above: “${w.context}”)` : "";
      const options = w.found.candidates.map((c, i) => `  c${i + 1} ${c.item.name} | ${c.item.unit} | ₹${c.item.sell_price}`).join("\n");
      return `Line ${w.n}: “${w.row.description}”${context}${facts ? ` · ${facts}` : ""}\n${options}`;
    }).join("\n\n");
    const json = parseJson(await complete([
      { role: "system", content: PICK_PROMPT },
      { role: "user", content: prompt },
    ], 128 + chunk.length * 80));
    if (!Array.isArray(json?.lines) || json.lines.length !== chunk.length) throw new Error("Some item matches were missing. Please retry matching.");
    const answered = new Set();
    for (const answer of json.lines) {
      const w = chunk.find((entry) => entry.n === answer?.line);
      if (!w || answered.has(w.n) || !Object.hasOwn(answer, "pick") || (answer.pick !== null && typeof answer.pick !== "string")) {
        throw new Error("Some item matches were unreadable. Please retry matching.");
      }
      answered.add(w.n);
      if (answer.pick === null) { picks.set(w.n, { item: null, confidence: 0 }); continue; }
      const index = /^c(\d+)$/i.exec(String(answer.pick).trim())?.[1];
      const candidate = index ? w.found.candidates[Number(index) - 1] : undefined;
      const confidence = Number.isFinite(answer.confidence) ? Math.min(1, Math.max(0, answer.confidence)) : 0.5;
      picks.set(w.n, candidate ? { item: candidate.item, confidence } : { invalid: true });
    }
  }
  return picks;
}

const STRUCTURE_PROMPT = `Identify item source lines in OCR text from a printed Hindi bill book whose layout was not recognised.
Each source line is labelled with its source_line number. Select only lines containing an item, excluding headings, customer names, signatures, totals, balances and standalone charges.
Never invent a line or join lines. The application will copy the original text and parse numeric cells itself.
Reply with JSON only: {"items":[{"source_line":<source line number>}]}. Use an empty array if no item line is readable.`;

// Fallback when the text does not look like the bill-book layout at all. Its rows always need review.
async function structureWithModel(text, complete) {
  const source = String(text).split("\n").map((raw, i) => ({ raw, n: i + 1 })).filter((line) => line.raw.trim());
  const selected = new Set();
  for (let start = 0; start < source.length; start += MODEL_LINES) {
    const chunk = source.slice(start, start + MODEL_LINES);
    const json = parseJson(await complete([
      { role: "system", content: STRUCTURE_PROMPT },
      { role: "user", content: chunk.map((line) => `source_line ${line.n}: ${line.raw}`).join("\n") },
    ], 128 + chunk.length * 40));
    if (!Array.isArray(json?.items)) throw new Error("The slip rows could not be read. Please retry with a clearer photo.");
    for (const answer of json.items) {
      if (!chunk.some((line) => line.n === answer?.source_line) || selected.has(answer.source_line)) {
        throw new Error("The slip rows could not be checked against the text. Please retry.");
      }
      selected.add(answer.source_line);
    }
  }
  const rows = source.filter((line) => selected.has(line.n)).map((line) => parseSourceRow(line.raw));
  if (rows.some((row) => !row)) throw new Error("A slip note was mistaken for an item. Please retry matching.");
  if (!rows.length) throw new Error("No item rows were readable. Please retry with a clearer photo.");
  return { rows, notes: source.filter((line) => !selected.has(line.n)).map((line) => line.raw) };
}

// Turns OCR text into invoice lines. Rows and numbers come from the slip layout (lib/slip.js);
// sarvam-105b only picks each line's SKU from that line's shortlist and can never change a figure.
export async function matchSlip(text, items, { aliases = [], complete = sarvamComplete } = {}) {
  if (typeof text !== "string" || !text.trim()) throw new Error("No readable slip text. Please retry with a clearer photo.");
  if (text.length > 16000 || text.split("\n").length > 180) throw new Error("This slip is too long. Please scan one page at a time.");
  const slip = parseSlip(text);
  let { rows } = slip;
  if (!rows.length && String(text ?? "").trim()) {
    const structured = await structureWithModel(text, complete);
    rows = structured.rows;
    slip.notes = structured.notes;
  }
  const index = buildIndex(items, aliases);
  let fullDescription = "";
  const work = rows.map((row, i) => {
    const context = row.continued ? fullDescription : "";
    if (!row.continued) fullDescription = row.description;
    return { n: i + 1, row, context, numbers: checkRow(row), found: findCandidates(index, row.description, context) };
  });
  const picks = await pickCandidates(work.filter((w) => w.found.candidates.length && !w.found.alias), complete);

  const lines = work.map(({ n, row, context, numbers, found }) => {
    const issues = [...numbers.issues];
    const check = (message) => issues.push({ level: "check", message });
    const info = (message) => issues.push({ level: "info", message });
    const candidateIds = found.candidates.map((c) => c.item.id);
    const pick = picks.get(n);
    let item = found.alias ? index.byId.get(found.alias).item : pick?.item ?? null;
    let confidence = found.alias ? 0.95 : pick?.confidence ?? 0;
    let ambiguous = [];
    if (row.layout === "model") check("The slip layout was not recognised. This is an original source line; check every column against the photo.");
    if (row.continued && !context) check("This row looks like a continued variant, but its preceding item was not found. Choose the item.");
    for (const note of row.notes) info(`Note under this row on the slip: ${note}`);
    if (found.alias) info("Matched by a name the shop confirmed earlier.");
    else if (pick?.invalid) check("Sarvam-105B chose an item outside this line's shortlist, so it was ignored. Choose the item.");
    if (found.alias_conflicts?.length) check("This name has been confirmed for several inventory items. Choose the correct variant; the alias alone cannot decide.");
    if (item) {
      const conflict = candidateConflict(contextualDescription(row.description, context), item);
      if (conflict) { check(`${item.name} conflicts with the slip's ${conflict}. The match was ignored; choose an item or keep a custom line.`); item = null; confidence = 0; }
    }
    if (item && !found.alias) {
      ambiguous = lookalikes(index, item.id, candidateIds, contextualDescription(row.description, context));
      if (ambiguous.length) {
        confidence = Math.min(confidence, 0.5);
        const names = ambiguous.slice(0, 4).map((id) => { const other = index.byId.get(id).item; return `${other.name} (${other.unit}, ₹${other.sell_price})`; });
        check(`Several items fit “${row.description}”: ${item.name} (${item.unit}, ₹${item.sell_price}) or ${names.join(", ")}. Pick the right one.`);
      } else if (found.weak || confidence < 0.6) {
        confidence = Math.min(confidence, 0.5);
        check(`“${row.description}” only loosely matches ${item.name}. Confirm or choose another item.`);
      }
    }
    if (!item) check(found.candidates.length ? "No sure match. Pick from the suggestions, or confirm this as a custom item (stock is not changed)." : "Nothing similar in inventory. Confirm this as a custom item (stock is not changed).");
    return {
      raw: row.raw, sno: row.sno, description: row.description, context,
      qty_text: row.qty_text, rate_text: row.rate_text, amount_text: row.amount_text,
      qty: row.qty, rate: numbers.rate, amount: numbers.amount, unit_price: numbers.unit_price, line_total: numbers.line_total,
      item_id: item?.id ?? null, sku: item?.sku ?? null, name: item?.name ?? row.description,
      confidence: item ? confidence : 0,
      candidates: found.candidates.map(({ item: c }) => ({ id: c.id, sku: c.sku, name: c.name, unit: c.unit, sell_price: c.sell_price })),
      ambiguous_with: ambiguous, issues, needs_review: issues.some((issue) => issue.level === "check"),
    };
  });

  return {
    customer_name: slip.customer_name, customer_phone: slip.customer_phone,
    invoice_no: slip.invoice_no, invoice_date: slip.invoice_date,
    items: lines, warnings: checkTotals(lines, slip.figures), notes: slip.notes,
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
