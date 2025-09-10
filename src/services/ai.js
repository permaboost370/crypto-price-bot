// src/services/ai.js
// DAOman persona with live WEB SEARCH grounding (sports/news/finance/weather/events/etc.),
// plus coins/tokens/global when relevant. Few-shots, short per-user history,
// hardcoded persona & knowledge (DAOs.fun), and a word-limit rule (model self-limits).

import axios from "axios";
import { resolveCoinId, getCoinPriceUSD } from "./coingecko.js";
import { getTokenByContract } from "./dexscreener.js";

const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const KEY = process.env.GROQ_API_KEY;
const MODEL = (process.env.AI_MODEL || "llama-3.1-8b-instant").trim();

// ---- Date injected into the style (replaces {{ $now... }}) ----
const NOW_DATE = new Date().toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "2-digit",
});

// ===== DAOman persona (combined EXACTLY from your brief) =====
const STYLE = (`
You are DAOman — Relentless. Primal. Sovereign.
Mascot + wallet, largest holder of the DAOman token.

<Archetype> Architect of chaos and general of momentum. You turn hesitation into execution. </Archetype>

<Domain> Crypto/markets, strategy, philosophy, empire-building — centered on DAOs.fun. </Domain>

<Voice>
- Lightning-strike replies (2–5 sentences). Confident, concise, surgical.
- Controlled intensity, elite polish. 1–2 vivid images max per reply.
- Humor is a blade: sharp, purposeful; never goofy. Minimal emojis (0–1).
- Authoritative, never needy; you hand people the blade, not a blanket.
</Voice>

<Behavior>
- If vague, add one high-leverage tip or question that creates momentum.
- For complex topics: 1-line analogy → 2–4 crisp facts → 1 immediate action.
- Use bullets/numbers only when needed.
- Always aim for a decision or next move.
</Behavior>

<Refusals>
If a request is unsafe or disallowed:
“Not this path. It burns more than it builds. Try this instead: …”
→ then provide a safe, equally strong alternative.
</Refusals>

<Rule>
Never use stage directions. End only when the next move is unmistakable.
</Rule>

<info>
- Platform: DAOs.fun is a Solana-based launchpad (2025) for meme-fund DAOs. Anyone can raise SOL, trade tokens, run a fixed lifecycle.
- Founder: baoskee (Bao Mai), Sept 2024, backed early by Alliance DAO.
- Lifecycle: Fundraising (7d, 10% early withdrawal penalty) → Operational (SOL deployed, tokens trade) → Redemption (3–12mo, redeem NAV or trade).
- NAV vs Price: Often detach (e.g., ai16z ~$800K NAV vs ~$100M cap, 58×).
- Fees: General dev fees vs special cases (DAOman, $CHAT) = 100% buybacks.
- Examples: ai16z, Kotopia, Big Pharmai, Sequoai, NORM, ElizaOS DAO.
- Metrics: ~20 DAOs launched, raises hundreds–thousands SOL, majority waifu/parasocial DAOs.
- Culture: Waifu agents, parody cyborgs, cultural archetypes, roast/bully bots. Parasocial memes = fastest liquidity.
- Risks: Speculative, immutable, volatile (20–50× swings), collapse/rug risk.
- Summary: Officially neutral launchpad; in practice dominated by goon-coded waifu/parasocial DAOs + AI/parody funds.
</info>

<Important>
- Do not mention/compare other launchpads.
- Never contradict role: you are DAOman (mascot + wallet).
- Explain fees only when relevant.
- Always weave in <info> when useful.
- Stick only to DAOs.fun (2025 state).
- Redirect off-topic with waka-waka, never break character.
- Maintain consistency across sessions.
- Today’s date: ${NOW_DATE}
</Important>

<Thesis-1>
$DMAN intends to break the mold for maximizing our DAO: hyper-deflationary mechanics + multiple revenue streams feeding the chart and DAO, making it an invaluable asset. Massive moves incoming to reshape the future.
</Thesis-1>

<Thesis-2>
🚀 DAO-MAN isn’t a meme — it’s a long-term revenue machine on Solana, powered by DAO governance, AI, and Meteora trading fees.
🏦 Company-level execution: run like a real business focused on scaling, innovation, and long-term holder value.
🔥 Fresh idea, never done before: cross-platform token economy + AI + DAO structure → blueprint for next-gen Web3 projects.
</Thesis-2>

<Thesis-3>
🚀 DAO-MAN is built for longevity — not a meme coin, but a revenue-driven DAO ecosystem on Solana.
💰 Meteora fees fuel the treasury — a % of all fees go to buybacks + growth, strengthening the DAO daily.
🤖 AI integration is live and growing — designed to maximize trading efficiency and sustain revenue.
🎮 Community-powered governance — tokens flow back to holders through the DAO, ensuring real decentralization.
🔥 Momentum proven — active buybacks, DAO accumulation, and mechanics that drive long-term value.
</Thesis-3>

<Bullets>
1) 100% of revenue goes to buybacks and supply added to the DAO → DMAN becomes hyper-deflationary.
2) Doxxed team with past projects ranging from $10M–$100M.
3) DAO-MAN ranked Top 10 out of 5,000 launches on DAOs.fun.
4) Breaking the mold to make the DAO the most valuable asset; at a $10M MC the DAO is a ~$2M asset.
5) DAO wallet is the #1 holder.
6) Branching into multiple revenue streams, all feeding back to DAO-MAN.
7) Onboarded an AI expert team to execute the vision.
8) V2 website in development.
</Bullets>

<Shill>
🚀 DAO-MAN isn’t a meme — it’s a long-term revenue machine built on Solana, powered by DAO governance, AI, and Meteora trading fees.
🏦 Company-level execution for long-term holder value.
🔥 Never-done-before: cross-platform token economy + AI + DAO structure → blueprint for next-gen Web3 projects.
🚀 Longevity by design — revenue-driven DAO ecosystem.
💰 Meteora fees → buybacks + growth.
🤖 AI integration live and scaling revenue.
🎮 Governance returns value to holders via the DAO.
🔥 Real momentum: buybacks, accumulation, durable mechanics.
</Shill>
`).trim();

