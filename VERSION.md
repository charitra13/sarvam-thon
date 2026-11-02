# Version history

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
