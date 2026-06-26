/**
 * In-memory store powering the live feed + SSE stream.
 *
 * Holds the ranked set of discovered ideas and the latest build artifact per
 * idea, plus a tiny pub/sub layer (array-of-callbacks, no external deps) so the
 * HTTP layer can fan out updates to connected Server-Sent-Events clients.
 *
 * The store is intentionally process-local and ephemeral: restart = clean slate.
 */
import type { AppIdea, BuildArtifact } from "../types.js";

/** Options for querying the feed. */
export interface FeedOptions {
  /** Only return ideas carrying this tag (case-insensitive). */
  tag?: string;
  /** Max number of ideas to return. */
  limit?: number;
}

type IdeaListener = (ideas: AppIdea[]) => void;
type BuildListener = (artifact: BuildArtifact) => void;

class IdeaStore {
  /** Ideas keyed by id; kept ranked-on-read. */
  private readonly ideas = new Map<string, AppIdea>();
  /** Latest build artifact keyed by ideaId. */
  private readonly builds = new Map<string, BuildArtifact>();

  private readonly ideaListeners = new Set<IdeaListener>();
  private readonly buildListeners = new Set<BuildListener>();

  /**
   * Insert or update ideas, deduping by id. On collision the incoming idea
   * replaces the stored one (treated as "newest"). Notifies idea subscribers
   * with the batch that was just upserted.
   */
  upsertIdeas(ideas: AppIdea[]): void {
    if (!Array.isArray(ideas) || ideas.length === 0) return;
    const accepted: AppIdea[] = [];
    for (const idea of ideas) {
      if (!idea || typeof idea.id !== "string") continue;
      this.ideas.set(idea.id, idea);
      accepted.push(idea);
    }
    if (accepted.length > 0) this.emitIdeas(accepted);
  }

  /**
   * Return ideas sorted by descending score, optionally filtered by tag and
   * capped to `limit`.
   */
  getFeed(opts: FeedOptions = {}): AppIdea[] {
    let list = [...this.ideas.values()];
    if (opts.tag) {
      const needle = opts.tag.toLowerCase();
      list = list.filter((i) =>
        (i.tags ?? []).some((t) => t.toLowerCase() === needle),
      );
    }
    list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (typeof opts.limit === "number" && opts.limit >= 0) {
      list = list.slice(0, opts.limit);
    }
    return list;
  }

  /** Look up a single idea by id. */
  getIdea(id: string): AppIdea | undefined {
    return this.ideas.get(id);
  }

  /**
   * Store (or replace) the build artifact for an idea and notify build
   * subscribers. Called repeatedly as a build progresses (queued -> building
   * -> succeeded/failed).
   */
  setBuild(artifact: BuildArtifact): void {
    if (!artifact || typeof artifact.ideaId !== "string") return;
    this.builds.set(artifact.ideaId, artifact);
    this.emitBuild(artifact);
  }

  /** Look up the latest build artifact for an idea. */
  getBuild(ideaId: string): BuildArtifact | undefined {
    return this.builds.get(ideaId);
  }

  /**
   * Subscribe to idea upserts. Returns an unsubscribe function.
   */
  onIdea(cb: IdeaListener): () => void {
    this.ideaListeners.add(cb);
    return () => this.ideaListeners.delete(cb);
  }

  /**
   * Subscribe to build updates. Returns an unsubscribe function.
   */
  onBuild(cb: BuildListener): () => void {
    this.buildListeners.add(cb);
    return () => this.buildListeners.delete(cb);
  }

  private emitIdeas(ideas: AppIdea[]): void {
    for (const cb of this.ideaListeners) {
      try {
        cb(ideas);
      } catch (err) {
        console.warn("[store] idea listener threw:", err);
      }
    }
  }

  private emitBuild(artifact: BuildArtifact): void {
    for (const cb of this.buildListeners) {
      try {
        cb(artifact);
      } catch (err) {
        console.warn("[store] build listener threw:", err);
      }
    }
  }
}

/** Singleton store shared across the API + pipeline. */
export const store = new IdeaStore();
