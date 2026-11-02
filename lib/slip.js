// Reads the printed bill-book layout from OCR text without any model or catalog:
// S.No | संख्या (qty) | विवरण (description) | दर (rate) | धनराशि (amount).
// Everything read here is kept as-is; inventory matching later only adds a SKU.

const CIRCLED = "[①-⑳❶-❿]";
const circled = (ch) => {
  const c = ch.codePointAt(0);
  return c >= 0x2776 ? c - 0x2775 : c - 0x245f;
};
const SEP = /^[-—–=~|/\\,.:;_*]+$/;
const TOTAL_WORDS = /राउ?ं?ड|राऊड|योग|कुल|जोड़?|टोटल|total|round|g\.?\s*total/i;
const TOTAL_LINE = /^(?:राउ?ं?ड|राऊड|योग|कुल|जोड़?|टोटल|(?:grand\s+|g\.?\s*)?total|round(?:ed)?|carried\s+forward|balance\s+brought)\b|^(?:कुल|योग|जोड़|राऊड|टोटल)(?:\s|:|$)/i;
const CHARGE_LINE = /^(?:packing|delivery|freight|postage|charges?|पैकिंग|भाड़ा)(?:\s|:|$)/i;
const HEADER_WORDS = /संख्या|विवरण|धनराशि|कमीशन/;
export const MONEY_TOLERANCE = 0.5; // handwritten amounts round paise; 3 × 333.33 is written 1000

const round2 = (n) => Math.round(n * 100) / 100;
export const amountsAgree = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= MONEY_TOLERANCE + 1e-9;
const agree = amountsAgree;
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

// Handwriting look-alikes: S=5, O=0, l/I/|=1. Only applied to tokens that already hold a digit.
function digits(token) {
  const t = String(token ?? "").replace(/[०-९]/g, (d) => d.charCodeAt(0) - 0x966);
  return /\d/.test(t) ? t.replace(/[Ss]/g, "5").replace(/[Oo]/g, "0").replace(/[lI|]/g, "1") : t;
}

// One money cell, e.g. "4/10" = 4.10, "2812-50" = 2812.50, "25/-" = 25, "3130-" = 3130, "0" = 0.
// Returns null when the cell holds no figure (missing is not zero).
export function readFigure(cell) {
  const raw = String(cell ?? "").trim();
  if (/^-\d/.test(raw)) return null;
  const t = digits(raw.replace(/^[—–=~(]+/, "").replace(/[-—–=~,;:)|/]+$/, ""));
  const m = t.match(/^(\d+)(?:([/=.-])(\d{1,2}))?$/);
  if (!m) return null;
  if (!Number.isFinite(Number(m[1]))) return null;
  const guessed = /[SsOoIl|]/.test(raw);
  if (!m[3]) return { text: raw, value: Number(m[1]), digits: m[1], sep: false, guessed };
  const paise = m[2] === "." ? Number(`0.${m[3]}`) : Number(m[3].padEnd(2, "0")) / 100;
  return { text: raw, value: round2(Number(m[1]) + paise), digits: m[1] + m[3], sep: true, guessed };
}

// Other ways OCR commonly garbles a handwritten rate. Only used when the written amount confirms one.
function rateReadings(figure) {
  const out = [];
  const d = figure.digits;
  if (figure.sep) out.push({ value: Number(d), why: "with the slash read as a digit" });
  else {
    // "901" is "90/-": the "/-" after whole rupees is often read as one more digit.
    if (d.length >= 2) out.push({ value: Number(d.slice(0, -1)), why: `as ${d.slice(0, -1)}/-` });
    // "2140" is "2/40": a "/" before the paise is often read as "1" or "7".
    for (let i = 1; i <= d.length - 3; i++) {
      if ((d[i] === "1" || d[i] === "7") && d.length - i - 1 === 2) {
        out.push({ value: round2(Number(d.slice(0, i)) + Number(d.slice(i + 1)) / 100), why: `as ${d.slice(0, i)}/${d.slice(i + 1)}` });
      }
    }
  }
  return out;
}

