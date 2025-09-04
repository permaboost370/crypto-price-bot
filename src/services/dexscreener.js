import axios from "axios";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWithRetry(url, { timeout = 10000 } = {}, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.get(url, {
        timeout,
        headers: { "User-Agent": "crypto-price-bot/1.0 (+render)" }
      });
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const isTimeout = err?.code === "ECONNABORTED";
      const retryable = status === 429 || status >= 500 || isTimeout;
      if (!retryable || attempt === maxRetries) break;
      const wait = 500 * Math.pow(2, attempt);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// simple cache: contract -> result
const tokenCache = new Map();

export async function getTokenByContract(contract) {
  const key = contract.trim().toLowerCase();
  const TTL_MS = 10 * 1000; // 10s to reduce spam
  const now = Date.now();
  const cached = tokenCache.get(key);
  if (cached && now - cached.ts < TTL_MS) return cached.data;

  const url = `https://api.dexscreener.com/latest/dex/tokens/${key}`;
  const { data } = await getWithRetry(url, { timeout: 12000 });

  if (!data || !data.pairs || data.pairs.length === 0) {
    throw new Error("Token not found on Dexscreener.");
  }

  const best = data.pairs
    .filter((p) => p.priceUsd)
    .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

  if (!best) throw new Error("No price data with USD liquidity found.");

  const result = {
    name: best.baseToken?.name || "",
    symbol: best.baseToken?.symbol || "",
    priceUsd: parseFloat(best.priceUsd),
    dex: best.dexId,
    pairUrl: best.url,
    chainId: best.chainId,
    liquidityUsd: best.liquidity?.usd || 0,
    fdvUsd: best.fdv || null,
    priceChange: best.priceChange || null // { m5, h1, h6, h24 }
  };

  tokenCache.set(key, { ts: now, data: result });
  return result;
}
