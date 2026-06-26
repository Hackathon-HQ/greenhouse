/**
 * Idea synthesis: turn a cluster of related RawSignals into one structured,
 * compelling AppIdea.
 *
 * Two layers:
 *   1. A deterministic HEURISTIC base (simple NLP: tokenize → stopword removal →
 *      keyword frequency) that always produces a complete, genuinely useful idea
 *      with zero external dependencies and zero API keys.
 *   2. An optional Anthropic LLM synthesizer that, when an API key is present,
 *      enriches the idea by calling the Messages API and returns Partial<AppIdea>.
 *      Any failure degrades gracefully to the heuristic base.
 *
 * `signalsToIdea` merges the (optional) LLM output over the heuristic base and
 * always returns a fully-populated AppIdea. Score and sub-signals are left at
 * zero — rank.ts fills those.
 */
import { config } from "../config.js";
import type {
  AppIdea,
  Buildability,
  IdeaSynthesizer,
  RawSignal,
  SourceName,
} from "../types.js";
import { tokenize } from "./cluster.js";

// ---------------------------------------------------------------------------
// Small NLP helpers
// ---------------------------------------------------------------------------

/** Keyword indicators that push an idea toward higher build complexity. */
const AMBITIOUS_HINTS = [
  "ai", "ml", "llm", "gpt", "realtime", "real-time", "blockchain", "crypto",
  "video", "stream", "streaming", "3d", "ar", "vr", "ml", "vision", "voice",
  "recommendation", "marketplace", "payments", "multiplayer", "p2p",
];

/** Keyword indicators of a simple, scoped CRUD-style build. */
const TRIVIAL_HINTS = [
  "list", "tracker", "todo", "notes", "checklist", "timer", "calculator",
  "directory", "bookmark", "log", "journal", "reminder",
];

/**
 * Rank keywords across a cluster by frequency, weighting title tokens more
 * heavily than body tokens (titles are denser signal).
 *
 * @returns Keywords ordered most → least salient.
 */
function rankedKeywords(cluster: RawSignal[]): string[] {
  const freq = new Map<string, number>();
  const bump = (token: string, weight: number) =>
    freq.set(token, (freq.get(token) ?? 0) + weight);

  for (const signal of cluster) {
    for (const t of tokenize(signal.title)) bump(t, 3);
    for (const t of tokenize(signal.summary)) bump(t, 1);
    // Fold the source-provided tags in as mild keyword signal too.
    for (const tag of signal.tags) {
      for (const t of tokenize(tag)) bump(t, 2);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token]) => token);
}

/** Title-case a single token. */
function titleCase(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}

/** Slugify text into an `idea-…` id, e.g. "AI Recipe Remixer" → "idea-ai-recipe-remixer". */
function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `idea-${slug || "untitled"}`;
}

/** Distinct source names that contributed to a cluster, in first-seen order. */
function clusterSources(cluster: RawSignal[]): SourceName[] {
  const seen = new Set<SourceName>();
  for (const s of cluster) seen.add(s.source);
  return [...seen];
}

// ---------------------------------------------------------------------------
// Heuristic synthesis
// ---------------------------------------------------------------------------

/**
 * Infer a target-user persona from the dominant keywords/tags.
 */
function deriveTargetUser(keywords: string[]): string {
  const has = (...ws: string[]) => ws.some((w) => keywords.includes(w));
  if (has("developer", "dev", "code", "coding", "api", "webdev", "programmer"))
    return "developers and technical builders";
  if (has("saas", "startup", "founder", "founders", "indie", "entrepreneur"))
    return "indie founders and SaaS builders";
  if (has("design", "designer", "ux", "ui", "creative"))
    return "designers and product teams";
  if (has("market", "marketing", "growth", "seo", "content", "social"))
    return "marketers and growth teams";
  if (has("student", "learn", "study", "course", "education"))
    return "students and self-learners";
  if (has("finance", "money", "budget", "invest", "expense"))
    return "personal-finance-conscious individuals";
  const topic = keywords[0] ?? "this space";
  return `people actively working with ${topic}`;
}

