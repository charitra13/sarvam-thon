import Link from "next/link";
import { listInvoices } from "../../../lib/data";
import styles from "../../../components/pages.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bills · Munshi" };

const money = (value) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const date = (value) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export default async function InvoicesPage({ searchParams }) {
  const [invoices, params] = await Promise.all([listInvoices(), searchParams]);
  const filter = ["pending", "due"].includes(params?.filter) ? params.filter : "all";
  const pending = invoices.filter((invoice) => !invoice.dispatched_at);
  const due = invoices.filter((invoice) => invoice.paid < invoice.total);
  const visible = filter === "pending" ? pending : filter === "due" ? due : invoices;
  const tabs = [
    { key: "all", label: "All bills", count: invoices.length, href: "/invoices" },
    { key: "pending", label: "Pending dispatch", count: pending.length, href: "/invoices?filter=pending" },
    { key: "due", label: "Payment due", count: due.length, href: "/invoices?filter=due" },
  ];

  return (
    <>
      <header className="page-head rise" style={{ "--i": 0 }}>
        <div><p className={styles.eyebrow}>Munshi / Bill register</p><h1>Every bill, on the books.</h1></div>
        <p className="annot">parchi se pakka hisaab</p>
      </header>
      <div className={`${styles.toolbar} rise`} style={{ "--i": 1 }}>
        <nav className={styles.tabs} aria-label="Filter bills">
          {tabs.map((tab) => <Link key={tab.key} className={styles.tab} href={tab.href} aria-current={filter === tab.key ? "page" : undefined}>{tab.label}<span className={styles.count}>{tab.count}</span></Link>)}
        </nav>
        <Link className="btn btn--red" href="/scan">+ Scan a bill</Link>
      </div>
      <section className={`sheet rise ${styles.registerSheet}`} style={{ "--i": 2 }} aria-label="Bill register">
        {visible.length ? <>
          <div className={styles.scroll} role="region" aria-label="Invoices" tabIndex={0}>
            <table className={`ledger ${styles.table}`}>
              <caption className={styles.srOnly}>Bills with customer, payment and dispatch status</caption>
              <thead><tr><th scope="col">Bill no.</th><th scope="col">Date</th><th scope="col">Customer</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Paid</th><th scope="col" className="num">Due</th><th scope="col">Status</th></tr></thead>
              <tbody>{visible.map((invoice) => (
                <tr key={invoice.id}>
                  <td><Link className={styles.billLink} href={`/invoices/${invoice.id}`}>{invoice.invoice_no || `Bill ${invoice.id}`}</Link></td>
                  <td className={styles.subtle} style={{ whiteSpace: "nowrap" }}>{date(invoice.invoice_date)}</td>
                  <td><Link href={`/customers/${invoice.customer_id}`}>{invoice.customer}</Link></td>
                  <td className="num">{money(invoice.total)}</td>
                  <td className="num">{money(invoice.paid)}</td>
                  <td className={`num ${invoice.paid < invoice.total ? styles.due : ""}`}>{money(Math.max(0, invoice.total - invoice.paid))}</td>
                  <td><div className={styles.status}><span className={`stamp ${invoice.dispatched_at ? "stamp--dispatched" : "stamp--pending"}`}>{invoice.dispatched_at ? "Dispatched" : "Pending dispatch"}</span><span className={`stamp ${invoice.paid >= invoice.total ? "stamp--paid" : "stamp--due"}`}>{invoice.paid >= invoice.total ? "Paid" : "Due"}</span></div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className={styles.footer}>{visible.length} {visible.length === 1 ? "bill" : "bills"} · amounts in INR</div>
        </> : <div className={styles.empty}><p className={styles.eyebrow}>A fresh page</p><h2>{invoices.length ? "All caught up here." : "Your first bill starts with a photo."}</h2><p>{invoices.length ? "No bills match this filter. Scan a new slip or view all bills." : "Turn a handwritten slip into a digital bill and a khata entry."}</p><Link className="btn btn--red" href="/scan">Scan a bill</Link>{invoices.length > 0 && <> <Link className="btn btn--ghost" href="/invoices">View all bills</Link></>}</div>}
      </section>
    </>
  );
}
