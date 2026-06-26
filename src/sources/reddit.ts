/**
 * Reddit discovery source.
 *
 * Mines pain points / feature requests from Reddit using the PUBLIC read-only
 * JSON API (append `.json` to any reddit.com path — no OAuth). For each seed
 * topic we search the configured subreddits and normalize each post into a
 * {@link RawSignal}.
 *
 * Operational notes (see project research notes):
 *  - A unique, descriptive `User-Agent` is mandatory; we use config.reddit.userAgent.
 *  - The public API is aggressively IP-rate-limited (~10 req/min) and
 *    datacenter/cloud IPs may receive 403 HTML block pages instead of JSON.
 *    We therefore gate every response on `res.ok && content-type includes json`
 *    and never throw on routine upstream failure — we log and return [].
 */
import { config } from "../config.js";
import type { DiscoverInput, RawSignal, Source } from "../types.js";
import { clamp01, stableId } from "./source.js";

/** Minimal shape of a Reddit `t3` (link/post) data object we rely on. */
interface RedditPost {
  id: string;
  title?: string;
  selftext?: string;
  ups?: number;
  score?: number;
  num_comments?: number;
  created_utc?: number;
  permalink?: string;
  subreddit?: string;
  url?: string;
  over_18?: boolean;
}

interface RedditListing {
  data?: {
    children?: Array<{ kind?: string; data?: RedditPost }>;
  };
}

/**
 * Map a `withinHours` window onto Reddit's coarse `t` (time range) search
 * parameter. Reddit only supports hour|day|week|month|year|all.
 */
function withinHoursToRange(hours: number | undefined): string {
  if (!hours || hours <= 0) return "month";
  if (hours <= 1) return "hour";
  if (hours <= 24) return "day";
  if (hours <= 24 * 7) return "week";
  if (hours <= 24 * 31) return "month";
  if (hours <= 24 * 366) return "year";
  return "all";
}

/**
 * Normalize an upvote count into a 0..1 popularity proxy using a saturating
 * curve: ups / (ups + 50). 0 ups -> 0, 50 -> 0.5, asymptotes toward 1.
 */
function upvotesToPopularity(ups: number): number {
  if (!Number.isFinite(ups) || ups <= 0) return 0;
  return clamp01(ups / (ups + 50));
}

/**
 * Discovery source backed by Reddit's public read-only JSON API. Always
 * available (no credentials required) and resilient to upstream failures.
 */
export class RedditSource implements Source {
  readonly name = "reddit" as const;

  /** Public JSON API needs no credentials, so it is always "configured". */
  isConfigured(): boolean {
    return true;
  }

  /**
   * Fetch one reddit.com `.json` endpoint, returning the parsed JSON or null.
   * Never throws: rate limits, IP blocks (403 HTML), and network errors all
   * resolve to null + a console.warn so the source degrades gracefully.
   */
  private async fetchJSON(url: string): Promise<RedditListing | null> {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": config.reddit.userAgent,
          Accept: "application/json",
        },
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || !ct.includes("json")) {
        // 403 + text/html is the datacenter IP block page; never .json() it.
        console.warn(
          `[reddit] bad response ${res.status} (${ct || "no content-type"}) for ${url}`,
        );
        return null;
      }
      return (await res.json()) as RedditListing;
    } catch (err) {
      console.warn(`[reddit] fetch failed for ${url}: ${String(err)}`);
      return null;
    }
  }

  /**
   * Search a single subreddit for a query within a time range, returning the
   * raw post objects (already unwrapped from the Listing envelope).
   */
  private async searchSub(
    sub: string,
    query: string,
    range: string,
    limit: number,
  ): Promise<RedditPost[]> {
    const u =
      `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json` +
      `?q=${encodeURIComponent(query)}` +
      `&restrict_sr=1&sort=top&t=${range}&limit=${Math.max(1, Math.min(100, limit))}`;
    const json = await this.fetchJSON(u);
    if (!json?.data?.children) return [];
    return json.data.children
      .filter((c) => c?.kind === "t3" && c.data?.id)
      .map((c) => c.data as RedditPost);
  }

  /** Convert a raw Reddit post into our normalized RawSignal shape. */
  private toSignal(post: RedditPost): RawSignal {
    const ups = post.ups ?? post.score ?? 0;
    const comments = post.num_comments ?? 0;
    const createdMs =
      typeof post.created_utc === "number"
        ? post.created_utc * 1000
        : Date.now();
    const permalink = post.permalink ?? "";
    const url = permalink
      ? `https://reddit.com${permalink}`
      : (post.url ?? "https://reddit.com");
    return {
      id: stableId("reddit", post.id),
      source: this.name,
      title: post.title ?? "(untitled)",
      summary: post.selftext ?? "",
      url,
      popularity: upvotesToPopularity(ups),
      engagement: { upvotes: ups, comments },
      createdAt: new Date(createdMs).toISOString(),
      tags: post.subreddit ? [post.subreddit] : [],
      raw: post,
    };
  }

  /**
   * Discover Reddit signals for the given seed topics. For each topic we query
   * every configured subreddit, dedupe posts by id, and return up to
   * `input.limit` signals (highest popularity first). Always resolves; on any
   * upstream failure it logs and contributes [].
   *
   * @param input Seed topics, soft per-source `limit`, and optional `withinHours`.
   * @returns Normalized RawSignals (possibly empty).
   */
  async discover(input: DiscoverInput): Promise<RawSignal[]> {
    const topics = input.topics?.filter(Boolean) ?? [];
    const subs = config.reddit.subreddits;
    if (topics.length === 0 || subs.length === 0) return [];

    const range = withinHoursToRange(
      input.withinHours ?? config.pipeline.withinHours,
    );
    // Per-request cap; the final list is trimmed to input.limit below.
    const perRequest = Math.max(5, Math.min(100, input.limit || 25));

    const byId = new Map<string, RawSignal>();
    try {
      // One search per (subreddit, topic). Run sequentially to respect the
      // strict ~10 req/min public-API cap and avoid 429s.
      for (const sub of subs) {
        for (const topic of topics) {
          const posts = await this.searchSub(sub, topic, range, perRequest);
          for (const post of posts) {
            if (post.over_18) continue;
            const signal = this.toSignal(post);
            const existing = byId.get(signal.id);
            // Keep the higher-popularity duplicate if the same post surfaces
            // from multiple topic queries.
            if (!existing || signal.popularity > existing.popularity) {
              byId.set(signal.id, signal);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[reddit] discover failed: ${String(err)}`);
    }

    return Array.from(byId.values())
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, Math.max(0, input.limit || byId.size));
  }
}
