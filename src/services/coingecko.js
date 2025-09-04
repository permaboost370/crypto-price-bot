import axios from "axios";

// Tries to map a casual symbol like "eth" -> the correct CoinGecko ID ("ethereum")
export async function resolveCoinId(symbolOrId) {
  const q = symbolOrId.trim().toLowerCase();

  // Fast path: try direct id first
  try {
    await axios.get(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(q)}`);
    return q;
  } catch (_) {
    // continue
  }

  // Fallback: search by symbol
  const { data } = await axios.get("https://api.coingecko.com/api/v3/coins/list?include_platform=true");
  const matches = data.filter(
    (c) => c.id === q || c.symbol?.toLowerCase() === q || c.name?.toLowerCase() === q
  );

  if (matches.length === 0) throw new Error("Coin not found on CoinGecko.");
  // Prefer exact symbol match, else take first
  const exact = matches.find((c) => c.symbol?.toLowerCase() === q) || matches[0];
  return exact.id;
}

export async function getCoinPriceUSD(coinId) {
  const { data } = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
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
  return {
    price: row.usd,
    change24h: row.usd_24h_change
  };
}
