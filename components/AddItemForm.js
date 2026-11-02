"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { addItemAction } from "../app/actions";
import styles from "./pages.module.css";

export default function AddItemForm({ categories = [] }) {
  const [state, action, pending] = useActionState(addItemAction, null);
  const formRef = useRef(null);
  const id = useId();

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <details className={styles.disclosure}>
      <summary>+ Add an inventory item</summary>
      <div className={styles.disclosureBody}>
        <p className={styles.subtle}>Enter opening stock and prices. A new SKU is assigned automatically.</p>
        <form ref={formRef} action={action} className={styles.form}>
          <label className={`field ${styles.full}`}>Item name<input name="name" required maxLength={200} placeholder="e.g. Classmate ruled notebook, 172 pages" disabled={pending} /></label>
          <label className="field">Category<input name="category" list={`${id}-categories`} defaultValue={categories[0] || "Uncategorized"} required maxLength={100} disabled={pending} /></label>
          <datalist id={`${id}-categories`}>{categories.map((category) => <option key={category} value={category} />)}</datalist>
          <label className="field">Unit<input name="unit" defaultValue="pc" placeholder="pc, pack, box" required maxLength={30} disabled={pending} /></label>
          <label className="field">Opening stock<input className={styles.mono} name="stock_qty" type="number" min="0" step="1" defaultValue="0" required disabled={pending} inputMode="numeric" /></label>
          <label className="field">Cost price (₹)<input className={styles.mono} name="cost_price" type="number" min="0" step="0.01" defaultValue="0" required disabled={pending} inputMode="decimal" /></label>
          <label className="field">Sell price (₹)<input className={styles.mono} name="sell_price" type="number" min="0" step="0.01" required disabled={pending} inputMode="decimal" /></label>
          <button className="btn btn--red" type="submit" disabled={pending}>{pending ? "Adding…" : "Add item"}</button>
          <div className={styles.message} aria-live="polite" aria-atomic="true">
            {state?.error && <span className={styles.error} role="alert">{state.error}</span>}
            {state?.ok && <span className={styles.success}>Item added to the stock register.</span>}
          </div>
        </form>
      </div>
    </details>
  );
}
