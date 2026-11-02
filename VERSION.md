# Version history

## 1.0.0

- Separate slip-row extraction from inventory matching. Keep source text and figures, retrieve
  bounded Hindi/English catalog candidates, and flag ambiguous products and pack variants.
- Require review of inferred rates, missing figures, edited lines and total discrepancies.
  Validate entire invoices before saving and preserve written rounding amounts in bills and ledgers.
- Add optional, explicitly confirmed item aliases behind a separate database migration; keep
  remembering disabled when its table is absent.
- Add deterministic regression coverage for captured Ankur Hindi/default-English and Sanjeev
  OCR, candidate matching, invoice validation and persistence. Other test photos and real-photo
  product identities still require manual validation.

## 0.6.0-alpha.1 — unfinished checkpoint

- Draft separate slip-row parsing and bounded catalog candidate matching, with Hindi spelling
  normalization, arithmetic warnings, and review controls. Add 37 deterministic regression tests.
- Draft explicit alias learning behind an optional, unapplied database migration. No production
  schema migration has been applied.
- Not release-ready: fallback extraction still needs numeric grounding; server-side invoice
  validation and review acknowledgements need tightening. Alias availability and inferred rate
  corrections also need review. Independent final code review remains pending.

## 0.5.1

- Replace Neon's demo inventory with the final CSV catalog: 3,950 items across 12 categories,
  mapped to the existing item schema by SKU. Use `unit_size` as the unit, defaulting to `pc`.
- Preserve invoice details and ledger balances; clear six demo invoice item links whose reused
  SKUs now identify different products. CSV fields absent from the current schema are not imported.

## 0.5.0

- Scan several slips at once for one customer: choose or drop multiple photos, or add camera shots one
  by one. Each slip is read and matched in turn, and all lines merge into one invoice for review.
  A failed slip can be retried without re-reading the others.

## 0.4.0

- Switch the whole UI to Helvetica Neue (Helvetica/Arial fallback) and drop the four Google fonts. Colors
  and the ledger theme are unchanged; heading weights, note sizes and label weights are retuned for the new face.

## 0.3.0

- Open the hackathon demo directly on the dashboard without login, remove sign-out and session
  checks, and redirect old login links to the dashboard.

## 0.2.1

- Fix slip reading: teach the matcher the bill-book columns (S.No, quantity, description, rate, amount),
  read handwritten numbers in code (S = 5, "/" paise mark) and price lines from the written amount.

## 0.2.0

- Add the Munshi app: Sarvam Vision slip OCR, sarvam-105b inventory matching, invoices, inventory,
  customer ledger, Bulbul Hinglish calls, demo login and Neon Postgres storage.
- Fix `first-call.js` sending an invalid `reasoning_effort` value.

## 0.1.0

- Add a Bun chat example using the Sarvam SDK and environment-based credentials.
