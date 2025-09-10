// src/services/stt.js
// Speech-to-Text via OpenAI Whisper, with prompt bias + explicit COMMON map
// + edit-distance fallback to fix mis-hearings of "DAOman".

import fs from "fs";
import path from "path";
import OpenAI from "openai";

const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
const client = new OpenAI({ apiKey: openaiKey });

// -----------------------------
// Bias Terms
// -----------------------------
const BASE_HINTS = [
  "DAOman",
  "DAOs.fun",
  "DMAN",
  "Solana",
  "Meteora",
  "buybacks",
  "treasury",
  "DAO",
  "NAV",
  "DeFi",
  "token"
];

const EXTRA_HINTS = (process.env.STT_PROMPT_EXTRA || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const WHISPER_PROMPT = [...new Set([...BASE_HINTS, ...EXTRA_HINTS])].join(", ");

// -----------------------------
// Correction Helpers
// -----------------------------

// Explicit replacements for common mis-hearings
const COMMON = new Map([
  ["dow", "DAOman"],
  ["down", "DAOman"],
  ["doa", "DAOman"],
  ["dowan", "DAOman"],
  ["daowan", "DAOman"],
  ["dauman", "DAOman"],
  ["deo man", "DAOman"],
  ["doughman", "DAOman"],
  ["doorman", "DAOman"] // sometimes heard this way
]);

function editDistance(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return dp[a.length][b.length];
}

function normalizeDAOman(text) {
  if (!text) return text;

  // Normalize spaced/hyphenated forms
  let out = text
    .replace(/\bdao[\s-]*man\b/gi, "DAOman")
    .replace(/\bdao\s*men\b/gi, "DAOman")
    .replace(/\bda\s*o\s*man\b/gi, "DAOman");

  // Token-wise corrections (preserving punctuation)
  const parts = out.split(/(\W+)/u);
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i];
    // skip non-words
    if (!/^[\p{L}\p{N}]+$/u.test(token)) continue;

    const lower = token.toLowerCase();

    // exact common replacements
    if (COMMON.has(lower)) {
      parts[i] = COMMON.get(lower);
      continue;
    }

    // avoid real words
    if (lower === "domain" || lower === "domains") continue;

    // edit-distance fallback to catch close phonetics
    const candidates = ["daoman", "dao-man", "downman", "dowman", "doaman"];
    if (candidates.some((c) => editDistance(lower, c) <= 2)) {
      parts[i] = "DAOman";
    }
  }

  out = parts.join("");

  // Two-token patterns like "dow man" / "down man"
  out = out.replace(/\b(dow|down|doa)\s+man\b/gi, "DAOman");

  return out;
}

// -----------------------------
// Main Transcription
// -----------------------------
/**
 * Transcribe an audio buffer with Whisper + correct DAOman.
 * @param {Buffer} buf
 * @param {object} opts
 * @param {string} [opts.filename='audio.ogg']
 * @param {string} [opts.model='whisper-1']
 */
export async function transcribeBuffer(
  buf,
  { filename = "audio.ogg", model = "whisper-1" } = {}
) {
  if (!openaiKey) throw new Error("Missing OPENAI_API_KEY for STT.");
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error("Empty audio buffer.");

  const tmpPath = path.join("/tmp", `${Date.now()}-${filename}`);
  await fs.promises.writeFile(tmpPath, buf);

  try {
    const response = await client.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model,
      language: "en",          // Force English
      prompt: WHISPER_PROMPT,  // Bias to project terms
      response_format: "text",
      temperature: 0
    });

    const raw = typeof response === "string" ? response : (response?.text || "");
    const clean = String(raw || "").trim();
    if (!clean) throw new Error("Empty transcription.");

    return normalizeDAOman(clean);
  } finally {
    // best-effort cleanup
    fs.promises.unlink(tmpPath).catch(() => {});
  }
}
