/**
 * Crypto Price Arbitrage Finder (enhanced)
 *
 * - Multi-chain (configurable) scanning across multiple aggregators (0x, 1inch, Paraswap, CowSwap)
 * - Smarter sell sizing from USD targets via CoinGecko (fallbacks to static amount)
 * - Resilient retries/timeouts with clear error context
 * - JSON + CSV + Markdown reports with `latest` pointers for the frontend
 * - Optional webhook posting
 */
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const config = require('../config/pairs.config.json');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

const OX_HOSTS = {
  1: 'https://api.0x.org',
  56: 'https://bsc.api.0x.org',
  137: 'https://polygon.api.0x.org'
};
const COW_HOSTS = {
  1: 'https://api.cow.fi/mainnet'
};
const DEFAULT_TIMEOUT = 12000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

const priceCache = new Map();
const axiosClient = axios.create({ timeout: DEFAULT_TIMEOUT });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, label) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw decorateError(err, label);
      attempt += 1;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

function decorateError(err, label) {
  const reason = err.response?.data?.description || err.response?.data?.message || err.message || String(err);
  const status = err.response?.status ? ` [${err.response.status}]` : '';
  return new Error(`${label || 'request'} failed${status}: ${reason}`);
}

function normalizeAmount(raw, decimals) {
  if (raw === null || raw === undefined) return null;
  const num = Number(raw);
  if (!isFinite(num)) return null;
  return num / Math.pow(10, decimals);
}

async function fetchTokenUsdPrice(coingeckoId) {
  if (!coingeckoId) return null;
  if (priceCache.has(coingeckoId)) return priceCache.get(coingeckoId);
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd`;
  const { data } = await axiosClient.get(url);
  const usd = data?.[coingeckoId]?.usd;
  if (usd) priceCache.set(coingeckoId, usd);
  return usd || null;
}

async function calculateSellAmount(pair, chain) {
  // Prefer explicit sample amount (token units), otherwise derive from USD target.
  if (pair.sampleSellAmount) {
    const raw = BigInt(Math.floor(pair.sampleSellAmount * Math.pow(10, pair.fromDecimals)));
    return { raw: raw.toString(), human: pair.sampleSellAmount };
  }

  const usdTarget = pair.usdSellTarget || chain.defaultUsdSell || 10;
  try {
    const price = await fetchTokenUsdPrice(pair.coingeckoId);
    if (price) {
      const tokens = usdTarget / price;
      const raw = BigInt(Math.max(1, Math.floor(tokens * Math.pow(10, pair.fromDecimals))));
      return { raw: raw.toString(), human: tokens };
    }
  } catch (err) {
    // Fall through to default below.
  }

  const fallback = Math.max(1, usdTarget / 1000);
  const raw = BigInt(Math.floor(fallback * Math.pow(10, pair.fromDecimals)));
  return { raw: raw.toString(), human: fallback };
}

async function quote0x(chainId, pair, sellAmount) {
  const host = OX_HOSTS[chainId];
  if (!host) throw new Error('0x not supported for chain');
  const url = `${host}/swap/v1/price?sellToken=${encodeURIComponent(pair.fromAddress)}&buyToken=${encodeURIComponent(pair.toAddress)}&sellAmount=${sellAmount}`;
  const { data } = await axiosClient.get(url);
  return { source: '0x', price: Number(data.price), buyAmount: data.buyAmount, sellAmount: data.sellAmount, raw: data };
}

async function quote1inch(chainId, pair, sellAmount) {
  const url = `https://api.1inch.io/v5.0/${chainId}/quote?fromTokenAddress=${pair.fromAddress}&toTokenAddress=${pair.toAddress}&amount=${sellAmount}`;
  const { data } = await axiosClient.get(url);
  const price = data.toTokenAmount && data.fromTokenAmount ? Number(data.toTokenAmount) / Number(data.fromTokenAmount) : null;
  return { source: '1inch', price, buyAmount: data.toTokenAmount, sellAmount: data.fromTokenAmount, raw: data };
}

