/**
 * Agentic idea discovery, built on the Vercel AI SDK.
 *
 * An LLM scout (umans.ai today — see provider.ts) runs a real tool-using agent
 * loop: it searches the web (Tavily MCP), Reddit (via Tavily) and HackerNews,
 * and emits structured, evidence-grounded ideas through the `emit_idea` tool as
 * it goes. A deterministic forced-emit safety net then tops the run up to the
 * target from the gathered research, so ideas ALWAYS come out even if the scout
 * over-researches and runs out its time budget.
 *
 * Everything flows through tool-calling (which umans supports reliably) — no
 * fragile JSON/structured-output mode.
 *
 * Public entrypoint: {@link runAgenticDiscovery}.
 */
import {
  dynamicTool,
  generateText,
  jsonSchema,
  stepCountIs,
  tool,
  type ToolSet,
} from "ai";
import { z } from "zod";

import { config } from "../config.js";
import type { AppIdea, DiscoverInput, SourceName } from "../types.js";
import { rankIdeas, scoreIdea } from "../pipeline/rank.js";
import { dedupeIdeas } from "../pipeline/dedupe.js";
import { providerAvailable, scoutModel } from "./provider.js";
import { callMcpTool, getTavilyMcp } from "./mcp.js";
import { runSearchTool } from "./tools.js";
import {
  appStoreReviews,
  stackExchangeSearch,
  githubIssues,
  devtoSearch,
  lobstersSearch,
  youtubeComments,
} from "./sources-extra.js";

/** True when the agentic path is usable (provider key present + enabled). */
export function agenticAvailable(): boolean {
  return config.agent.enabled && providerAvailable();
}

/** Cap individual tool results so a single huge payload can't blow the context. */
const MAX_TOOL_RESULT_CHARS = 2200;
/** Cap the research digest handed to the forced-emit pass. */
const MAX_DIGEST_CHARS = 14000;

/** Zod schema for one emitted idea — also the `emit_idea` tool's input schema. */
const ideaSchema = z.object({
  title: z
    .string()
    .describe(
      "A clear, simple product name — a real word or clean compound. NOT a " +
        "forced portmanteau (avoid 'SplitSpend', 'CalenDough'). A plain " +
        "descriptive name like 'Household Splitwise' or 'Month-End Forecaster' is better.",
    ),
  pitch: z.string().describe("One-sentence elevator pitch."),
  description: z
    .string()
    .describe(
      "THE MAIN CONTENT: 2-4 sentences describing the idea — what it is, how it " +
        "works for the user, and why it's compelling. Concrete and vivid, grounded " +
        "in the real need. This is the centerpiece shown on the feed card.",
    ),
  problem: z.string().describe("The specific user problem it solves."),
  targetUser: z.string().describe("Who it's for."),
  mvpFeatures: z.array(z.string()).describe("3-6 concrete MVP features."),
  suggestedStack: z.array(z.string()).default([]),
  buildability: z.enum(["trivial", "moderate", "ambitious"]).default("moderate"),
  tags: z.array(z.string()).default([]),
  evidence: z
    .array(z.string())
    .default([])
    .describe("Source URLs this idea is grounded in."),
  sourceQuote: z
    .string()
    .describe(
      "The actual complaint/suggestion from the source, close to its original " +
        "wording (light cleanup only — do NOT paraphrase into a generic pitch).",
    ),
  intent: z
    .enum(["demand", "hidden-gem"])
    .describe(
      "'demand' = people ask for this now; 'hidden-gem' = a strong idea posted " +
        "years ago that was never built and isn't discussed today.",
    ),
});
type EmittedIdea = z.infer<typeof ideaSchema>;

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "untitled"
  );
}

/** Infer which sources an idea drew on from its evidence URLs. */
function inferSources(evidence: string[]): SourceName[] {
  const set = new Set<SourceName>();
  for (const url of evidence) {
    const u = url.toLowerCase();
    if (u.includes("reddit.com")) set.add("reddit");
    else if (u.includes("ycombinator")) set.add("hackernews");
    else if (u.includes("x.com") || u.includes("twitter.com")) set.add("x");
    else if (u.startsWith("http")) set.add("tavily");
  }
  return set.size ? [...set] : ["tavily"];
}

