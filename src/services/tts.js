// src/services/tts.js
// ElevenLabs SDK-based TTS. Requires:
//  - ELEVENLABS_API_KEY (sk_...)
//  - ELEVEN_VOICE_ID (default voice to use)
// Optional:
//  - ELEVEN_MODEL_ID (default: eleven_multilingual_v2)
//  - ELEVEN_OUTPUT_FORMAT (default: mp3_44100_128)

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const client = new ElevenLabsClient({
  apiKey: (process.env.ELEVENLABS_API_KEY || "").trim(), // explicit to avoid env issues
});

function assertEnv(name, val, predicate = (v) => !!v) {
  if (!predicate(val)) {
    throw new Error(`Missing or invalid ${name}`);
  }
}

export async function synthesizeToMp3(text, voiceId) {
  const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  const defaultVoice = (process.env.ELEVEN_VOICE_ID || "").trim();
  const modelId = (process.env.ELEVEN_MODEL_ID || "eleven_multilingual_v2").trim();
  const outputFormat = (process.env.ELEVEN_OUTPUT_FORMAT || "mp3_44100_128").trim();

  assertEnv("ELEVENLABS_API_KEY", apiKey, (v) => v.startsWith("sk_") && v.length > 20);

  const useVoice = (voiceId || defaultVoice || "").trim();
  assertEnv("ELEVEN_VOICE_ID", useVoice, (v) => v.length >= 8);

  const safe = String(text || "").trim();
  if (!safe) throw new Error("Nothing to speak.");

  try {
    // SDK returns an ArrayBuffer (or Uint8Array under the hood). Convert to Buffer for Telegram.
    const audio = await client.textToSpeech.convert(useVoice, {
      text: safe,
      modelId,
      outputFormat, // e.g. 'mp3_44100_128'
    });

    // Handle both ArrayBuffer and Uint8Array just in case
    if (audio instanceof ArrayBuffer) {
      return Buffer.from(new Uint8Array(audio));
    }
    // Some environments may already give a Uint8Array
    if (ArrayBuffer.isView(audio)) {
      return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
    }
    // If SDK ever returns a node Buffer, just pass through
    if (Buffer.isBuffer(audio)) {
      return audio;
    }

    // Fallback: try to coerce
    return Buffer.from(audio);
  } catch (err) {
    // Provide crystal-clear errors
    const status = err?.response?.status || err?.status;
    const msg = err?.message || "Unknown error";
    if (status === 401) {
      throw new Error("ElevenLabs auth failed (401). Check ELEVENLABS_API_KEY.");
    }
    if (status === 403) {
      throw new Error("ElevenLabs forbidden (403). Check API key permissions (Text-to-Speech).");
    }
    if (status === 404) {
      throw new Error("Voice not found (404). Check ELEVEN_VOICE_ID.");
    }
    if (status === 429) {
      throw new Error("ElevenLabs rate-limited (429). Try again shortly.");
    }
    throw new Error(`ElevenLabs error ${status || ""}: ${msg}`);
  }
}
