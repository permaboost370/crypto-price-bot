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

// Explicit replacements
const COMMON = new Map([
  ["dow", "DAOman"],
  ["down", "DAOman"],
  ["doa", "DAOman"],
  ["dowan", "DAOman"],
  ["daowan", "DAOman"],
  ["dauman", "DAOman"],
  ["deo man", "DAOman"],
  ["doughman", "DAOman"],
  ["doorman", "DAOman"], // sometimes heard this way
]);

function editDistance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function normalizeDAOman(text) {
  if (!text) return text;

  // Normalize spaces/hyphens
  let out = text
    .replace(/\bdao[\s-]*man\b/gi, "DAOman")
    .replace(/\bdao\s*men\b/gi, "DAOman")
    .replace(/\bda\s*o\s*man\b/gi, "DAOman");

  const words = out.split(/(\W+)/); // keep punctuation

  for (let i = 0; i < words.length; i++) {
    const lower = words[i].toLowerCase();

    if (COMMON.has(lower)) {
      words[i] = COMMON.get(lower);
      continue;
    }

    // skip "domain"
    if (lower === "domain" || lower === "domains") continue;

    const candidates = ["daoman", "dao-man", "downman", "dowman", "doaman"];
    if (candidates.some((c) => editDistance(lower, c) <= 2)) {
      words[i] = "DAOman";
    }
  }

  out = words.join("");
  out = out.replace(/\b(dow|down|doa)\s+man\b/gi, "DAOman");

  return out;
}

// -----------------------------
// Main Transcription
// -----------------------------
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
      prompt: WHISPER
