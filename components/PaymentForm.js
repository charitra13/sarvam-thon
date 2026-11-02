"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { paymentAction } from "../app/actions";
import styles from "./pages.module.css";

const money = (value) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function PaymentForm({ customerId, invoiceId, due = 0, invoices = [] }) {
  const [state, action, pending] = useActionState(paymentAction, null);
  const formRef = useRef(null);
  const id = useId();
  const dueInvoices = invoices.filter((invoice) => invoice.total > invoice.paid);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <section className={styles.formPanel} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Record a payment</h2>
      <p className={styles.subtle}>Cash, UPI or bank transfer — enter the amount received.</p>
      <form action={action} ref={formRef} className={styles.form}>
        <input type="hidden" name="customer_id" value={customerId} />
        {invoiceId ? <input type="hidden" name="invoice_id" value={invoiceId} /> : (
          <label className={`field ${styles.full}`}>
            Apply to a bill (optional)
            <select name="invoice_id" defaultValue="" disabled={pending}>
              <option value="">Customer account · no specific bill</option>
              {dueInvoices.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.invoice_no || `Bill ${invoice.id}`} · {money(Math.max(0, invoice.total - invoice.paid))} due
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Amount received (₹)
          <input className={styles.mono} name="amount" type="number" min="0.01" step="0.01" defaultValue={due > 0 ? Number(due.toFixed(2)) : ""} required disabled={pending} inputMode="decimal" />
        </label>
        <label className="field">
          Payment note (optional)
          <input name="note" placeholder="e.g. UPI received" maxLength={500} disabled={pending} />
        </label>
        <button className="btn btn--red" type="submit" disabled={pending}>{pending ? "Recording…" : "Record payment"}</button>
        <div className={styles.message} aria-live="polite" aria-atomic="true">
          {state?.error && <span className={styles.error} role="alert">{state.error}</span>}
          {state?.ok && <span className={styles.success}>Payment recorded. Khata updated.</span>}
        </div>
      </form>
    </section>
  );
}
