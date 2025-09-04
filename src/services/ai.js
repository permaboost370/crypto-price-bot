// src/services/ai.js — Groq AI client (OpenAI-compatible)
import axios from "axios";

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.AI_MODEL || "llama-3.1-70b-versatile";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postWithRetry(body, maxRetries = 3) {
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
      if (!retryable || attempt === maxRetries) break;
      await sleep(500 * Math.pow(2, attempt)); // 0.5s, 1s, 2s...
    }
  }
  throw lastErr;
}

export async function askAI(userText) {
  if (!KEY) throw new Error("Missing GROQ_API_KEY");
  const payload = {
    model: MODEL,
    temperature: 0.3,
    max_tokens: 700,
    messages: [
      {
        role: "system",
        content:
          "You are a concise, helpful assistant. If asked about crypto, be practical and avoid hype. Use bullet points for steps. Keep answers under 300 words unless code is requested."
      },
      { role: "user", content: String(userText || "").slice(0, 4000) }
    ]
  };

  const data = await postWithRetry(payload);
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty AI response.");
  return text;
}
