// src/services/tts.js
import axios from "axios";

export async function synthesizeToMp3(text, voiceId = process.env.ELEVEN_VOICE_ID) {
  const resp = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.0 }
    },
    {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json"
      },
      responseType: "arraybuffer"
    }
  );
  return Buffer.from(resp.data);
}
