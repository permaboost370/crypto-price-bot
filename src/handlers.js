// src/handlers.js
import axios from "axios";
import { askAI } from "./services/ai.js";
import { synthesizeToMp3 } from "./services/tts.js";
import { transcribeBuffer } from "./services/stt.js";

export function attachHandlers(bot) {
  // small anti-spam
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
      await ctx.reply(`TTS error: ${e?.message || "unknown"}`);
    }
  }

  // /start
  bot.start((ctx) =>
    ctx.reply(
      [
        "DAOman online.",
        "Use /ai <your question> or send a voice note — I reply with text and voice."
      ].join("\n")
    )
  );

  // /ai <text> (also works as reply to a voice/audio to transcribe it first)
  bot.command("ai", async (ctx) => {
    let q = ctx.message.text.split(" ").slice(1).join(" ").trim();

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
      await replyTextAndVoice(ctx, answer, "DaoMan");
    } catch (err) {
      if (err?.response?.status === 429) return ctx.reply("AI is rate-limited. Try again shortly.");
      await ctx.reply(`AI error: ${err.message || "Something went wrong."}`);
    }
  });

  // Voice note → STT → AI → text + voice
  bot.on("voice", async (ctx) => {
    try {
      if (!process.env.OPENAI_API_KEY) return ctx.reply("Missing OPENAI_API_KEY for transcription.");
      const fileId = ctx.message.voice.file_id;
      const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, "voice.ogg");
      const userText = await transcribeBuffer(buffer, { filename });
      const answer = await askAI(userText);
      await replyTextAndVoice(ctx, answer, "DaoMan");
    } catch (err) {
      console.error("voice handler failed:", err);
      await ctx.reply(`Voice processing failed: ${err?.message || "unknown error"}`);
    }
  });

  // (optional) Audio file → STT → AI → text + voice
  bot.on("audio", async (ctx) => {
    try {
      if (!process.env.OPENAI_API_KEY) return ctx.reply("Missing OPENAI_API_KEY for transcription.");
      const fileId = ctx.message.audio.file_id;
      const { buffer, filename } = await getTelegramFileBuffer(ctx, fileId, ctx.message.audio.file_name || "audio.mp3");
      const userText = await transcribeBuffer(buffer, { filename });
      const answer = await askAI(userText);
      await replyTextAndVoice(ctx, answer, "DaoMan");
    } catch (err) {
      console.error("audio handler failed:", err);
      await ctx.reply(`Audio processing failed: ${err?.message || "unknown error"}`);
    }
  });
}
