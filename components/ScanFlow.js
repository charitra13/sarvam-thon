"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readSlipAction, matchSlipAction, saveInvoiceAction } from "../app/actions.js";
import styles from "./ScanFlow.module.css";

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const steps = ["Sarvam Vision reading the slip", "Sarvam-105B matching inventory", "Review"];

async function prepareImage(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("image");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size > 3 * 1024 * 1024) throw new Error("size");
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "slip"}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Owns one slip's preview URL, so it is freed when that slip is removed.
function SlipPhoto({ file, alt }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // Local object URL; the original photo never goes through image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} className={styles.photo} /> : null;
}

export default function ScanFlow({ items = [] }) {
  const router = useRouter();
  const id = useId();
  const nextLine = useRef(0);
  const nextSlip = useRef(0);
  const work = useRef(false);
  const mounted = useRef(true);
  const reviewHeading = useRef(null);
  // Each slip keeps its OCR text and match result, so a retry only redoes the slips that failed.
  const [slips, setSlips] = useState([]);
  const [progress, setProgress] = useState(0);
  const [language, setLanguage] = useState("en-IN");
  const [stage, setStage] = useState("upload");
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [failedAt, setFailedAt] = useState(null);
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [bill, setBill] = useState({ number: "", date: "" });
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const busy = preparing || stage === "reading" || stage === "matching" || saving;
  const activeStep = stage === "reading" ? 0 : stage === "matching" ? 1 : stage === "review" ? 2 : -1;
  const many = slips.length > 1;
  const counter = many && (stage === "reading" || stage === "matching") ? ` (${progress + 1} of ${slips.length})` : "";
  const ocr = slips.map((slip, index) => slip.text && (many ? `— Slip ${index + 1} —\n${slip.text}` : slip.text)).filter(Boolean).join("\n\n");
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const item of items) {
      const category = item.category || "Other";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(item);
    }
    return Array.from(groups);
  }, [items]);
  const itemsById = useMemo(() => new Map(items.map((item) => [String(item.id), item])), [items]);
  const total = lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unit_price) || 0), 0);
  const quantities = lines.reduce((map, line) => {
    if (line.item_id) map.set(String(line.item_id), (map.get(String(line.item_id)) || 0) + (Number(line.qty) || 0));
    return map;
  }, new Map());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (stage === "review") reviewHeading.current?.focus();
  }, [stage]);

  async function addSlips(files, sample = false) {
    if (work.current) return;
    work.current = true;
    setPreparing(true);
    setError("");
    setFailedAt(null);
    const failed = [];
    try {
      let sources = files;
      if (sample) {
        const response = await fetch("/sample-slip.png");
        if (!response.ok) throw new Error("sample");
        sources = [new File([await response.blob()], "sample-slip.png", { type: "image/png" })];
      }
      const added = [];
      // One photo at a time: decoding several full-size phone photos at once can run a phone out of memory.
      for (const source of sources) {
        try {
          added.push({ key: nextSlip.current++, file: await prepareImage(source), text: "", result: null });
        } catch {
          failed.push(source.name || "a photo");
        }
      }
      if (!mounted.current) return;
      if (added.length) {
        setSlips((current) => [...current, ...added]);
        setStage("upload");
        setLines([]);
      }
      if (failed.length) throw new Error("image");
    } catch {
      if (mounted.current) setError(sample
        ? "The sample slip couldn’t be loaded. Try again, or choose a photo."
        : `We couldn’t open ${failed.join(", ") || "this photo"}. Try a JPG, PNG or WebP image, or take a fresh photo.`);
    } finally {
      work.current = false;
      if (mounted.current) setPreparing(false);
    }
  }

  function pick(event) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) addSlips(files);
  }

  function removeSlip(key) {
    if (work.current) return;
    setSlips((current) => current.filter((slip) => slip.key !== key));
    setStage("upload");
    setLines([]);
    setFailedAt(null);
    setError("");
  }

  async function scan() {
    if (!slips.length || work.current) return;
    work.current = true;
    setError("");
    const texts = slips.map((slip) => slip.text);
    const results = slips.map((slip) => slip.result);
    const keep = (key, patch) => setSlips((current) => current.map((slip) => slip.key === key ? { ...slip, ...patch } : slip));
    let step = "reading";
    let index = 0;
    try {
      // Read every slip first, then match each one, so the progress steps only move forward.
      for (index = 0; index < slips.length; index++) {
        if (texts[index]) continue;
        setProgress(index);
        setStage("reading");
        const data = new FormData();
        data.set("file", slips[index].file);
        data.set("language", language);
        const result = await readSlipAction(data);
        if (result?.error || !result?.text?.trim()) throw new Error("read");
        if (!mounted.current) return;
        texts[index] = result.text;
        keep(slips[index].key, { text: result.text });
      }
      step = "matching";
      for (index = 0; index < slips.length; index++) {
        if (results[index]) continue;
        setProgress(index);
        setStage("matching");
        const result = await matchSlipAction(texts[index]);
        if (result?.error || !Array.isArray(result?.items)) throw new Error("match");
        if (!mounted.current) return;
        results[index] = result;
        keep(slips[index].key, { result });
      }
      // The slips are one customer's bill: the first name, phone and date found win; every bill number and line is kept.
      const first = (field) => results.find((result) => result[field])?.[field] || "";
      const date = first("invoice_date");
      setCustomer({ name: first("customer_name"), phone: first("customer_phone") });
      setBill({ number: [...new Set(results.map((result) => result.invoice_no).filter(Boolean))].join(", "), date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "" });
      setLines(results.flatMap((result) => result.items).map((line) => {
        const item = itemsById.get(String(line.item_id));
        return {
          key: nextLine.current++, raw: line.raw || "", item_id: item?.id ?? null,
          name: item?.name || line.name || line.raw || "", qty: line.qty ?? 1,
          unit_price: line.unit_price ?? "", confidence: Math.max(0, Math.min(1, Number(line.confidence) || 0)),
        };
      }));
      setFailedAt(null);
      setStage("review");
    } catch {
      if (!mounted.current) return;
      setFailedAt(step);
      setStage("upload");
      setError(step === "reading"
        ? `We couldn’t read ${many ? `slip ${index + 1}` : "the slip"} clearly. Try again, or choose a brighter, sharper photo.`
        : `${many ? `Slip ${index + 1}` : "The slip"} was read, but inventory matching didn’t finish. Retry matching; your ${many ? "photos" : "photo"} and text are safe.`);
    } finally {
      work.current = false;
    }
  }

  function updateLine(key, patch) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  function selectItem(line, value) {
    const item = itemsById.get(value);
    updateLine(line.key, item ? {
      item_id: item.id, name: item.name, confidence: 1,
      unit_price: line.unit_price === "" || line.unit_price == null ? item.sell_price : line.unit_price,
    } : { item_id: null, confidence: 0 });
  }

  async function save(event) {
    event.preventDefault();
    if (work.current) return;
    if (!customer.name.trim() || !lines.length || lines.some((line) => !line.name.trim() || !Number.isInteger(Number(line.qty)) || Number(line.qty) <= 0 || line.unit_price === "" || !Number.isFinite(Number(line.unit_price)) || Number(line.unit_price) < 0)) {
      setError("Add a customer name and at least one item. Check that every line has a name, a whole quantity above zero and a valid rate.");
      return;
    }
    work.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await saveInvoiceAction({
        customer: { name: customer.name.trim(), phone: customer.phone.trim() },
        invoice_no: bill.number.trim(), invoice_date: bill.date, ocr_text: ocr,
        lines: lines.map((line) => ({ item_id: line.item_id, raw_text: line.raw, name: line.name.trim(), qty: Number(line.qty), unit_price: Number(line.unit_price) })),
      });
      if (result?.error || !result?.id) throw new Error("save");
      if (mounted.current) router.push(`/invoices/${result.id}`);
    } catch {
      setError("The invoice couldn’t be saved. Your edits are still here; please try saving again.");
    } finally {
      work.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div className={styles.flow}>
      <ol className={styles.steps} aria-label="Slip scanning progress">
        {steps.map((step, index) => (
          <li key={step} className={`${styles.step} ${activeStep === index ? styles.active : ""} ${activeStep > index ? styles.done : ""}`} aria-current={activeStep === index ? "step" : undefined}>
            <span className={styles.tick} aria-hidden="true">{activeStep > index ? "✓" : `0${index + 1}`}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <div className={`${styles.workspace} ${stage === "review" ? styles.reviewWorkspace : ""}`}>
        <aside className={`${styles.capture} sheet rise`} style={{ "--i": 1 }}>
          <div className={styles.sectionLabel}><span>01 / THE ORIGINAL</span><span className={styles.hand}>Kaagaz se shuru</span></div>
          {slips.length > 0 ? (
            <ol className={styles.slips} aria-label="Slips to read">
              {slips.map((slip, index) => (
                <li key={slip.key} className={styles.photoArea}>
                  <div className={styles.pin} aria-hidden="true" />
                  <SlipPhoto file={slip.file} alt={many ? `Handwritten slip ${index + 1} of ${slips.length}, ready to read` : "Your handwritten invoice slip, ready to read"} />
                  <p className={styles.fileInfo}>{many && `Slip ${index + 1} · `}{slip.file.name} · {Math.round(slip.file.size / 1024)} KB</p>
                  <button type="button" className={styles.removeSlip} disabled={busy} aria-label={`Remove slip ${index + 1}`} onClick={() => removeSlip(slip.key)}>×</button>
                </li>
              ))}
            </ol>
          ) : (
            <label className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!busy && event.dataTransfer.files.length) addSlips(Array.from(event.dataTransfer.files)); }}>
              <span className={styles.slipIcon} aria-hidden="true">≡<span>₹</span></span>
              <strong>A little paper.<br />A lot of hisaab.</strong>
              <span>Drop slips here, or choose photos</span>
              <span className={styles.fileHint}>One or more slips · JPG, PNG or WebP · resized before upload</span>
              <input className={styles.fileInput} type="file" accept="image/*" multiple disabled={busy} aria-label="Choose invoice slip photos" onChange={pick} />
            </label>
          )}
          <div className={styles.photoControls}>
            {slips.length > 0 && <label className={`btn btn--ghost ${styles.fileButton}`}>Add more slips<input type="file" accept="image/*" multiple disabled={busy} onChange={pick} /></label>}
            <label className={`btn btn--ghost ${styles.fileButton}`}>Take a photo<input type="file" accept="image/*" capture="environment" disabled={busy} onChange={pick} /></label>
            <button type="button" className={`btn btn--ghost ${styles.sampleButton}`} disabled={busy} onClick={() => addSlips([], true)}>Try the sample slip ↗</button>
          </div>
          {preparing && <p className={styles.note} role="status">Preparing your photo…</p>}
          {stage !== "review" && (
            <>
              <fieldset className={styles.languages} disabled={busy}>
                <legend>What language is the slip in?</legend>
                {[ ["en-IN", "English"], ["hi-IN", "हिन्दी / Hindi"] ].map(([value, label]) => <label key={value} className={language === value ? styles.selectedLanguage : ""}><input type="radio" name={`${id}-language`} value={value} checked={language === value} onChange={() => { setLanguage(value); setFailedAt(null); setSlips((current) => current.map((slip) => ({ ...slip, text: "", result: null }))); }} />{label}</label>)}
              </fieldset>
              <button type="button" className={`btn btn--red ${styles.readButton}`} disabled={!slips.length || busy} onClick={scan}>{stage === "reading" ? `Reading ${many ? "slips" : "the slip"}${counter}…` : stage === "matching" ? `Matching inventory${counter}…` : failedAt === "matching" ? "Retry inventory matching →" : failedAt ? "Try reading again →" : many ? `Read these ${slips.length} slips →` : "Read this slip →"}</button>
            </>
          )}
        </aside>

        {stage !== "review" ? (
          <section className={`${styles.waiting} rise`} style={{ "--i": 2 }} aria-live="polite" aria-atomic="true">
            <span className={styles.eyebrow}>THE MUNSHI WAY</span>
            <h2>{stage === "reading" ? "Reading between the lines." : stage === "matching" ? "Finding every item its place." : "Your handwriting.\nOur paperwork."}</h2>
            <p>{stage === "reading" ? "Sarvam Vision is reading the names, quantities and prices on your slip. This usually takes a few seconds." : stage === "matching" ? "Sarvam-105B is matching the slip with your shop’s inventory. You’ll check the details next." : "Photograph the bill. Munshi reads it, finds your stock and gets the entry ready for your final check."}</p>
            <span className={styles.hand}>{busy ? `Bas, ek pal…${counter}` : "Pehle dekho, phir likho."}</span>
            {(stage === "reading" || stage === "matching") && <div className={styles.workingRule} aria-hidden="true"><span /></div>}
            <p className={styles.promise}>You review every line before stock and the customer’s khata are updated.</p>
          </section>
        ) : (
          <form className={`${styles.review} sheet`} onSubmit={save}>
            <fieldset disabled={saving} className={styles.reviewFields}>
              <div className={styles.reviewTitle}><div><span className={styles.eyebrow}>02 / THE RECORD</span><h2 ref={reviewHeading} tabIndex={-1}>Ek baar dekh lijiye.</h2></div><span className="stamp stamp--pending">Review</span></div>
              <p className={styles.note}>{many && `Lines from all ${slips.length} slips are on this one bill. `}Check the matches, especially the amber marks. Every field is yours to correct.</p>
              <div className={styles.customerFields}>
                <label className="field">Customer name *<input required autoComplete="name" value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} placeholder="Who is this bill for?" /></label>
                <label className="field">Phone<input type="tel" autoComplete="tel" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} placeholder="e.g. 98765 43210" /></label>
                <label className="field">Bill number<input value={bill.number} onChange={(event) => setBill({ ...bill, number: event.target.value })} placeholder="Optional" /></label>
                <label className="field">Bill date<input type="date" value={bill.date} onChange={(event) => setBill({ ...bill, date: event.target.value })} /></label>
              </div>
              <div className={styles.tableScroll} role="region" aria-label="Editable invoice lines" tabIndex={0}>
                <table className={`ledger ${styles.lineTable}`}>
                  <thead><tr><th>Slip says</th><th>Inventory match</th><th className="num">Qty</th><th className="num">Rate ₹</th><th className="num">Amount</th><th><span className={styles.srOnly}>Remove line</span></th></tr></thead>
                  <tbody>{lines.map((line, index) => {
                    const item = itemsById.get(String(line.item_id));
                    const overStock = item && quantities.get(String(item.id)) > Number(item.stock_qty);
                    return <tr key={line.key} className={line.confidence < 0.6 ? styles.checkLine : ""}>
                      <td><label className={styles.srOnly} htmlFor={`${id}-raw-${line.key}`}>Raw slip text for line {index + 1}</label><textarea id={`${id}-raw-${line.key}`} className={styles.rawLine} rows={2} value={line.raw} onChange={(event) => updateLine(line.key, { raw: event.target.value })} placeholder="Handwritten line…" /></td>
                      <td><label className={styles.srOnly} htmlFor={`${id}-item-${line.key}`}>Inventory item for line {index + 1}</label><select id={`${id}-item-${line.key}`} className={styles.itemSelect} value={line.item_id ?? ""} onChange={(event) => selectItem(line, event.target.value)}><option value="">Unmatched / custom item</option>{grouped.map(([category, group]) => <optgroup label={category} key={category}>{group.map((entry) => <option value={entry.id} key={entry.id}>{entry.sku} · {entry.name}</option>)}</optgroup>)}</select>
                        {!item && <input className={styles.customName} aria-label={`Custom item name for line ${index + 1}`} required value={line.name} placeholder="Custom item name" onChange={(event) => updateLine(line.key, { name: event.target.value })} />}
                        <div className={`${styles.confidence} ${line.confidence < 0.6 ? styles.lowConfidence : ""}`}><meter min="0" max="1" low="0.6" optimum="1" value={line.confidence} aria-label={`Match confidence for line ${index + 1}`} /><span>{line.confidence < 0.6 ? "Check match" : "Matched"} · {Math.round(line.confidence * 100)}%</span></div>
                        {overStock && <span className={styles.stockWarning}>Only {item.stock_qty} {item.unit} in stock · {quantities.get(String(item.id))} on this bill</span>}
                      </td>
                      <td><input className={styles.numberInput} aria-label={`Quantity for line ${index + 1}`} type="number" min="1" step="1" required value={line.qty} onChange={(event) => updateLine(line.key, { qty: event.target.value })} /></td>
                      <td><input className={styles.rateInput} aria-label={`Rate for line ${index + 1}`} type="number" min="0" step="0.01" required value={line.unit_price} onChange={(event) => updateLine(line.key, { unit_price: event.target.value })} /></td>
                      <td className={`num ${styles.amount}`}>{money.format((Number(line.qty) || 0) * (Number(line.unit_price) || 0))}</td>
                      <td><button className={styles.remove} type="button" aria-label={`Remove line ${index + 1}`} onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>×</button></td>
                    </tr>;
                  })}</tbody>
                </table>
                {!lines.length && <p className={styles.emptyLines}>No lines yet. Add an item to begin the entry.</p>}
              </div>
              <button type="button" className={`btn btn--ghost ${styles.addLine}`} onClick={() => setLines((current) => [...current, { key: nextLine.current++, raw: "", item_id: null, name: "", qty: 1, unit_price: "", confidence: 0 }])}>+ Add a line</button>
              <div className={styles.total}><span>Bill total</span><strong>{money.format(total)}</strong></div>
              <div className={styles.saveRow}><p>Saving deducts stock and adds this bill to the customer’s khata.</p><button className="btn btn--red" type="submit" disabled={saving || !lines.length}>{saving ? "Writing in the khata…" : "Save invoice →"}</button></div>
            </fieldset>
          </form>
        )}
      </div>
      {ocr && <details className={`${styles.ocrPanel} sheet`}><summary>What Sarvam Vision read <span>Original OCR text</span></summary><pre>{ocr}</pre></details>}
    </div>
  );
}
