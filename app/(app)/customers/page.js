import Link from "next/link";
import { listCustomers } from "../../../lib/data";
import styles from "../../../components/pages.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer khata · Munshi" };

const money = (value) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const date = (value) => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export default async function CustomersPage() {
  const customers = await listCustomers();
  const balance = customers.reduce((sum, customer) => sum + Math.max(0, customer.billed - customer.paid), 0);
  const dueCount = customers.filter((customer) => customer.billed > customer.paid).length;

  return (
    <>
      <header className="page-head rise" style={{ "--i": 0 }}><div><p className={styles.eyebrow}>Munshi / Customer accounts</p><h1>Naam ka khata.</h1></div><p className="annot">rishton ka bhi hisaab</p></header>
      <dl className={`${styles.summary} rise`} style={{ "--i": 1 }}><div><dt>Customers</dt><dd>{customers.length.toLocaleString("en-IN")}</dd></div><div><dt>Total balance due</dt><dd className={balance > 0 ? styles.due : ""}>{money(balance)}</dd></div><div><dt>Accounts with dues</dt><dd>{dueCount.toLocaleString("en-IN")}</dd></div></dl>
      <section className={`sheet rise ${styles.registerSheet}`} style={{ "--i": 2 }} aria-label="Customer accounts">
        {customers.length ? <>
          <div className={styles.scroll} role="region" aria-label="Customer ledger list" tabIndex={0}>
            <table className={`ledger ${styles.table}`}>
              <caption className={styles.srOnly}>Customers, ordered by outstanding balance</caption>
              <thead><tr><th scope="col">Customer</th><th scope="col">Phone</th><th scope="col" className="num">Billed</th><th scope="col" className="num">Paid</th><th scope="col" className="num">Balance due</th><th scope="col">Last activity</th></tr></thead>
              <tbody>{customers.map((customer) => {
                const due = customer.billed - customer.paid;
                return <tr key={customer.id}><td className={styles.lineName}><Link href={`/customers/${customer.id}`}>{customer.name} <span aria-hidden="true">↗</span></Link></td><td className={styles.mono} style={{ whiteSpace: "nowrap" }}>{customer.phone || "—"}</td><td className="num">{money(customer.billed)}</td><td className="num">{money(customer.paid)}</td><td className={`num ${due > 0 ? styles.due : styles.credit}`}>{money(Math.max(0, due))}{due < 0 && <span className={styles.ledgerNote}>{money(-due)} credit</span>}</td><td className={styles.subtle} style={{ whiteSpace: "nowrap" }}>{customer.last_activity ? date(customer.last_activity) : "No activity yet"}</td></tr>;
              })}</tbody>
            </table>
          </div><div className={styles.footer}>Largest balances first · amounts in INR</div>
        </> : <div className={styles.empty}><p className={styles.eyebrow}>The first page awaits</p><h2>A bill begins a relationship.</h2><p>Scan a customer’s bill to open their khata automatically.</p><Link href="/scan" className="btn btn--red">Scan a bill</Link></div>}
      </section>
    </>
  );
}
