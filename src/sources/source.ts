/**
 * Shared primitives for discovery sources.
 *
 * Hosts the small helpers every Source implementation reuses (`clamp01`,
 * `stableId`) plus the `allSources()` registry that the discovery pipeline
 * iterates over. Each source self-reports `isConfigured()`, so the registry
 * always includes every known source and lets the caller filter.
 */
import type { Source } from "../types.js";
import { TavilySource } from "./tavily.js";
import { RedditSource } from "./reddit.js";
import { HackerNewsSource } from "./hackernews.js";

/**
 * Clamp a number into the inclusive [0, 1] range.
 *
 * Non-finite inputs (NaN / Infinity) collapse to 0 so downstream scoring
 * never has to defend against bad popularity values.
 *
 * @param n - Any number (possibly NaN/Infinity).
 * @returns A value guaranteed to be within [0, 1].
 */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Build a stable, source-prefixed id of the form `"<source>:<key>"`.
 *
 * The key is lightly sanitized (whitespace collapsed) so ids stay readable and
 * comparable across runs. Identical (source, key) pairs always yield the same id.
 *
 * @param source - The source name, e.g. "reddit".
 * @param key - A source-unique key, e.g. a post id or URL.
 * @returns A deterministic id, e.g. "reddit:t3_abc123".
 */
export function stableId(source: string, key: string): string {
  const cleanSource = String(source).trim().toLowerCase();
  const cleanKey = String(key).trim().replace(/\s+/g, "-");
  return `${cleanSource}:${cleanKey}`;
}

/**
 * The full registry of discovery sources.
 *
 * Returns one instance of every known source. Each self-reports
 * `isConfigured()`, so callers (e.g. the discovery pipeline) decide which to
 * actually run. Order reflects priority: web search, then social, then HN.
 *
 * @returns A fresh array of every Source implementation.
 */
export function allSources(): Source[] {
  return [new TavilySource(), new RedditSource(), new HackerNewsSource()];
}
