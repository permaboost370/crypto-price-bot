// src/services/stt.js
// Speech-to-Text via OpenAI Whisper (accepts OGG/OPUS voice notes, MP3, M4A, WAV, etc.)

import fs from "fs";
import path from "path";
import OpenAI from "openai";

const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
const client = new OpenAI({ apiKey: openaiKey });

/**
 * Transcribe an audio Buffer with Whisper.
 * @param {Buffer} buf - audio data
 * @param {object} opts
 * @param {string} [opts.filename='audio.ogg'] - file name (determines mime for some libs)
 * @param {string} [opts.model='whisper-1']
 * @returns {Promise<string>} transcript text
 */
export async function transcribeBuffer(buf, { filename = "audio.ogg", model = "whisper-1" } = {}) {
  if (!openaiKey) {
    throw new Error("Missing OPENAI_API_KEY for STT.");
  }
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error("Empty audio buffer.");
  }

  // Write to a temp file because OpenAI Node SDK streams from fs nicely
  const tmpDir = "/tmp";
  const tmpPath = path.join(tmpDir, `${Date.now()}-${filename}`);
  await fs.promises.writeFile(tmpPath, buf);

  try {
    const response = await client.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model,
      // Whisper handles language automatically, but you can force it with:
      // language: "en",
      response_format: "text",
      temperature: 0,
    });

    // response is a string when response_format="text"
    const text = typeof response === "string" ? response : (response?.text || "");
    const clean = String(text || "").trim();
    if (!clean) throw new Error("Empty transcription.");
    return clean;
  } finally {
    // cleanup
    fs.promises.unlink(tmpPath).catch(() => {});
  }
}
