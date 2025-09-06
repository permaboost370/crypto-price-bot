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
  const model = process.env.ELEVEN_MODEL_ID || "eleven_multilingual_v2";

  if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY");
  const useVoice = (voiceId || defaultVoice || "").trim();
  if (!useVoice) throw new Error("Missing ELEVEN_VOICE_ID (no voice selected)");

  const safe = String(text || "").trim();
  if (!safe) throw new Error("Nothing to speak.");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(useVoice)}`;

  try {
    const resp = await axios.post(
      url,
      {
        text: safe,
        model_id: model,
        voice_settings: {
          stability: Number(process.env.ELEVEN_STABILITY ?? 0.5),        // 0..1
          similarity_boost: Number(process.env.ELEVEN_SIMILARITY ?? 0.5) // 0..1
        }
      },
      {
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "accept": "audio/mpeg"
        },
        responseType: "arraybuffer",
        timeout: 30000
      }
    );

    return Buffer.from(resp.data);
  } catch (err) {
    // Make errors crystal clear
    const status = err?.response?.status;
    const dataText = err?.response?.data
      ? Buffer.isBuffer(err.response.data) ? err.response.data.toString() : String(err.response.data)
      : "";
    if (status === 401) throw new Error("ElevenLabs auth failed (401). Check ELEVENLABS_API_KEY.");
    if (status === 404) throw new Error("Voice not found (404). Check ELEVEN_VOICE_ID.");
    if (status === 429) throw new Error("ElevenLabs rate-limited (429). Try again shortly.");
    throw new Error(`ElevenLabs error ${status || ""}: ${dataText || err.message}`);
  }
}
