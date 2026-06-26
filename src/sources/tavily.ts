/**
 * Tavily discovery source.
 *
 * Uses the Tavily search API (package `@tavily/core`) to surface recent web
 * articles, discussions and launches relevant to the seed topics. Tavily's
 * per-result `score` is an already-normalized ~0..1 relevance value, which we
 * map straight into {@link RawSignal.popularity} as a demand proxy.
 */
import { tavily } from "@tavily/core";
import { config } from "../config.js";
import type { DiscoverInput, RawSignal, Source } from "../types.js";
import { clamp01, stableId } from "./source.js";

/** Shape of a single Tavily search result we rely on. */
interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate: string;
}

/**
 * Discovers RawSignals from the Tavily web search API. Runs one advanced
 * "general" search per seed topic over the last month, then merges and
 * de-duplicates results by URL. Never throws on routine upstream failure —
 * a failed topic is logged and skipped.
 */
export class TavilySource implements Source {
  readonly name = "tavily";

  /** True when a Tavily API key is configured; otherwise the source is skipped. */
  isConfigured(): boolean {
    return Boolean(config.tavily.apiKey);
  }

  /**
   * Fetch web signals for the given topics.
   *
   * @param input - Seed topics and a soft per-source result cap.
   * @returns RawSignals deduped by URL, capped at `input.limit`.
   */
  async discover(input: DiscoverInput): Promise<RawSignal[]> {
    if (!this.isConfigured()) return [];

    const topics = input.topics.filter(Boolean);
    if (topics.length === 0) return [];

    const client = tavily({ apiKey: config.tavily.apiKey });
    // Spread the soft cap across topics so no single topic monopolizes the budget.
    const maxResults = Math.max(1, Math.ceil(input.limit / topics.length));

    const byUrl = new Map<string, RawSignal>();

    const perTopic = await Promise.allSettled(
      topics.map((topic) =>
        client.search(topic, {
          searchDepth: "advanced",
          topic: "general",
          maxResults,
          timeRange: "month",
          includeRawContent: false,
        }),
      ),
    );

    perTopic.forEach((outcome, i) => {
      const topic = topics[i];
      if (outcome.status === "rejected") {
        console.warn(
          `[tavily] search failed for topic "${topic}":`,
          outcome.reason,
        );
        return;
      }

      const results = (outcome.value?.results ?? []) as TavilyResult[];
      for (const r of results) {
        if (!r?.url || byUrl.has(r.url)) continue;
        byUrl.set(r.url, this.toSignal(r, topic));
      }
    });

    return [...byUrl.values()].slice(0, input.limit);
  }

  /** Map a single Tavily result + originating topic into a RawSignal. */
  private toSignal(r: TavilyResult, topic: string): RawSignal {
    const createdAt = this.toIso(r.publishedDate);
    return {
      id: stableId("tavily", r.url),
      source: this.name,
      title: (r.title ?? "").trim() || r.url,
      summary: (r.content ?? "").trim(),
      url: r.url,
      popularity: clamp01(typeof r.score === "number" ? r.score : 0),
      createdAt,
      tags: [topic],
      raw: r,
    };
  }

  /** Coerce Tavily's publishedDate into a valid ISO string, falling back to now. */
  private toIso(value: string | undefined): string {
    if (value) {
      const t = Date.parse(value);
      if (Number.isFinite(t)) return new Date(t).toISOString();
    }
    return new Date().toISOString();
  }
}
