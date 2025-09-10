// src/services/tts.js
// ElevenLabs TTS + Voice-to-Voice (Speech-to-Speech) helpers.
//
// Required env:
//   ELEVENLABS_API_KEY=sk_...
//   ELEVEN_VOICE_ID=...                 # your saved voice ID
//
// Optional env (recommended):
//   ELEVEN_MODEL_ID=eleven_multilingual_v2   # TTS model for text->speech
//   ELEVEN_STS_MODEL_ID=eleven_english_sts_v2  # STS model for speech->speech
//   ELEVEN_OUTPUT_FORMAT=mp3_44100_128
//   ELEVEN_STABILITY=0.7
//   ELEVEN_SIMILARITY=0.35
//   ELEVEN_STYLE=90
//   ELEVEN_SPEAKER_BOOST=1   # or 0

import fs from "fs";
import path from "path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// ----------------- small utils -----------------
function ensure(cond, msg) { if (!cond) throw new Error(msg); }
function arrayBufferToBuffer(ab) { return Buffer.from(new Uint8Array(ab)); }
function viewToBuffer(view) { return Buffer.from(view.buffer, view.byteOffset, view.byteLength); }

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
  if (typeof audio.arrayBuffer === "function") {
    const ab = await audio.arrayBuffer();
    return arrayBufferToBuffer(ab);
  }
  if (typeof audio.getReader === "function") {
    return webReadableToBuffer(audio);
  }
  if (typeof audio.pipe === "function") {
    return nodeStreamToBuffer(audio);
  }
  if (audio instanceof ArrayBuffer) return arrayBufferToBuffer(audio);
  if (ArrayBuffer.isView(audio)) return viewToBuffer(audio);
  if (Buffer.isBuffer(audio)) return audio;
  try { return Buffer.from(audio); } catch {
    throw new Error(`Unsupported audio type: ${Object.prototype.toString.call(audio)}`);
  }
}

function bufferToTempFile(buf, filename = "reference.ogg") {
  const p = path.join("/tmp", `${Date.now()}-${filename}`);
  fs.writeFileSync(p, buf);
  return p;
}

// ----------------- ElevenLabs client -----------------
const client = new ElevenLabsClient({
  apiKey: (process.env.ELEVENLABS_API_KEY || "").trim(),
});

// ----------------- Public: plain Text-to-Speech -----------------
export async function synthesizeToMp3(text, voiceId) {
  const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  const defaultVoice = (process.env.ELEVEN_VOICE_ID || "").trim();
  const outputFormat = (process.env.ELEVEN_OUTPUT_FORMAT || "mp3_44100_128").trim();
  const useVoice = (voiceId || defaultVoice || "").trim();

  ensure(apiKey && apiKey.startsWith("sk_") && apiKey.length > 20, "Missing or invalid ELEVENLABS_API_KEY");
  ensure(useVoice, "Missing ELEVEN_VOICE_ID (no voice selected)");

  const safe = String(text || "").trim();
  ensure(safe, "Nothing to speak.");

  const request = {
    text: safe,
    outputFormat,
    ...(process.env.ELEVEN_MODEL_ID ? { modelId: process.env.ELEVEN_MODEL_ID.trim() } : {}),
  };

  const vs = {};
  if (process.env.ELEVEN_STABILITY != null) vs.stability = Number(process.env.ELEVEN_STABILITY);
  if (process.env.ELEVEN_SIMILARITY != null) vs.similarityBoost = Number(process.env.ELEVEN_SIMILARITY);
  if (process.env.ELEVEN_STYLE != null) vs.style = Number(process.env.ELEVEN_STYLE);
  if (process.env.ELEVEN_SPEAKER_BOOST != null) vs.useSpeakerBoost = process.env.ELEVEN_SPEAKER_BOOST !== "0";
  if (Object.keys(vs).length) request.voiceSettings = vs;

  try {
    const audio = await client.textToSpeech.convert(useVoice, request);
    return await anyToBuffer(audio);
  } catch (err) {
    const status = err?.response?.status || err?.status;
    const msg = err?.message || "Unknown error";
    if (status === 401) throw new Error("ElevenLabs auth failed (401). Check ELEVENLABS_API_KEY.");
    if (status === 403) throw new Error("ElevenLabs forbidden (403). Check API key permissions (Text-to-Speech).");
    if (status === 404) throw new Error("Voice not found (404). Check ELEVEN_VOICE_ID.");
    if (status === 429) throw new Error("ElevenLabs rate-limited (429). Try again shortly.");
    throw new Error(`ElevenLabs TTS error ${status || ""}: ${msg}`);
  }
}

