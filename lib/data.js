import { sql } from "./db.js";
import { seedItems, seedCustomers, seedInvoices } from "./seed.js";

export const LOW_STOCK = 30;

let ready;
// Creates tables and seeds demo data once per server instance.
export function ensureDb() {
  ready ??= init().catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}

async function init() {
  await sql.begin(async (tx) => {
    // Serialises cold starts so two instances never seed twice.
    await tx`select pg_advisory_xact_lock(4242)`;
    await tx`create table if not exists items (
      id serial primary key,
      sku text unique not null,
      name text not null,
      category text not null default 'Uncategorized',
      unit text not null default 'pc',
      stock_qty int not null default 0,
      cost_price numeric(10,2) not null default 0,
      sell_price numeric(10,2) not null default 0
    )`;
    await tx`create table if not exists customers (
      id serial primary key,
      name text not null,
      phone text,
      address text,
      created_at timestamptz not null default now()
    )`;
    await tx`create table if not exists invoices (
      id serial primary key,
      invoice_no text,
      customer_id int not null references customers(id),
      invoice_date date not null default current_date,
      total numeric(12,2) not null default 0,
      ocr_text text,
      dispatched_at timestamptz,
      created_at timestamptz not null default now()
    )`;
    await tx`create table if not exists invoice_items (
      id serial primary key,
      invoice_id int not null references invoices(id) on delete cascade,
      item_id int references items(id),
      raw_text text,
      name text not null,
      qty int not null,
      unit_price numeric(10,2) not null,
      line_total numeric(12,2) not null
    )`;
    await tx`create table if not exists ledger (
      id serial primary key,
      customer_id int not null references customers(id),
      invoice_id int references invoices(id),
      kind text not null check (kind in ('invoice', 'payment')),
      amount numeric(12,2) not null check (amount > 0),
      note text,
      created_at timestamptz not null default now()
    )`;
    await tx`create table if not exists calls (
      id serial primary key,
      invoice_id int not null references invoices(id),
      kind text not null check (kind in ('dispatch', 'payment')),
      script text not null,
      created_at timestamptz not null default now()
    )`;

    const [{ n }] = await tx`select count(*)::int as n from items`;
    if (n > 0) return;

    for (const i of seedItems) {
      await tx`insert into items (sku, name, category, unit, stock_qty, cost_price, sell_price)
        values (${i.sku}, ${i.name}, ${i.category}, ${i.unit}, ${i.stock_qty}, ${i.cost_price}, ${i.sell_price})`;
    }
    const customerIds = [];
    for (const c of seedCustomers) {
      const [row] = await tx`insert into customers (name, phone, address)
        values (${c.name}, ${c.phone}, ${c.address}) returning id`;
      customerIds.push(row.id);
    }
    for (const inv of seedInvoices) {
      const lines = [];
      for (const [sku, qty, unit_price] of inv.lines) {
        const [item] = await tx`select id, name from items where sku = ${sku}`;
        lines.push({ item_id: item.id, name: item.name, raw_text: null, qty, unit_price });
      }
      const date = new Date(Date.now() - inv.days_ago * 864e5).toISOString().slice(0, 10);
      const id = await insertInvoice(tx, {
        customer_id: customerIds[inv.customer - 1], invoice_no: inv.invoice_no, invoice_date: date, lines,
      });
      if (inv.dispatched) await tx`update invoices set dispatched_at = ${date}::date + interval '1 day' where id = ${id}`;
      if (inv.paid) {
        await tx`insert into ledger (customer_id, invoice_id, kind, amount, note)
          values (${customerIds[inv.customer - 1]}, ${id}, 'payment', ${inv.paid}, 'Part payment (UPI)')`;
      }
    }
  });
}

// Writes the invoice, its lines, the stock deduction and the ledger debit. Call inside a transaction.
async function insertInvoice(tx, { customer_id, invoice_no, invoice_date, ocr_text = null, lines }) {
  const total = lines.reduce((sum, l) => sum + l.qty * l.unit_price, 0);
  const [inv] = await tx`insert into invoices (invoice_no, customer_id, invoice_date, total, ocr_text)
    values (${invoice_no}, ${customer_id}, coalesce(${invoice_date || null}::date, current_date), ${total}, ${ocr_text}) returning id`;
  for (const l of lines) {
    await tx`insert into invoice_items (invoice_id, item_id, raw_text, name, qty, unit_price, line_total)
      values (${inv.id}, ${l.item_id}, ${l.raw_text}, ${l.name}, ${l.qty}, ${l.unit_price}, ${l.qty * l.unit_price})`;
    if (l.item_id) await tx`update items set stock_qty = stock_qty - ${l.qty} where id = ${l.item_id}`;
  }
  if (total > 0) {
    await tx`insert into ledger (customer_id, invoice_id, kind, amount, note)
      values (${customer_id}, ${inv.id}, 'invoice', ${total}, ${"Bill " + (invoice_no || inv.id)})`;
  }
  return inv.id;
}

export async function createInvoice({ customer, invoice_no, invoice_date, ocr_text, lines }) {
  await ensureDb();
  return sql.begin(async (tx) => {
    const digits = (customer.phone || "").replace(/\D/g, "").slice(-10);
    let [existing] = digits.length === 10
      ? await tx`select id from customers where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = ${digits} limit 1`
      : [];
    existing ??= (await tx`select id from customers where lower(name) = lower(${customer.name}) limit 1`)[0];
    const customer_id = existing?.id ?? (await tx`insert into customers (name, phone)
      values (${customer.name}, ${customer.phone || null}) returning id`)[0].id;
    return insertInvoice(tx, { customer_id, invoice_no, invoice_date, ocr_text, lines });
  });
}

