// src/services/websearch.js
// Unified web search with multiple providers: Serper (Google), Tavily, Brave, DuckDuckGo (fallback)
import axios from "axios";

const SERPER_API_KEY = process.env.SERPER_API_KEY || "";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";
const BRAVE_API_KEY  = process.env.BRAVE_API_KEY  || "";

// Normalize results to: { title, snippet, url, source }
function normalize(items = [], source = "") {
  return items
    .filter(Boolean)
    .map((r) => ({
      title: r.title || r.name || r.Title || "",
      snippet: r.snippet || r.description || r.Snippet || r.AbstractText || "",
      url: r.link || r.url || r.URL || "",
      source
    }))
    .filter((r) => r.url);
}

// --- Serper (Google) ---
async function serperSearch(query) {
  const { data } = await axios.post(
    "https://google.serper.dev/search",
    { q: query, num: 5 },
    { headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" }, timeout: 15000 }
  );
  const organic = Array.isArray(data?.organic) ? data.organic : [];
  return normalize(organic, "serper");
}

// --- Tavily ---
async function tavilySearch(query) {
  const { data } = await axios.post(
    "https://api.tavily.com/search",
    { query, max_results: 5, include_answer: false },
    { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${TAVILY_API_KEY}` }, timeout: 15000 }
  );
  const results = Array.isArray(data?.results) ? data.results : [];
  return normalize(results, "tavily");
}

// --- Brave ---
async function braveSearch(query) {
  const { data } = await axios.get(
    "https://api.search.brave.com/res/v1/web/search",
    { params: { q: query, count: 5 }, headers: { "X-Subscription-Token": BRAVE_API_KEY }, timeout: 15000 }
  );
  const results = Array.isArray(data?.web?.results) ? data.web.results : [];
  return normalize(results, "brave");
}

// --- DuckDuckGo (no key; weaker, but free) ---
async function ddgSearch(query) {
  const { data } = await axios.get("https://api.duckduckgo.com/", {
    params: { q: query, format: "json", no_html: 1, skip_disambig: 1 },
    timeout: 15000
  });
  const primary = data?.AbstractText
    ? [{ Title: data.Heading, Snippet: data.AbstractText, URL: data?.AbstractURL }]
    : [];
  const related = Array.isArray(data?.RelatedTopics)
    ? data.RelatedTopics.map((t) => ({ Title: t?.Text, URL: t?.FirstURL, Snippet: t?.Text }))
    : [];
  return normalize([...primary, ...related].slice(0, 5), "duckduckgo");
}

// Public: query the best available provider
export async function webSearch(query) {
  try {
    if (SERPER_API_KEY) return await serperSearch(query);
    if (TAVILY_API_KEY) return await tavilySearch(query);
    if (BRAVE_API_KEY)  return await braveSearch(query);
    return await ddgSearch(query);
  } catch (e) {
    // fallback chain
    try {
      if (TAVILY_API_KEY && !SERPER_API_KEY) return await tavilySearch(query);
      if (BRAVE_API_KEY) return await braveSearch(query);
      return await ddgSearch(query);
    } catch {
      return [];
    }
  }
}
