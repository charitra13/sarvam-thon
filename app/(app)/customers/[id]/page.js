import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomer } from "../../../../lib/data";
import PaymentForm from "../../../../components/PaymentForm";
import CallButton from "../../../../components/CallButton";
import styles from "../../../../components/pages.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer ledger · Munshi" };

const money = (value) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const date = (value) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export default async function CustomerPage({ params }) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1 || Number(id) > 2147483647) notFound();
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const latestDue = customer.invoices.find((invoice) => invoice.total > invoice.paid);
  const balanceDue = Math.max(0, customer.balance);

  return (
    <>
      <Link className={styles.back} href="/customers">← All customer accounts</Link>
      <header className="page-head rise" style={{ "--i": 0 }}><div><p className={styles.eyebrow}>Munshi / Customer ledger</p><h1>Khata, khula hai.</h1></div><p className="annot">ek-ek rupaye ka hisaab</p></header>
      <section className={`sheet ${styles.khata} rise`} style={{ "--i": 1 }} aria-label={`${customer.name}'s account ledger`}>
        <header className={styles.khataHead}>
          <div><p className={styles.eyebrow}>Account / {String(customer.id).padStart(4, "0")}</p><h2>{customer.name}</h2>{customer.phone && <p className={`${styles.mono} ${styles.subtle}`}>{customer.phone}</p>}{customer.address && <address>{customer.address}</address>}</div>
          <div className={styles.balance}><span>{customer.balance < 0 ? "Credit in account" : "Balance due"}</span><strong className={customer.balance > 0 ? styles.due : styles.credit}>{money(Math.abs(customer.balance))}</strong><span className={styles.hand}>{customer.balance > 0 ? "baaki hai" : customer.balance < 0 ? "advance jama hai" : "hisaab barabar"}</span></div>
        </header>
        <div className={styles.scroll} role="region" aria-label="Khata entries" tabIndex={0}>
          <table className={`ledger ${styles.table} ${styles.khataTable}`}>
            <caption className={styles.srOnly}>Chronological debits, credits and running account balance</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">Particulars</th><th scope="col" className="num">Debit · naam</th><th scope="col" className="num">Credit · jama</th><th scope="col" className="num">Balance</th></tr></thead>
            <tbody>
              {customer.entries.map((entry) => <tr key={entry.id}>
                <td>{date(entry.created_at)}</td>
                <td>{entry.kind === "invoice" ? entry.invoice_id ? <Link className={styles.billLink} href={`/invoices/${entry.invoice_id}`}>Bill {entry.invoice_no || entry.invoice_id}</Link> : "Opening bill" : <><span>{entry.note || "Payment received"}</span>{entry.invoice_id && <span className={styles.ledgerNote}>Against <Link href={`/invoices/${entry.invoice_id}`}>{entry.invoice_no || `Bill ${entry.invoice_id}`}</Link></span>}</>}</td>
                <td className={`num ${styles.due}`}>{entry.kind === "invoice" ? money(entry.amount) : "—"}</td>
                <td className={`num ${styles.credit}`}>{entry.kind === "payment" ? money(entry.amount) : "—"}</td>
                <td className={`num ${entry.balance > 0 ? styles.due : styles.credit}`}>{money(Math.abs(entry.balance))}{entry.balance < 0 && <span className={styles.ledgerNote}>credit</span>}</td>
              </tr>)}
              {!customer.entries.length && <tr><td colSpan={5}><div className={styles.empty}><h2>A clean page.</h2><p>No bills or payments in this account yet.</p><Link className="btn btn--red" href="/scan">Scan a bill</Link></div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className={styles.footer}>Debit = billed · credit = received · amounts in INR</div>
      </section>
      <div className={styles.actions}><CallButton customerId={customer.id} kind="order" label="Call to place order" />{balanceDue > 0 && latestDue && <><CallButton invoiceId={latestDue.id} kind="payment" label="Call for payment" /><span className={styles.subtle}>For {latestDue.invoice_no || `Bill ${latestDue.id}`} · {money(Math.max(0, latestDue.total - latestDue.paid))} due</span></>}</div>
      <PaymentForm customerId={customer.id} due={balanceDue} invoices={customer.invoices} />
      <div className={styles.sectionHead}><h2>Customer’s bills</h2><span className={styles.subtle}>{customer.invoices.length} on record</span></div>
      <section className={`sheet ${styles.registerSheet}`} aria-label="Customer invoices">
        {customer.invoices.length ? <div className={styles.scroll} role="region" aria-label="Customer bill register" tabIndex={0}><table className={`ledger ${styles.table}`}><caption className={styles.srOnly}>All bills for {customer.name}</caption><thead><tr><th scope="col">Bill</th><th scope="col">Date</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Paid</th><th scope="col" className="num">Due</th><th scope="col">Status</th></tr></thead><tbody>{customer.invoices.map((invoice) => <tr key={invoice.id}><td><Link className={styles.billLink} href={`/invoices/${invoice.id}`}>{invoice.invoice_no || `Bill ${invoice.id}`}</Link></td><td className={styles.subtle} style={{ whiteSpace: "nowrap" }}>{date(invoice.invoice_date)}</td><td className="num">{money(invoice.total)}</td><td className="num">{money(invoice.paid)}</td><td className={`num ${invoice.total > invoice.paid ? styles.due : ""}`}>{money(Math.max(0, invoice.total - invoice.paid))}</td><td><div className={styles.status}><span className={`stamp ${invoice.dispatched_at ? "stamp--dispatched" : "stamp--pending"}`}>{invoice.dispatched_at ? "Dispatched" : "Pending dispatch"}</span><span className={`stamp ${invoice.paid >= invoice.total ? "stamp--paid" : "stamp--due"}`}>{invoice.paid >= invoice.total ? "Paid" : "Due"}</span></div></td></tr>)}</tbody></table></div> : <div className={styles.empty}><p>No bills recorded for this customer yet.</p></div>}
      </section>
    </>
  );
}
