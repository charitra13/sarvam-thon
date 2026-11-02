# Sarvam chat

A minimal JavaScript example that calls Sarvam's `sarvam-105b` chat model with Bun
and prints the reply. It also accepts a custom prompt as a command-line argument.

Requires Bun and a Sarvam account with API credits. Store your key as
`SARVAM_API_KEY` in a local `.env` file; Bun loads it automatically and Git ignores it.

```sh
bun install
bun start
bun start "Say hello in Hindi."
```