async function quoteParaswap(chainId, pair, sellAmount) {
  const url = `https://api.paraswap.io/prices/?fromToken=${pair.fromAddress}&toToken=${pair.toAddress}&amount=${sellAmount}&srcDecimals=${pair.fromDecimals}&destDecimals=${pair.toDecimals}&side=SELL&network=${chainId}`;
  const { data } = await axiosClient.get(url);
  const route = data.priceRoute || data;
  const price = route.destAmount && route.srcAmount ? Number(route.destAmount) / Number(route.srcAmount) : null;
  return { source: 'paraswap', price, buyAmount: route.destAmount, sellAmount: route.srcAmount, raw: data };
}

async function quoteCow(chainId, pair, sellAmount) {
  const host = COW_HOSTS[chainId];
  if (!host) throw new Error('CowSwap not supported for chain');
  const url = `${host}/api/v1/quote`;
  const body = {
    sellToken: pair.fromAddress,
    buyToken: pair.toAddress,
    receiver: '0x000000000000000000000000000000000000dead',
    from: '0x000000000000000000000000000000000000dead',
    appData: '0x' + '0'.repeat(64),
    partiallyFillable: false,
    kind: 'sell',
    sellAmountBeforeFee: sellAmount
  };
  const { data } = await axiosClient.post(url, body, { headers: { 'Content-Type': 'application/json' } });
  const quote = data.quote || data;
  const price = quote.buyAmount && quote.sellAmount ? Number(quote.buyAmount) / Number(quote.sellAmount) : null;
  return { source: 'cow', price, buyAmount: quote.buyAmount, sellAmount: quote.sellAmount, raw: data };
}

async function collectQuotes(chain, pair, sellAmount) {
  const tasks = [];
  for (const agg of chain.aggregators || []) {
    const label = `${agg} ${pair.name}`;
    const fn = async () => {
      switch (agg) {
        case '0x':
          return quote0x(chain.id, pair, sellAmount);
        case '1inch':
          return quote1inch(chain.id, pair, sellAmount);
        case 'paraswap':
          return quoteParaswap(chain.id, pair, sellAmount);
        case 'cow':
          return quoteCow(chain.id, pair, sellAmount);
        default:
          throw new Error(`Unknown aggregator ${agg}`);
      }
    };

    tasks.push(
      withRetry(fn, label)
        .then(res => normalizeQuote(res, pair))
        .catch(err => ({ source: agg, error: err.message }))
    );
  }

  return Promise.all(tasks);
}

function normalizeQuote(res, pair) {
  const buyNorm = normalizeAmount(res.buyAmount, pair.toDecimals);
  const sellNorm = normalizeAmount(res.sellAmount, pair.fromDecimals);
  return { ...res, buyAmountHuman: buyNorm, sellAmountHuman: sellNorm };
}

function computeSpread(quotes) {
  const valid = quotes.filter(q => q.price && isFinite(q.price));
  if (valid.length < 2) return null;
  const prices = valid.map(q => q.price);
  const maxP = Math.max(...prices);
  const minP = Math.min(...prices);
  const best = valid.find(q => q.price === maxP);
  const worst = valid.find(q => q.price === minP);
  const spread = ((maxP - minP) / minP) * 100;
  return { spread_percent: spread, best: best?.source, worst: worst?.source };
}

async function analyzePair(chain, pair) {
  const sellInfo = await calculateSellAmount(pair, chain);
  const quotes = await collectQuotes(chain, pair, sellInfo.raw);
  const spread = computeSpread(quotes);

  const buys = quotes.map(q => q.buyAmountHuman || 0);
  const bestBuy = buys.length ? Math.max(...buys) : 0;
  let liquidityFlag = null;
  if (pair.minBuyAmount && bestBuy < pair.minBuyAmount) {
    liquidityFlag = `best buy ${bestBuy.toFixed(4)} < min ${pair.minBuyAmount}`;
  }

  const result = {
    pair: pair.name,
    chainId: chain.id,
    chain: chain.name,
    sellAmount: Number(sellInfo.human.toFixed ? sellInfo.human.toFixed(6) : sellInfo.human),
    sellToken: pair.fromSymbol,
    buyToken: pair.toSymbol,
    quotes,
    minBuyAmount: pair.minBuyAmount,
    liquidity_flag: liquidityFlag || undefined
  };

  if (spread && !liquidityFlag) {
    result.spread_percent = spread.spread_percent;
    result.best = spread.best;
    result.worst = spread.worst;
  }

  return result;
}

