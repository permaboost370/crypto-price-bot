// src/services/tts.js
// ElevenLabs SDK TTS with robust output handling.
// Env:
//   ELEVENLABS_API_KEY=sk_...
//   ELEVEN_VOICE_ID=...                 (voice to use)
//   ELEVEN_MODEL_ID=eleven_multilingual_v2  (optional)
//   ELEVEN_OUTPUT_FORMAT=mp3_44100_128      (optional, good default)

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// --- helpers ---------------------------------------------------------------

function ensure(cond, msg) {
  if (!cond) throw new Error(msg);
}

function arrayBufferToBuffer(ab) {
  return Buffer.from(new Uint8Array(ab));
}

function viewToBuffer(view) {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

async function webReadableToBuffer(webStream) {
  const reader = webStream.getReader();
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function nodeStreamToBuffer(nodeStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    nodeStream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    nodeStream.on("end", () => resolve(Buffer.concat(chunks)));
    nodeStream.on("error", reject);
  });
}

async function anyToBuffer(audio) {
  if (!audio) throw new Error("No audio returned from ElevenLabs.");

  // 1) Web Response object?
  if (typeof audio.arrayBuffer === "function") {
    const ab = await audio.arrayBuffer();
    return arrayBufferToBuffer(ab);
  }

  // 2) Web ReadableStream?
  if (typeof audio.getReader === "function") {
    return webReadableToBuffer(audio);
  }

  // 3) Node stream?
  if (typeof audio.pipe === "function") {
    return nodeStreamToBuffer(audio);
  }

  // 4) ArrayBuffer?
  if (audio instanceof ArrayBuffer) {
    return arrayBufferToBuffer(audio);
  }

  // 5) TypedArray/Uint8Array?
  if (ArrayBuffer.isView(audio)) {
    return viewToBuffer(audio);
  }

  // 6) Buffer?
  if (Buffer.isBuffer(audio)) {
    return audio;
  }

  // Fallback: try to coerce
  try {
    return Buffer.from(audio);
  } catch {
    throw new Error(
      `Unsupported audio type: ${Object.prototype.toString.call(audio)}`
    );
  }
}

// --- main ------------------------------------------------------------------

const client = new ElevenLabsClient({
  apiKey: (process.env.ELEVENLABS_API_KEY || "").trim(), // explicit to avoid env weirdness
});

export async function synthesizeToMp3(text, voiceId) {
  const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  const defaultVoice = (process.env.ELEVEN_VOICE_ID || "").trim();
  const modelId = (process.env.ELEVEN_MODEL_ID || "eleven_multilingual_v2").trim();
  const outputFormat = (process.env.ELEVEN_OUTPUT_FORMAT || "mp3_44100_128").trim();

  ensure(apiKey && apiKey.startsWith("sk_") && apiKey.length > 20, "Missing or invalid ELEVENLABS_API_KEY");
  const useVoice = (voiceId || defaultVoice || "").trim();
  ensure(useVoice, "Missing ELEVEN_VOICE_ID (no voice selected)");

  const safe = String(text || "").trim();
  ensure(safe, "Nothing to speak.");

  try {
    const audio = await client.textToSpeech.convert(useVoice, {
      text: safe,
      modelId,
      outputFormat, // e.g. 'mp3_44100_128'
    });

    // Convert whatever the SDK returned into a Buffer for Telegram
    return await anyToBuffer(audio);
  } catch (err) {
    const status = err?.response?.status || err?.status;
    const msg = err?.message || "Unknown error";
    if (status === 401) throw new Error("ElevenLabs auth failed (401). Check ELEVENLABS_API_KEY.");
    if (status === 403) throw new Error("ElevenLabs forbidden (403). Check API key permissions (Text-to-Speech).");
    if (status === 404) throw new Error("Voice not found (404). Check ELEVEN_VOICE_ID.");
    if (status === 429) throw new Error("ElevenLabs rate-limited (429). Try again shortly.");
    throw new Error(`ElevenLabs error ${status || ""}: ${msg}`);
  }
}
