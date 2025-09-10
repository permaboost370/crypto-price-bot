// src/handlers.js
import axios from "axios";
import { resolveCoinId, getCoinPriceUSD } from "./services/coingecko.js";
import { getTokenByContract } from "./services/dexscreener.js";
import { askAI } from "./services/ai.js";
import { synthesizeToMp3 } from "./services/tts.js";
import { transcribeBuffer } from "./services/stt.js";

export function attachHandlers(bot) {
  // --- simple per-user cooldown ---
  const lastCall = new Map();
  bot.use((ctx, next) => {
    const uid = ctx.from?.id;
    if (!uid) return next();
    const now = Date.now();
    const prev = lastCall.get(uid) || 0;
    if (now - prev < 500) return; // drop very fast repeats
    lastCall.set(uid, now);
    return next();
  });

  // ---------- helpers ----------
  function tgDisplayName(ctx) {
    const name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ");
    return name || ctx.from?.username || "friend";
  }

  async function getTelegramFileBuffer(ctx, fileId, fallbackName = "audio.ogg") {
    const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
    const file = await ctx.telegram.getFile(fileId);
    if (!file?.file_path) throw new Error("Telegram did not return file_path");
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const { data } = await axios.get(url, { responseType: "arraybuffer", timeout: 45000 });
    if (!data || data.byteLength === 0) throw new Error("Downloaded empty file");
    return { buffer: Buffer.from(data), filename: file.file_path.split("/").pop() || fallbackName };
  }

  async function replyTextAndVoice(ctx, answer, title = "DaoMan") {
    const waka = `Waka Waka ${tgDisplayName(ctx)}! `;
    const textOut = waka + answer;

    // 1) text reply
    await ctx.reply(textOut, { disable_web_page_preview: true });

    // 2) voice reply — ALWAYS TTS for consistency
    try {
      const cleaned = textOut
        .replace(/https?:\/\/\S+/g, "")
        .replace(/```[\s\S]*?```/g, "")
        .trim();
      const mp3 = await synthesizeToMp3(cleaned);
      await ctx.replyWithAudio({ source: mp3, filename: "reply.mp3" }, { title });
    } catch (e) {
      console.error("TTS failed:", e?.message || e);
      await ctx.reply(`TTS error: ${e?.message || "unknown"}`);
    }
  }

  // ---------- /start ----------
  bot.start((ctx) =>
    ctx.reply(
      [
        "DAOman online.",
        "Use /price <symbol>, /token <contract>, /ai <question>, or send a voice note — I reply with text and voice (one consistent voice)."
      ].join("\n")
    )
  );

  // ---------- /price <symbolOrId> ----------
  bot.command("price", async (ctx) => {
    const q = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!q) return ctx.reply("Usage: /price <symbol or name>\nExample: /price btc");

    try {
      const id = await resolveCoinId(q); // e.g., "btc-bitcoin"
      const { price, change24h } = await getCoinPriceUSD(id);

      const ch = change24h != null ? change24h.toFixed(2) : "0.00";
      const arrow = (change24h ?? 0) >= 0 ? "🟢" : "🔴";

      await ctx.reply(
        [
          `Price — ${q.toUpperCase()}`,
          `USD: $${Number(price).toLocaleString(undefined, { maximumFractionDigits: 10 })}`,
          `${arrow} 24h: ${ch}%`
        ].join("\n")
      );
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) return ctx.reply("Rate limit hit. Try again in a few seconds.");
      await ctx.reply(`Error: ${err.message || "Could not fetch price."}`);
    }
  });

  // ---------- /token <contractAddress> ----------
  bot.command("token", async (ctx) => {
    const contract = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!contract) {
      return ctx.reply(
        "Usage: /token <contractAddress>\nExample: /token 0xdAC17F958D2ee523a2206206994597C13D831ec7"
      );
    }

    try {
      const t = await getTokenByContract(contract);
      const pc = t.priceChange?.h24 != null ? `${t.priceChange.h24.toFixed(2)}%` : "n/a";
      const liq = t.liquidityUsd ? `$${Math.round(t.liquidityUsd).toLocaleString()}` : "n/a";
      const fdv = t.fdvUsd ? `$${Math.round(t.fdvUsd).toLocaleString()}` : "n/a";

      await ctx.reply(
        [
          `Token: ${t.name || "Unknown"} (${t.symbol || "?"})`,
          `Chain: ${t.chainId} • DEX: ${t.dex}`,
          `Price: $${t.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 10 })}`,
          `24h: ${pc}`,
          `Liquidity: ${liq} • FDV: ${fdv}`,
          t.pairUrl ? `Chart: ${t.pairUrl}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (err) {
      const status = err?.response?.status;
      if (status === 429) return ctx.reply("Dexscreener rate limit. Try again shortly.");
      await ctx.reply(`Error: ${err.message || "Could not fetch token."}`);
    }
  });

  // ---------- /ai (text OR reply-to voice/audio) ----------
  bot.command("ai", async (ctx) => {
    let q = ctx.message.text.split(" ").slice(1).join(" ").trim();

    // If no text and /ai is replying to a voice/audio, transcribe it first
    if (!q && ctx.message.reply_to_message) {
      const rep = ctx.message.reply_to_message;
      try {
        let fileId = null;
        let fallback = "audio.ogg";
        if (rep.voice) {
          fileId = rep.voice.file_id;
          fallback = "voice.ogg";
        } else if (rep.audio) {
          fileId = rep.audio.file_id;
          fallback = rep.audio.file_name || "audio.mp3";
        }
        if (fileId) {
          if (!process.env.OPENAI_API_KEY)
            return ctx.reply("Missing OPENAI_API_KEY for transcription.");
          const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, fallback);
          q = await transcribeBuffer(buffer, { filename });
        }
      } catch (e) {
        console.error("reply-to transcription failed:", e?.message || e);
        return ctx.reply("Couldn't read the replied voice/audio. Try again or type your question.");
      }
    }

    if (!q) return ctx.reply("Usage: /ai <your question> or reply to a voice note with /ai");

    try {
      const answer = await askAI(q);
      await replyTextAndVoice(ctx, answer, "DaoMan"); // ALWAYS TTS
    } catch (err) {
      if (err?.response?.status === 429) return ctx.reply("AI is rate-limited. Try again shortly.");
      await ctx.reply(`AI error: ${err.message || "Something went wrong."}`);
    }
  });

  // ---------- Voice note → STT → AI → text + voice (TTS only) ----------
  bot.on("voice", async (ctx) => {
    try {
      if (!process.env.OPENAI_API_KEY) return ctx.reply("Missing OPENAI_API_KEY for transcription.");
      const fileId = ctx.message.voice.file_id;
      const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, "voice.ogg");
      const userText = await transcribeBuffer(buffer, { filename });
      const answer = await askAI(userText);
      await replyTextAndVoice(ctx, answer, "DaoMan"); // ALWAYS TTS
    } catch (err) {
      console.error("voice handler failed:", err);
      await ctx.reply(`Voice processing failed: ${err?.message || "unknown error"}`);
    }
  });

  // ---------- Audio file → STT → AI → text + voice (TTS only) ----------
  bot.on("audio", async (ctx) => {
    try {
      if (!process.env.OPENAI_API_KEY) return ctx.reply("Missing OPENAI_API_KEY for transcription.");
      const fileId = ctx.message.audio.file_id;
      const { buffer, filename } = await getTelegramFileBuffer(
        ctx,
        fileId,
        ctx.message.audio.file_name || "audio.mp3"
      );
      const userText = await transcribeBuffer(buffer, { filename });
      const answer = await askAI(userText);
      await replyTextAndVoice(ctx, answer, "DaoMan"); // ALWAYS TTS
    } catch (err) {
      console.error("audio handler failed:", err);
      await ctx.reply(`Audio processing failed: ${err?.message || "unknown error"}`);
    }
  });

  // ---------- /say (manual TTS test) ----------
  bot.command("say", async (ctx) => {
    const text = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!text) return ctx.reply("Usage: /say <text>");
    try {
      const cleaned = text.replace(/https?:\/\/\S+/g, "").replace(/```[\s\S]*?```/g, "").trim();
      const mp3 = await synthesizeToMp3(cleaned); // ALWAYS TTS
      await ctx.replyWithAudio({ source: mp3, filename: "say.mp3" }, { title: "DaoMan" });
    } catch (err) {
      console.error("TTS /say failed:", err?.message || err);
      await ctx.reply(`TTS error: ${err?.message || "unknown"}`);
    }
  });

  // ---------- /help ----------
  bot.hears(/^\/help/i, (ctx) =>
    ctx.reply(
      "Commands: /price <symbol>, /token <contractAddress>, /ai <question>. Send a voice note for automatic text + voice replies."
    )
  );
}
