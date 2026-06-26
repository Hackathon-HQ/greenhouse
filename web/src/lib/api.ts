/**
 * Typed client for the Idea Forge / AppTok backend.
 *
 * Base URL comes from NEXT_PUBLIC_API_URL (e.g. https://apptok.fly.dev),
 * falling back to the local dev server on :8787. CORS is open on the backend
 * so these run client-side cross-origin.
 */

export type Buildability = "trivial" | "moderate" | "ambitious";

export type BuildStatus =
  | "queued"
  | "building"
  | "succeeded"
  | "failed"
  | "skipped";

/** A synthesized, buildable product idea (mirrors backend src/types.ts AppIdea). */
export interface AppIdea {
  id: string;
  title: string;
  pitch: string;
  description: string;
  problem: string;
  targetUser: string;
  mvpFeatures: string[];
  suggestedStack: string[];
  buildability: Buildability;
  tags: string[];
  score: number;
  signals: {
    demand: number;
    recency: number;
    novelty: number;
    feasibility: number;
  };
  sourceQuote?: string;
  intent?: "demand" | "hidden-gem";
  /** URLs of the raw signals this idea came from. */
  sourceSignalIds: string[];
  /** Platform provenance strings, e.g. "reddit" | "x" | "hackernews" | "tavily". */
  sources: string[];
  createdAt: string;
}

/** Output of an auto-build (mirrors backend src/types.ts BuildArtifact). */
export interface BuildArtifact {
  ideaId: string;
  status: BuildStatus;
  workdir?: string;
  previewUrl?: string;
  files: string[];
  logs: string[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

const BASE =
  (process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "").trim() ||
  "http://localhost:8787";

/** The resolved API base URL (handy for debugging). */
export function apiBaseUrl(): string {
  return BASE;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`API ${res.status} ${res.statusText} for ${res.url}`);
  }
  return (await res.json()) as T;
}

/** GET /api/feed → ranked AppIdea[]. */
export async function getFeed(): Promise<AppIdea[]> {
  const res = await fetch(`${BASE}/api/feed`, {
    headers: { accept: "application/json" },
  });
  return asJson<AppIdea[]>(res);
}

/** POST /api/discover → AppIdea[] (also streams each idea via SSE as found). */
export async function discover(topics?: string[]): Promise<AppIdea[]> {
  const body = topics && topics.length ? { topics } : {};
  const res = await fetch(`${BASE}/api/discover`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  return asJson<AppIdea[]>(res);
}

/** POST /api/ideas/:id/build → 202 queued BuildArtifact (build runs async). */
export async function build(id: string): Promise<BuildArtifact> {
  const res = await fetch(`${BASE}/api/ideas/${encodeURIComponent(id)}/build`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  return asJson<BuildArtifact>(res);
}

/** GET /api/builds/:ideaId → latest BuildArtifact. */
export async function getBuild(ideaId: string): Promise<BuildArtifact> {
  const res = await fetch(`${BASE}/api/builds/${encodeURIComponent(ideaId)}`, {
    headers: { accept: "application/json" },
  });
  return asJson<BuildArtifact>(res);
}

export interface StreamHandlers {
  onIdea?: (ideas: AppIdea[]) => void;
  onBuild?: (artifact: BuildArtifact) => void;
}

/**
 * Subscribe to GET /api/stream via EventSource.
 *
 * Each message is `data: {"type":"idea"|"build","data": <...>}`. There are no
 * named events, so we parse JSON off `event.data`. The leading `: connected`
 * comment line is ignored by EventSource automatically. Idea payloads may be a
 * single AppIdea or an array; both are normalized to an array.
 *
 * Returns an unsubscribe function that closes the connection.
 */
export function subscribeStream(handlers: StreamHandlers): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => {};
  }
  const es = new EventSource(`${BASE}/api/stream`);

  es.onmessage = (ev: MessageEvent) => {
    if (!ev.data) return;
    let msg: { type?: string; data?: unknown };
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "idea" && handlers.onIdea) {
      const d = msg.data;
      const ideas = Array.isArray(d) ? d : d ? [d] : [];
      if (ideas.length) handlers.onIdea(ideas as AppIdea[]);
    } else if (msg.type === "build" && handlers.onBuild) {
      if (msg.data) handlers.onBuild(msg.data as BuildArtifact);
    }
  };

  // EventSource reconnects automatically; swallow transient errors.
  es.onerror = () => {};

  return () => es.close();
}
