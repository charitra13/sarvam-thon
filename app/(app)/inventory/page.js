import { listItems, LOW_STOCK } from "../../../lib/data";
import InventoryTable from "../../../components/InventoryTable";
import AddItemForm from "../../../components/AddItemForm";
import styles from "../../../components/pages.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock register · Munshi" };

const money = (value) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default async function InventoryPage() {
  const items = await listItems();
  const value = items.reduce((sum, item) => sum + item.stock_qty * item.cost_price, 0);
  const low = items.filter((item) => item.stock_qty < LOW_STOCK).length;
  const categories = [...new Set(items.map((item) => item.category))].sort();

  return (
    <>
      <header className="page-head rise" style={{ "--i": 0 }}><div><p className={styles.eyebrow}>Munshi / Stock register</p><h1>On the shelf.</h1></div><p className="annot">maal ka poora hisaab</p></header>
      <dl className={`${styles.summary} rise`} style={{ "--i": 1 }}><div><dt>Items in register</dt><dd>{items.length.toLocaleString("en-IN")}</dd></div><div><dt>Stock value · at cost</dt><dd>{money(value)}</dd></div><div><dt>Low stock · below {LOW_STOCK}</dt><dd className={low > 0 ? styles.due : ""}>{low.toLocaleString("en-IN")}<span className={styles.hand}>{low > 0 ? "dobara mangwa lo" : "sab taiyaar hai"}</span></dd></div></dl>
      <div className="rise" style={{ "--i": 2 }}><InventoryTable items={items} lowStock={LOW_STOCK} /><AddItemForm categories={categories} /></div>
    </>
  );
}
