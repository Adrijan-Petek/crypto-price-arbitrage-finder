# Crypto Price Arbitrage Finder  

Compare quotes across multiple DEX aggregators (0x, 1inch, Paraswap, CowSwap) on multiple chains, rank spreads, and publish JSON/CSV/Markdown reports for a small frontend dashboard.

## How it works
- `config/pairs.config.json` lists chains, pairs, preferred aggregators, and USD sizing hints.
- `src/arbitrage.js` pulls quotes from every configured aggregator, computes spreads, and flags thin-liquidity pairs.
- Reports are written to `reports/` as versioned files plus `latest.json` / `latest.csv` / `latest.md` for easy consumption.
- Optional webhook posting for the newest report.

## Quickstart
1. Copy `.env.example` to `.env` and optionally set:
   - `CHAIN_IDS` (comma separated, e.g. `1,137`) to limit which chains run
   - `WEBHOOK_URL` to POST the final report somewhere
2. Install deps:
   ```
   npm install
   ```
3. Run scanner:
   ```
   npm run scan
   ```
4. Outputs land in `reports/` (create the folder if it does not exist). The newest files are `latest.json`, `latest.csv`, and `latest.md`.

## Config basics (`config/pairs.config.json`)
- `chains[]`: `id`, `name`, `aggregators` (subset of `0x`, `1inch`, `paraswap`, `cow`), `defaultUsdSell`.
- `pairs[]`: token symbols, addresses, decimals, `coingeckoId`, and optional `usdSellTarget` or `sampleSellAmount`.
- `minBuyAmount` filters out results where even the best quote would return less than the threshold (to avoid dust/liquidity traps).

## Frontend
The `/web` Next.js page reads `reports/latest.json` if present (falls back to `sample_reports/report-sample.json`). It shows a sorted list of top spreads, filtering by chain and search, plus a quick bar chart. Deploy `/web` anywhere static (Vercel works) and host the `reports/` artifacts publicly or behind a small API.

## Extending
- Add more chains/pairs by editing the config.
- To try different sell sizes, set `usdSellTarget` or a fixed `sampleSellAmount`.
- Add more aggregators by wiring a new quote helper in `src/arbitrage.js` and listing it under `aggregators` for the chains that support it.

## Notes
- CoinGecko is used to turn USD sizing into token amounts; if that fails we fall back to a tiny deterministic amount.
- CowSwap is enabled for Ethereum only in the sample config; add other supported networks as desired.
- For automation, wire the `scan` script into cron or a GitHub Action and publish `reports/latest.json` for the frontend.
