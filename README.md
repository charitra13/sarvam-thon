# Munshi

Turns photos of handwritten invoice slips into digital records for a stationery shop, keeps
inventory and a customer ledger, and makes Hinglish voice calls for dispatch and payment follow-ups.

## Features

- Slip OCR with Sarvam Vision (Doc AI, handwritten mode)
- Slip rows and written figures parsed separately from inventory matching; `sarvam-105b`
  chooses from a short list of candidates using Hindi spellings, brands and product variants
- Review uncertain matches, missing figures and arithmetic conflicts before saving; edits require a fresh check
- Optionally remember explicitly confirmed item names for future scans
- Scan several slips for one customer at once; their lines merge into one invoice
- Saving an invoice lowers stock and adds a debit to the customer's ledger
- Customer ledger (khata) with payments and a running balance
- Dispatch and payment calls voiced by Bulbul v4 (`simran_enhi_customer`), played in the browser
- Opens directly to the dashboard with no login for the hackathon demo

## Setup

Requires Bun, a Sarvam API key and a Neon Postgres database. Put these in `.env`:

- `SARVAM_API_KEY`
- `DATABASE_URL` (Neon pooled connection string)

```sh
bun install
bun run dev      # http://localhost:3000
bun run build
bun run test     # deterministic OCR, matching and invoice validation checks
```

Tables are created on the first request, and demo inventory is seeded only when the item table
is empty. On Vercel, set the same two environment variables.

Remembering item names is optional. Validate
`data-migrations/20261103_create_item_aliases.sql` on an isolated database branch before applying
it to the target database. Until that migration is applied, scanning works and remembering names
is disabled. Only an item explicitly chosen, checked and marked to remember during invoice review
teaches a name; model guesses do not.