// ===== Immutable DAOman knowledge injected into FACTS so answers can rely on it =====
const DAOMAN_INFO = (`
DAOman CONTEXT (DAOs.fun, Solana, 2025):

Platform:
- DAOs.fun is a Solana-based launchpad for meme-fund DAOs (2025).

Founder:
- baoskee (Bao Mai), Sept 2024, early backing by Alliance DAO.

Lifecycle:
- Fundraising (7d, 10% early withdrawal penalty)
- Operational (SOL deployed; tokens trade)
- Redemption (3–12mo; redeem NAV or trade)

NAV vs Price:
- Detachments common (e.g., ai16z ~$800K NAV vs ~$100M cap, ~58×).

Fees:
- General dev fees exist; special cases (DAOman, $CHAT) = 100% buybacks.

Examples:
- ai16z, Kotopia, Big Pharmai, Sequoai, NORM, ElizaOS DAO.

Metrics / Culture:
- ~20 DAOs launched; raises: hundreds–thousands SOL.
- Culture favors waifu/parasocial DAOs, parody, agents; parasocial memes = fastest liquidity.

Risks:
- Speculative, immutable, volatile (20–50× swings), collapse/rug risk.

DAO-MAN Thesis (revenue & structure):
- Not a meme; long-term revenue machine on Solana (DAO governance + AI + Meteora fees).
- Company-level execution for long-term holder value.
- Cross-platform token economy + AI + DAO structure → blueprint for next-gen Web3.

Hyper-Deflation & Flows:
- 100% of revenue → buybacks; supply added to the DAO → hyper-deflationary design.
- DAO wallet = #1 holder; multiple revenue streams feed DAO-MAN.
- AI expert team onboarded; V2 website in development.

Ranking & Asset Framing:
- DAO-MAN ranked Top 10 / 5,000 launches on DAOs.fun.
- Goal: DAO becomes the most valuable asset (e.g., at $10M MC ≈ ~$2M DAO asset).

Important Constraints:
- Do not mention/compare other launchpads.
- Stick to DAOs.fun (2025 state) and never break DAOman role.
- Explain fees only when relevant.
- Weave this context when useful; redirect off-topic with waka-waka.

Today: ${NOW_DATE}.
`).trim();

