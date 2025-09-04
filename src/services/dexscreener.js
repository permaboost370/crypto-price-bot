import axios from "axios";

// Works for EVM, Solana, and more—Dexscreener auto-detects chains via contract address.
export async function getTokenByContract(contract) {
  const addr = contract.trim();
  const url = `https://api.dexscreener.com/latest/dex/tokens/${addr}`;
  const { data } = await axios.get(url, { timeout: 10000 });

  if (!data || !data.pairs || data.pairs.length === 0) {
    throw new Error("Token not found on Dexscreener.");
  }

  // Choose the pair with highest liquidity
  const best = data.pairs
    .filter((p) => p.priceUsd)
    .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

  if (!best) throw new Error("No price data with USD liquidity found.");

  return {
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
}
