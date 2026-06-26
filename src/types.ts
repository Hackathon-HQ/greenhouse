/**
 * Shared domain contract for the Idea Forge backend.
 *
 * Data flow:
 *   Source[] -> RawSignal[]  (discover)
 *   RawSignal[] -> AppIdea[]  (synthesize -> dedupe -> rank)
 *   AppIdea -> BuildArtifact  (build via Cursor)
 *
 * Every module in src/ imports types from here. Treat this file as the
 * frozen interface: changing a field here ripples across sources/pipeline/build/api.
 */

/** Where a signal came from. Extend the union when adding a new Source. */
export type SourceName = "tavily" | "reddit" | "hackernews" | string;

/**
 * A raw, un-synthesized signal scraped from a source. This is the lowest
 * common denominator every Source must produce. `popularity` is a normalized
 * 0..1 demand proxy (upvotes, points, relevance) so ranking can compare across
 * heterogeneous sources.
 */
export interface RawSignal {
  /** Stable, source-prefixed id, e.g. "reddit:t3_abc123" or "hn:39842011". */
  id: string;
  source: SourceName;
  title: string;
  /** Body text / self-text / snippet. May be empty. */
  summary: string;
  url: string;
  /** Normalized 0..1 popularity/demand proxy. */
  popularity: number;
  /** Raw upstream engagement counts, kept for transparency in the UI. */
  engagement?: {
    upvotes?: number;
    comments?: number;
    points?: number;
  };
  /** ISO 8601. */
  createdAt: string;
  /** Free-form tags/subreddit/topic the source attached. */
  tags: string[];
  /** Untouched upstream payload for debugging; never relied on downstream. */
  raw?: unknown;
}

/** A complexity/effort estimate for the auto-build step. */
export type Buildability = "trivial" | "moderate" | "ambitious";

/**
 * A synthesized, buildable product idea derived from one or more RawSignals.
 * This is the object the TikTok-style feed renders, and the input to the
 * Cursor build step.
 */
export interface AppIdea {
  /** Deterministic slug-based id, e.g. "idea-ai-recipe-remixer". */
  id: string;
  /**
   * A clear, simple product name — a real word or clean compound, NOT a forced
   * portmanteau (e.g. "Splitwise for households", not "SplitSpend").
   */
  title: string;
  /** One-sentence elevator pitch shown on the feed card. */
  pitch: string;
  /**
   * The MAIN content: a 2-4 sentence description of the idea — what it is, how
   * it works, and why it's compelling. This is the centerpiece of the feed card.
   */
  description: string;
  /** The user problem this solves. */
  problem: string;
  /** Who it's for. */
  targetUser: string;
  /** 3-6 MVP features the auto-build should attempt. */
  mvpFeatures: string[];
  /** Suggested implementation stack hint for the Cursor build. */
  suggestedStack: string[];
  /** Effort estimate. */
  buildability: Buildability;
  /** Topical tags for filtering the feed. */
  tags: string[];
  /** Composite score (see scoring weights). Higher = surface sooner. */
  score: number;
  /** Sub-scores that compose `score`, exposed for UI transparency. */
  signals: {
    /** 0..1 aggregate demand from source popularity. */
    demand: number;
    /** 0..1 how fresh/trending the underlying signals are. */
    recency: number;
    /** 0..1 how novel vs. existing saturated markets. */
    novelty: number;
    /** 0..1 inverse-complexity: how feasible a hackathon MVP is. */
    feasibility: number;
  };
  /**
   * The real user complaint/suggestion this idea came from, kept close to the
   * source's own words (near-zero paraphrase). Surfaced on the feed card so the
   * idea reads as authentic demand, not a generic pitch. Empty for heuristic ideas.
   */
  sourceQuote?: string;
  /**
   * Which discovery vein produced this idea:
   *  - "demand": something people are actively complaining about / asking for now.
   *  - "hidden-gem": a strong idea posted years ago that was never built and isn't
   *    discussed today.
   */
  intent?: "demand" | "hidden-gem";
  /** Ids of the RawSignals this idea was synthesized from. */
  sourceSignalIds: string[];
  /** Lightweight provenance for UI ("found on r/SaaS + HN"). */
  sources: SourceName[];
  createdAt: string;
}

/** Lifecycle of an auto-build. */
export type BuildStatus =
  | "queued"
  | "building"
  | "succeeded"
  | "failed"
  | "skipped";

/**
 * The output of asking Cursor to build a minimal version of an AppIdea.
 */
export interface BuildArtifact {
  ideaId: string;
  status: BuildStatus;
  /** Absolute path to the generated project on disk. */
  workdir?: string;
  /** Local dev URL if the build could be served. */
  previewUrl?: string;
  /** Relative paths of files the build produced. */
  files: string[];
  /** Human-readable build log lines (streamed to the UI). */
  logs: string[];
  /** Populated when status === "failed". */
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

/**
 * The contract every discovery source implements. Sources are pure: given a
 * query + options they return RawSignals and never mutate shared state.
 */
export interface Source {
  readonly name: SourceName;
  /** True if required credentials/config are present; false => skipped gracefully. */
  isConfigured(): boolean;
  /**
   * Fetch raw signals for a set of seed topics.
   * Must never throw for routine upstream failures — return [] and log instead.
   */
  discover(input: DiscoverInput): Promise<RawSignal[]>;
}

export interface DiscoverInput {
  /** Seed topics/keywords, e.g. ["ai tools", "developer productivity"]. */
  topics: string[];
  /** Max signals to return per source (soft cap). */
  limit: number;
  /** Only return signals newer than this many hours, when the source supports it. */
  withinHours?: number;
}

/**
 * Optional LLM provider for idea synthesis. When absent, the pipeline falls
 * back to deterministic heuristics so the whole system runs with zero LLM keys.
 */
export interface IdeaSynthesizer {
  readonly available: boolean;
  /** Turn a cluster of related signals into a single structured idea. */
  synthesize(signals: RawSignal[]): Promise<Partial<AppIdea> | null>;
}
