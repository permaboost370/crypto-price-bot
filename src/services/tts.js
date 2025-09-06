// src/services/tts.js
// ElevenLabs TTS (character/robot voices). Requires:
// - ELEVENLABS_API_KEY
// - ELEVEN_VOICE_ID (default voice to use)
import axios from "axios";

/**
 * Synthesize text to MP3 Buffer via ElevenLabs.
 * @param {string} text - Text to speak
 * @param {string} [voiceId] - Optional ElevenLabs Voice ID; falls back to process.env.ELEVEN_VOICE_ID
 * @returns {Promise<Buffer>} MP3 audio buffer
 */
export async function synthesizeToMp3(text, voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const defaultVoice = process.env.ELEVEN_VOICE_ID;
  const useVoice = (voiceId || defaultVoice || "").trim();

  if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY");
  if (!useVoice) throw new Error("Missing ELEVEN_VOICE_ID (no voice selected)");

  const safe = String(text || "").trim();
  if (!safe) throw new Error("Nothing to speak.");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(useVoice)}`;

  const payload = {
    text: safe,
    model_id: process.env.ELEVEN_MODEL_ID || "eleven_multilingual_v2",
    voice_settings: {
      stability: Number(process.env.ELEVEN_STABILITY ?? 0.5),
      similarity_boost: Number(process.env.ELEVEN_SIMILARITY ?? 0.5)
    }
  };

  const resp = await axios.post(url, payload, {
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json"
    },
    responseType: "arraybuffer",
    timeout: 30000
  });

  return Buffer.from(resp.data);
}