export async function getDashboard() {
  await ensureDb();
  const [totals] = await sql`select
      coalesce(sum(amount) filter (where kind = 'invoice'), 0)::float8
        - coalesce(sum(amount) filter (where kind = 'payment'), 0)::float8 as receivable,
      coalesce(sum(amount) filter (where kind = 'payment' and created_at >= date_trunc('month', now())), 0)::float8 as collected
    from ledger`;
  const [{ pending }] = await sql`select count(*)::int as pending from invoices where dispatched_at is null`;
  const lowStock = await sql`select id, sku, name, stock_qty, unit from items
    where stock_qty < ${LOW_STOCK} order by stock_qty limit 6`;
  const invoices = await listInvoices(6);
  const calls = await sql`select c.id, c.kind, c.created_at, i.id as invoice_id, i.invoice_no, cu.name as customer
    from calls c join invoices i on i.id = c.invoice_id join customers cu on cu.id = i.customer_id
    order by c.created_at desc limit 5`;
  return { ...totals, pending, lowStock, invoices, calls };
}

export async function listInvoices(limit = 500) {
  await ensureDb();
  return sql`select i.id, i.invoice_no, i.invoice_date, i.total::float8 as total, i.dispatched_at,
      cu.id as customer_id, cu.name as customer,
      coalesce((select sum(amount) from ledger l where l.invoice_id = i.id and l.kind = 'payment'), 0)::float8 as paid
    from invoices i join customers cu on cu.id = i.customer_id
    order by i.created_at desc, i.id desc limit ${limit}`;
}

export async function getInvoice(id) {
  await ensureDb();
  const [invoice] = await sql`select i.*, i.total::float8 as total,
      cu.name as customer, cu.phone, cu.address,
      coalesce((select sum(amount) from ledger l where l.invoice_id = i.id and l.kind = 'payment'), 0)::float8 as paid
    from invoices i join customers cu on cu.id = i.customer_id where i.id = ${id}`;
  if (!invoice) return null;
  const lines = await sql`select ii.*, ii.unit_price::float8 as unit_price, ii.line_total::float8 as line_total, it.sku
    from invoice_items ii left join items it on it.id = ii.item_id where ii.invoice_id = ${id} order by ii.id`;
  const calls = await sql`select * from calls where invoice_id = ${id} order by created_at desc`;
  return { ...invoice, lines, calls };
}

export async function markDispatched(id) {
  await ensureDb();
  await sql`update invoices set dispatched_at = coalesce(dispatched_at, now()) where id = ${id}`;
}

export async function recordPayment({ customer_id, invoice_id, amount, note }) {
  await ensureDb();
  await sql`insert into ledger (customer_id, invoice_id, kind, amount, note)
    values (${customer_id}, ${invoice_id || null}, 'payment', ${amount}, ${note || null})`;
}

export async function logCall({ invoice_id, kind, script }) {
  await sql`insert into calls (invoice_id, kind, script) values (${invoice_id}, ${kind}, ${script})`;
}

export async function listItems() {
  await ensureDb();
  return sql`select id, sku, name, category, unit, stock_qty,
      cost_price::float8 as cost_price, sell_price::float8 as sell_price
    from items order by category, name`;
}

export async function updateItem({ id, stock_qty, sell_price }) {
  await ensureDb();
  await sql`update items set stock_qty = ${stock_qty}, sell_price = ${sell_price} where id = ${id}`;
}

export async function addItem({ name, category, unit, stock_qty, cost_price, sell_price }) {
  await ensureDb();
  await sql.begin(async (tx) => {
    const [{ next }] = await tx`select coalesce(max(id), 0) + 101 as next from items`;
    await tx`insert into items (sku, name, category, unit, stock_qty, cost_price, sell_price)
      values (${"LBD-" + String(next).padStart(6, "0")}, ${name}, ${category}, ${unit}, ${stock_qty}, ${cost_price}, ${sell_price})`;
  });
}

export async function listCustomers() {
  await ensureDb();
  return sql`select cu.id, cu.name, cu.phone, cu.address,
      coalesce(sum(l.amount) filter (where l.kind = 'invoice'), 0)::float8 as billed,
      coalesce(sum(l.amount) filter (where l.kind = 'payment'), 0)::float8 as paid,
      max(l.created_at) as last_activity
    from customers cu left join ledger l on l.customer_id = cu.id
    group by cu.id order by (coalesce(sum(l.amount) filter (where l.kind = 'invoice'), 0)
      - coalesce(sum(l.amount) filter (where l.kind = 'payment'), 0)) desc, cu.name`;
}

export async function getCustomer(id) {
  await ensureDb();
  const [customer] = await sql`select * from customers where id = ${id}`;
  if (!customer) return null;
  const entries = await sql`select l.id, l.kind, l.amount::float8 as amount, l.note, l.created_at, l.invoice_id, i.invoice_no,
      sum(case when l.kind = 'invoice' then l.amount else -l.amount end)
        over (order by l.created_at, l.id)::float8 as balance
    from ledger l left join invoices i on i.id = l.invoice_id
    where l.customer_id = ${id} order by l.created_at, l.id`;
  const invoices = (await listInvoices()).filter((i) => i.customer_id === customer.id);
  return { ...customer, entries, invoices, balance: entries.at(-1)?.balance ?? 0 };
}
