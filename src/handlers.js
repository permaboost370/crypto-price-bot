import { resolveCoinId, getCoinPriceUSD } from "./services/coingecko.js";
import { getTokenByContract } from "./services/dexscreener.js";

export function attachHandlers(bot) {
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

  bot.command("price", async (ctx) => {
    const q = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!q) return ctx.reply("Usage: /price <symbol or id>\nExample: /price btc");

    try {
      const id = await resolveCoinId(q);
      const { price, change24h } = await getCoinPriceUSD(id);

      const ch = change24h ? change24h.toFixed(2) : "0.00";
      const arrow = change24h >= 0 ? "🟢" : "🔴";

      await ctx.reply(
        [
          `💰 ${id} price`,
          `USD: $${Number(price).toLocaleString(undefined, { maximumFractionDigits: 10 })}`,
          `${arrow} 24h: ${ch}%`
        ].join("\n")
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message || "Could not fetch price."}`);
    }
  });

  bot.command("token", async (ctx) => {
    const contract = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!contract) {
      return ctx.reply("Usage: /token <contractAddress>\nExample: /token 0xdAC17F958D2ee523a2206206994597C13D831ec7");
    }

    try {
      const t = await getTokenByContract(contract);
      const pc = t.priceChange?.h24 != null ? `${(t.priceChange.h24).toFixed(2)}%` : "n/a";
      const liq = t.liquidityUsd ? `$${Math.round(t.liquidityUsd).toLocaleString()}` : "n/a";
      const fdv = t.fdvUsd ? `$${Math.round(t.fdvUsd).toLocaleString()}` : "n/a";

      await ctx.reply(
        [
          `🔎 ${t.name || "Token"} (${t.symbol || "?"})`,
          `Chain: ${t.chainId} • DEX: ${t.dex}`,
          `Price: $${t.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 10 })}`,
          `24h: ${pc}`,
          `Liquidity: ${liq} • FDV: ${fdv}`,
          t.pairUrl ? `Chart: ${t.pairUrl}` : ""
        ].filter(Boolean).join("\n")
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message || "Could not fetch token price."}`);
    }
  });

  bot.hears(/^\/help/i, (ctx) => ctx.reply("Use /price <symbol> or /token <contractAddress>."));
}