/** Coerce an emitted idea into a complete, scored-pending AppIdea. */
function toAppIdea(e: EmittedIdea): AppIdea {
  const title = (e.title ?? "Untitled").trim();
  const evidence = (e.evidence ?? []).filter(Boolean);
  return {
    id: `idea-${slugify(title)}`,
    title,
    pitch: e.pitch ?? "",
    description: e.description ?? e.pitch ?? "",
    problem: e.problem ?? "",
    targetUser: e.targetUser ?? "",
    mvpFeatures: (e.mvpFeatures ?? []).slice(0, 6),
    suggestedStack: e.suggestedStack ?? [],
    buildability: e.buildability ?? "moderate",
    tags: (e.tags ?? []).slice(0, 8),
    sourceQuote: e.sourceQuote,
    intent: e.intent,
    score: 0,
    signals: { demand: 0, recency: 0, novelty: 0, feasibility: 0 },
    sourceSignalIds: evidence,
    sources: inferSources(evidence),
    createdAt: new Date().toISOString(),
  };
}

function truncate(s: string, max = MAX_TOOL_RESULT_CHARS): string {
  return s.length > max ? s.slice(0, max) + "\n…[truncated]" : s;
}

function researchSystemPrompt(target: number): string {
  // EMPIRICALLY-DERIVED playbook (see src/agent/SEARCH_STRATEGY.md).
  return [
    "You are AppTok's Idea Scout: an autonomous agent that finds fresh, buildable app ideas grounded in REAL user demand — actual posts where people complain about, ask for, or propose tools. Not blog listicles.",
    "You decide how to search. The notes below are TIPS and capabilities, not a script — use your judgment, improvise, and follow the signal where it leads.",
    "",
    "## Tools (what each is good for)",
    "- tavily_search: general web search. Advanced depth, and scoping include_domains to discussion sites (reddit.com, news.ycombinator.com, indiehackers.com, x.com), tends to beat SEO blogspam.",
    "- tavily_extract: pull the FULL text + comments of a promising URL. Concrete ideas usually live in the comments or deep in a thread, not the headline.",
    "- reddit_search / hackernews_search / search_x_posts: real user threads on Reddit, HN, and X.",
    "- appstore_reviews: 1-3★ reviews = concrete feature-gap gripes about existing consumer apps.",
    "- github_issues / stackexchange_search / lobsters_search / devto_search: developer-tool gaps and unmet tooling needs.",
    "- youtube_comments: (when available) consumer frustration in comments on review / 'X vs Y' videos.",
    "- emit_idea: record one finished, evidence-grounded idea — call it the moment you've grounded one; it streams to the feed live.",
    "",
    "Rough routing: consumer-app gripes → appstore_reviews / X / Reddit; developer-tool gaps → github_issues / stackexchange / lobsters / dev.to. Breadth across sources beats depth on any one. You have ample budget — search a lot.",
    "",
    "## Tip: hunt the phrasings where people express ideas",
    "People announce unmet needs in recognizable ways, and searching those as EXACT quoted strings cuts spam and lands on the real expression — things in the spirit of \"i wish there was an app\", \"is there a tool that\", \"why is there no app for\", or idea-list posts like \"10 app ideas\" / \"startup ideas\". Treat these as flavor; generate your own variations around the topic.",
    "",
    "## Tip: long threads are goldmines",
    "On X and Reddit, builders post long threads packed with numbered app/startup ideas, and the best gems are often buried near the bottom where few read. When you surface one, extract the whole post and pull out EVERY distinct idea — each can become its own emit_idea, grounded in that post's URL with the buried line quoted. One great thread can yield several ideas.",
    "",
    "## What makes a result worth using",
    "Judge by CONTENT, not search rank — high-ranking 'top N app ideas' blogspam is noise; a low-ranking forum thread is often the real signal.",
    "",
    "## Two veins to pursue",
    "(A) DEMAND — what people want / complain about NOW.",
    "(B) HIDDEN GEMS — strong ideas posted a while ago that were never built and aren't discussed today (search without a recency filter; sanity-check it isn't already mainstream).",
    "",
    "## Filter, don't invent",
    "Keep `sourceQuote` close to the source's actual words (light cleanup only). Don't abstract a vivid, specific gripe into a generic 'AI assistant for X'.",
    "",
    "## Emit as you go",
    `Don't over-research before producing anything — emit your first idea early and keep emitting as you ground them. Aim for ${target} distinct ideas, each with its intent and evidence URLs. Favor specific niches over generic ideas.`,
    "",
    "## Naming + description",
    "Clear, simple names (a real word or clean compound like 'Household Splitwise'), not forced portmanteaus. The centerpiece is `description`: 2-4 vivid, concrete sentences on what it is, how it works, and why it's compelling — grounded in the real need.",
  ].join("\n");
}

