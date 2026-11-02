-- Shop-confirmed slip spellings for inventory items (e.g. "pen doms inakstra" -> one SKU).
-- Not run automatically: the app reads and writes aliases only after this table exists.
-- Rows are added only when a person picks an item for a slip line and ticks "remember" at save.
-- Apply on a branch first; roll back with: drop table item_aliases;

create table if not exists item_aliases (
  id serial primary key,
  alias text not null check (length(alias) between 3 and 200),
  item_id int not null references items(id) on delete cascade,
  invoice_id int references invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (alias, item_id)
);