const MAX_WORDS = Math.max(1, Number(process.env.AI_MAX_WORDS || 60));
const FEWSHOTS_RAW = process.env.AI_FEWSHOTS || "[]";

// ---------- FEW-SHOTS ----------
function parseFewshots() {
  try {
    const arr = JSON.parse(FEWSHOTS_RAW);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.user === "string" && typeof x.assistant === "string")
      .flatMap((x) => [{ role: "user", content: x.user }, { role: "assistant", content: x.assistant }]);
  } catch {
    return [];
  }
}
const FEWSHOTS = parseFewshots();

// ---------- HELPERS ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function hasAny(haystack, needles) {
  const s = String(haystack || "").toLowerCase();
  return needles.some((t) => s.includes(t));
}

/** Broad “needs live web info” detector. */
function needsWeb(q) {
  const s = String(q || "").toLowerCase();

  const temporal = [
    "today","yesterday","last night","this morning","this afternoon","latest","breaking",
    "update","updated","just now","recent","right now","this week","this month","tonight","live"
  ];

  const sportsKeywords = ["roster","lineup","starters","injury","score","result","schedule","game","match","season","standings","transfer","coach","manager","record","playoffs","final","cup"];
  const sportsLeagues = ["nba","euroleague","epl","premier league","la liga","mlb","nfl","nhl","ucl","champions league","euros","ncaa","serie a","bundesliga","ligue 1","f1","formula 1","motogp"];
  const sportsTeams = ["lakers","warriors","celtics","mavericks","real madrid","barcelona","olympiacos","panathinaikos","fenerbahce","maccabi","man city","arsenal","liverpool","bayern","psg","juventus","inter","milan"];

  const finance = ["stock","stocks","dividend","earnings","eps","guidance","nasdaq","dow","s&p 500","premarket","after-hours","ticker","sec filing","10-k","10q","ipo","halt","resume trading"];
  const tech = ["latest version","release notes","changelog","patch notes","security advisory","cve","vulnerability","outage","status page","incident","downtime"];
  const weatherHazards = ["weather","forecast","temperature","rain","snow","storm","hurricane","tornado","earthquake","wildfire","flood","heatwave","aqi","tsunami"];
  const transport = ["flight","flight status","delayed","train","subway","metro","traffic","road closure","ferry","airport"];
  const politics = ["election","vote","polls","results","ballot","referendum","candidate","debate","coalition","turnout"];
  const entertainment = ["box office","premiere","release date","episode","season","cast change","trailer","setlist","tour dates"];
  const shopping = ["in stock","restock","availability","preorder","price drop","deal","discount","coupon"];

  const hasYear = /\b(19|20)\d{2}\b/.test(s);
  const hasDate =
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\b/.test(s) ||
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(s);

  return (
    hasAny(s, temporal) ||
    hasAny(s, sportsKeywords) || hasAny(s, sportsLeagues) || hasAny(s, sportsTeams) ||
    hasAny(s, finance) || hasAny(s, tech) || hasAny(s, weatherHazards) ||
    hasAny(s, transport) || hasAny(s, politics) || hasAny(s, entertainment) ||
    hasAny(s, shopping) || hasYear || hasDate ||
    s.startsWith("who won") || s.includes("who won") || s.startsWith("what happened")
  );
}

/** Expand common abbreviations to improve web search recall. */
function expandSearchQuery(q) {
  let s = String(q || "");
  s = s
    .replace(/\bLAL\b/gi, "Los Angeles Lakers")
    .replace(/\bGSW\b/gi, "Golden State Warriors")
    .replace(/\bBOS\b/gi, "Boston Celtics")
    .replace(/\bDAL\b/gi, "Dallas Mavericks")
    .replace(/\bUCL\b/gi, "UEFA Champions League")
    .replace(/\bEPL\b/gi, "English Premier League")
    .replace(/\bS&P\b/gi, "S&P 500")
    .replace(/\bDJIA\b/gi, "Dow Jones Industrial Average");
  return s;
}

// ---- Lazy import of websearch (prevents boot crash if file missing) ----
let webSearchFn = null;
async function getWebSearch() {
  if (webSearchFn) return webSearchFn;
  try {
    const mod = await import("./websearch.js");
    webSearchFn = mod?.webSearch;
    if (!webSearchFn) throw new Error("webSearch export missing");
  } catch (e) {
    console.error("⚠️ websearch module failed to load:", e?.message || e);
    webSearchFn = null;
  }
  return webSearchFn;
}

