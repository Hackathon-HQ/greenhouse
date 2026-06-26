/**
 * Maps the backend's AppIdea domain object onto the frontend's ReviewSeed
 * view-model used by the Tinder-style review UI + evidence panel.
 */
import type { AppIdea, BuildArtifact, BuildStatus } from "@/lib/api";
import type { BuildStep, ReviewSeed, Source } from "@/lib/data";

/** Human relative time, e.g. "now", "12m", "5h", "3d", "2w", "4mo", "1y". */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "now";
  const diff = Date.now() - then;
  if (diff <= 0) return "now";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

/** Friendly platform label for a URL host. */
function labelFromHost(host: string): string {
  const h = host.toLowerCase();
  if (h.includes("reddit")) return "Reddit";
  if (h === "x.com" || h.endsWith(".x.com") || h.includes("twitter")) return "X";
  if (h.includes("ycombinator")) return "Hacker News";
  if (h.includes("github")) return "GitHub";
  if (h.includes("apps.apple") || h.includes("apple.com")) return "App Store";
  if (h.includes("producthunt")) return "Product Hunt";
  if (h.includes("stackoverflow")) return "Stack Overflow";
  return "Web";
}

/** Friendly label for a backend provenance string ("reddit"/"x"/...). */
function labelFromSourceName(s: string): string {
  const v = s.toLowerCase();
  if (v.includes("reddit")) return "Reddit";
  if (v === "x" || v.includes("twitter")) return "X";
  if (v.includes("hackernews") || v === "hn") return "Hacker News";
  if (v.includes("github")) return "GitHub";
  if (v.includes("tavily") || v.includes("web")) return "Web";
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Web";
}

/** Best-guess favicon host for a backend provenance string. */
function hostFromSourceName(s: string): string {
  const v = s.toLowerCase();
  if (v.includes("reddit")) return "reddit.com";
  if (v === "x" || v.includes("twitter")) return "x.com";
  if (v.includes("hackernews") || v === "hn") return "news.ycombinator.com";
  if (v.includes("github")) return "github.com";
  return "google.com";
}

/** Turn a signal URL into an evidence Source. */
function sourceFromUrl(url: string, idea: AppIdea, i: number): Source {
  const id = `${idea.id}-s${i}`;
  const quote = i === 0 ? idea.sourceQuote ?? "" : "";
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const seg = u.pathname.split("/").filter(Boolean)[0];
    const domain = seg ? `${host}/${seg}` : host;
    return { id, name: labelFromHost(host), host, age: relativeTime(idea.createdAt), quote, domain };
  } catch {
    // Not a URL — fall back to treating it as a provenance string.
    const host = hostFromSourceName(url);
    return { id, name: labelFromSourceName(url), host, age: relativeTime(idea.createdAt), quote, domain: host };
  }
}

/** Build the evidence Source[] for an idea. */
function buildSources(idea: AppIdea): Source[] {
  const ids = idea.sourceSignalIds ?? [];
  if (ids.length) {
    return ids.map((url, i) => sourceFromUrl(url, idea, i));
  }
  // No raw signal URLs: synthesize a single source from idea.sources[0].
  const name = idea.sources?.[0] ?? "web";
  const host = hostFromSourceName(name);
  return [
    {
      id: `${idea.id}-s0`,
      name: labelFromSourceName(name),
      host,
      age: relativeTime(idea.createdAt),
      quote: idea.sourceQuote ?? "",
      domain: host,
    },
  ];
}

/** Count of corroborating source signals for an idea. */
export function signalCountFor(idea: AppIdea): number {
  return idea.sourceSignalIds?.length || idea.sources?.length || 0;
}

/** Map a backend AppIdea into the frontend ReviewSeed view-model. */
export function appIdeaToSeed(idea: AppIdea): ReviewSeed {
  const signalCount = signalCountFor(idea);
  const why = [
    idea.intent === "hidden-gem"
      ? "An overlooked idea that was never built"
      : "People are actively asking for this now",
    `${signalCount} corroborating source signals`,
    `${idea.buildability} to prototype`,
    idea.targetUser ? `Built for ${idea.targetUser}` : "",
  ].filter(Boolean) as string[];

  return {
    id: idea.id,
    title: idea.title,
    confidence: Math.round((idea.score ?? 0) * 100),
    lead: idea.pitch,
    why,
    firstVersion: (idea.mvpFeatures ?? []).slice(0, 5),
    scope: idea.description,
    signalCount,
    sources: buildSources(idea),
  };
}

/** The 4 build-step labels shown on a building card, in order. */
const STEP_LABELS = [
  "Writing spec",
  "Building prototype",
  "Publishing cited.md",
  "Deploying preview",
];

/**
 * Map a BuildArtifact's status + logs onto the 4 visible build steps.
 *   queued    → spec done
 *   building  → spec + prototype done (+ cited.md if a log says "wrote"/"succeeded")
 *   succeeded → all done
 *   failed/skipped → spec done (build stalled)
 */
export function stepsFromArtifact(a: BuildArtifact): BuildStep[] {
  const logText = (a.logs ?? []).join("\n").toLowerCase();
  const wrote = logText.includes("wrote") || logText.includes("succeeded");
  let doneCount: number;
  switch (a.status) {
    case "queued":
      doneCount = 1;
      break;
    case "building":
      doneCount = wrote ? 3 : 2;
      break;
    case "succeeded":
      doneCount = 4;
      break;
    case "failed":
    case "skipped":
    default:
      doneCount = 1;
      break;
  }
  return STEP_LABELS.map((label, i) => ({ label, done: i < doneCount }));
}

export function isTerminalBuild(status: BuildStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "skipped";
}