/**
 * Pick a punchy product-type suffix based on the cluster's intent keywords.
 */
function deriveSuffix(keywords: string[]): string {
  const has = (...ws: string[]) => ws.some((w) => keywords.includes(w));
  if (has("track", "tracker", "monitor", "log")) return "Tracker";
  if (has("learn", "course", "study", "education")) return "Academy";
  if (has("automate", "automation", "workflow", "bot")) return "Autopilot";
  if (has("manage", "organize", "dashboard")) return "Hub";
  if (has("generate", "create", "ai", "writer", "content")) return "Studio";
  if (has("connect", "community", "network", "social")) return "Network";
  return "Hub";
}

/**
 * Build a deterministic, complete AppIdea base from the signals alone.
 * Every field is derived from extracted keywords so the output is reproducible
 * and never empty.
 */
function heuristicBase(cluster: RawSignal[]): Omit<
  AppIdea,
  "id" | "score" | "signals" | "sourceSignalIds" | "sources" | "createdAt"
> {
  const keywords = rankedKeywords(cluster);
  const top = keywords.slice(0, 6);
  const kw = (i: number, fallback: string): string => top[i] ?? fallback;

  // Title: top 1-2 keywords + an intent-driven product suffix.
  const namePart = top
    .slice(0, top.length >= 2 ? 2 : 1)
    .map(titleCase)
    .join(" ");
  const title = (namePart ? `${namePart} ${deriveSuffix(keywords)}` : "Insight Hub").trim();

  const targetUser = deriveTargetUser(keywords);
  const focus = kw(0, "this workflow");
  const secondary = kw(1, "everyday tasks");

  const pitch = `A focused tool that helps ${targetUser} tame ${focus} and ${secondary} without the usual busywork.`;

  const sourceLabel = clusterSources(cluster).join(" + ") || "the web";
  const problem = `Across ${sourceLabel}, ${targetUser} repeatedly hit friction around ${focus}${
    top[1] ? ` and ${secondary}` : ""
  } — today it's scattered across tabs, notes, and one-off hacks with no purpose-built solution.`;

  // 3-6 concrete MVP features, templated off the strongest keywords.
  const featurePool = [
    `Capture and organize ${focus} in one structured place`,
    `Smart search and filtering across your ${focus} items`,
    `One-click ${secondary} summaries and exports`,
    `Templates and presets to get started with ${focus} fast`,
    `Notifications when new ${focus} activity needs attention`,
    `Shareable ${focus} dashboards for your team`,
  ];
  const mvpFeatures = featurePool.slice(0, Math.min(6, Math.max(3, top.length + 2)));

  // Stack: solid default, plus an AI layer when the domain calls for it.
  const aiFlavored = keywords.some((k) => AMBITIOUS_HINTS.includes(k));
  const suggestedStack = aiFlavored
    ? ["Next.js", "TypeScript", "Tailwind CSS", "SQLite", "Anthropic API"]
    : ["Next.js", "TypeScript", "Tailwind CSS", "SQLite"];

  // Tags: source tags ∪ top keywords, deduped + capped.
  const tagSet = new Set<string>();
  for (const s of cluster)
    for (const t of s.tags) {
      const norm = t.toLowerCase().trim();
      if (norm) tagSet.add(norm);
    }
  for (const k of top) tagSet.add(k);
  const tags = [...tagSet].slice(0, 8);

  const description = `${pitch} Built for ${targetUser.toLowerCase()}, it focuses on ${mvpFeatures
    .slice(0, 3)
    .join(", ")
    .toLowerCase()}.`;

  return {
    title,
    pitch,
    description,
    problem,
    targetUser,
    mvpFeatures,
    suggestedStack,
    buildability: estimateBuildability(keywords, mvpFeatures.length),
    tags,
  };
}

/**
 * Estimate hackathon-MVP effort from keyword complexity + feature count.
 */
