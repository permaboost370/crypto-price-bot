import { resolveCoinId, getCoinPriceUSD } from "./services/coingecko.js";
import { getTokenByContract } from "./services/dexscreener.js";

export function attachHandlers(bot) {
  // --- Step 3: simple per-user cooldown (prevents spam/flood) ---
  // Drops messages if the same user sends commands faster than 500ms
  const lastCall = new Map();
  bot.use((ctx, next) => {
    const uid = ctx.from?.id;
    if (!uid) return next();
    const now = Date.now();
    const prev = lastCall.get(uid) || 0;
    if (now - prev < 500) {
      return; // silently drop if too fast
    }
    lastCall.set(uid, now);
    return next();
  });

  // --- /start help text ---
  bot.start((ctx) =>
    ctx.reply(
      [
        "👋 Hey! I fetch live crypto prices.",
        "",
        "🔹 Major coins (CoinGecko):",
        "   /price btc",
        "   /price eth",
        "",
        "🔹 Tokens by contract (Dexscreener):",
        "   /token <contractAddress>",
        "   e.g. /token 0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "",
        "Tips:",
        "• Symbols are case-insensitive.",
        "• I’ll pick the most liquid pair on Dexscreener automatically."
      ].join("\n")
    )
  );

  // --- /price <symbolOrId> ---
  bot.command("price", asyn
