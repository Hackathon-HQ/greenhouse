/**
 * Discovery orchestrator.
 *
 * Ties the whole pipeline together:
 *   sources -> RawSignal[] -> cluster -> synthesize -> dedupe -> rank -> slice
 *
 * This is the single entry point the API and CLI call to produce a ranked feed
 * of buildable app ideas from live web/social signals.
 */
import type { AppIdea, DiscoverInput, RawSignal } from "../types.js";
import { config } from "../config.js";
import { allSources } from "../sources/source.js";
import { clusterSignals } from "./cluster.js";
import { makeSynthesizer, signalsToIdea } from "./synthesize.js";
import { dedupeIdeas } from "./dedupe.js";
import { rankIdeas } from "./rank.js";
import { agenticAvailable, runAgenticDiscovery } from "../agent/discover-agent.js";

/**
 * Run discovery, preferring the AGENTIC scout (umans.ai + Tavily MCP + Reddit/HN
 * tools) and falling back to the deterministic heuristic pipeline when the
 * agent is unavailable or returns nothing.
 *
 * @param input Optional overrides; `topics` defaults to config.defaultTopics.
 * @param onLog Optional progress sink (agent tool calls, emitted ideas).
 * @returns Ranked AppIdeas (best first), capped at config.pipeline.maxIdeas.
 */
export async function runDiscovery(
  input?: Partial<DiscoverInput>,
  onLog: (line: string) => void = () => {},
  onIdea?: (idea: AppIdea) => void,
): Promise<AppIdea[]> {
  if (agenticAvailable()) {
    try {
      const ideas = await runAgenticDiscovery(input, onLog, undefined, onIdea);
      if (ideas.length > 0) return ideas;
      console.warn(
        "[discover] agentic scout returned no ideas; falling back to heuristic pipeline.",
      );
    } catch (err) {
      console.warn(
        "[discover] agentic scout failed; falling back to heuristic pipeline:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return runHeuristicDiscovery(input);
}

/**
 * Deterministic fallback: fetch signals from every configured source in
 * parallel, cluster, synthesize one idea per cluster, dedupe, rank, and return
 * the top `config.pipeline.maxIdeas`. Requires no LLM key.
 *
 * @param input Optional overrides; `topics` defaults to config.defaultTopics.
 */
export async function runHeuristicDiscovery(
  input?: Partial<DiscoverInput>,
): Promise<AppIdea[]> {
  const topics =
    input?.topics && input.topics.length > 0
      ? input.topics
      : [...config.defaultTopics];
  const limit = input?.limit ?? config.pipeline.perSourceLimit;
  const withinHours = input?.withinHours ?? config.pipeline.withinHours;

  const discoverInput: DiscoverInput = { topics, limit, withinHours };

  const sources = allSources().filter((s) => s.isConfigured());

  // Fetch from all sources concurrently; isolate per-source failures.
  const settled = await Promise.allSettled(
    sources.map((s) => s.discover(discoverInput)),
  );

  const signals: RawSignal[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      signals.push(...result.value);
    } else {
      console.warn(
        `[discover] source "${sources[i]?.name}" failed:`,
        result.reason,
      );
    }
  }

  if (signals.length === 0) {
    console.warn(
      "[discover] no signals collected from any source; returning empty feed.",
    );
    return [];
  }

  // Group related signals, then synthesize one idea per cluster.
  const clusters = clusterSignals(signals);
  const synth = makeSynthesizer();

  const ideaResults = await Promise.allSettled(
    clusters.map((cluster) => signalsToIdea(cluster, synth)),
  );

  const ideas: AppIdea[] = [];
  for (const result of ideaResults) {
    if (result.status === "fulfilled") {
      ideas.push(result.value);
    } else {
      console.warn("[discover] idea synthesis failed:", result.reason);
    }
  }

  const deduped = dedupeIdeas(ideas);
  const ranked = rankIdeas(deduped);
  const top = ranked.slice(0, config.pipeline.maxIdeas);

  console.info(
    `[discover] ${signals.length} signals from ${sources.length} source(s) -> ` +
      `${clusters.length} cluster(s) -> ${ideas.length} idea(s) -> ` +
      `${deduped.length} after dedupe -> returning top ${top.length}.`,
  );

  return top;
}
