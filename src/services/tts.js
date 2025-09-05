// src/services/tts.js
import gTTSFactory from "node-gtts";

/**
 * Synthesize text to MP3 Buffer using Google TTS (node-gtts).
 * VOICE_LANG (e.g., 'en', 'el', 'es', 'fr', 'de', 'it', 'pt', 'hi', 'ja', 'ko', 'zh')
 */
export async function synthesizeToMp3(text, lang = process.env.VOICE_LANG || "en") {
  const gtts = gTTSFactory(lang);

  const safe = String(text || "").trim();
  if (!safe) throw new Error("Nothing to speak.");

  return new Promise((resolve, reject) => {
    try {
      const stream = gtts.stream(safe);
      const chunks = [];
      stream.on("data", (c) => chunks.push(Buffer.from(c)));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}
