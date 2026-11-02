-- 20260423_transform_railway_staging.sql
-- Transform selected Railway staging data into the Track Desk app schemas.
--
-- Run after db/migrations/006_track_desk_import_support.sql.

BEGIN;

CREATE TEMP TABLE temp_item_map (
    legacy_item_id integer PRIMARY KEY,
    new_item_id    uuid    NOT NULL
) ON COMMIT DROP;

INSERT INTO temp_item_map (legacy_item_id, new_item_id)
SELECT id, gen_random_uuid()
FROM railway_inventory.items;

INSERT INTO inventory.items (
    id,
    sku,
    name,
    category,
    barcode,
    stock_qty,
    cost_price,
    sell_price,
    tax_percent,
    is_active,
    created_at,
    updated_at
)
SELECT
    m.new_item_id,
    nullif(trim(i.sku), ''),
    i.name,
    'Uncategorized',
    null,
    i.quantity::int,
    coalesce(i.cost_price, 0),
    coalesce(i.sell_price, 0),
    coalesce(i.tax, 0),
    true,
    coalesce(i.created_at, now()),
    now()
FROM railway_inventory.items i
JOIN temp_item_map m ON m.legacy_item_id = i.id;

CREATE TEMP TABLE temp_customer_map (
    legacy_customer_id integer PRIMARY KEY,
    new_customer_id    uuid    NOT NULL
) ON COMMIT DROP;

INSERT INTO temp_customer_map (legacy_customer_id, new_customer_id)
SELECT id, gen_random_uuid()
FROM railway_orders.customers;

INSERT INTO orders.customers (
    id,
    name,
    phone,
    email,
    address,
    created_at
)
SELECT
    m.new_customer_id,
    c.name,
    c.phone,
    c.email,
    coalesce(nullif(c.billing_address, ''), nullif(c.shipping_address, '')),
    coalesce(c.created_at, now())
FROM railway_orders.customers c
JOIN temp_customer_map m ON m.legacy_customer_id = c.id;

CREATE TEMP TABLE temp_estimate_map (
    legacy_bill_id  integer PRIMARY KEY,
    new_estimate_id uuid    NOT NULL
) ON COMMIT DROP;

INSERT INTO temp_estimate_map (legacy_bill_id, new_estimate_id)
SELECT id, gen_random_uuid()
FROM railway_estimates.bills;

CREATE TEMP TABLE temp_seeded_super_admin (
    id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO temp_seeded_super_admin (id)
SELECT id
FROM app_auth.users
WHERE username = 'admin'
  AND role::text = 'super_admin'
ORDER BY created_at ASC
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM temp_seeded_super_admin) THEN
    RAISE EXCEPTION 'Seeded Super Admin user not found';
  END IF;
END
$$;

WITH bill_totals AS (
    SELECT
        b.id,
        coalesce(
            sum(
                coalesce(nullif(line.item ->> 'price', '')::numeric, 0)
                * coalesce(nullif(line.item ->> 'quantity', '')::numeric, 0)
            ),
            0
        ) AS subtotal,
        coalesce(
            sum(coalesce(nullif(line.item ->> 'discount_price', '')::numeric, 0)),
            0
        ) AS discount
    FROM railway_estimates.bills b
    LEFT JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN jsonb_typeof(b.items::jsonb) = 'array' THEN b.items::jsonb
            ELSE '[]'::jsonb
        END
    ) AS line(item) ON true
    GROUP BY b.id
)
INSERT INTO estimates.estimates (
    id,
    estimate_number,
    customer_name,
    customer_id,
    subtotal,
    discount,
    tax_total,
    total,
    status,
    valid_until,
    notes,
    created_by,
    created_at
)
SELECT
    m.new_estimate_id,
    'EST-RY-' || lpad(b.id::text, 6, '0'),
    b.client_name,
    null,
    bt.subtotal,
    bt.discount,
    0,
    b.grand_total,
    'draft',
    null,
    'Imported from Railway bill ' || b.id,
    admin.id,
    coalesce(b.created_at, b.estimate_date, now())
FROM railway_estimates.bills b
JOIN temp_estimate_map m ON m.legacy_bill_id = b.id
JOIN bill_totals bt ON bt.id = b.id
CROSS JOIN temp_seeded_super_admin admin;

INSERT INTO estimates.estimate_items (
    estimate_id,
    item_id,
    item_name,
    item_sku,
    quantity,
    unit_price,
    tax_percent,
    total
)
SELECT
    m.new_estimate_id,
    null,
    line.item ->> 'item_name',
    null,
    coalesce(nullif(line.item ->> 'quantity', '')::numeric, 0)::int,
    coalesce(nullif(line.item ->> 'price', '')::numeric, 0),
    0,
    coalesce(nullif(line.item ->> 'price', '')::numeric, 0)
      * coalesce(nullif(line.item ->> 'quantity', '')::numeric, 0)
FROM railway_estimates.bills b
JOIN temp_estimate_map m ON m.legacy_bill_id = b.id
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(b.items::jsonb) = 'array' THEN b.items::jsonb
        ELSE '[]'::jsonb
    END
) AS line(item);

INSERT INTO settings.app_settings (
    id,
    company_name,
    company_address,
    company_phone,
    company_email,
    vat_number
)
VALUES (
    1,
    'Track Desk Stationery',
    '',
    '',
    '',
    ''
)
ON CONFLICT (id) DO UPDATE
SET company_name = EXCLUDED.company_name,
    company_address = EXCLUDED.company_address,
    company_phone = EXCLUDED.company_phone,
    company_email = EXCLUDED.company_email,
    vat_number = EXCLUDED.vat_number,
    updated_at = now();

DROP TABLE temp_seeded_super_admin;
DROP TABLE temp_estimate_map;
DROP TABLE temp_customer_map;
DROP TABLE temp_item_map;

COMMIT;
