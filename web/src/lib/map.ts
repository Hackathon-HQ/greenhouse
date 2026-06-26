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
    return { id, name: labelFromHost(host), host, url, age: relativeTime(idea.createdAt), quote, domain };
  } catch {
    // Not a URL — fall back to treating it as a provenance string.
    const host = hostFromSourceName(url);
    return { id, name: labelFromSourceName(url), host, url, age: relativeTime(idea.createdAt), quote, domain: host };
  }
}

/** Turn a real evidence item (url + verbatim quote + provenance) into a Source. */
function sourceFromEvidence(
  e: { url: string; quote: string; source: string },
  idea: AppIdea,
  i: number,
): Source {
  const id = `${idea.id}-e${i}`;
  try {
    const u = new URL(e.url);
    const host = u.hostname.replace(/^www\./, "");
    const seg = u.pathname.split("/").filter(Boolean)[0];
    const domain = seg ? `${host}/${seg}` : host;
    return {
      id,
      name: labelFromHost(host),
      host,
      url: e.url,
      age: relativeTime(idea.createdAt),
      quote: e.quote ?? "",
      domain,
    };
  } catch {
    // url isn't a parseable URL — fall back to provenance string for labels.
    const host = hostFromSourceName(e.source || e.url);
    return {
      id,
      name: labelFromSourceName(e.source || e.url),
      host,
      url: e.url,
      age: relativeTime(idea.createdAt),
      quote: e.quote ?? "",
      domain: host,
    };
  }
}

/** Build the evidence Source[] for an idea. */
function buildSources(idea: AppIdea): Source[] {
  // Preferred: real evidence links (exact url paired with verbatim quote).
  const evidence = idea.evidence ?? [];
  if (evidence.length) {
    return evidence.map((e, i) => sourceFromEvidence(e, idea, i));
  }
  // Fallback: derive sources from the raw signal URLs.
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
      url: `https://${host}`,
      age: relativeTime(idea.createdAt),
      quote: idea.sourceQuote ?? "",
      domain: host,
    },
  ];
}

/** Count of corroborating source signals for an idea. */
export function signalCountFor(idea: AppIdea): number {
  return idea.evidence?.length || idea.sourceSignalIds?.length || idea.sources?.length || 0;
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

/** The 3 build-step labels shown on a building card, in order. */
const STEP_LABELS = ["Publishing cited.md", "Deploying preview"];

/**
 * Map a BuildArtifact's status + logs onto the visible post-build steps. The
 * live cursor console is the "building" indicator, so the steps only track the
 * publish/deploy stages.
 *   queued/building → nothing done; once a log says "publishing cited.md",
 *                     that step goes done and "Deploying preview" is active
 *   succeeded → all done
 *   failed/skipped → nothing marked done
 */
export function stepsFromArtifact(a: BuildArtifact): BuildStep[] {
  const logText = (a.logs ?? []).join("\n").toLowerCase();
  let doneCount: number;
  switch (a.status) {
    case "succeeded":
      doneCount = STEP_LABELS.length;
      break;
    case "building":
      doneCount =
        logText.includes("deploy") ? 1 : logText.includes("cited.md") ? 1 : 0;
      break;
    case "queued":
    case "failed":
    case "skipped":
    default:
      doneCount = 0;
      break;
  }
  return STEP_LABELS.map((label, i) => ({ label, done: i < doneCount }));
}

/**
 * Return the last meaningful build log line, cleaned for display: strips the
 * leading channel prefix ([build] / [cursor] / [cursor:stdout] / [cursor:stderr]),
 * skips empty lines, collapses whitespace and caps the length.
 */
export function latestLogLine(logs: string[]): string {
  const lines = logs ?? [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const cleaned = (lines[i] ?? "")
      .replace(/^\s*\[(?:build|cursor|cursor:stdout|cursor:stderr)\]\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;
    return cleaned.length > 90 ? `${cleaned.slice(0, 89)}…` : cleaned;
  }
  return "";
}

export function isTerminalBuild(status: BuildStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "skipped";
}
