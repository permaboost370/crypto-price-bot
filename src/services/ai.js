// src/services/ai.js — Groq AI client with style + HARD word cap
import axios from "axios";

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const KEY = process.env.GROQ_API_KEY;
const MODEL = (process.env.AI_MODEL || "llama-3.1-8b-instant").trim();
const STYLE = process.env.AI_STYLE?.trim() ||
  "You are a concise, helpful assistant. Keep answers short and practical.";
const MAX_WORDS = Math.max(1, Number(process.env.AI_MAX_WORDS || 20)); // hard cap

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function trimToWords(text, limit) {
  const words = String(text || "").trim().split(/\s+/);
  if (words.length <= limit) return words.join(" ");
  return words.slice(0, limit).join(" ");
}

function buildMessages(userText) {
  const content = String(userText || "").trim();
  if (!content) throw new Error("Prompt is empty. Use /ai <your question>.");

  // Add explicit brevity rule to the system message
  const system = [
    STYLE,
    `RULES: Use at most ${MAX_WORDS} words. No lists unless the user asks.`
  ].join(" ");

  return [
    { role: "system", content: system },
    { role: "user", content: content.slice(0, 4000) }
  ];
}

async function postWithRetry(body, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data } = await axios.post(GROQ_BASE, body, {
        headers: {
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
          "User-Agent": "crypto-price-bot/ai"
        },
        timeout: 20000
      });
      return data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const isTimeout = err?.code === "ECONNABORTED";
      const retryable = status === 429 || status >= 500 || isTimeout;
      if (!retryable || attempt === maxRetries) {
        const detail =
          err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          err?.message ||
          "Unknown AI error.";
        const e = new Error(detail);
        e.status = status;
        throw e;
      }
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

export async function askAI(userText) {
  if (!KEY) throw new Error("Missing GROQ_API_KEY");

  const messages = buildMessages(userText);

  const payload = {
    model: MODEL,
    temperature: 0.7,          // still stylish, but less rambly
    max_tokens: 120,           // conservative to avoid overflow
    messages
  };

  const data = await postWithRetry(payload);
  const raw = data?.choices?.[0]?.message?.content ?? "";
  const clipped = trimToWords(raw, MAX_WORDS); // HARD post-process cap
  if (!clipped.trim()) throw new Error("Empty AI response.");
  return clipped;
}