function estimateBuildability(
  keywords: string[],
  featureCount: number,
): Buildability {
  const ambitiousScore = keywords.filter((k) =>
    AMBITIOUS_HINTS.includes(k),
  ).length;
  const trivialScore = keywords.filter((k) => TRIVIAL_HINTS.includes(k)).length;

  if (ambitiousScore >= 2 || (ambitiousScore >= 1 && featureCount >= 6))
    return "ambitious";
  if (trivialScore >= 1 && ambitiousScore === 0 && featureCount <= 4)
    return "trivial";
  return "moderate";
}

// ---------------------------------------------------------------------------
// LLM synthesizer (optional, Anthropic Messages API)
// ---------------------------------------------------------------------------

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const VALID_BUILDABILITY: ReadonlySet<string> = new Set([
  "trivial",
  "moderate",
  "ambitious",
]);

/** Compact, prompt-friendly view of a single signal. */
function describeSignal(s: RawSignal): string {
  const body = s.summary.replace(/\s+/g, " ").slice(0, 280);
  const tags = s.tags.length ? ` [tags: ${s.tags.join(", ")}]` : "";
  return `- (${s.source}, popularity ${s.popularity.toFixed(
    2,
  )}) ${s.title}${tags}${body ? `\n    ${body}` : ""}`;
}

/**
 * Pull the first JSON object out of an LLM text response, tolerating fenced
 * code blocks and surrounding prose.
 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Coerce an unknown value into a clean string[] (trimmed, non-empty). */
function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
}

/**
 * Validate/sanitize a raw parsed object into a Partial<AppIdea>, keeping only
 * recognized, well-typed fields. Returns null if nothing usable was produced.
 */
function sanitizeIdea(raw: unknown): Partial<AppIdea> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<AppIdea> = {};

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

  if (str(o.title)) out.title = str(o.title);
  if (str(o.pitch)) out.pitch = str(o.pitch);
  if (str(o.problem)) out.problem = str(o.problem);
  if (str(o.targetUser)) out.targetUser = str(o.targetUser);

  const mvp = asStringArray(o.mvpFeatures);
  if (mvp) out.mvpFeatures = mvp.slice(0, 6);

  const stack = asStringArray(o.suggestedStack);
  if (stack) out.suggestedStack = stack;

  const tags = asStringArray(o.tags);
  if (tags) out.tags = tags.map((t) => t.toLowerCase()).slice(0, 10);

  if (typeof o.buildability === "string" && VALID_BUILDABILITY.has(o.buildability))
    out.buildability = o.buildability as Buildability;

  return Object.keys(out).length ? out : null;
}

/**
 * Build an LLM synthesizer backed by the Anthropic Messages API.
 * Called via raw `fetch` (no SDK dependency in this module).
 */
