// src/services/tts.js
import axios from "axios";

/**
 * ElevenLabs TTS
 * Requires:
 *  - ELEVENLABS_API_KEY = sk_...
 *  - ELEVEN_VOICE_ID = <voice id>
 */
export async function synthesizeToMp3(text, voiceId) {
  const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();       // <-- trim
  const defaultVoice = (process.env.ELEVEN_VOICE_ID || "").trim();     // <-- trim
  const model = (process.env.ELEVEN_MODEL_ID || "eleven_multilingual_v2").trim();
  const useVoice = (voiceId || defaultVoice);

  if (!apiKey || !apiKey.startsWith("sk_") || apiKey.length < 20) {
    throw new Error(`Missing/invalid ELEVENLABS_API_KEY (got len=${apiKey.length}).`);
  }
  if (!useVoice || useVoice.length < 8) {
    throw new Error(`Missing/invalid ELEVEN_VOICE_ID (got len=${useVoice.length}).`);
  }

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
          stability: Number(process.env.ELEVEN_STABILITY ?? 0.5),
          similarity_boost: Number(process.env.ELEVEN_SIMILARITY ?? 0.5),
        },
      },
      {
        headers: {
          "xi-api-key": apiKey,                  // <— correct header
          "Content-Type": "application/json",
          "accept": "audio/mpeg",                // <— ask for MP3
        },
        responseType: "arraybuffer",
        timeout: 30000,
      }
    );

    return Buffer.from(resp.data);
  } catch (err) {
    const status = err?.response?.status;
    let dataText = "";
    try {
      dataText = err?.response?.data
        ? (Buffer.isBuffer(err.response.data) ? err.response.data.toString() : String(err.response.data))
        : "";
    } catch {}
    if (status === 401) throw new Error("ElevenLabs auth failed (401). Check ELEVENLABS_API_KEY.");
    if (status === 403) throw new Error("ElevenLabs forbidden (403). Check API key permissions/scopes.");
    if (status === 404) throw new Error("Voice not found (404). Check ELEVEN_VOICE_ID.");
    if (status === 429) throw new Error("ElevenLabs rate-limited (429). Try again shortly.");
    throw new Error(`ElevenLabs error ${status || ""}: ${dataText || err.message}`);
  }
}
