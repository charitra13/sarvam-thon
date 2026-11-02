import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoice } from "../../../../lib/data";
import DispatchButton from "../../../../components/DispatchButton";
import PaymentForm from "../../../../components/PaymentForm";
import CallButton from "../../../../components/CallButton";
import styles from "../../../../components/pages.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Digital bill · Munshi" };

const money = (value) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const date = (value) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const time = (value) => new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default async function InvoicePage({ params }) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1 || Number(id) > 2147483647) notFound();
  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  const due = Math.max(0, invoice.total - invoice.paid);
  const bill = invoice.invoice_no || `Bill ${invoice.id}`;

  return (
    <>
      <Link className={styles.back} href="/invoices">← Back to bill register</Link>
      <header className="page-head rise" style={{ "--i": 0 }}><div><p className={styles.eyebrow}>Munshi / Digital bill</p><h1>From slip to record.</h1></div><p className="annot">likha hua, sambhala hua</p></header>
      <article className={`sheet ${styles.paper} rise`} style={{ "--i": 1 }} aria-label={`Invoice ${bill}`}>
        <header className={styles.invoiceHead}>
          <div><p className={styles.eyebrow}>Stationery · Books · Everyday essentials</p><h2 className={styles.shopName}>Track Desk<br />Stationery</h2><span className={styles.subtle}>Digital copy · customer bill</span></div>
          <div className={styles.billMeta}><span className={styles.eyebrow}>Bill number</span><strong>{bill}</strong><span className={styles.subtle}>{date(invoice.invoice_date)}</span></div>
        </header>
        <div className={styles.billTo}>
          <div><p className={styles.eyebrow}>Billed to</p><h2><Link href={`/customers/${invoice.customer_id}`}>{invoice.customer}</Link></h2>{invoice.phone && <div className={styles.mono}>{invoice.phone}</div>}{invoice.address && <address>{invoice.address}</address>}</div>
          <div className={styles.stamps}><span className={`stamp ${invoice.dispatched_at ? "stamp--dispatched" : "stamp--pending"}`}>{invoice.dispatched_at ? "Dispatched" : "Pending dispatch"}</span><span className={`stamp ${due === 0 ? "stamp--paid" : "stamp--due"}`}>{due === 0 ? "Paid" : "Payment due"}</span></div>
        </div>
        <div className={styles.scroll} role="region" aria-label="Bill items" tabIndex={0}>
          <table className={`ledger ${styles.table}`}>
            <caption className={styles.srOnly}>Items on this bill, with original handwriting where available</caption>
            <thead><tr><th scope="col">Item / original handwriting</th><th scope="col">SKU</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Rate</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>{invoice.lines.map((line) => <tr key={line.id}><td className={styles.lineName}>{line.name}{line.raw_text && <span className={styles.hand}><span className={styles.srOnly}>Original handwritten text: </span>“{line.raw_text}”</span>}</td><td className={styles.mono}>{line.sku || "—"}</td><td className="num">{line.qty.toLocaleString("en-IN")}</td><td className="num">{money(line.unit_price)}</td><td className="num">{money(line.line_total)}</td></tr>)}</tbody>
          </table>
        </div>
        <dl className={styles.totals}><div><dt>Bill total</dt><dd>{money(invoice.total)}</dd></div><div><dt>Payment received</dt><dd className={styles.credit}>{money(invoice.paid)}</dd></div><div className={styles.grandTotal}><dt>Balance due</dt><dd className={due > 0 ? styles.due : styles.credit}>{money(due)}</dd></div></dl>
        <footer className={styles.invoiceFoot}><span className={styles.hand}>Dhanyavaad. Phir aaiyega!</span><span className={styles.subtle}>{invoice.dispatched_at ? `Dispatched ${date(invoice.dispatched_at)}` : "Awaiting dispatch"}</span></footer>
      </article>
      <div className={`${styles.actions} rise`} style={{ "--i": 2 }}><DispatchButton invoiceId={invoice.id} dispatched={Boolean(invoice.dispatched_at)} />{due > 0 && <CallButton invoiceId={invoice.id} kind="payment" label="Call for payment" />}</div>
      {due > 0 && <PaymentForm customerId={invoice.customer_id} invoiceId={invoice.id} due={due} />}
      <div className={styles.sectionHead}><h2>Call register</h2><span className={styles.subtle}>{invoice.calls.length} {invoice.calls.length === 1 ? "call" : "calls"} made</span></div>
      <section className={`sheet ${styles.registerSheet}`} aria-label="Call history">
        {invoice.calls.length ? <ol className={styles.callLog}>{invoice.calls.map((call) => <li key={call.id}><div className={styles.callMeta}><strong>{call.kind === "dispatch" ? "Dispatch update" : "Payment reminder"}</strong><time className={styles.subtle} dateTime={new Date(call.created_at).toISOString()}>{date(call.created_at)} · {time(call.created_at)}</time></div><p>{call.script.length > 260 ? `${call.script.slice(0, 260)}…` : call.script}</p></li>)}</ol> : <div className={styles.empty}><p>No calls yet. Customer se baat baaki hai.</p></div>}
      </section>
      {invoice.ocr_text && <details className={styles.disclosure}><summary>Original OCR text</summary><pre className={styles.ocr}>{invoice.ocr_text}</pre></details>}
    </>
  );
}
