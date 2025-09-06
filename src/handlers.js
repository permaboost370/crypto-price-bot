import axios from "axios";
import { resolveCoinId, getCoinPriceUSD } from "./services/coingecko.js"; // now powered by CoinPaprika in your setup
import { getTokenByContract } from "./services/dexscreener.js";
import { askAI } from "./services/ai.js";
import { synthesizeToMp3 } from "./services/tts.js"; // ElevenLabs TTS

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

      // 1) Text reply
      await ctx.reply(answer, { disable_web_page_preview: true });

      // 2) Voice reply (via ElevenLabs)
      try {
        const mp3 = await synthesizeToMp3(
          answer
            .replace(/https?:\/\/\S+/g, "")       // optional cleanup for TTS
            .replace(/```[\s\S]*?```/g, "")
            .trim()
        );

        await ctx.replyWithAudio(
          { source: mp3, filename: "reply.mp3" },
          { title: "AI reply" }
        );
      } catch (ttsErr) {
        console.error("TTS failed:", ttsErr?.message || ttsErr);
        // For debugging, uncomment to see the error in chat:
        // await ctx.reply(`🔇 TTS error: ${ttsErr?.message || "unknown"}`);
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) {
        return ctx.reply("⏳ AI is rate-limited. Try again shortly.");
      }
      await ctx.reply(`❌ AI error: ${err.message || "Something went wrong."}`);
    }
  });

  // --- /say <text> (TTS smoke test) ---
  bot.command("say", async (ctx) => {
    const text = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!text) return ctx.reply("Usage: /say <text>");

    try {
      const mp3 = await synthesizeToMp3(
        text
          .replace(/https?:\/\/\S+/g, "")
          .replace(/```[\s\S]*?```/g, "")
          .trim()
      );

      await ctx.replyWithAudio(
        { source: mp3, filename: "say.mp3" },
        { title: "TTS test" }
      );
    } catch (err) {
      console.error("TTS /say failed:", err?.message || err);
      await ctx.reply(`🔇 TTS error: ${err?.message || "unknown"}`);
    }
  });

  // --- /diag (check critical env) ---
  bot.command("diag", (ctx) => {
    const mask = (s, show = 4) => (s ? s.slice(0, show) + "…" : "(unset)");
    const len = (s) => (s ? `len=${s.length}` : "");
    return ctx.reply(
      [
        `BASE_URL: ${process.env.BASE_URL || "(unset)"}`,
        `TELEGRAM_BOT_TOKEN: ${mask(process.env.TELEGRAM_BOT_TOKEN)} ${len(process.env.TELEGRAM_BOT_TOKEN)}`,
        `GROQ_API_KEY: ${mask(process.env.GROQ_API_KEY)} ${len(process.env.GROQ_API_KEY)}`,
        `ELEVENLABS_API_KEY: ${mask(process.env.ELEVENLABS_API_KEY)} ${len(process.env.ELEVENLABS_API_KEY)}`,
        `ELEVEN_VOICE_ID: ${process.env.ELEVEN_VOICE_ID || "(unset)"} ${len(process.env.ELEVEN_VOICE_ID)}`,
        `ELEVEN_MODEL_ID: ${process.env.ELEVEN_MODEL_ID || "eleven_multilingual_v2"}`
      ].join("\n")
    );
  });

  // --- /eleven (direct auth check) ---
  bot.command("eleven", async (ctx) => {
    try {
      const r = await axios.get("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": (process.env.ELEVENLABS_API_KEY || "").trim(), accept: "application/json" },
        timeout: 12000
      });
      return ctx.reply(`✅ ElevenLabs auth OK (status ${r.status}).`);
    } catch (err) {
      const st = err?.response?.status;
      let body = "";
      try {
        body = err?.response?.data
          ? (Buffer.isBuffer(err.response.data) ? err.response.data.toString() : JSON.stringify(err.response.data))
          : "";
      } catch {}
      return ctx.reply(`🔴 ElevenLabs auth FAILED (status ${st || "?"}) ${body || err.message}`);
    }
  });

  // --- /help ---
  bot.hears(/^\/help/i, (ctx) =>
    ctx.reply("Use /price <symbol>, /token <contractAddress>, or /ai <question>.")
  );
}
