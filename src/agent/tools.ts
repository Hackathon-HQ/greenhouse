/**
 * Executors for the scout's non-MCP search tools (Reddit + HackerNews). The AI
 * SDK tool wrappers live in discover-agent.ts; this module just does the work
 * and returns readable text for the model.
 *
 *  - reddit_search: routed through Tavily (`include_domains:["reddit.com"]`)
 *    because Reddit's public JSON API is rate-limited/blocked from this host.
 *  - hackernews_search: direct HN Algolia API via the existing source.
 *
 * Web search itself is provided by the Tavily MCP server (see ./mcp.ts).
 */
import { HackerNewsSource } from "../sources/hackernews.js";
import { config } from "../config.js";
import type { RawSignal } from "../types.js";

const hn = new HackerNewsSource();

/**
 * Search a set of domains via the Tavily REST API. Used to reach platforms
 * whose own APIs are blocked/expensive from here: Reddit (public JSON is
 * 429/403'd) and X/Twitter (Grok Live Search deprecated, OAuth token churn).
 * Tavily reliably surfaces their public threads.
 */
async function tavilySiteSearch(
  query: string,
  domains: string[],
  limit: number,
  label: string,
): Promise<string> {
  if (!config.tavily.apiKey) {
    return `ERROR: Tavily key required to search ${label}.`;
  }
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.tavily.apiKey,
        query,
        search_depth: "advanced",
        max_results: limit,
        include_domains: domains,
        include_raw_content: false,
      }),
    });
    if (!res.ok) return `ERROR: Tavily ${res.status} searching ${label}`;
    const json = (await res.json()) as {
      results?: Array<{ title: string; url: string; content: string }>;
    };
    const results = json.results ?? [];
    if (results.length === 0) return `(no ${label} results found)`;
    return results
      .slice(0, limit)
      .map(
        (r, i) =>
          `${i + 1}. ${r.title}\n   ${r.url}\n   ${(r.content || "")
            .replace(/\s+/g, " ")
            .slice(0, 260)}`,
      )
      .join("\n");
  } catch (err) {
    return `ERROR searching ${label} via Tavily: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}

/** Compact a list of signals into a readable block for the model to reason over. */
function renderSignals(signals: RawSignal[], limit: number): string {
  if (signals.length === 0) return "(no results)";
  return signals
    .slice(0, limit)
    .map((s, i) => {
      const eng = s.engagement
        ? ` [${s.engagement.upvotes ?? s.engagement.points ?? 0} pts, ${
            s.engagement.comments ?? 0
          } comments]`
        : "";
      const body = s.summary
        ? ` — ${s.summary.replace(/\s+/g, " ").slice(0, 220)}`
        : "";
      return `${i + 1}. ${s.title}${eng}\n   ${s.url}${body}`;
    })
    .join("\n");
}

/**
 * Execute a Reddit/HN search and return human-readable results text for the
 * model. Never throws — upstream failures degrade to an explanatory string.
 */
export async function runSearchTool(
  name: "reddit_search" | "hackernews_search" | "x_search",
  query: string,
  limit = 8,
): Promise<string> {
  const q = query.trim();
  const n = Math.min(Math.max(limit || 8, 1), 20);
  if (!q) return "ERROR: query is required";

  try {
    if (name === "reddit_search")
      return await tavilySiteSearch(q, ["reddit.com"], n, "Reddit");
    if (name === "x_search")
      return await tavilySiteSearch(q, ["x.com", "twitter.com"], n, "X");
    return renderSignals(
      await hn.discover({
        topics: [q],
        limit: n,
        withinHours: config.pipeline.withinHours,
      }),
      n,
    );
  } catch (err) {
    return `ERROR running ${name}: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}
