/**
 * Signal clustering for the Idea Forge pipeline.
 *
 * Groups raw, heterogeneous signals into "idea clusters" using lightweight
 * keyword/title similarity (token Jaccard) so that several posts describing the
 * same underlying need collapse into a single synthesized AppIdea. No external
 * NLP deps — just tokenization + stopword removal.
 */
import type { RawSignal } from "../types.js";

/**
 * Common English + domain stopwords stripped before similarity scoring so that
 * filler words ("the", "app", "need") don't dominate the Jaccard overlap.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "to",
  "of", "in", "on", "at", "by", "with", "from", "as", "is", "are", "was",
  "were", "be", "been", "being", "this", "that", "these", "those", "it",
  "its", "i", "you", "he", "she", "we", "they", "me", "my", "your", "our",
  "their", "do", "does", "did", "doing", "have", "has", "had", "having",
  "can", "could", "should", "would", "will", "shall", "may", "might", "must",
  "not", "no", "yes", "so", "than", "too", "very", "just", "about", "into",
  "over", "after", "before", "between", "out", "up", "down", "off", "any",
  "all", "some", "more", "most", "other", "such", "only", "own", "same",
  "how", "what", "when", "where", "who", "why", "which", "there", "here",
  "get", "got", "make", "want", "need", "like", "use", "using", "way",
  "app", "apps", "application", "tool", "tools", "idea", "ideas", "build",
  "building", "looking", "anyone", "someone", "something", "really", "good",
  "best", "new", "im", "ive", "dont", "cant", "thing", "things", "help",
  "please", "thanks", "guys", "feel", "think", "know", "going", "lot",
  // Web/markup junk that leaks in from scraped URLs and HTML-escaped content.
  "http", "https", "www", "com", "org", "net", "html", "htm", "php", "amp",
  "utm", "href", "nbsp", "quot", "apos", "gt", "lt", "x2f", "x3a", "x27",
]);

/**
 * Strip URLs and HTML entity references (e.g. `&#x2F;`, `&amp;`) out of raw
 * scraped text BEFORE tokenization, so encoded punctuation can't surface as
 * junk keywords like "x2f" in synthesized idea titles.
 */
function stripWebNoise(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, " ") // bare URLs
    .replace(/&#?[a-z0-9]+;/gi, " ") // HTML entities: &amp; &#x2F; &#39; ...
    .replace(/\bwww\.\S+/g, " "); // www-prefixed links
}

/**
 * Normalize free text into a list of meaningful lowercase tokens.
 * Drops punctuation, pure numbers, short tokens (< 3 chars) and stopwords.
 *
 * @param text - Arbitrary input (title + body, etc.).
 * @returns Ordered token list (duplicates preserved for frequency counting).
 */
export function tokenize(text: string): string[] {
  return stripWebNoise(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (t) =>
        t.length >= 3 &&
        !STOPWORDS.has(t) &&
        !/^\d+$/.test(t) &&
        // Drop alphanumeric hash-like junk (e.g. "x2f", "a1b2c3"): tokens that
        // mix letters and digits and aren't a clean word.
        !(/\d/.test(t) && /[a-z]/.test(t) && t.length <= 4),
    );
}

/** Jaccard similarity between two token sets: |A ∩ B| / |A ∪ B|. */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Internal accumulator used while greedily growing clusters. */
interface Cluster {
  /** Token set of the seed signal — kept stable to avoid topic drift. */
  seed: Set<string>;
  members: RawSignal[];
}

/** Minimum token overlap for two signals to be considered the same idea. */
const SIMILARITY_THRESHOLD = 0.3;

/**
 * Cluster related signals into idea-groups by title/keyword similarity.
 *
 * Uses single-pass greedy clustering: each signal joins the most similar
 * existing cluster whose seed similarity clears {@link SIMILARITY_THRESHOLD},
 * otherwise it founds a new cluster. Comparison is against each cluster's seed
 * (first member) rather than a growing centroid, which keeps clusters tight and
 * prevents unrelated signals from chaining together. Singletons are allowed.
 *
 * @param signals - Flat list of raw signals from all sources.
 * @returns Array of clusters; every input signal appears in exactly one.
 */
export function clusterSignals(signals: RawSignal[]): RawSignal[][] {
  const clusters: Cluster[] = [];

  for (const signal of signals) {
    const tokens = new Set(tokenize(`${signal.title} ${signal.summary}`));

    let bestCluster: Cluster | null = null;
    let bestScore = SIMILARITY_THRESHOLD;
    for (const cluster of clusters) {
      const score = jaccard(tokens, cluster.seed);
      if (score >= bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      bestCluster.members.push(signal);
    } else {
      clusters.push({ seed: tokens, members: [signal] });
    }
  }

  return clusters.map((c) => c.members);
}
