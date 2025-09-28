/**
 * Crypto Price Arbitrage Finder
 *
 * - Compares quotes from 0x and 1inch public APIs for configured token pairs.
 * - Produces JSON reports with detected spreads and "top N" opportunities.
 *
 * Environment variables (.env):
 *   CHAIN_ID (default 1)
 *   WEBHOOK_URL (optional) - POST report
 *
 * Note: This is an example/template. You can add more sources (on-chain pair checks)
 * or other aggregators as needed.
 */
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const config = require('../config/pairs.config.json');

const CHAIN_ID = process.env.CHAIN_ID || '1'; // 1 = Ethereum mainnet

// helper to call 0x price API
async function quote0x(sellToken, buyToken, sellAmount) {
  const url = `https://api.0x.org/swap/v1/price?sellToken=${encodeURIComponent(sellToken)}&buyToken=${encodeURIComponent(buyToken)}&sellAmount=${sellAmount}`;
  const res = await axios.get(url, { timeout: 10000 });
  // res.data: price, buyAmount, sellAmount, estimatedGas, etc.
  return res.data;
}

// helper to call 1inch quote API (v5)
async function quote1inch(chainId, fromTokenAddress, toTokenAddress, amount) {
  const url = `https://api.1inch.io/v5.0/${chainId}/quote?fromTokenAddress=${fromTokenAddress}&toTokenAddress=${toTokenAddress}&amount=${amount}`;
  const res = await axios.get(url, { timeout: 10000 });
  return res.data;
}

function toFloatAmount(rawAmount, decimals) {
  // rawAmount is a string or number in smallest unit
  return Number(rawAmount) / Math.pow(10, decimals);
}

async function analyzePair(pair) {
  // choose a sellAmount (in smallest unit) from config or default (1 unit of sell token)
  const sellAmountUnits = pair.sampleSellAmount || 1; // e.g., 1 ETH
  const sellDecimals = pair.fromDecimals;
  const sellAmount = BigInt(Math.floor(sellAmountUnits * Math.pow(10, sellDecimals))).toString();

  const results = { pair: pair.name, timestamp: new Date().toISOString(), quotes: [] };

  // 0x quote
  try {
    const q0 = await quote0x(pair.fromSymbol, pair.toSymbol, sellAmount);
    // 0x returns price as string and buyAmount/sellAmount as strings in token units (not decimals)
    // but to be safe we compute price: buyAmount/sellAmount adjusted by decimals
    const buyAmount0x = q0.buyAmount ? q0.buyAmount : q0.to ? q0.to : null;
    const sellAmount0x = q0.sellAmount;
    const price0x = q0.price ? Number(q0.price) : (buyAmount0x && sellAmount0x ? Number(buyAmount0x)/Number(sellAmount0x) : null);
    results.quotes.push({ source: '0x', price: price0x, raw: q0 });
  } catch (e) {
    results.quotes.push({ source: '0x', error: e.message });
  }

  // 1inch quote
  try {
    const q1 = await quote1inch(CHAIN_ID, pair.fromAddress, pair.toAddress, sellAmount);
    // q1.toTokenAmount, q1.fromTokenAmount are strings
    const price1 = q1.toTokenAmount && q1.fromTokenAmount ? Number(q1.toTokenAmount) / Number(q1.fromTokenAmount) : null;
    results.quotes.push({ source: '1inch', price: price1, raw: q1 });
  } catch (e) {
    results.quotes.push({ source: '1inch', error: e.message });
  }

  // compute spreads between sources
  const validQuotes = results.quotes.filter(q => q.price && !isNaN(q.price));
  if (validQuotes.length >= 2) {
    // find best buy (highest price for buyToken per sellToken) and worst
    const prices = validQuotes.map(q => q.price);
    const maxP = Math.max(...prices);
    const minP = Math.min(...prices);
    const spread = ((maxP - minP) / minP) * 100;
    results.spread_percent = spread;
    results.best = validQuotes.find(q => q.price === maxP).source;
    results.worst = validQuotes.find(q => q.price === minP).source;
  }

  return results;
}

async function main() {
  const timestamp = new Date().toISOString();
  const reports = [];
  for (const pair of config.pairs) {
    try {
      const r = await analyzePair(pair);
      reports.push(r);
    } catch (e) {
      reports.push({ pair: pair.name, error: e.message });
    }
  }

  // sort by spread
  const opportunities = reports.filter(r => r.spread_percent).sort((a,b)=>b.spread_percent - a.spread_percent);
  const report = {
    timestamp,
    opportunities,
    summary: { total_pairs: reports.length, candidates: opportunities.length }
  };

  const outPath = path.join(REPORTS_DIR, `opportunities-${timestamp.replace(/[:.]/g,'-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('Wrote', outPath);

  // optionally post to webhook
  const webhook = process.env.WEBHOOK_URL;
  if (webhook && opportunities.length) {
    try {
      await axios.post(webhook, report, { headers: {'Content-Type': 'application/json'}, timeout: 10000 });
      console.log('Posted to webhook');
    } catch (e) {
      console.warn('Webhook post failed:', e.message || e);
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
