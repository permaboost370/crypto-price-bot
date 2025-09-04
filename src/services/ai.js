// src/services/ai.js — Groq AI client (with persona style support)
import axios from "axios";

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const KEY = process.env.GROQ_API_KEY;
const MODEL = (process.env.AI_MODEL || "llama-3.1-8b-instant").trim();
const STYLE = process.env.AI_STYLE?.trim() || 
  "You are a concise, helpful assistant. If asked about crypto, be practical and avoid hype.";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildMessages(userText) {
  const content = String(userText || "").trim();
  if (!content) throw new Error("Prompt is empty. Use /ai <your question>.");
  return [
    { role: "system", content: STYLE },
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
    temperature: 0.9, // make it more creative & theatrical
    max_tokens: 700,
    messages
  };

  const data = await postWithRetry(payload);
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty AI response.");
  return text;
}