function createAnthropicSynthesizer(apiKey: string, model: string): IdeaSynthesizer {
  return {
    available: true,
    async synthesize(signals: RawSignal[]): Promise<Partial<AppIdea> | null> {
      if (signals.length === 0) return null;

      const system =
        "You are a sharp product strategist for a hackathon idea engine. " +
        "Given a cluster of related web/social signals describing a real user " +
        "need, distill ONE compelling, buildable app idea. Respond with ONLY a " +
        "single JSON object (no prose, no markdown fences) using exactly these " +
        'keys: "title" (punchy product name), "pitch" (one sentence), ' +
        '"problem" (the underlying user problem), "targetUser" (who it is for), ' +
        '"mvpFeatures" (array of 3-6 concrete features), "suggestedStack" ' +
        '(array of technologies), "tags" (array of short lowercase topic tags), ' +
        '"buildability" (one of "trivial", "moderate", "ambitious"). Keep it ' +
        "concrete and grounded in the signals.";

      const userContent =
        "Signals in this cluster:\n" +
        signals.map(describeSignal).join("\n") +
        "\n\nReturn the JSON object now.";

      try {
        const res = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            system,
            messages: [{ role: "user", content: userContent }],
          }),
        });

        if (!res.ok) {
          console.warn(
            `[synthesize] Anthropic API returned ${res.status} ${res.statusText}`,
          );
          return null;
        }

        const data = (await res.json()) as {
          content?: Array<{ type?: string; text?: string }>;
          stop_reason?: string;
        };

        if (data.stop_reason === "refusal") {
          console.warn("[synthesize] Anthropic declined the request (refusal).");
          return null;
        }

        const text = (data.content ?? [])
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text!)
          .join("\n");

        if (!text.trim()) return null;
        return sanitizeIdea(extractJson(text));
      } catch (err) {
        console.warn(
          `[synthesize] Anthropic call failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      }
    },
  };
}

/**
 * Construct the active idea synthesizer.
 *
 * Returns an LLM-backed synthesizer when `config.anthropic.apiKey` is set,
 * otherwise an inert synthesizer (`available: false`) so the pipeline runs on
 * pure heuristics with no LLM key.
 */
export function makeSynthesizer(): IdeaSynthesizer {
  if (config.anthropic.apiKey) {
    return createAnthropicSynthesizer(
      config.anthropic.apiKey,
      config.anthropic.model,
    );
  }
  return {
    available: false,
    async synthesize(): Promise<Partial<AppIdea> | null> {
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Merge a sanitized LLM partial over the heuristic base (only non-empty wins). */
function mergeIdea(
  base: ReturnType<typeof heuristicBase>,
  llm: Partial<AppIdea> | null,
): ReturnType<typeof heuristicBase> {
  if (!llm) return base;
  return {
    title: llm.title ?? base.title,
    pitch: llm.pitch ?? base.pitch,
    description: llm.description ?? base.description,
    problem: llm.problem ?? base.problem,
    targetUser: llm.targetUser ?? base.targetUser,
    mvpFeatures:
      llm.mvpFeatures && llm.mvpFeatures.length >= 3
        ? llm.mvpFeatures
        : base.mvpFeatures,
    suggestedStack:
      llm.suggestedStack && llm.suggestedStack.length
        ? llm.suggestedStack
        : base.suggestedStack,
    buildability: llm.buildability ?? base.buildability,
    tags: llm.tags && llm.tags.length ? llm.tags : base.tags,
  };
}

/**
 * Turn a cluster of related signals into a complete AppIdea.
 *
 * Always derives a deterministic heuristic base from the signals, then attempts
 * to enrich it with the synthesizer (if available); any synthesizer failure is
 * transparent. The returned idea is fully populated with a slug-based id,
 * provenance (sourceSignalIds/sources), and createdAt. `score` is 0 and the
 * `signals` sub-scores are zeroed — rank.ts fills those.
 *
 * @param cluster - One or more related RawSignals.
 * @param synth - The synthesizer from {@link makeSynthesizer}.
 * @returns A complete, ready-to-rank AppIdea.
 */
export async function signalsToIdea(
  cluster: RawSignal[],
  synth: IdeaSynthesizer,
): Promise<AppIdea> {
  const base = heuristicBase(cluster);

  let llm: Partial<AppIdea> | null = null;
  if (synth.available) {
    try {
      llm = await synth.synthesize(cluster);
    } catch (err) {
      // Defensive: synthesizers must not break the pipeline.
      console.warn(
        `[synthesize] synthesizer threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      llm = null;
    }
  }

  const merged = mergeIdea(base, llm);

  return {
    id: slugify(merged.title),
    title: merged.title,
    pitch: merged.pitch,
    description: merged.description,
    problem: merged.problem,
    targetUser: merged.targetUser,
    mvpFeatures: merged.mvpFeatures,
    suggestedStack: merged.suggestedStack,
    buildability: merged.buildability,
    tags: merged.tags,
    score: 0,
    signals: { demand: 0, recency: 0, novelty: 0, feasibility: 0 },
    sourceSignalIds: cluster.map((s) => s.id),
    sources: clusterSources(cluster),
    createdAt: new Date().toISOString(),
  };
}