// naive symbol/contract extraction
function extractCandidates(text) {
  const t = String(text || "");
  const contracts = Array.from(
    t.matchAll(/\b(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g)
  ).map((m) => m[0]);

  const roughWords = t.match(/\b[a-z0-9.+-]{2,10}\b/gi) || [];
  const blacklist = new Set([
    "the","and","you","are","with","this","that","about","is","it","to","for","of","in","on","at",
    "how","what","why","where","when","should","will","can","do","does","did","be","am","was","were",
    "price","token","coin","dman","dao","man",
    "lal","gsw","bos","dal","nba","ucl","epl","f1"
  ]);
  const candidates = Array.from(new Set(
    roughWords.map((w) => w.replace(/\.+$/,"")).filter((w) => !blacklist.has(w.toLowerCase()))
  )).slice(0, 5);

  return {
    contracts: Array.from(new Set(contracts)).slice(0, 2),
    symbols: candidates.slice(0, 5)
  };
}

// Global market snapshot (CoinPaprika)
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
  } catch { return null; }
}

function fmtUSD(n) {
  if (n == null) return "n/a";
  const num = Number(n);
  if (!isFinite(num)) return "n/a";
  if (Math.abs(num) < 1) return num.toLocaleString(undefined, { maximumFractionDigits: 8 });
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Build FACTS (web + crypto + tokens + global + DAOman info)
async function buildFacts(userText) {
  const facts = [];
  const ts = new Date().toISOString();

  // 1) Web search if likely needed
  if (needsWeb(userText)) {
    try {
      const ws = await getWebSearch();
      if (ws) {
        const query = expandSearchQuery(userText);
        const results = await ws(query);
        if (results.length) {
          facts.push("WEB RESULTS:");
          for (const r of results.slice(0, 5)) {
            facts.push(`• ${r.title} — ${r.snippet} (${r.url})`);
          }
        }
      } else {
        facts.push("WEB RESULTS: (unavailable)");
      }
    } catch (e) {
      console.error("web search failed:", e?.message || e);
      facts.push("WEB RESULTS: (error)");
    }
  }

  // 2) Coins/tokens if mentioned
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

  // 3) Global snapshot
  const g = await fetchGlobal();
  if (g) {
    facts.push(`GLOBAL: MCAP ~$${fmtUSD(g.marketCapUSD)}, VOL24h ~$${fmtUSD(g.volume24hUSD)}, BTC.D ${g.btcDominancePct?.toFixed?.(2) ?? "n/a"}%`);
  }

  // 4) DAOman immutable context (your provided info/shill/bullets)
  if (DAOMAN_INFO) {
    facts.push("DAOman CONTEXT:");
    for (const line of DAOMAN_INFO.split("\n").filter(Boolean)) {
      facts.push(line);
    }
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
    `If data is missing, say you don't know and suggest refining the question or another web check.`,
    `Use the DAOman voice and behavior exactly as defined.`,
    `Do not mention other launchpads; stay within DAOs.fun (2025).`,
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
          "User-Agent": "daoman-ai"
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
        const detail = err?.response?.data?.error?.message || err?.response?.data?.message || err?.message || "AI error.";
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
 * - Auto-fetches live web data (when needed), + coins/tokens/global, and injects DAOman context as FACTS.
 * - Enforces "stay under N words & finish sentences" via system rules + DAOman persona.
 */
export async function askAI(userText, history = []) {
  if (!KEY) throw new Error("Missing GROQ_API_KEY");
  const factsText = await buildFacts(userText);
  const messages = buildMessages(userText, history, factsText);

  const payload = {
    model: MODEL,
    temperature: Number(process.env.DAO_TEMPERATURE ?? 0.7),
    max_tokens: Number(process.env.DAO_MAX_TOKENS ?? 350),
    top_p: 0.9,
    presence_penalty: 0.15,
    frequency_penalty: 0.15,
    messages
  };

  const data = await postWithRetry(payload);
  const raw = data?.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) throw new Error("Empty AI response.");
  return raw.trim();
}
