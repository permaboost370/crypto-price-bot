import axios from "axios";

// ---------- tiny helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWithRetry(url, { params = {}, timeout = 10000 } = {}, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.get(url, {
        params,
        timeout,
        headers: {
          // Some APIs rate-limit anonymous clients that don't set UA
          "User-Agent": "crypto-price-bot/1.0 (+render)"
        }
      });
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const isTimeout = err?.code === "ECONNABORTED";
      const retryable = status === 429 || status >= 500 || isTimeout;
      if (!retryable || attempt === maxRetries) break;
      // exponential backoff: 500ms, 1000ms, 2000ms, 4000ms...
      const wait = 500 * Math.pow(2, attempt);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// ---------- caches ----------
/** Cache for price lookups: coinId -> { price, change24h, ts }  */
const priceCache = new Map();
/** Cache for the giant coins list to speed up symbol->id resolve */
let coinsListCache = { ts: 0, data: null };

// ---------- public API ----------
export async function resolveCoinId(symbolOrId) {
  const q = symbolOrId.trim().toLowerCase();

  // Fast path: try direct id
  try {
    await getWithRetry(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(q)}`);
    return q;
  } catch (_) {
    // continue
  }

  // Refresh coins list cache every 10 minutes
  const now = Date.now();
  if (!coinsListCache.data || now - coinsListCache.ts > 10 * 60 * 1000) {
    const { data } = await getWithRetry(
      "https://api.coingecko.com/api/v3/coins/list",
      { params: { include_platform: "true" }, timeout: 15000 }
    );
    coinsListCache = { ts: now, data };
  }

  const matches = coinsListCache.data.filter(
    (c) => c.id === q || c.symbol?.toLowerCase() === q || c.name?.toLowerCase() === q
  );
  if (matches.length === 0) throw new Error("Coin not found on CoinGecko.");
  const exact = matches.find((c) => c.symbol?.toLowerCase() === q) || matches[0];
  return exact.id;
}

export async function getCoinPriceUSD(coinId) {
  // short TTL cache to reduce API hits & 429
  const TTL_MS = 15 * 1000; // 15s
  const now = Date.now();
  const cached = priceCache.get(coinId);
  if (cached && now - cached.ts < TTL_MS) return { price: cached.price, change24h: cached.change24h };

  const { data } = await getWithRetry("https://api.coingecko.com/api/v3/simple/price", {
    params: {
      ids: coinId,
      vs_currencies: "usd",
      include_24hr_change: "true",
      include_last_updated_at: "true"
    },
    timeout: 10000
  });

  if (!data[coinId]) throw new Error("Price not available.");
  const row = data[coinId];
  const result = { price: row.usd, change24h: row.usd_24h_change };
  priceCache.set(coinId, { ...result, ts: now });
  return result;
}