function sortOpportunities(list) {
  return (list || []).filter(r => r.spread_percent).sort((a, b) => b.spread_percent - a.spread_percent);
}

function buildCsv(report) {
  const rows = ['timestamp,chain,pair,best,worst,spread_percent,sell_amount,sell_token,buy_token,liquidity_flag'];
  for (const chain of report.chains) {
    for (const op of chain.opportunities) {
      const cells = [
        report.timestamp,
        chain.chain,
        op.pair,
        op.best,
        op.worst,
        op.spread_percent?.toFixed(4),
        op.sellAmount,
        op.sellToken,
        op.buyToken,
        op.liquidity_flag || ''
      ];
      rows.push(cells.map(v => (v === undefined ? '' : String(v))).join(','));
    }
  }
  return rows.join('\n');
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# Arbitrage Opportunities (${report.timestamp})`);
  for (const chain of report.chains) {
    lines.push(`\n## ${chain.chain} (top ${chain.opportunities.length})`);
    lines.push('| Pair | Spread % | Best | Worst | Sell Amount | Notes |');
    lines.push('| --- | ---: | --- | --- | --- | --- |');
    for (const op of chain.opportunities) {
      lines.push(`| ${op.pair} | ${op.spread_percent?.toFixed(4) || 'n/a'} | ${op.best || 'n/a'} | ${op.worst || 'n/a'} | ${op.sellAmount} ${op.sellToken} | ${op.liquidity_flag || ''} |`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const timestamp = new Date().toISOString();
  const enabledChains = parseChainFilter(config.chains || []);

  const chainReports = [];
  for (const chain of enabledChains) {
    const pairResults = [];
    for (const pair of chain.pairs || []) {
      try {
        const r = await analyzePair(chain, pair);
        pairResults.push(r);
      } catch (err) {
        pairResults.push({ pair: pair.name, chainId: chain.id, chain: chain.name, error: err.message });
      }
    }
    const opportunities = sortOpportunities(pairResults);
    chainReports.push({ chain: chain.name, chainId: chain.id, total_pairs: pairResults.length, opportunities, raw: pairResults });
  }

  const flattened = chainReports.flatMap(c => c.opportunities || []);
  const topFlattened = sortOpportunities(flattened).slice(0, 20);
  const report = {
    timestamp,
    chains: chainReports,
    top: topFlattened,
    summary: {
      total_chains: chainReports.length,
      total_pairs: chainReports.reduce((acc, c) => acc + c.total_pairs, 0),
      candidates: topFlattened.length
    }
  };

  const outPath = path.join(REPORTS_DIR, `opportunities-${timestamp.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const latestJson = path.join(REPORTS_DIR, 'latest.json');
  fs.writeFileSync(latestJson, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(REPORTS_DIR, 'latest.csv'), buildCsv(report));
  fs.writeFileSync(path.join(REPORTS_DIR, 'latest.md'), buildMarkdown(report));

  console.log('Wrote', outPath);

  const webhook = process.env.WEBHOOK_URL;
  if (webhook && report.top.length) {
    try {
      await axiosClient.post(webhook, report, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
      console.log('Posted to webhook');
    } catch (err) {
      console.warn('Webhook post failed:', err.message || err);
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseChainFilter(chains) {
  const env = process.env.CHAIN_IDS;
  if (!env) return chains;
  const allow = env.split(',').map(v => Number(v.trim())).filter(Boolean);
  return chains.filter(c => allow.includes(c.id));
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
