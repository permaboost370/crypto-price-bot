import { resolveCoinId, getCoinPriceUSD } from "./services/coingecko.js"; // now powered by CoinPaprika in your setup
import { getTokenByContract } from "./services/dexscreener.js";
import { askAI } from "./services/ai.js";
import { synthesizeToMp3 } from "./services/tts.js";

export function attachHandlers(bot) {
  // --- simple per-user cooldown (prevents spam/flood) ---
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
        "👋 Hey! I fetch live crypto prices and can answer questions with AI.",
        "",
        "🔹 Major coins:",
        "   /price btc",
        "   /price eth",
        "",
        "🔹 Tokens by contract (Dexscreener):",
        "   /token <contractAddress>",
        "   e.g. /token 0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "",
        "🤖 AI assistant:",
        "   /ai <your question>",
        "",
        "Tips:",
        "• Symbols are case-insensitive.",
        "• I pick the most liquid pair on Dexscreener automatically."
      ].join("\n")
    )
  );

  // --- /price <symbolOrId> ---
  bot.command("price", async (ctx) => {
    const q = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!q) return ctx.reply("Usage: /price <symbol or name>\nExample: /price btc");

    try {
      const id = await resolveCoinId(q); // e.g., "btc-bitcoin" for CoinPaprika backend
      const { price, change24h } = await getCoinPriceUSD(id);

      const ch = change24h != null ? change24h.toFixed(2) : "0.00";
      const arrow = (change24h ?? 0) >= 0 ? "🟢" : "🔴";

      await ctx.reply(
        [
          `💰 ${q.toUpperCase()} price`,
          `USD: $${Number(price).toLocaleString(undefined, { maximumFractionDigits: 10 })}`,
          `${arrow} 24h: ${ch}%`
        ].join("\n")
      );
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        return ctx.reply("⏳ Hit a rate limit. Please try again in a few seconds.");
      }
      await ctx.reply(`❌ ${err.message || "Could not fetch price."}`);
    }
  });

  // --- /token <contractAddress> ---
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
      const status = err?.response?.status;
      if (status === 429) {
        return ctx.reply("⏳ Hit a rate limit (Dexscreener). Try again in a few seconds.");
      }
      await ctx.reply(`❌ ${err.message || "Could not fetch token price."}`);
    }
  });

  // --- /ai <question> ---
  bot.command("ai", async (ctx) => {
    const q = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!q) return ctx.reply("Usage: /ai <your question or prompt>");

    try {
      const answer = await askAI(q);
      await ctx.reply(answer, { disable_web_page_preview: true });
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        return ctx.reply("⏳ AI is rate-limited. Try again shortly.");
      }
      await ctx.reply(`❌ AI error: ${err.message || "Something went wrong."}`);
    }
  });

  // --- /help ---
  bot.hears(/^\/help/i, (ctx) =>
    ctx.reply("Use /price <symbol>, /token <contractAddress>, or /ai <question>.")
  );
}
