# Version history

## 0.2.1

- Fix slip reading: teach the matcher the bill-book columns (S.No, quantity, description, rate, amount),
  read handwritten numbers in code (S = 5, "/" paise mark) and price lines from the written amount.

## 0.2.0

- Add the Munshi app: Sarvam Vision slip OCR, sarvam-105b inventory matching, invoices, inventory,
  customer ledger, Bulbul Hinglish calls, demo login and Neon Postgres storage.
- Fix `first-call.js` sending an invalid `reasoning_effort` value.

## 0.1.0

- Add a Bun chat example using the Sarvam SDK and environment-based credentials.