// ----------------- Public: Voice-to-Voice (Speech-to-Speech) -----------------
export async function synthesizeWithReference(
  text,
  referenceBuffer,
  referenceFilename = "reference.ogg",
  voiceId
) {
  const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  const defaultVoice = (process.env.ELEVEN_VOICE_ID || "").trim();
  const outputFormat = (process.env.ELEVEN_OUTPUT_FORMAT || "mp3_44100_128").trim();
  const stsModel = (process.env.ELEVEN_STS_MODEL_ID || "eleven_english_sts_v2").trim(); // speech-to-speech model
  const useVoice = (voiceId || defaultVoice || "").trim();

  ensure(apiKey && apiKey.startsWith("sk_") && apiKey.length > 20, "Missing or invalid ELEVENLABS_API_KEY");
  ensure(useVoice, "Missing ELEVEN_VOICE_ID (no voice selected)");

  const safe = String(text || "").trim();
  ensure(safe, "Nothing to speak.");
  ensure(Buffer.isBuffer(referenceBuffer) && referenceBuffer.length > 0, "Empty reference audio buffer.");

  // write temp file for multipart upload
  const tmp = bufferToTempFile(referenceBuffer, referenceFilename);

  try {
    // speech-to-speech (voice-to-voice) uses `client.speechToSpeech.convert`
    const audio = await client.speechToSpeech.convert(useVoice, {
      // multipart field name must be `audio`
      audio: fs.createReadStream(tmp),
      modelId: stsModel,    // e.g., eleven_english_sts_v2
      outputFormat,         // e.g., mp3_44100_128
      // Optional: override per-request voice settings
      ...(process.env.ELEVEN_STABILITY != null ||
         process.env.ELEVEN_SIMILARITY != null ||
         process.env.ELEVEN_STYLE != null ||
         process.env.ELEVEN_SPEAKER_BOOST != null
        ? {
            voiceSettings: {
              ...(process.env.ELEVEN_STABILITY != null ? { stability: Number(process.env.ELEVEN_STABILITY) } : {}),
              ...(process.env.ELEVEN_SIMILARITY != null ? { similarityBoost: Number(process.env.ELEVEN_SIMILARITY) } : {}),
              ...(process.env.ELEVEN_STYLE != null ? { style: Number(process.env.ELEVEN_STYLE) } : {}),
              ...(process.env.ELEVEN_SPEAKER_BOOST != null ? { useSpeakerBoost: process.env.ELEVEN_SPEAKER_BOOST !== "0" } : {}),
            },
          }
        : {}
      ),
    });

    return await anyToBuffer(audio);
  } catch (err) {
    const status = err?.response?.status || err?.status;
    const msg = err?.message || "Unknown error";
    if (status === 401) throw new Error("ElevenLabs auth failed (401). Check ELEVENLABS_API_KEY.");
    if (status === 403) throw new Error("ElevenLabs forbidden (403). Check API key permissions.");
    if (status === 404) throw new Error("Voice not found (404). Check ELEVEN_VOICE_ID.");
    if (status === 429) throw new Error("ElevenLabs rate-limited (429). Try again shortly.");
    throw new Error(`ElevenLabs V2V error ${status || ""}: ${msg}`);
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}