/**
 * Run the agentic discovery loop and return ranked, deduped AppIdeas.
 *
 * @param input  Optional topics/limit; topics seed the scout's initial focus.
 * @param onLog  Optional progress sink (tool calls, emitted ideas) for the UI.
 * @param signal Optional abort signal to cancel a long run.
 */
export async function runAgenticDiscovery(
  input: Partial<DiscoverInput> = {},
  onLog: (line: string) => void = () => {},
  signal?: AbortSignal,
  onIdea?: (idea: AppIdea) => void,
): Promise<AppIdea[]> {
  if (!agenticAvailable()) {
    throw new Error("agentic discovery unavailable (provider not configured)");
  }

  const topics = input.topics?.length ? input.topics : config.defaultTopics;
  const target = config.agent.targetIdeas;
  const model = scoutModel();

  const emitted: EmittedIdea[] = [];
  const seenTitles = new Set<string>();
  const researchLog: string[] = [];
  const record = (label: string, text: string): void => {
    researchLog.push(`### ${label}\n${text}`);
  };

  // --- emit_idea tool (shared by the loop and the forced-emit fallback) ---
  const emitTool = tool({
    description:
      "Record ONE concrete, buildable app idea grounded in evidence you actually retrieved. " +
      "Call this the MOMENT you've grounded an idea — it streams straight to the feed.",
    inputSchema: ideaSchema,
    execute: async (idea) => {
      const key = idea.title.trim().toLowerCase();
      if (seenTitles.has(key)) {
        return `"${idea.title}" is a duplicate — skip it and find a different idea.`;
      }
      seenTitles.add(key);
      emitted.push(idea);
      // Stream the idea to the frontend immediately (scored individually).
      if (onIdea) {
        try {
          onIdea(scoreIdea(toAppIdea(idea)));
        } catch {
          /* a faulty consumer must never break the agent */
        }
      }
      onLog(`[agent] emitted ${emitted.length}/${target}: ${idea.title}`);
      return `Recorded "${idea.title}" (${emitted.length}/${target}) — pushed to the feed.${
        emitted.length >= target ? " Target reached — you may stop." : " Keep finding more."
      }`;
    },
  });

  // --- search tools: Tavily MCP (dynamic) + Reddit/HN ---
  const mcp = await getTavilyMcp();
  const searchTools: ToolSet = {
    reddit_search: tool({
      description:
        "Search Reddit THREADS (via web search) for real pain points & feature requests. " +
        "Use wish/pain phrasings: 'what software do you wish existed', 'is there a tool for'.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().optional(),
      }),
      execute: async ({ query, limit }) => {
        onLog(`[agent] reddit_search(${JSON.stringify(query)})`);
        const text = truncate(await runSearchTool("reddit_search", query, limit ?? 8));
        record(`reddit_search: ${query}`, text);
        return text;
      },
    }),
    hackernews_search: tool({
      description:
        "Search HackerNews for fresh 'Show HN' launches and 'Ask HN: what do you wish existed' threads.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().optional(),
      }),
      execute: async ({ query, limit }) => {
        onLog(`[agent] hackernews_search(${JSON.stringify(query)})`);
        const text = truncate(
          await runSearchTool("hackernews_search", query, limit ?? 8),
        );
        record(`hackernews_search: ${query}`, text);
        return text;
      },
    }),
  };

  // X / Twitter posts — searched via Tavily (scoped to x.com/twitter.com).
  searchTools.search_x_posts = tool({
    description:
      "Search X (Twitter) posts about a topic. Surfaces real-time complaints, " +
      "feature requests and 'I wish there was an app for…' posts — a fast-moving " +
      "demand signal the other sources miss.",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().optional(),
    }),
    execute: async ({ query, limit }) => {
      onLog(`[agent] search_x_posts(${JSON.stringify(query)})`);
      const text = truncate(await runSearchTool("x_search", query, limit ?? 10));
      record(`search_x_posts: ${query}`, text);
      return text;
    },
  });

  // --- Extra KEYLESS idea-mining sources (src/agent/sources-extra.ts) ---
  searchTools.appstore_reviews = tool({
    description:
      "Mine LOW-STAR (1-3★) App Store reviews of apps matching a query. The " +
      "single best source for 'what do users HATE about existing apps' — each " +
      "review is a concrete, unmet feature-gap pain point. Pass an app category " +
      "or need (e.g. 'budget tracker', 'habit tracker', 'recipe app').",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().optional(),
    }),
    execute: async ({ query, limit }) => {
      onLog(`[agent] appstore_reviews(${JSON.stringify(query)})`);
      const text = truncate(await appStoreReviews(query, limit ?? 8));
      record(`appstore_reviews: ${query}`, text);
      return text;
    },
  });

  searchTools.stackexchange_search = tool({
    description:
      "Search StackOverflow for high-vote questions WITHOUT an accepted answer " +
      "— unmet tooling/automation needs developers keep hitting. Use for " +
      "'is there a way to…', workflow friction, missing libraries/tools.",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().optional(),
    }),
    execute: async ({ query, limit }) => {
      onLog(`[agent] stackexchange_search(${JSON.stringify(query)})`);
      const text = truncate(await stackExchangeSearch(query, limit ?? 8));
      record(`stackexchange_search: ${query}`, text);
      return text;
    },
  });

  searchTools.github_issues = tool({
    description:
      "Search OPEN GitHub issues labelled 'help wanted' + 'feature request' — " +
      "developer-tool gaps maintainers openly admit aren't built yet. Best for " +
      "dev-tool / CLI / API / library ideas. Pass a tool category or domain.",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().optional(),
    }),
    execute: async ({ query, limit }) => {
      onLog(`[agent] github_issues(${JSON.stringify(query)})`);
      const text = truncate(await githubIssues(query, limit ?? 8));
      record(`github_issues: ${query}`, text);
      return text;
    },
  });

  searchTools.devto_search = tool({
    description:
      "Search dev.to articles (full-text + tag feed) for practitioner write-ups " +
      "— 'I built X because nothing did Y' posts that reveal workflow gaps and " +
      "tool wishes. Good for developer/indie-hacker angles.",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().optional(),
    }),
    execute: async ({ query, limit }) => {
      onLog(`[agent] devto_search(${JSON.stringify(query)})`);
      const text = truncate(await devtoSearch(query, limit ?? 8));
      record(`devto_search: ${query}`, text);
      return text;
    },
  });

  searchTools.lobsters_search = tool({
    description:
      "Scan lobste.rs (a sharp, technical community) hottest/newest stories, " +
      "filtered to your query, for emerging dev-tool discussion and gripes. " +
      "Use as a high-signal cross-check on technical / infra ideas.",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().optional(),
    }),
    execute: async ({ query, limit }) => {
      onLog(`[agent] lobsters_search(${JSON.stringify(query)})`);
      const text = truncate(await lobstersSearch(query, limit ?? 8));
      record(`lobsters_search: ${query}`, text);
      return text;
    },
  });

  // YouTube comments — only exposed when a key is configured (server-side).
  if (config.youtube.apiKey) {
    searchTools.youtube_comments = tool({
      description:
        "Read top comments on review / 'X vs Y' / tutorial videos for a topic — " +
        "loud, specific complaints about existing tools and 'I wish it could…' " +
        "asks. Use to gauge real consumer frustration with a product category.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().optional(),
      }),
      execute: async ({ query, limit }) => {
        onLog(`[agent] youtube_comments(${JSON.stringify(query)})`);
        const text = truncate(await youtubeComments(query, limit ?? 10));
        record(`youtube_comments: ${query}`, text);
        return text;
      },
    });
  }

  // Wrap each Tavily MCP tool as a dynamic AI SDK tool.
  if (mcp) {
    for (const def of mcp.toolDefs) {
      const name = def.function.name;
      searchTools[name] = dynamicTool({
        description: def.function.description,
        inputSchema: jsonSchema(def.function.parameters),
        execute: async (args) => {
          const a = (args ?? {}) as Record<string, unknown>;
          onLog(`[agent] ${name}(${JSON.stringify(a.query ?? a.urls ?? "")})`);
          const text = truncate(await callMcpTool(mcp, name, a));
          record(`${name}: ${JSON.stringify(a).slice(0, 100)}`, text);
          return text;
        },
      });
    }
  }
  onLog(
    `[agent] ${mcp ? "Tavily MCP connected" : "Tavily MCP unavailable"}; ${
      Object.keys(searchTools).length + 1
    } tools available`,
  );

  // --- Phase 1: agentic research loop (emit-as-you-go) ---
  // Soft wall-clock budget so heavy research can't starve idea emission.
  const budgetController = new AbortController();
  const timer = setTimeout(
    () => budgetController.abort(),
    config.agent.researchBudgetMs,
  );
  signal?.addEventListener("abort", () => budgetController.abort(), {
    once: true,
  });

  try {
    await generateText({
      model,
      system: researchSystemPrompt(target),
      prompt:
        `Discover ${target} buildable app ideas. Seed focus areas: ${topics.join(", ")}. ` +
        `Search broadly across the web, Reddit and HackerNews, and emit ideas as you ground them.`,
      tools: { ...searchTools, emit_idea: emitTool },
      stopWhen: [stepCountIs(config.agent.maxSteps), () => emitted.length >= target],
      temperature: 0.6,
      maxOutputTokens: config.agent.maxTokens,
      abortSignal: budgetController.signal,
    });
  } catch (err) {
    // Budget/abort or transient model error — proceed to the forced-emit net.
    onLog(
      `[agent] research loop ended: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    clearTimeout(timer);
  }

  // --- Phase 2: forced-emit safety net (guarantees output) ---
  if (emitted.length < target && researchLog.length > 0 && !signal?.aborted) {
    const need = target - emitted.length;
    const digest = truncate(researchLog.join("\n\n"), MAX_DIGEST_CHARS);
    onLog(`[agent] forcing synthesis of ${need} more idea(s) from research`);
    try {
      await generateText({
        model,
        system:
          "You convert raw research notes into buildable app ideas by calling emit_idea. " +
          "Filter, don't invent: keep sourceQuote close to the real wording. Ground evidence in URLs from the notes.",
        prompt:
          `Research notes gathered from Reddit/HN/web:\n\n${digest}\n\n` +
          `Emit ${need} more DISTINCT, grounded app ideas now via emit_idea ` +
          `(set intent to 'demand' or 'hidden-gem'). Do not repeat ideas already covered.`,
        tools: { emit_idea: emitTool },
        toolChoice: "required",
        stopWhen: [stepCountIs(need + 2), () => emitted.length >= target],
        maxOutputTokens: config.agent.maxTokens,
      });
    } catch (err) {
      onLog(
        `[agent] forced synthesis failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  onLog(`[agent] done — ${emitted.length} idea(s) emitted`);

  const ideas = dedupeIdeas(emitted.map(toAppIdea));
  return rankIdeas(ideas).slice(0, config.pipeline.maxIdeas);
}
