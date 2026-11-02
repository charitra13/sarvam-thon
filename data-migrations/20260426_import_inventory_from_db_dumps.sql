-- 20260426_import_inventory_from_db_dumps.sql
-- Import only Railway inventory data from db-dumps into the Track Desk inventory schema.
--
-- Run from the repository root after db/migrations/006_track_desk_import_support.sql:
-- psql <database> -v ON_ERROR_STOP=1 -f db/data-migrations/20260426_import_inventory_from_db_dumps.sql

BEGIN;

CREATE TEMP TABLE temp_railway_inventory_items (
    item_id integer NOT NULL,
    sku text,
    name text NOT NULL,
    category_id integer,
    unit text,
    cost_price numeric(12,2),
    sell_price numeric(12,2),
    barcode text,
    description text,
    created_at timestamptz,
    tax numeric(6,2),
    quantity numeric
) ON COMMIT DROP;

\copy temp_railway_inventory_items (item_id, sku, name, category_id, unit, cost_price, sell_price, barcode, description, created_at, tax, quantity) FROM PROGRAM 'awk ''/^COPY railway_inventory.items \(item_id, sku, name, category_id, unit, cost_price, sell_price, barcode, description, created_at, tax, quantity\) FROM stdin;$/ { copy = 1; next } copy && /^\\\.$/ { exit } copy { print }'' db-dumps/railway-full-20260423-003950.sql' WITH (FORMAT text);

INSERT INTO inventory.categories (name)
SELECT curated.category_name
FROM (
    VALUES
        ('Books & Study Material'),
        ('School Textbooks & Course Books'),
        ('Exam Guides & Practice Books'),
        ('Children''s Learning Books'),
        ('Notebooks & Registers'),
        ('Paper & Chart Materials'),
        ('Pens, Pencils & Writing'),
        ('Art & Craft Supplies'),
        ('Adhesives & Tapes'),
        ('Files & Folders'),
        ('Office & Geometry Supplies'),
        ('Board & Chalk Supplies')
) AS curated(category_name)
ON CONFLICT (name) DO NOTHING;

