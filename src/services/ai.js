// src/services/ai.js — Groq AI client (OpenAI-compatible) with better errors & safe defaults
import axios from "axios";

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const KEY = process.env.GROQ_API_KEY;
const MODEL = (process.env.AI_MODEL || "llama-3.1-8b-instant").trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildMessages(userText) {
  const content = String(userText || "").trim();
  if (!content) {
    throw new Error("Prompt is empty. Use /ai <your question>.");
  }
  // keep payload small to avoid context errors
  const clipped = content.slice(0, 4000);
  return [
    {
      role: "system",
      content:
        "You are a concise, helpful assistant. If asked about crypto, be practical and avoid hype. Use short paragraphs or bullet points. Keep answers under 300 words unless code is requested."
    },
    { role: "user", content: clipped }
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
      // If it's a 400/401/403, no point retrying — surface the message immediately
      if (!retryable || attempt === maxRetries) {
        // Enhance the error with Groq's message (if any)
        const detail =
          err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          err?.message ||
          "Unknown AI error.";
        const e = new Error(detail);
        e.status = status;
        throw e;
      }
      await sleep(500 * Math.pow(2, attempt)); // 0.5s, 1s...
    }
  }
  throw lastErr;
}

export async function askAI(userText) {
  if (!KEY) throw new Error("Missing GROQ_API_KEY");

  const messages = buildMessages(userText);

  // Build a conservative payload. If you changed MODEL to an invalid name, Groq will 400.
  const payload = {
    model: MODEL,
    temperature: 0.3,
    max_tokens: 700,
    messages
  };

  const data = await postWithRetry(payload);
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty AI response.");
  return text;
}