export function readQty(token) {
  const raw = String(token ?? "").replace(/^\(|\)$/g, "");
  if (/^[Ss]$/.test(raw)) return { value: 5, guessed: true };
  const t = digits(raw).replace(/[-=.,]+$/, "");
  return /^\d{1,5}$/.test(t) ? { value: Number(t), guessed: /[A-Za-z|]/.test(raw) } : null;
}

const hasWords = (s) => /\p{L}[\p{L}\p{M}]+/u.test(s.replace(/[A-Za-z]?\d+[A-Za-z]?/g, ""));
// Trims separators and marks around a description; keeps a printed price such as "25/-".
const cleanDescription = (s) => s.replace(new RegExp(CIRCLED, "g"), "").replace(/^[\s\-—–=~|.,:;]+|(?<!\/)[\s\-—–=~|.,:;]+$/g, "").replace(/\s+/g, " ").trim();
const continuedDescription = (s) => {
  const tail = s.trim().match(/^[-—–](?:\s+|$)(.*)/)?.[1];
  return tail !== undefined && !/^(?:pen(?:cil)?|ballpen|eraser|copy|पेन|पेसिल|पेंसिल|कॉपी|रबर)(?:\s|$)/i.test(tail);
};

// Splits one plain-text row after its S.No into qty, description, rate and amount.
function splitPlain(rest) {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  const qty = tokens.length > 1 ? readQty(tokens[0]) : null;
  if (qty) tokens.shift();
  const continued = continuedDescription(tokens.join(" "));
  const figures = [];
  while (tokens.length && figures.length < 2) {
    const last = tokens[tokens.length - 1];
    if (SEP.test(last) || new RegExp(`^${CIRCLED}$`).test(last)) { tokens.pop(); continue; }
    if (!readFigure(last)) break;
    figures.unshift(tokens.pop());
  }
  const [rate, amount] = figures.length === 2 ? figures : ["", figures[0] ?? ""];
  return { qty, qtyText: qty ? rest.trim().split(/\s+/)[0] : "", description: cleanDescription(tokens.join(" ")), rate, amount, continued, single: figures.length === 1 };
}

// A model may identify an unnumbered source line, but its numeric cells are still read here.
// In a fallback layout even an amount cannot prove a rate until the person checks the photo.
export function parseSourceRow(raw) {
  const parts = raw.includes("|") ? raw.replace(/^\||\|$/g, "").split("|").map((s) => s.trim()) : null;
  const parsed = parts?.length === 4
    ? { qty: readQty(parts[0]), qtyText: parts[0], description: cleanDescription(parts[1]), rate: parts[2], amount: parts[3], continued: continuedDescription(parts[1]), single: false }
    : splitPlain(raw);
  if ((!parsed.qty && (TOTAL_LINE.test(parsed.description) || CHARGE_LINE.test(parsed.description))) || HEADER_WORDS.test(parsed.description) || /^M\s*\/\s*s\b/i.test(parsed.description)) return null;
  return rowFromCells(parsed, { raw, sno: null, mark: "", layout: "model" });
}

function rowFromCells(parsed, { raw, sno, mark, layout }) {
  return {
    sno, mark, raw, layout, description: parsed.description,
    qty_text: parsed.qtyText, rate_text: parsed.rate, amount_text: parsed.amount,
    qty: parsed.qty?.value ?? null, qty_guessed: parsed.qty?.guessed ?? false,
    continued: parsed.continued, single_figure: parsed.single, notes: [],
  };
}