WITH source_rows AS (
    SELECT
        item_id,
        (
            substr(md5('railway_inventory.items:' || item_id::text), 1, 8) || '-' ||
            substr(md5('railway_inventory.items:' || item_id::text), 9, 4) || '-' ||
            substr(md5('railway_inventory.items:' || item_id::text), 13, 4) || '-' ||
            substr(md5('railway_inventory.items:' || item_id::text), 17, 4) || '-' ||
            substr(md5('railway_inventory.items:' || item_id::text), 21, 12)
        )::uuid AS id,
        CASE
            WHEN nullif(btrim(sku), '') ~ '^RYI-[0-9]{6}$' THEN regexp_replace(nullif(btrim(sku), ''), '^RYI-', 'LBD-')
            ELSE nullif(btrim(sku), '')
        END AS raw_sku,
        'LBD-' || lpad(item_id::text, 6, '0') AS generated_sku,
        btrim(name) AS name,
        nullif(btrim(barcode), '') AS raw_barcode,
        upper(
            concat_ws(
                ' ',
                coalesce(name, ''),
                coalesce(description, ''),
                coalesce(unit, '')
            )
        ) AS search_text,
        greatest(coalesce(quantity, 0), 0)::int AS stock_qty,
        coalesce(cost_price, sell_price, 0)::numeric(10,2) AS cost_price,
        coalesce(sell_price, cost_price, 0)::numeric(10,2) AS sell_price,
        greatest(coalesce(tax, 0), 0)::numeric(5,2) AS tax_percent,
        coalesce(created_at, now()) AS created_at
    FROM temp_railway_inventory_items
    WHERE nullif(btrim(name), '') IS NOT NULL
),
deduped_source AS (
    SELECT
        source_rows.*,
        CASE
            WHEN raw_sku IS NULL THEN generated_sku
            WHEN row_number() OVER (
                PARTITION BY upper(raw_sku)
                ORDER BY item_id
            ) = 1 THEN raw_sku
            ELSE generated_sku
        END AS sku,
        CASE
            WHEN raw_barcode IS NULL THEN NULL
            WHEN row_number() OVER (
                PARTITION BY raw_barcode
                ORDER BY item_id
            ) = 1 THEN raw_barcode
            ELSE NULL
        END AS barcode
    FROM source_rows
),
classified_source AS (
    SELECT
        deduped_source.id,
        deduped_source.item_id,
        deduped_source.sku,
        deduped_source.name,
        deduped_source.barcode,
        deduped_source.stock_qty,
        deduped_source.cost_price,
        deduped_source.sell_price,
        deduped_source.tax_percent,
        deduped_source.created_at,
        CASE
            WHEN deduped_source.search_text ~ 'CHALK|SLATE|DUSTER|WHITE BOARD|BLACK BOARD|BOARD MARKER' THEN 'Board & Chalk Supplies'
            WHEN deduped_source.search_text ~ 'FEVICOL|GLUE|GUM|ADHESIVE|BOPP TAPE|CELLO TAPE|MASKING TAPE|BROWN TAPE|TAPE' THEN 'Adhesives & Tapes'
            WHEN deduped_source.search_text ~ 'BOX FILE|FILE|FOLDER|DOCUMENT CASE|CHEQUE FOLDER|EXPANDING|ENVELOPE' THEN 'Files & Folders'
            WHEN deduped_source.search_text ~ 'CLIP BOARD|COMPASS|DIVIDER|PROTRACTOR|SET SQUARE|GEOMETRY|RULER|SCALE|STAPLER|STAPLE|PUNCH|BINDER|CUTTER|SCISSOR|PAPER KNIFE' THEN 'Office & Geometry Supplies'
            WHEN deduped_source.search_text ~ 'NOTEBOOK|REGISTER|LONG BOOK|PRACTICAL COPY|COPY|COPIES|JOURNAL|DIARY' THEN 'Notebooks & Registers'
            WHEN deduped_source.search_text ~ 'PAPER|REAM|SHEET|CARBON|CHART|CARD SHEET|CARD STOCK|STICKER|LABEL|OMR' THEN 'Paper & Chart Materials'
            WHEN deduped_source.search_text ~ 'PEN|PENCIL|REFILL|INK|FOUNTAIN|ERASER|RUBBER|SHARPENER|MARKER|HIGHLIGHTER' THEN 'Pens, Pencils & Writing'
            WHEN deduped_source.search_text ~ 'CRAYON|COLOUR|COLOR|PAINT|BRUSH|GLITTER|CRAFT|CLAY|CANVAS|PALETTE|DRAWING|SKETCH|POSTER COLOUR' THEN 'Art & Craft Supplies'
            WHEN deduped_source.search_text ~ 'ALPHABET|RHYME|PICTURE BOOK|NURSERY|CURSIVE|HANDWRITING|CARNIVAL|FIND OUT|TODDLER|PRIMER' THEN 'Children''s Learning Books'
            WHEN deduped_source.search_text ~ 'GUIDE|PRACTICE|SOLVED|UNSOLVED|QUESTION BANK|Q/B|QB|ENTRANCE|AGNIVEER|SSC|POLICE|NAVODYA|JEE|NEET|CTET|TET|POLYTECH|SAINIK|MODEL PAPER|SAMPLE PAPER|COMPETITIVE' THEN 'Exam Guides & Practice Books'
            WHEN deduped_source.search_text ~ 'TEXTBOOK|READER|GRAMMER|GRAMMAR|ENGLISH|HINDI|MATH|MATHEMATICS|SCIENCE|SOCIAL|SANSKRIT|VIGYAN|GANIT|BHUGOL|ITIHAS|COMMERCE|PHYSICS|CHEMISTRY|BIOLOGY|GENERAL KNOWLEDGE|COMPUTER|EDUCATION|VOCATIONAL|PHYSICAL EDUCATION|SAMAJIK|POORVI|MRIDANG|SARANGI|SANTOOR|VEENA|JIGYAASA|JEEV VIGYAN|RASAYAN|BHAUTIKI|KAUSHAL|MALHAAR|DEEPAKAM|CURIOSITY|NCERT|COURSE' THEN 'School Textbooks & Course Books'
            ELSE 'Books & Study Material'
        END AS category
    FROM deduped_source
),
collision_safe_source AS (
    SELECT
        classified_source.id,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM inventory.items existing_item
                WHERE existing_item.sku = classified_source.sku
                  AND existing_item.id <> classified_source.id
            ) THEN 'LBD-' || lpad(classified_source.item_id::text, 6, '0')
            ELSE classified_source.sku
        END AS sku,
        classified_source.name,
        classified_source.category,
        CASE
            WHEN classified_source.barcode IS NULL THEN NULL
            WHEN EXISTS (
                SELECT 1
                FROM inventory.items existing_item
                WHERE existing_item.barcode = classified_source.barcode
                  AND existing_item.id <> classified_source.id
            ) THEN NULL
            ELSE classified_source.barcode
        END AS barcode,
        classified_source.stock_qty,
        classified_source.cost_price,
        classified_source.sell_price,
        classified_source.tax_percent,
        classified_source.created_at
    FROM classified_source
)
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
    collision_safe_source.id,
    collision_safe_source.sku,
    collision_safe_source.name,
    collision_safe_source.category,
    collision_safe_source.barcode,
    collision_safe_source.stock_qty,
    collision_safe_source.cost_price,
    collision_safe_source.sell_price,
    collision_safe_source.tax_percent,
    true,
    collision_safe_source.created_at,
    now()
FROM collision_safe_source
ON CONFLICT (id) DO UPDATE
SET sku = EXCLUDED.sku,
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    barcode = EXCLUDED.barcode,
    stock_qty = EXCLUDED.stock_qty,
    cost_price = EXCLUDED.cost_price,
    sell_price = EXCLUDED.sell_price,
    tax_percent = EXCLUDED.tax_percent,
    is_active = EXCLUDED.is_active,
    created_at = EXCLUDED.created_at,
    updated_at = now();

COMMIT;
