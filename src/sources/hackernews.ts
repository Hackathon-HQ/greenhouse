/**
 * HackerNews discovery source.
 *
 * Mines the HackerNews Algolia Search API (https://hn.algolia.com/api/v1) for
 * recent, traction-bearing stories and Show HN posts matching the seed topics.
 * No auth or API key is required, so this source is always "configured".
 *
 * Each HN hit is normalized into a {@link RawSignal} with a log-scaled,
 * clamped popularity derived from story points. All upstream/network failures
 * are caught and logged — discover never throws for routine failures.
 */
import type {
  DiscoverInput,
  RawSignal,
  Source,
  SourceName,
} from "../types.js";
import { clamp01, stableId } from "./source.js";

/** Base URL for the HN Algolia Search API (HTTPS preferred). */
const HN_API_BASE = "https://hn.algolia.com/api/v1";

/** Shape of a single Algolia search hit we rely on (others ignored). */
interface HnHit {
  objectID: string;
  title?: string | null;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  author?: string | null;
  created_at?: string | null;
  created_at_i?: number | null;
  story_text?: string | null;
}

interface HnSearchResponse {
  hits?: HnHit[];
}

/**
 * Strip HTML tags/entities from Algolia `story_text` (which is HTML-escaped)
 * so the resulting summary is plain readable text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Log-scale a HN point count into a normalized 0..1 popularity proxy.
 * ~3 points -> ~0.16, ~100 points -> ~0.66, ~1000 points -> ~1.0.
 */
function pointsToPopularity(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return clamp01(Math.log10(points + 1) / 3);
}

/** Convert a raw Algolia hit into a RawSignal, or null if unusable. */
function hitToSignal(hit: HnHit): RawSignal | null {
  if (!hit?.objectID) return null;
  const title = (hit.title ?? "").trim();
  if (!title) return null;

  const points = typeof hit.points === "number" ? hit.points : 0;
  const comments =
    typeof hit.num_comments === "number" ? hit.num_comments : 0;
  const permalink = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const createdAt = hit.created_at
    ? new Date(hit.created_at).toISOString()
    : typeof hit.created_at_i === "number"
      ? new Date(hit.created_at_i * 1000).toISOString()
      : new Date().toISOString();

  return {
    id: stableId("hn", hit.objectID),
    source: "hackernews",
    title,
    summary: hit.story_text ? stripHtml(hit.story_text) : "",
    url: (hit.url ?? "").trim() || permalink,
    popularity: pointsToPopularity(points),
    engagement: { points, comments },
    createdAt,
    tags: ["hackernews"],
    raw: hit,
  };
}

/** Fetch and parse a single Algolia search URL, tolerating failures. */
async function fetchHits(url: string): Promise<HnHit[]> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`HN API ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as HnSearchResponse;
  return Array.isArray(json.hits) ? json.hits : [];
}

export class HackerNewsSource implements Source {
  readonly name: SourceName = "hackernews";

  /** The public HN Algolia API needs no credentials. */
  isConfigured(): boolean {
    return true;
  }

  /**
   * Discover HN signals for the given seed topics.
   *
   * For each topic we run two queries: relevance-ranked recent stories with
   * traction (`points>20`) and newest-first Show HN posts. Results are deduped
   * by HN id, sorted by popularity, and soft-capped at `input.limit`.
   */
  async discover(input: DiscoverInput): Promise<RawSignal[]> {
    const topics = input.topics.filter(Boolean);
    if (topics.length === 0) return [];

    const limit = Math.max(1, input.limit);
    const windowHours = input.withinHours ?? 30 * 24;
    const since = Math.floor(Date.now() / 1000) - windowHours * 60 * 60;
    // Cap per-query fetch so one source can't flood the pipeline.
    const perQuery = Math.min(50, Math.max(10, limit));

    const byId = new Map<string, RawSignal>();

    for (const topic of topics) {
      const q = encodeURIComponent(topic);
      // Note: only `created_at_i` is filterable via numericFilters on this
      // index; `points`/`num_comments` are NOT (the API 400s on them), so we
      // apply the traction threshold client-side below.
      const storyUrl =
        `${HN_API_BASE}/search?query=${q}&tags=story` +
        `&numericFilters=created_at_i>${since}` +
        `&hitsPerPage=${perQuery}`;
      const showUrl =
        `${HN_API_BASE}/search_by_date?query=${q}&tags=show_hn` +
        `&numericFilters=created_at_i>${since}` +
        `&hitsPerPage=${perQuery}`;

      const results = await Promise.allSettled([
        fetchHits(storyUrl).then((hits) =>
          // Keep only stories with real traction; Show HN posts are kept
          // regardless since fresh launches are valuable signal.
          hits.filter((h) => (h.points ?? 0) > 20),
        ),
        fetchHits(showUrl),
      ]);

      for (const r of results) {
        if (r.status !== "fulfilled") {
          console.warn(
            `[hackernews] query "${topic}" failed:`,
            r.reason instanceof Error ? r.reason.message : r.reason,
          );
          continue;
        }
        for (const hit of r.value) {
          const signal = hitToSignal(hit);
          if (!signal) continue;
          const existing = byId.get(signal.id);
          // Keep the higher-popularity variant when the same story appears
          // in both the story and Show HN result sets.
          if (!existing || signal.popularity > existing.popularity) {
            byId.set(signal.id, signal);
          }
        }
      }
    }

    return Array.from(byId.values())
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, limit);
  }
}
