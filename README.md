# AppTok 🌱

An AI that **discovers buildable app ideas** from real user demand and serves them as a TikTok-style feed — then auto-builds a minimal version of any idea you pick.

## How it works

```
Agentic scout (Vercel AI SDK + umans/Grok-class LLM)
  ├─ searches the live web (Tavily MCP), Reddit + X (via Tavily), HackerNews
  ├─ filters real complaints / "I wish there was an app for…" posts (near-verbatim, not paraphrased)
  ├─ pursues two intents: (A) active demand  (B) "hidden gems" — great unbuilt ideas from years ago
  └─ streams each grounded idea to the feed the moment it's found (SSE)
        ↓
  Cursor (cursor-agent CLI) auto-builds a minimal MVP when you click "Build"
```

Every idea carries a generated **description** (the centerpiece), a near-verbatim **source quote**, an **intent** (`demand` / `hidden-gem`), MVP features, a suggested stack, and provenance.

## Stack

- **TypeScript ESM**, Fastify v5
- **Vercel AI SDK** (`ai`) agent loop, provider isolated in `src/agent/provider.ts` (swappable)
- **Tavily MCP** for web search; Reddit/X reached via Tavily; HackerNews via Algolia
- Deterministic heuristic pipeline as a zero-LLM fallback

## Run locally

```bash
npm install
cp .env.example .env   # fill in TAVILY_API_KEY, UMANS_API_KEYS, CURSOR_API_KEY
npm run discover       # one-shot CLI discovery
npm run dev            # start the API server (SSE feed at /api/stream)
```

## API

| Route | Purpose |
|---|---|
| `GET /api/feed` | ranked idea feed |
| `POST /api/discover` | run discovery; ideas stream to the feed as found |
| `POST /api/ideas/:id/build` | auto-build an MVP (async) |
| `GET /api/builds/:ideaId` | build artifact + logs |
| `GET /api/stream` | Server-Sent Events: live ideas + build progress |

## Configuration

All config is via environment variables — see `.env.example`. No secrets are committed; in production they live in the host's secret store.
