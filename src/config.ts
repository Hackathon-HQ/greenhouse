/**
 * Centralized, validated runtime configuration. Loaded once at startup.
 * Nothing else in the codebase should read process.env directly.
 */
import "dotenv/config";

function bool(v: string | undefined, def = false): boolean {
  if (v == null) return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function int(v: string | undefined, def: number): number {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : def;
}

export const config = {
  port: int(process.env.PORT, 8787),
  host: process.env.HOST ?? "0.0.0.0",

  /** Default seed topics if a request doesn't specify any. */
  defaultTopics: (process.env.SEED_TOPICS ??
    "ai tools,developer productivity,indie saas,automation,no-code")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),

  tavily: {
    apiKey: process.env.TAVILY_API_KEY ?? "",
  },

  reddit: {
    /** Optional OAuth; when absent we use the public read-only JSON API. */
    clientId: process.env.REDDIT_CLIENT_ID ?? "",
    clientSecret: process.env.REDDIT_CLIENT_SECRET ?? "",
    userAgent:
      process.env.REDDIT_USER_AGENT ?? "idea-forge/0.1 (discovery bot)",
    /** Subreddits to mine for pain points / requests. */
    subreddits: (process.env.REDDIT_SUBREDDITS ??
      "SaaS,SideProject,Entrepreneur,startups,webdev,AppIdeas")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
  },

  /**
   * umans.ai — OpenAI-compatible LLM provider that drives the AGENTIC idea
   * scout (tool-calling loop). Multiple keys can be supplied (comma-separated)
   * for round-robin failover across the free tier.
   */
  umans: {
    apiKeys: (process.env.UMANS_API_KEYS ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    baseUrl: process.env.UMANS_BASE_URL ?? "https://api.code.umans.ai/v1",
    /** "umans-glm-5.2" (reasoning) or "umans-kimi-k2.7" (tool-optimized). */
    model: process.env.UMANS_MODEL ?? "umans-kimi-k2.7",
  },

  /** The agentic discovery loop (web/Reddit/HN search -> synthesized ideas). */
  agent: {
    /** When true and umans keys exist, discovery uses the agent instead of heuristics. */
    enabled: bool(process.env.AGENT_ENABLED, true),
    /** Hard cap on tool-call rounds before we force the agent to wrap up. */
    maxSteps: int(process.env.AGENT_MAX_STEPS, 28),
    /** How many ideas the agent should aim to emit per run. */
    targetIdeas: int(process.env.AGENT_TARGET_IDEAS, 8),
    /** Per-LLM-call token ceiling (reasoning models burn these on thinking). */
    maxTokens: int(process.env.AGENT_MAX_TOKENS, 4096),
    /** Soft wall-clock budget for the research loop before we force synthesis. */
    researchBudgetMs: int(process.env.AGENT_RESEARCH_BUDGET_MS, 150000),
  },

  /**
   * xAI / Grok — powers the `search_x_posts` tool via Live Search. Auth is the
   * Grok OAuth token (access+refresh), reverse-engineered from the opencode
   * xai-oauth-rebirth plugin: refresh at auth.x.ai/oauth2/token, call api.x.ai/v1
   * with `Authorization: Bearer <access>`. Tokens are seeded from Fly secrets.
   */
  xai: {
    enabled: bool(process.env.XAI_ENABLED, true),
    /** OAuth client id from the opencode xai-oauth-rebirth plugin. */
    clientId:
      process.env.XAI_CLIENT_ID ?? "b1a00492-073a-47ea-816f-4c329264a828",
    accessToken: process.env.XAI_ACCESS_TOKEN ?? "",
    refreshToken: process.env.XAI_REFRESH_TOKEN ?? "",
    /** ms-epoch expiry of the access token (best-effort; JWT exp also checked). */
    tokenExpires: int(process.env.XAI_TOKEN_EXPIRES, 0),
    apiBase: process.env.XAI_API_BASE ?? "https://api.x.ai/v1",
    tokenUrl: process.env.XAI_TOKEN_URL ?? "https://auth.x.ai/oauth2/token",
    /** Grok model with Agent Tools (server-side x_search) support. */
    model: process.env.XAI_MODEL ?? "grok-4.3",
  },

  /** Tavily MCP server — connected over stdio and exposed to the agent as tools. */
  tavilyMcp: {
    enabled: bool(process.env.TAVILY_MCP_ENABLED, true),
    command: process.env.TAVILY_MCP_CMD ?? "npx",
    args: (process.env.TAVILY_MCP_ARGS ?? "-y,tavily-mcp@latest")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
  },

  cursor: {
    apiKey: process.env.CURSOR_API_KEY ?? "",
    /** Where auto-built MVPs are written. */
    buildsDir: process.env.BUILDS_DIR ?? ".builds",
    /** When false, the build step is mocked (no real Cursor invocation). */
    enabled: bool(process.env.CURSOR_ENABLED, true),
    /** Path to the cursor-agent CLI binary (installed to ~/.local/bin by default). */
    cliPath: process.env.CURSOR_CLI_PATH ?? "cursor-agent",
    /**
     * Model the headless agent uses. "auto" lets Cursor pick a fast coding
     * model (verified to one-shot a single self-contained index.html in ~30s).
     * Override with a concrete id from `cursor-agent --list-models`
     * (e.g. "composer-2.5-fast", "gpt-5.3-codex") if "auto" ever gets flaky.
     */
    model: process.env.CURSOR_MODEL ?? "auto",
    /** Max wall-clock (ms) a single headless build may run before being killed. */
    timeoutMs: int(process.env.CURSOR_TIMEOUT_MS, 5 * 60 * 1000),
  },

  pipeline: {
    /** Soft cap of signals fetched per source per run. */
    perSourceLimit: int(process.env.PER_SOURCE_LIMIT, 25),
    /** Only consider signals newer than this. */
    withinHours: int(process.env.WITHIN_HOURS, 168),
    /** Max ideas the feed holds. */
    maxIdeas: int(process.env.MAX_IDEAS, 50),
  },

  /** Scoring weights — must sum to ~1.0. Tunable without code changes. */
  weights: {
    demand: Number(process.env.W_DEMAND ?? 0.4),
    recency: Number(process.env.W_RECENCY ?? 0.2),
    novelty: Number(process.env.W_NOVELTY ?? 0.2),
    feasibility: Number(process.env.W_FEASIBILITY ?? 0.2),
  },
} as const;

export type AppConfig = typeof config;
