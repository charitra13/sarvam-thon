import Link from "next/link";
import { getDashboard, listInvoices, LOW_STOCK } from "../../lib/data.js";
import CallButton from "../../components/CallButton.js";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const day = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default async function Dashboard() {
  const [d, invoices] = await Promise.all([getDashboard(), listInvoices()]);
  const toDispatch = invoices.filter((i) => !i.dispatched_at).slice(0, 4);
  const toCollect = invoices.filter((i) => i.dispatched_at && i.total - i.paid > 0).slice(0, 4);
  const greeting = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  const totals = [
    { label: "Udhaar baaki", sub: "Receivable", value: inr(d.receivable), tone: "debit" },
    { label: "Is mahine aaya", sub: "Collected this month", value: inr(d.collected), tone: "credit" },
    { label: "Dispatch pending", sub: "Invoices", value: d.pending, tone: "" },
    { label: "Stock kam", sub: `Items under ${LOW_STOCK}`, value: d.lowStock.length, tone: d.lowStock.length ? "debit" : "" },
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">{greeting}</p>
          <h1>Aaj ka hisaab</h1>
          <p className="annot">sab kuch ek nazar mein ✓</p>
        </div>
        <Link href="/scan" className="btn btn--red">+ Scan a handwritten slip</Link>
      </header>

      <section className={styles.totals} aria-label="Totals">
        {totals.map((t, i) => (
          <div key={t.label} className={`${styles.total} rise`} style={{ "--i": i }}>
            <span className="eyebrow">{t.sub}</span>
            <strong className={`mono ${t.tone}`}>{t.value}</strong>
            <span className="hand">{t.label}</span>
          </div>
        ))}
      </section>

      <div className={styles.grid}>
        <section className="sheet rise" style={{ "--i": 4 }}>
          <header className={styles.head}>
            <h2>Next calls</h2>
            <span className="hand">Simran call karegi · Bulbul</span>
          </header>
          {!toDispatch.length && !toCollect.length && <p className="muted">Nothing pending. Scan a slip to get started.</p>}
          <ul className={styles.todo}>
            {toDispatch.map((i) => (
              <li key={"d" + i.id}>
                <span className="stamp stamp--pending">Dispatch</span>
                <div>
                  <Link href={`/invoices/${i.id}`}>{i.customer}</Link>
                  <small className="mono muted">Bill {i.invoice_no || i.id} · {inr(i.total)}</small>
                </div>
                <Link href={`/invoices/${i.id}`} className="btn">Dispatch & call</Link>
              </li>
            ))}
            {toCollect.map((i) => (
              <li key={"p" + i.id}>
                <span className="stamp stamp--due">Due</span>
                <div>
                  <Link href={`/customers/${i.customer_id}`}>{i.customer}</Link>
                  <small className="mono muted">Bill {i.invoice_no || i.id} · {inr(i.total - i.paid)} baaki</small>
                </div>
                <CallButton invoiceId={i.id} kind="payment" label="Payment call" />
              </li>
            ))}
          </ul>
        </section>

        <section className="sheet rise" style={{ "--i": 5 }}>
          <header className={styles.head}>
            <h2>Stock kam hai</h2>
            <Link href="/inventory" className="btn btn--ghost">Inventory →</Link>
          </header>
          {d.lowStock.length ? (
            <ul className={styles.stock}>
              {d.lowStock.map((s) => (
                <li key={s.id}>
                  <span>{s.name}</span>
                  <span className="mono debit">{s.stock_qty} {s.unit}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Everything is well stocked.</p>}
        </section>

        <section className={`sheet rise ${styles.wide}`} style={{ "--i": 6 }}>
          <header className={styles.head}>
            <h2>Recent bills</h2>
            <Link href="/invoices" className="btn btn--ghost">All invoices →</Link>
          </header>
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr><th>Bill</th><th>Date</th><th>Customer</th><th className="num">Amount</th><th className="num">Baaki</th><th>Status</th></tr>
              </thead>
              <tbody>
                {d.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="mono"><Link href={`/invoices/${i.id}`}>{i.invoice_no || i.id}</Link></td>
                    <td className="mono">{day(i.invoice_date)}</td>
                    <td>{i.customer}</td>
                    <td className="num">{inr(i.total)}</td>
                    <td className={`num ${i.total - i.paid > 0 ? "debit" : "credit"}`}>{inr(i.total - i.paid)}</td>
                    <td>
                      <span className={`stamp ${i.dispatched_at ? "stamp--dispatched" : "stamp--pending"}`}>
                        {i.dispatched_at ? "Dispatched" : "Pending"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`sheet rise ${styles.wide}`} style={{ "--i": 7 }}>
          <header className={styles.head}><h2>Call log</h2></header>
          {d.calls.length ? (
            <ul className={styles.calls}>
              {d.calls.map((c) => (
                <li key={c.id}>
                  <span className="mono muted">{new Date(c.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  <span>{c.kind === "order" ? "Phone order from" : c.kind === "dispatch" ? "Dispatch update to" : "Payment reminder to"} <Link href={`/invoices/${c.invoice_id}`}>{c.customer}</Link></span>
                  <span className="mono muted">Bill {c.invoice_no || c.invoice_id}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No calls yet. Dispatch an invoice to make the first one.</p>}
        </section>
      </div>
    </>
  );
}
