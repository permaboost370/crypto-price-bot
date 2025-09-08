import axios from "axios";
import { resolveCoinId, getCoinPriceUSD } from "./services/coingecko.js";
import { getTokenByContract } from "./services/dexscreener.js";
import { askAI } from "./services/ai.js";
import { synthesizeToMp3 } from "./services/tts.js";
import { transcribeBuffer } from "./services/stt.js";

export function attachHandlers(bot) {
  // --- per-user cooldown ---
  const lastCall = new Map();
  bot.use((ctx, next) => {
    const uid = ctx.from?.id;
    if (!uid) return next();
    const now = Date.now();
    const prev = lastCall.get(uid) || 0;
    if (now - prev < 500) return;
    lastCall.set(uid, now);
    return next();
  });

  // --- helpers ---
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

    await ctx.reply(textOut, { disable_web_page_preview: true });

    try {
      const mp3 = await synthesizeToMp3(
        textOut.replace(/https?:\/\/\S+/g, "").replace(/```[\s\S]*?```/g, "").trim()
      );
      await ctx.replyWithAudio({ source: mp3, filename: "reply.mp3" }, { title });
    } catch (e) {
      console.error("TTS failed:", e?.message || e);
      await ctx.reply(`🔇 TTS error: ${e?.message || "unknown"}`);
    }
  }

  // --- /start ---
  bot.start((ctx) =>
    ctx.reply(
      [
        "👋 Hey! I fetch live crypto prices and can answer questions with AI.",
        "",
        "🔹 Major coins:",
        "   /price btc",
        "   /price eth",
        "",
        "🔹 Tokens by contract:",
        "   /token <contractAddress>",
        "",
        "🤖 AI assistant:",
        "   • /ai <your question>",
        "   • or just send a 🎤 voice message",
        "",
        "Tips:",
        "• Symbols are case-insensitive.",
        "• I pick the most liquid pair on Dexscreener automatically."
      ].join("\n")
    )
  );

  // --- /price ---
  bot.command("price", async (ctx) => {
    const q = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!q) return ctx.reply("Usage: /price <symbol or name>\nExample: /price btc");

    try {
      const id = await resolveCoinId(q);
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
      if (err?.response?.status === 429)
        return ctx.reply("⏳ Hit a rate limit. Please try again in a few seconds.");
      await ctx.reply(`❌ ${err.message || "Could not fetch price."}`);
    }
  });

  // --- /token ---
  bot.command("token", async (ctx) => {
    const contract = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!contract)
      return ctx.reply("Usage: /token <contractAddress>\nExample: /token 0xdAC17F958D2ee523a2206206994597C13D831ec7");

    try {
      const t = await getTokenByContract(contract);
      const pc = t.priceChange?.h24 != null ? `${t.priceChange.h24.toFixed(2)}%` : "n/a";
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
      if (err?.response?.status === 429)
        return ctx.reply("⏳ Hit a rate limit (Dexscreener). Try again in a few seconds.");
      await ctx.reply(`❌ ${err.message || "Could not fetch token price."}`);
    }
  });

  // --- /ai (supports text AND reply-to-voice/audio) ---
  bot.command("ai", async (ctx) => {
    let q = ctx.message.text.split(" ").slice(1).join(" ").trim();

    // If no text and /ai was sent as a reply to a voice/audio, transcribe that
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
          if (!process.env.OPENAI_API_KEY) return ctx.reply("❌ Missing OPENAI_API_KEY for transcription.");
          const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, fallback);
          q = await transcribeBuffer(buffer, { filename });
        }
      } catch (e) {
        console.error("reply-to voice/audio transcription failed:", e?.message || e);
        return ctx.reply("❌ Couldn't read the replied voice/audio. Try again or type your question.");
      }
    }

    if (!q) {
      return ctx.reply(
        [
          "Usage:",
          "• /ai <your question>",
          "• Send a 🎤 voice note (no command needed)",
          "• Or reply to a voice/audio with /ai"
        ].join("\n")
      );
    }

    try {
      const answer = await askAI(q);
      await replyTextAndVoice(ctx, answer, "DaoMan");
    } catch (err) {
      if (err?.response?.status === 429) return ctx.reply("⏳ AI is rate-limited. Try again shortly.");
      await ctx.reply(`❌ AI error: ${err.message || "Something went wrong."}`);
    }
  });

  // --- VOICE NOTE → STT → AI → TTS ---
  bot.on("voice", async (ctx) => {
    try {
      if (!process.env.OPENAI_API_KEY) return ctx.reply("❌ Missing OPENAI_API_KEY for transcription.");
      const fileId = ctx.message.voice.file_id;
      const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, "voice.ogg");
      const userText = await transcribeBuffer(buffer, { filename });
      const answer = await askAI(userText);
      await replyTextAndVoice(ctx, answer, "DaoMan");
    } catch (err) {
      console.error("voice handler failed:", err);
      await ctx.reply(`❌ Voice processing failed: ${err?.message || "unknown error"}`);
    }
  });

  // --- AUDIO FILE → STT → AI → TTS ---
  bot.on("audio", async (ctx) => {
    try {
      if (!process.env.OPENAI_API_KEY) return ctx.reply("❌ Missing OPENAI_API_KEY for transcription.");
      const fileId = ctx.message.audio.file_id;
      const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, ctx.message.audio.file_name || "audio.mp3");
      const userText = await transcribeBuffer(buffer, { filename });
      const answer = await askAI(userText);
      await replyTextAndVoice(ctx, answer, "DaoMan");
    } catch (err) {
      console.error("audio handler failed:", err);
      await ctx.reply(`❌ Audio processing failed: ${err?.message || "unknown error"}`);
    }
  });

  // --- /say (manual TTS test) ---
  bot.command("say", async (ctx) => {
    const text = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!text) return ctx.reply("Usage: /say <text>");

    try {
      const mp3 = await synthesizeToMp3(
        text.replace(/https?:\/\/\S+/g, "").replace(/```[\s\S]*?```/g, "").trim()
      );
      await ctx.replyWithAudio({ source: mp3, filename: "say.mp3" }, { title: "DaoMan" });
    } catch (err) {
      console.error("TTS /say failed:", err?.message || err);
      await ctx.reply(`🔇 TTS error: ${err?.message || "unknown"}`);
    }
  });

  // --- /vtest: confirms STT readiness ---
  bot.command("vtest", (ctx) => {
    if (!process.env.OPENAI_API_KEY) return ctx.reply("❌ OPENAI_API_KEY is missing.");
    return ctx.reply("✅ STT ready. Send a 🎤 voice note or reply to one with /ai.");
  });

  // --- /diag ---
  bot.command("diag", (ctx) => {
    const mask = (s, show = 4) => (s ? s.slice(0, show) + "…" : "(unset)");
    const len = (s) => (s ? `len=${s.length}` : "len=0");
    const starts = (s) => (s ? (s.startsWith("sk_") ? "startsWith=sk_" : "startsWith=" + s.slice(0, 3)) : "startsWith=?");
    const trimInfo = (s) => (s ? (s === s.trim() ? "trim=ok" : "trim=needed") : "trim=?");
    const lines = [
      `BASE_URL: ${process.env.BASE_URL || "(unset)"}`,
      `TELEGRAM_BOT_TOKEN: ${mask(process.env.TELEGRAM_BOT_TOKEN)} ${len(process.env.TELEGRAM_BOT_TOKEN)}`,
      `GROQ_API_KEY: ${mask(process.env.GROQ_API_KEY)} ${len(process.env.GROQ_API_KEY)}`,
      `OPENAI_API_KEY: ${mask(process.env.OPENAI_API_KEY)} ${len(process.env.OPENAI_API_KEY)}`,
      `ELEVENLABS_API_KEY: ${mask(process.env.ELEVENLABS_API_KEY)} ${len(process.env.ELEVENLABS_API_KEY)} ${starts(process.env.ELEVENLABS_API_KEY)} ${trimInfo(process.env.ELEVENLABS_API_KEY)}`,
      `ELEVEN_VOICE_ID: ${process.env.ELEVEN_VOICE_ID || "(unset)"} ${len(process.env.ELEVEN_VOICE_ID)}`,
      `ELEVEN_MODEL_ID: ${process.env.ELEVEN_MODEL_ID || "(voice default)"}`
    ];
    return ctx.reply(lines.join("\n"));
  });

  // --- /eleven ---
  bot.command("eleven", async (ctx) => {
    try {
      const key = (process.env.ELEVENLABS_API_KEY || "").trim();
      const r = await axios.get("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": key, accept: "application/json" },
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

  // --- /keypeek ---
  bot.command("keypeek", (ctx) => {
    const raw = process.env.ELEVENLABS_API_KEY || "";
    const trimmed = raw.trim();
    const preview = trimmed.slice(0, 12);
    const codes = [...trimmed.slice(0, 8)].map((c) => c.charCodeAt(0)).join(",");
    return ctx.reply(
      [
        `raw_len=${raw.length}`,
        `trimmed_len=${trimmed.length}`,
        `startsWith=${trimmed.slice(0, 3)}`,
        `preview=${preview}`,
        `first8_charCodes=${codes}`
      ].join("\n")
    );
  });

  // --- /help ---
  bot.hears(/^\/help/i, (ctx) =>
    ctx.reply("Use /price <symbol>, /token <contractAddress>, send a 🎤 voice message, or /ai <question>.")
  );
}
