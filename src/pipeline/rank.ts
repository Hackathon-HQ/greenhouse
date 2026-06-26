/**
 * Idea ranking.
 *
 * Computes the four transparency sub-scores (demand, recency, novelty,
 * feasibility) for each AppIdea and combines them into a single composite
 * `score` using the tunable weights in config. AppIdea does not carry raw
 * popularity, so demand is approximated from provenance breadth (how many
 * signals and how many distinct sources backed the idea).
 */
import type { AppIdea, Buildability } from "../types.js";
import { config } from "../config.js";

/** Clamp a number into the 0..1 range. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Map a buildability estimate to a feasibility sub-score. */
function feasibilityFor(buildability: Buildability): number {
  switch (buildability) {
    case "trivial":
      return 1;
    case "moderate":
      return 0.6;
    case "ambitious":
      return 0.3;
    default:
      return 0.5;
  }
}

/**
 * Demand proxy from provenance breadth.
 *
 * More backing signals and more distinct sources => stronger demand. Both
 * components saturate (log-ish via x/(x+k)) so a single viral thread can't
 * fully max the score while cross-source corroboration is rewarded.
 */
function demandFor(idea: AppIdea): number {
  const signalCount = idea.sourceSignalIds.length;
  const distinctSources = new Set(idea.sources).size;

  const volume = signalCount / (signalCount + 3); // 0..1, saturates
  const diversity = distinctSources / 3; // 3 sources => full diversity

  return clamp01(0.6 * volume + 0.4 * clamp01(diversity));
}

/**
 * Recency from createdAt freshness, decaying over the configured window.
 *
 * Fresh (just discovered) => ~1; older than the pipeline's withinHours window
 * => ~0. Linear decay keeps it interpretable.
 */
function recencyFor(idea: AppIdea, now: number): number {
  const created = Date.parse(idea.createdAt);
  if (!Number.isFinite(created)) return 0.5;
  const ageHours = (now - created) / (1000 * 60 * 60);
  if (ageHours <= 0) return 1;
  const window = Math.max(1, config.pipeline.withinHours);
  return clamp01(1 - ageHours / window);
}

/**
 * Novelty as inverse keyword saturation.
 *
 * Ideas riding crowded, generic buzzwords ("ai", "app", "platform") read as
 * less novel; richer, more specific tag/feature vocabulary reads as more
 * novel. A simple heuristic: reward the count of distinct, non-generic tokens
 * across tags + features.
 */
const SATURATED = new Set([
  "ai",
  "app",
  "tool",
  "tools",
  "platform",
  "saas",
  "web",
  "online",
  "smart",
  "automation",
  "no",
  "code",
  "nocode",
  "the",
  "and",
  "for",
]);

function noveltyFor(idea: AppIdea): number {
  const tokens = `${idea.tags.join(" ")} ${idea.mvpFeatures.join(" ")}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

  if (tokens.length === 0) return 0.4;

  const distinct = new Set(tokens);
  let saturatedHits = 0;
  let specific = 0;
  for (const t of distinct) {
    if (SATURATED.has(t)) saturatedHits++;
    else specific++;
  }

  const saturation = saturatedHits / distinct.size; // 0..1 (more generic)
  const specificity = clamp01(specific / 8); // ~8 specific tokens => rich

  return clamp01(0.5 * (1 - saturation) + 0.5 * specificity);
}

/**
 * Compute sub-scores and the weighted composite score for a single idea.
 *
 * Mutates a shallow clone (not the input) and returns it. demand/recency/
 * novelty/feasibility are each 0..1; `score` is their config.weights-weighted
 * sum.
 *
 * @param idea The idea to score (its existing score/signals are recomputed).
 * @returns A new AppIdea with populated `signals` and `score`.
 */
export function scoreIdea(idea: AppIdea): AppIdea {
  const now = Date.now();

  const demand = demandFor(idea);
  const recency = recencyFor(idea, now);
  const novelty = noveltyFor(idea);
  const feasibility = feasibilityFor(idea.buildability);

  const { weights } = config;
  const score =
    weights.demand * demand +
    weights.recency * recency +
    weights.novelty * novelty +
    weights.feasibility * feasibility;

  return {
    ...idea,
    signals: { demand, recency, novelty, feasibility },
    score: clamp01(score),
  };
}

/**
 * Score every idea and return them sorted by descending composite score.
 *
 * @param ideas Ideas to rank.
 * @returns A new array, highest-scoring first.
 */
export function rankIdeas(ideas: AppIdea[]): AppIdea[] {
  return ideas.map(scoreIdea).sort((a, b) => b.score - a.score);
}
