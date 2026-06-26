/**
 * Idea deduplication.
 *
 * After synthesis, distinct signal clusters can yield near-identical ideas
 * (same product described slightly differently). This module merges those
 * near-duplicates so the feed shows each concept once, combining provenance
 * (sourceSignalIds + sources) from every contributing idea.
 */
import type { AppIdea } from "../types.js";

/** Lowercase, split on non-alphanumerics, drop very short tokens. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

/** Jaccard similarity of two token sets (0..1). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Union of two arrays preserving order and uniqueness. */
function unionArrays<T>(a: readonly T[], b: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of [...a, ...b]) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Build a comparable signature for an idea from its title + tags.
 */
function ideaTokens(idea: AppIdea): Set<string> {
  return tokenize(`${idea.title} ${idea.tags.join(" ")}`);
}

/**
 * Merge near-duplicate ideas by title/tag similarity.
 *
 * Two ideas are considered duplicates when the Jaccard similarity of their
 * title+tag token sets meets the threshold (~0.5). When merging, the earlier
 * (kept) idea absorbs the other's sourceSignalIds, sources and tags, and keeps
 * the longer/richer textual fields. Scores are left untouched here — ranking
 * runs afterwards.
 *
 * @param ideas Candidate ideas, possibly containing near-duplicates.
 * @returns A new array with duplicates merged into representative ideas.
 */
export function dedupeIdeas(ideas: AppIdea[]): AppIdea[] {
  const threshold = 0.5;
  const kept: AppIdea[] = [];
  const keptTokens: Set<string>[] = [];

  for (const idea of ideas) {
    const tokens = ideaTokens(idea);
    let mergedInto = -1;

    for (let i = 0; i < kept.length; i++) {
      const sameId = kept[i].id === idea.id;
      if (sameId || jaccard(tokens, keptTokens[i]) >= threshold) {
        mergedInto = i;
        break;
      }
    }

    if (mergedInto === -1) {
      // Clone so we never mutate the caller's objects.
      kept.push({
        ...idea,
        mvpFeatures: [...idea.mvpFeatures],
        suggestedStack: [...idea.suggestedStack],
        tags: [...idea.tags],
        sourceSignalIds: [...idea.sourceSignalIds],
        sources: [...idea.sources],
      });
      keptTokens.push(tokens);
      continue;
    }

    // Merge provenance into the representative idea.
    const target = kept[mergedInto];
    target.sourceSignalIds = unionArrays(
      target.sourceSignalIds,
      idea.sourceSignalIds,
    );
    target.sources = unionArrays(target.sources, idea.sources);
    target.tags = unionArrays(target.tags, idea.tags);
    target.mvpFeatures = unionArrays(target.mvpFeatures, idea.mvpFeatures).slice(
      0,
      6,
    );
    target.suggestedStack = unionArrays(
      target.suggestedStack,
      idea.suggestedStack,
    );

    // Prefer the richer textual fields.
    if (idea.pitch.length > target.pitch.length) target.pitch = idea.pitch;
    if (idea.problem.length > target.problem.length)
      target.problem = idea.problem;
    if (idea.targetUser.length > target.targetUser.length)
      target.targetUser = idea.targetUser;

    // Keep the earliest createdAt as the canonical discovery time.
    if (idea.createdAt < target.createdAt) target.createdAt = idea.createdAt;

    keptTokens[mergedInto] = ideaTokens(target);
  }

  return kept;
}