function parseHeader(lines) {
  const header = { customer_name: "", customer_phone: "", invoice_no: "", invoice_date: "" };
  const text = lines.join(" ");
  const date = text.match(/(\d{1,2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{4}|\d{2})(?!\d)/);
  if (date) {
    const [d, m, y] = [Number(date[1]), Number(date[2]), Number(date[3].length === 2 ? `20${date[3]}` : date[3])];
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const check = new Date(`${iso}T00:00:00Z`);
    if (check.getUTCMonth() + 1 === m && check.getUTCDate() === d) header.invoice_date = iso;
  }
  header.customer_phone = text.match(/(?<!\d)(?:\+?91[-\s]?)?([6-9]\d{9})(?!\d)/)?.[1] ?? "";
  const ms = lines.find((line) => /M\s*\/\s*s\.?/i.test(line));
  if (ms) {
    let rest = ms.replace(/^.*?M\s*\/\s*s\.?/i, "").replace(date?.[0] ?? "\u0000", " ").replace(/दिनांक|date\s*:?/gi, " ").trim();
    const number = rest.match(/(?:^|\s)(\d{1,6})\s*$/);
    if (number) {
      header.invoice_no = number[1];
      rest = rest.slice(0, number.index);
    }
    header.customer_name = rest.replace(/\s+/g, " ").trim();
  }
  return header;
}

// Turns OCR text into header fields, item rows and the other figures on the slip (totals, carried
// balances, packing charges). Nothing is dropped silently: non-item lines come back as figures or notes.
export function parseSlip(text) {
  const lines = String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const headerLines = [];
  const rows = [];
  const figures = [];
  const notes = [];
  const rowStart = new RegExp(`^(?:(${CIRCLED})\\s*)?(\\d{1,2}|${CIRCLED})(?:\\s*[.)])?(?:\\s+(.*))?$`);

  for (const line of lines) {
    if (/^\|[\s|:-]+\|$/.test(line)) continue;
    if (HEADER_WORDS.test(line) && !/\d{2,}/.test(line.replace(/\d{1,2}\s*%/, ""))) continue;
    let sno = null;
    let mark = "";
    let cells = null;
    let rest = "";
    if (line.startsWith("|")) {
      const parts = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const first = parts[0].match(new RegExp(`^(${CIRCLED})?\\s*(\\d{1,2}|${CIRCLED})$`));
      if (first && parts.length >= 3) {
        mark = first[1] && first[2] ? first[1] : "";
        sno = /\d/.test(first[2]) ? Number(first[2]) : circled(first[2]);
        cells = parts.slice(1);
      } else rest = parts.join(" ");
    } else {
      const m = line.match(rowStart);
      if (m && m[3] !== undefined && !(m[1] && !m[3])) {
        mark = m[1] ?? "";
        sno = /\d/.test(m[2]) ? Number(m[2]) : circled(m[2]);
        rest = m[3];
      } else if (m && m[3] === undefined) continue; // a bare S.No: blank row
      else rest = line;
    }

    if (sno === null) {
      // Lines without a S.No are header text, totals, signatures or wrapped notes; never items.
      if (!rows.length) headerLines.push(line);
      else if (/^\(.*\)$/.test(rest)) rows.at(-1).notes.push(rest);
      else if (readFigureIn(rest)) figures.push({ sno: null, text: line, value: readFigureIn(rest).value, total: TOTAL_WORDS.test(rest) || !hasWords(rest) });
      else notes.push(line);
      continue;
    }

    let parsed;
    if (cells) {
      const [qtyText = "", description = "", rate = "", amount = ""] = cells;
      const qty = readQty(qtyText);
      parsed = { qty, qtyText, description: cleanDescription(description), rate, amount, continued: continuedDescription(description), single: false, layout: "table" };
    } else parsed = { ...splitPlain(rest), layout: "plain" };

    if (!parsed.qty && (TOTAL_LINE.test(parsed.description) || CHARGE_LINE.test(parsed.description))) {
      const figure = readFigure(parsed.amount) ?? readFigure(parsed.rate) ?? readFigureIn(rest);
      if (figure) figures.push({ sno, text: line, value: figure.value, total: TOTAL_LINE.test(parsed.description) });
      else notes.push(line);
      continue;
    }
    if (!hasWords(parsed.description) && !parsed.qty) {
      // S.No with only a figure: running total, carried balance or a charge such as packing.
      const value = readFigure(parsed.amount)?.value ?? readFigure(parsed.rate)?.value ?? parsed.qty?.value;
      if (value !== undefined && value !== null) figures.push({ sno, text: line, value, total: true });
      else notes.push(line);
      continue;
    }
    if (/^\(.*\)$/.test(parsed.description) && !parsed.qty && rows.length) {
      rows.at(-1).notes.push(parsed.description);
      continue;
    }
    rows.push(rowFromCells(parsed, { sno, mark, raw: line, layout: parsed.layout }));
  }
  return { ...parseHeader(headerLines), rows, figures, notes };
}

function readFigureIn(s) {
  const tokens = String(s).split(/\s+/).filter((t) => !SEP.test(t));
  for (let i = tokens.length - 1; i >= 0; i--) {
    const f = readFigure(tokens[i]);
    if (f) return f;
  }
  return null;
}

// Works out the unit price for one row and every doubt about it. Never invents a quantity or a rate:
// a figure that cannot be confirmed is either left empty or offered as a suggestion that must be checked.
export function checkRow(row) {
  const issues = [];
  const check = (message) => issues.push({ level: "check", message });
  const qty = row.qty;
  const rate = readFigure(row.rate_text);
  const amount = readFigure(row.amount_text);
  let unit = null;

  if (!row.description.trim()) check("Item description not found. Enter a custom name or choose an inventory item.");
  if (qty === null) check("Quantity not found on the slip. Enter it from the photo.");
  else if (qty === 0) check("Quantity reads 0. Check the photo.");
  else if (row.qty_guessed) check(`Quantity read from “${row.qty_text}” as ${qty}. Check the photo.`);
  if (rate?.guessed || amount?.guessed) check(`A letter or mark was read as a digit in ${[rate?.guessed && `rate “${row.rate_text}”`, amount?.guessed && `amount “${row.amount_text}”`].filter(Boolean).join(" and ")}. Confirm against the photo.`);

  if (qty) {
    if (rate && amount) {
      if (agree(qty * rate.value, amount.value)) unit = rate.value;
      else {
        const alt = rateReadings(rate).find((r) => agree(qty * r.value, amount.value));
        if (alt) {
          unit = alt.value;
          check(`Suggested rate: “${rate.text}” read ${alt.why}: ${qty} × ${fmt(alt.value)} = ${fmt(amount.value)}, the written amount. Confirm against the photo.`);
        } else {
          unit = round2(amount.value / qty);
          check(`Slip rate “${rate.text}” (${fmt(rate.value)}) × ${qty} = ${fmt(round2(qty * rate.value))}, but the amount reads ${fmt(amount.value)}. Suggested rate ${fmt(unit)} comes from the amount. Confirm against the photo.`);
        }
      }
    } else if (amount) {
      unit = round2(amount.value / qty);
      if (row.single_figure) check(`Only one figure, “${amount.text}”, was found after the item. It was taken as the line amount (rate ${fmt(unit)}), but it could be a printed price. Confirm.`);
      else check(`No rate written. Suggested rate ${fmt(unit)} comes from the amount ${fmt(amount.value)} ÷ ${qty}. Confirm against the photo.`);
    } else if (rate) {
      unit = rate.value;
      check(`No amount written to double-check the rate “${rate.text}”. Confirm it.`);
    } else check("No rate or amount on the slip. Enter the rate.");
  } else if (rate || amount) {
    if (rate) unit = rate.value;
  }

  const amountValue = amount?.value ?? null;
  const lineTotal = unit !== null && qty && amountValue !== null && agree(qty * unit, amountValue) ? amountValue : null;
  return { rate: rate?.value ?? null, amount: amountValue, unit_price: unit, line_total: lineTotal, issues };
}

// Compares the first total written after the items with the sum of the lines; lists every other figure.
export function checkTotals(lines, figures) {
  const warnings = [];
  const amounts = lines.map((l) => l.line_total ?? l.amount ?? (l.qty && l.unit_price !== null ? l.qty * l.unit_price : null));
  const total = figures.find((f) => f.total);
  if (total && amounts.length && amounts.every((a) => a !== null)) {
    const sum = round2(amounts.reduce((s, a) => s + a, 0));
    if (Math.abs(sum - total.value) > 1) warnings.push({ level: "check", message: `The slip total reads ${fmt(total.value)}, but the lines add up to ${fmt(sum)}. One amount or the total may be misread.` });
    else if (sum !== total.value) warnings.push({ level: "info", message: `The slip total ${fmt(total.value)} matches the lines (${fmt(sum)}) after rounding.` });
  }
  const others = figures.filter((f) => f !== total);
  if (others.length) {
    warnings.push({ level: "info", message: `Other figures on the slip were not added as items (running totals, carried balances or charges such as packing): ${others.map((f) => `“${f.text}”`).join(", ")}. Add a line yourself if one should be billed.` });
  }
  return warnings;
}
