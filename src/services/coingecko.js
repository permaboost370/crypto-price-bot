// src/services/coingecko.js  (now using CoinPaprika - no API key)
import axios from "axios";

const PAPRIKA = "https://api.coinpaprika.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWithRetry(path, { params = {}, timeout = 12000 } = {}, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.get(`${PAPRIKA}${path}`, {
        params,
        timeout,
        headers: { "User-Agent": "crypto-price-bot/1.0 (+render)" }
      });
      return res.data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const isTimeout = err?.code === "ECONNABORTED";
      const retryable = status === 429 || status >= 500 || isTimeout;
      if (!retryable || attempt === maxRetries) break;
      await sleep(500 * Math.pow(2, attempt)); // 0.5s, 1s, 2s, 4s...
    }
  }
  throw lastErr;
}

// ---------------- CACHES ----------------
/** Coins list cache (to resolve symbol/name -> paprika ID) */
let coinsCache = { ts: 0, data: null };
/** Price cache: paprika ID -> { price, change24h, ts } */
const priceCache = new Map();

/**
 * resolveCoinId(userInput) -> returns CoinPaprika coin ID (e.g., "btc-bitcoin")
 * Accepts: "btc", "bitcoin", "Bitcoin", etc.
 */
export async function resolveCoinId(userInput) {
  const q = userInput.trim();
  if (!q) throw new Error("Empty symbol.");

  // Refresh coins list every 30 minutes
  const now = Date.now();
  const FRESH_MS = 30 * 60 * 1000;

  if (!coinsCache.data || now - coinsCache.ts > FRESH_MS) {
    const all = await getWithRetry("/v1/coins", { timeout: 20000 });
    // Keep only active coins (exclude inactive and tokens here; tokens also return, but it's ok)
    const filtered = all.filter((c) => c.is_active && c.type === "coin");
    coinsCache = { ts: now, data: filtered };
  }

  const coins = coinsCache.data;
  const lower = q.toLowerCase();

  // 1) Exact ID match (user typed e.g. "btc-bitcoin")
  let found = coins.find((c) => c.id.toLowerCase() === lower);
  if (found) return found.id;

  // 2) Exact symbol match (e.g. "btc")
  found = coins.find((c) => (c.symbol || "").toLowerCase() === lower);
  if (found) return found.id;

  // 3) Exact name match (e.g. "bitcoin")
  found = coins.find((c) => (c.name || "").toLowerCase() === lower);
  if (found) return found.id;

  // 4) Fuzzy: symbol startsWith / name includes
  found =
    coins.find((c) => (c.symbol || "").toLowerCase().startsWith(lower)) ||
    coins.find((c) => (c.name || "").toLowerCase().includes(lower));
  if (found) return found.id;

  // 5) As a fallback, try Paprika search API (wider coverage)
  try {
    const s = await getWithRetry("/v1/search", {
      params: { q: q, c: "currencies", limit: 5 },
      timeout: 15000
    });
    const hit = Array.isArray(s?.currencies) && s.currencies[0];
    if (hit?.id) return hit.id; // already a paprika ID
  } catch (_) {
    // ignore and fall through
  }

  throw new Error("Coin not found on CoinPaprika.");
}

/**
 * getCoinPriceUSD(coinId) -> { price, change24h }
 * coinId is a Paprika ID like "btc-bitcoin".
 * Caches results for 60s to avoid rate limits.
 */
export async function getCoinPriceUSD(coinId) {
  const TTL = 60 * 1000; // 60s
  const now = Date.now();
  const cached = priceCache.get(coinId);
  if (cached && now - cached.ts < TTL) {
    return { price: cached.price, change24h: cached.change24h };
  }

  const data = await getWithRetry(`/v1/tickers/${encodeURIComponent(coinId)}`, {
    params: { quotes: "USD" },
    timeout: 12000
  });

  const usd = data?.quotes?.USD;
  if (!usd || typeof usd.price !== "number") {
    throw new Error("Price not available.");
  }

  const result = {
    price: usd.price,
    change24h: usd.percent_change_24h // already a %
  };

  priceCache.set(coinId, { ...result, ts: now });
  return result;
}
