// src/services/ai.js
// DMAN persona with live WEB SEARCH grounding (sports/news/etc.), plus coins/tokens if present.
// Few-shots, short per-user history, and a word-limit rule (no hard trim).
import axios from "axios";
import { resolveCoinId, getCoinPriceUSD } from "./coingecko.js";     // CoinPaprika-backed
import { getTokenByContract } from "./dexscreener.js";
import { webSearch } from "./websearch.js";

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const KEY = process.env.GROQ_API_KEY;
const MODEL = (process.env.AI_MODEL || "llama-3.1-8b-instant").trim();
const STYLE = (process.env.AI_STYLE || "You are DMAN. Speak boldly, be concise.").trim();
const MAX_WORDS = Math.max(1, Number(process.env.AI_MAX_WORDS || 40));
const FEWSHOTS_RAW = process.env.AI_FEWSHOTS || "[]";

// ---------- FEW-SHOTS ----------
function parseFewshots() {
  try {
    const arr = JSON.parse(FEWSHOTS_RAW);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.user === "string" && typeof x.assistant === "string")
      .map((x) => [{ role: "user", content: x.user }, { role: "assistant", content: x.assistant }])
      .flat();
  } catch {
    return [];
  }
}
const FEWSHOTS = parseFewshots();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Heuristic: does the prompt likely require fresh web info? */
function needsWeb(q) {
  const s = String(q || "").toLowerCase();
  const triggers = [
    "who won", "score", "today", "yesterday", "last night", "breaking", "latest",
    "update", "news", "this week", "this month", "live", "just now", "result", "results",
    "earnings", "transfer", "injury", "fixture", "lineup", "election", "vote", "match", "game"
  ];
  return triggers.some((t) => s.includes(t));
}

// naive symbol/contract extraction (fast & safe)
function extractCandidates(text) {
  const t = String(text || "");
  const contracts = Array.from(
    t.matchAll(/\b(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g)
  ).map((m) => m[0]);

  const roughWords = t.toLowerCase().match(/\b[a-z0-9.+-]{2,10}\b/gi) || [];
  const blacklist = new Set([
    "the","and","you","are","with","this","that","about","price","token","coin","dman","dao","man",
    "buy","sell","up","down","today","yesterday","latest","news","result","score","won","who","when",
    "should","will","is","it","to","for","of","in","on","at","how","what","why","where","match","game"
  ]);
  const candidates = Array.from(new Set(
    roughWords
      .map((w) => w.replace(/\.+$/,""))
      .filter((w) => !blacklist.has(w.toLowerCase()))
  )).slice(0, 5);

  return { contracts: Array.from(new Set(contracts)).slice(0, 2), symbols: candidates.slice(0, 5) };
}

async function fetchGlobal() {
  try {
    const { data } = await axios.get("https://api.coinpaprika.com/v1/global", {
      timeout: 10000,
      headers: { "User-Agent": "dman-ai" }
    });
    const mcap = data?.market_cap_usd;
    const vol = data?.volume_24h_usd;
    const btcDom = data?.bitcoin_dominance_percentage;
    return {
      marketCapUSD: typeof mcap === "number" ? mcap : null,
      volume24hUSD: typeof vol === "number" ? vol : null,
      btcDominancePct: typeof btcDom === "number" ? btcDom : null
    };
  } catch {
    return null;
  }
}

function fmtUSD(n) {
  if (n == null) return "n/a";
  const num = Number(n);
  if (!isFinite(num)) return "n/a";
  if (Math.abs(num) < 1) return num.toLocaleString(undefined, { maximumFractionDigits: 8 });
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function buildFacts(userText) {
  const facts = [];
  const ts = new Date().toISOString();

  // 1) Web search if needed
  if (needsWeb(userText)) {
    try {
      const results = await webSearch(userText);
      if (results.length) {
        facts.push("WEB RESULTS:");
        for (const r of results.slice(0, 5)) {
          facts.push(`• ${r.title} — ${r.snippet} (${r.url})`);
        }
      }
    } catch { /* ignore */ }
  }

  // 2) Coins/tokens if user mentioned them (kept from previous logic)
  const { symbols, contracts } = extractCandidates(userText);
  const seenCoins = new Set();

  for (const raw of symbols.slice(0, 3)) {
    try {
      const id = await resolveCoinId(raw);
      if (seenCoins.has(id)) continue;
      const { price, change24h } = await getCoinPriceUSD(id);
      const arrow = (change24h ?? 0) >= 0 ? "🟢" : "🔴";
      facts.push(`COIN ${raw.toUpperCase()}: $${fmtUSD(price)} (${arrow} ${change24h?.toFixed?.(2) ?? "0.00"}% 24h)`);
      seenCoins.add(id);
    } catch { /* ignore */ }
  }

  for (const ca of contracts) {
    try {
      const t = await getTokenByContract(ca);
      const pc = t.priceChange?.h24 != null ? `${t.priceChange.h24.toFixed(2)}%` : "n/a";
      facts.push(`TOKEN ${t.symbol || "?"} (${t.chainId} • ${t.dex}): $${fmtUSD(t.priceUsd)} (24h ${pc})`);
    } catch { /* ignore */ }
  }

  const g = await fetchGlobal();
  if (g) {
    facts.push(`GLOBAL: MCAP ~$${fmtUSD(g.marketCapUSD)}, VOL24h ~$${fmtUSD(g.volume24hUSD)}, BTC.D ${g.btcDominancePct?.toFixed?.(2) ?? "n/a"}%`);
  }

  if (!facts.length) return "";
  return `FACTS @ ${ts}:\n- ` + facts.join("\n- ");
}

function buildMessages(userText, history = [], factsText = "") {
  const content = String(userText || "").trim();
  if (!content) throw new Error("Prompt is empty. Use /ai <your question>.");

  const rules = [
    `RULES: Keep answers under ${MAX_WORDS} words.`,
    `Always finish your sentences.`,
    `When FACTS are provided, ground your answer strictly on them; cite no numbers beyond FACTS.`,
    `If data is missing, say you don't know and suggest /price <symbol> or /token <contract> or refine search.`,
    `Punchy, cinematic, fearless DMAN tone.`
  ].join(" ");

  const system = [STYLE, rules].join(" ");
  const shortHistory = Array.isArray(history) ? history.slice(-6) : [];
  const factMessage = factsText ? [{ role: "system", content: factsText }] : [];

  return [
    { role: "system", content: system },
    ...factMessage,
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

export async function askAI(userText, history = []) {
  if (!KEY) throw new Error("Missing GROQ_API_KEY");

  const factsText = await buildFacts(userText); // includes WEB RESULTS when needed
  const messages = buildMessages(userText, history, factsText);
  const payload = {
    model: MODEL,
    temperature: 0.7,
    max_tokens: 240,
    messages
  };

  const data = await postWithRetry(payload);
  const raw = data?.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) throw new Error("Empty AI response.");
  return raw.trim();
}
