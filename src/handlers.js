// src/handlers.js
import axios from "axios";
import { resolveCoinId, getCoinPriceUSD } from "./services/coingecko.js";
import { getTokenByContract } from "./services/dexscreener.js";
import { askAI } from "./services/ai.js";
import { synthesizeToMp3, synthesizeWithReference } from "./services/tts.js";
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

  // --- per-user last V2V reference (Buffer+filename), expires after 30 minutes ---
  const lastV2VRef = new Map(); // uid -> { buffer, filename, ts }

  // ---------- helpers ----------
  function tgDisplayName(ctx) {
    const name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ");
    return name || ctx.from?.username || "friend";
  }

  function getFreshReference(uid, maxAgeMs = 30 * 60 * 1000) {
    const ref = lastV2VRef.get(uid);
    if (!ref) return null;
    if (Date.now() - ref.ts > maxAgeMs) return null;
    if (!Buffer.isBuffer(ref.buffer) || ref.buffer.length === 0) return null;
    return ref;
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

  // reply with text + voice
  // If a fresh V2V reference exists, use it (voice-to-voice); else do normal TTS.
  async function replyTextAndVoice(ctx, answer, title = "DaoMan") {
    const uid = ctx.from?.id;
    const waka = `Waka Waka ${tgDisplayName(ctx)}! `;
    const textOut = waka + answer;

    // 1) text
    await ctx.reply(textOut, { disable_web_page_preview: true });

    // 2) voice
    try {
      const cleaned = textOut.replace(/https?:\/\/\S+/g, "").replace(/```[\s\S]*?```/g, "").trim();
      const ref = uid ? getFreshReference(uid) : null;

      let mp3;
      if (ref) {
        // Voice-to-Voice with stored reference
        mp3 = await synthesizeWithReference(cleaned, ref.buffer, ref.filename);
      } else {
        // Standard ElevenLabs TTS
        mp3 = await synthesizeToMp3(cleaned);
      }

      await ctx.replyWithAudio({ source: mp3, filename: "reply.mp3" }, { title });
    } catch (e) {
      console.error("TTS/V2V failed:", e?.message || e);
      await ctx.reply(`🔇 TTS error: ${e?.message || "unknown"}`);
    }
  }

  // ---------- /start ----------
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
        "🤖 Ask AI:",
        "   • /ai <your question>",
        "   • or just send a 🎤 voice message",
        "",
        "Tip: I’ll mimic your latest voice note for replies (voice-to-voice) for ~30 minutes."
      ].join("\n")
    )
  );

  // ---------- /price ----------
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

  // ---------- /token ----------
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

  // ---------- /ai (supports text AND reply-to-voice/audio) ----------
  bot.command("ai", async (ctx) => {
    const uid = ctx.from?.id;
    let q = ctx.message.text.split(" ").slice(1).join(" ").trim();

    // If no text and /ai is replying to a voice/audio, transcribe that
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
            return ctx.reply("❌ Missing OPENAI_API_KEY for transcription.");
          const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, fallback);
          q = await transcribeBuffer(buffer, { filename });
          // store this reference for subsequent V2V replies
          if (uid) lastV2VRef.set(uid, { buffer, filename, ts: Date.now() });
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
          "• Or reply to a voice/audio with /ai (I’ll mimic that voice in the reply)"
        ].join("\n")
      );
    }

    try {
      const answer = await askAI(q); // <-- includes live web data when needed
      await replyTextAndVoice(ctx, answer, "DaoMan"); // <-- will use V2V if ref exists
    } catch (err) {
      if (err?.response?.status === 429) return ctx.reply("⏳ AI is rate-limited. Try again shortly.");
      await ctx.reply(`❌ AI error: ${err.message || "Something went wrong."}`);
    }
  });

  // ---------- VOICE NOTE → STT → AI → V2V (stores reference) ----------
  bot.on("voice", async (ctx) => {
    try {
      if (!process.env.OPENAI_API_KEY) return ctx.reply("❌ Missing OPENAI_API_KEY for transcription.");
      const uid = ctx.from?.id;
      const fileId = ctx.message.voice.file_id;
      const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, "voice.ogg");

      // store as latest reference for this user
      if (uid) lastV2VRef.set(uid, { buffer, filename, ts: Date.now() });

      const userText = await transcribeBuffer(buffer, { filename });
      const answer = await askAI(userText); // live data path preserved
      await replyTextAndVoice(ctx, answer, "DaoMan"); // uses V2V with stored ref
    } catch (err) {
      console.error("voice handler failed:", err);
      await ctx.reply(`❌ Voice processing failed: ${err?.message || "unknown error"}`);
    }
  });

  // ---------- AUDIO FILE → STT → AI → V2V (stores reference) ----------
  bot.on("audio", async (ctx) => {
    try {
      if (!process.env.OPENAI_API_KEY) return ctx.reply("❌ Missing OPENAI_API_KEY for transcription.");
      const uid = ctx.from?.id;
      const fileId = ctx.message.audio.file_id;
      const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, ctx.message.audio.file_name || "audio.mp3");

      // store as latest reference for this user
      if (uid) lastV2VRef.set(uid, { buffer, filename, ts: Date.now() });

      const userText = await transcribeBuffer(buffer, { filename });
      const answer = await askAI(userText);
      await replyTextAndVoice(ctx, answer, "DaoMan");
    } catch (err) {
      console.error("audio handler failed:", err);
      await ctx.reply(`❌ Audio processing failed: ${err?.message || "unknown error"}`);
    }
  });

  // ---------- /vvask <question> (reply-to voice/audio uses that as reference) ----------
  bot.command("vvask", async (ctx) => {
    let q = ctx.message.text.split(" ").slice(1).join(" ").trim();
    const uid = ctx.from?.id;

    // If /vvask is a reply to a voice/audio, read it as the reference (no STT needed unless no text)
    if (ctx.message.reply_to_message) {
      const rep = ctx.message.reply_to_message;
      try {
        let fileId = null;
        let fallback = "reference.ogg";
        if (rep.voice) {
          fileId = rep.voice.file_id;
          fallback = "voice.ogg";
        } else if (rep.audio) {
          fileId = rep.audio.file_id;
          fallback = rep.audio.file_name || "audio.mp3";
        }
        if (fileId) {
          const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, fallback);
          if (uid) lastV2VRef.set(uid, { buffer, filename, ts: Date.now() });
        }
      } catch (e) {
        console.error("vvask reference fetch failed:", e?.message || e);
        return ctx.reply("❌ Couldn't read the replied voice/audio as reference.");
      }
    }

    if (!q) {
      return ctx.reply("Usage: reply to a voice/audio with /vvask <your question> (I’ll mimic that voice).");
    }

    try {
      const answer = await askAI(q); // live data included
      await replyTextAndVoice(ctx, answer, "DaoMan"); // will V2V if ref exists
    } catch (err) {
      console.error("/vvask failed:", err);
      await ctx.reply(`❌ /vvask error: ${err?.message || "unknown"}`);
    }
  });

  // ---------- /say (manual TTS test) ----------
  bot.command("say", async (ctx) => {
    const text = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!text) return ctx.reply("Usage: /say <text>");

    try {
      const uid = ctx.from?.id;
      const ref = uid ? getFreshReference(uid) : null;
      const cleaned = text.replace(/https?:\/\/\S+/g, "").replace(/```[\s\S]*?```/g, "").trim();
      const mp3 = ref
        ? await synthesizeWithReference(cleaned, ref.buffer, ref.filename)
        : await synthesizeToMp3(cleaned);
      await ctx.replyWithAudio({ source: mp3, filename: "say.mp3" }, { title: "DaoMan" });
    } catch (err) {
      console.error("TTS /say failed:", err?.message || err);
      await ctx.reply(`🔇 TTS error: ${err?.message || "unknown"}`);
    }
  });

  // =========================
  // STT DIAGNOSTICS
  // =========================

  // --- /sttinfo: show Whisper config/status ---
  bot.command("sttinfo", (ctx) => {
    const mask = (s, show = 4) => (s ? s.slice(0, show) + "…" : "(unset)");
    const len = (s) => (s ? `len=${s.length}` : "len=0");
    const key = process.env.OPENAI_API_KEY || "";
    const lines = [
      `OPENAI_API_KEY: ${mask(key)} ${len(key)}`,
      `STT model: whisper-1`,
      `How to test: reply to a voice/audio with /stttest`,
    ];
    return ctx.reply(lines.join("\n"));
  });

  // --- /stttest: reply to a voice/audio -> transcribe and echo the text ---
  bot.command("stttest", async (ctx) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return ctx.reply("❌ OPENAI_API_KEY is missing. Set it in Render and redeploy.");
      }
      const rep = ctx.message.reply_to_message;
      if (!rep || (!rep.voice && !rep.audio)) {
        return ctx.reply("📌 Usage: reply to a voice note or audio file with /stttest and I’ll transcribe it.");
      }

      let fileId = null;
      let fallback = "audio.ogg";
      if (rep.voice) {
        fileId = rep.voice.file_id;
        fallback = "voice.ogg";
      } else if (rep.audio) {
        fileId = rep.audio.file_id;
        fallback = rep.audio.file_name || "audio.mp3";
      }

      const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, fallback);
      const text = await transcribeBuffer(buffer, { filename });

      await ctx.reply(["📝 Transcription", "—", text].join("\n"));
    } catch (err) {
      console.error("/stttest failed:", err);
      await ctx.reply(`❌ /stttest error: ${err?.message || "unknown"}`);
    }
  });

  // =========================
  // V2V DIAGNOSTICS
  // =========================

  // --- /vvinfo: show current ElevenLabs voice + V2V-related envs ---
  bot.command("vvinfo", (ctx) => {
    const lines = [
      `VOICE_ID: ${process.env.ELEVEN_VOICE_ID || "(unset)"}`,
      `MODEL_ID: ${process.env.ELEVEN_MODEL_ID || "(voice default)"}`,
      `OUTPUT_FORMAT: ${process.env.ELEVEN_OUTPUT_FORMAT || "mp3_44100_128"}`,
      `STABILITY: ${process.env.ELEVEN_STABILITY ?? "(voice default)"}`,
      `SIMILARITY: ${process.env.ELEVEN_SIMILARITY ?? "(voice default)"}`,
      `STYLE: ${process.env.ELEVEN_STYLE ?? "(voice default)"}`,
      `SPEAKER_BOOST: ${process.env.ELEVEN_SPEAKER_BOOST ?? "(voice default)"}`,
    ];
    return ctx.reply(lines.join("\n"));
  });

  // --- /vvtest: plain = TTS; reply to voice/audio = V2V pipeline test (static line) ---
  bot.command("vvtest", async (ctx) => {
    try {
      const isReply = !!ctx.message.reply_to_message;
      const testLine = "This is a voice to voice test. Waka Waka power up!";
      const title = isReply ? "DaoMan (V2V test)" : "DaoMan (TTS test)";

      if (isReply) {
        const rep = ctx.message.reply_to_message;
        let fileId = null;
        let fallback = "reference.ogg";
        if (rep.voice) {
          fileId = rep.voice.file_id;
          fallback = "voice.ogg";
        } else if (rep.audio) {
          fileId = rep.audio.file_id;
          fallback = rep.audio.file_name || "audio.mp3";
        } else {
          return ctx.reply("Reply to a voice note or audio file, then send /vvtest.");
        }

        const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, fallback);
        const mp3 = await synthesizeWithReference(testLine, buffer, filename);
        await ctx.replyWithAudio({ source: mp3, filename: "vvtest.mp3" }, { title });
        return;
      }

      const mp3 = await synthesizeToMp3(testLine);
      await ctx.replyWithAudio({ source: mp3, filename: "vvtest.mp3" }, { title });
    } catch (err) {
      console.error("/vvtest failed:", err);
      await ctx.reply(`❌ /vvtest error: ${err?.message || "unknown"}`);
    }
  });

  // ---------- /vtest: quick STT readiness ping ----------
  bot.command("vtest", (ctx) => {
    if (!process.env.OPENAI_API_KEY) return ctx.reply("❌ OPENAI_API_KEY is missing.");
    return ctx.reply("✅ STT ready. Send a 🎤 voice note or reply to one with /ai.");
  });

  // ---------- /diag ----------
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
      `ELEVEN_MODEL_ID: ${process.env.ELEVEN_MODEL_ID || "eleven_multilingual_v2"}`
    ];
    return ctx.reply(lines.join("\n"));
  });

  // ---------- /eleven ----------
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

  // ---------- /keypeek ----------
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

  // ---------- /help ----------
  bot.hears(/^\/help/i, (ctx) =>
    ctx.reply("Use /price <symbol>, /token <contractAddress>, send a 🎤 voice message, or /ai <question>. I’ll mimic your latest voice in my replies for ~30 minutes.")
  );
}
