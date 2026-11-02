"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { updateItemAction } from "../app/actions";
import styles from "./pages.module.css";

const money = (value) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function ItemRow({ item, lowStock }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateItemAction, null);
  const formId = useId();

  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  return (
    <tr>
      <td className={styles.mono}>{item.sku}</td>
      <td className={styles.lineName}>{item.name}</td>
      <td>{item.category}</td>
      <td className={styles.subtle}>{item.unit}</td>
      <td className={`num ${item.stock_qty < lowStock ? styles.lowStock : ""}`}>
        {editing ? (
          <label><span className={styles.srOnly}>Stock quantity for {item.name}</span><input className={styles.inlineInput} form={formId} name="stock_qty" type="number" min="0" step="1" defaultValue={item.stock_qty} required disabled={pending} inputMode="numeric" /></label>
        ) : item.stock_qty.toLocaleString("en-IN")}
        {item.stock_qty < lowStock && <span className={styles.lowLabel}>{item.stock_qty <= 0 ? "Out of stock" : "Low stock"}</span>}
      </td>
      <td className="num">{money(item.cost_price)}</td>
      <td className="num">
        {editing ? (
          <label><span className={styles.srOnly}>Sell price in rupees for {item.name}</span><input className={styles.inlineInput} form={formId} name="sell_price" type="number" min="0" step="0.01" defaultValue={item.sell_price} required disabled={pending} inputMode="decimal" /></label>
        ) : money(item.sell_price)}
      </td>
      <td className="num">{money(item.stock_qty * item.cost_price)}</td>
      <td>
        <form id={formId} action={action} className={styles.rowActions}>
          <input type="hidden" name="id" value={item.id} />
          {editing ? <>
            <button className="btn btn--red" type="submit" disabled={pending} aria-label={`Save ${item.name}`}>{pending ? "Saving…" : "Save"}</button>
            <button className="btn btn--ghost" type="button" disabled={pending} onClick={() => setEditing(false)}>Cancel</button>
          </> : <button className="btn btn--ghost" type="button" onClick={() => setEditing(true)} aria-label={`Edit ${item.name}`}>Edit</button>}
          <p aria-live="polite" aria-atomic="true">
            {editing && state?.error && <span className={styles.error} role="alert">{state.error}</span>}
            {!editing && state?.ok && <span className={styles.success}>Saved</span>}
          </p>
        </form>
      </td>
    </tr>
  );
}

export default function InventoryTable({ items, lowStock }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const categories = [...new Set(items.map((item) => item.category))].sort();
  const query = search.trim().toLocaleLowerCase("en-IN");
  const visible = items.filter((item) => (!category || item.category === category)
    && (!onlyLow || item.stock_qty < lowStock)
    && (!query || `${item.sku} ${item.name} ${item.category}`.toLocaleLowerCase("en-IN").includes(query)));

  return (
    <>
      <div className={styles.toolbar}>
        <label className={styles.search}>Search the stock register<input type="search" placeholder="Item name, SKU or category" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <span className={styles.subtle} role="status">{visible.length} of {items.length} items</span>
      </div>
      <div className={styles.filters} role="group" aria-label="Filter inventory">
        <button className={styles.tab} type="button" aria-pressed={!category} onClick={() => setCategory("")}>All categories</button>
        {categories.map((name) => <button key={name} className={styles.tab} type="button" aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}
        <label className={styles.lowFilter}><input type="checkbox" checked={onlyLow} onChange={(event) => setOnlyLow(event.target.checked)} />Low stock (&lt; {lowStock})</label>
      </div>
      <div className={`sheet ${styles.registerSheet}`}>
        <div className={styles.scroll} role="region" aria-label="Inventory register" tabIndex={0}>
          <table className={`ledger ${styles.table}`}>
            <caption className={styles.srOnly}>Inventory, stock quantities and prices. Use Edit to change stock and sell price.</caption>
            <thead><tr><th scope="col">SKU</th><th scope="col">Item name</th><th scope="col">Category</th><th scope="col">Unit</th><th scope="col" className="num">Stock</th><th scope="col" className="num">Cost</th><th scope="col" className="num">Sell</th><th scope="col" className="num">Stock value</th><th scope="col">Edit</th></tr></thead>
            <tbody>
              {visible.map((item) => <ItemRow key={item.id} item={item} lowStock={lowStock} />)}
              {!visible.length && <tr><td colSpan={9}><div className={styles.empty}><h2>{items.length ? "No matching items" : "The stock register is empty"}</h2><p>{items.length ? "Try another search or clear the filters." : "Add your first item using the form below."}</p>{items.length > 0 && <button type="button" className="btn btn--ghost" onClick={() => { setSearch(""); setCategory(""); setOnlyLow(false); }}>Clear filters</button>}</div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className={styles.footer}>Stock value at cost · amounts in INR</div>
      </div>
    </>
  );
}
