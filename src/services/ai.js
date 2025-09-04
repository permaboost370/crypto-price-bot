// src/services/ai.js — DMAN persona with style, FEWSHOTS, memory, and word-limit rule
import axios from "axios";

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const KEY = process.env.GROQ_API_KEY;
const MODEL = (process.env.AI_MODEL || "llama-3.1-8b-instant").trim();
const STYLE = (process.env.AI_STYLE || "You are DMAN. Speak boldly, be concise.").trim();
const MAX_WORDS = Math.max(1, Number(process.env.AI_MAX_WORDS || 40));
const FEWSHOTS_RAW = process.env.AI_FEWSHOTS || "[]";

function parseFewshots() {
  try {
    const arr = JSON.parse(FEWSHOTS_RAW);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(x => x && typeof x.user === "string" && typeof x.assistant === "string")
      .map(x => [{ role: "user", content: x.user }, { role: "assistant", content: x.assistant }])
      .flat();
  } catch {
    return [];
  }
}
const FEWSHOTS = parseFewshots();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function buildMessages(userText, history = []) {
  const content = String(userText || "").trim();
  if (!content) throw new Error("Prompt is empty. Use /ai <your question>.");

  const system = [
    STYLE,
    `RULES: Keep answers under ${MAX_WORDS} words. Always finish your sentences. Never exceed the limit. Punchy, cinematic, fearless.`
  ].join(" ");

  const shortHistory = Array.isArray(history) ? history.slice(-6) : [];

  return [
    { role: "system", content: system },
    ...FEWSHOTS,
    ...shortHistory,
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
          "User-Agent": "dman-ai"
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
          "AI error.";
        const e = new Error(detail);
        e.status = status;
        throw e;
      }
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

/**
 * askAI(userText, history?)
 * history: [{role:'user'|'assistant', content:string}, ...]
 */
export async function askAI(userText, history = []) {
  if (!KEY) throw new Error("Missing GROQ_API_KEY");
  const messages = buildMessages(userText, history);
  const payload = {
    model: MODEL,
    temperature: 0.7,
    max_tokens: 200, // enough room for short but complete answers
    messages
  };
  const data = await postWithRetry(payload);
  const raw = data?.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) throw new Error("Empty AI response.");
  return raw.trim();
}
