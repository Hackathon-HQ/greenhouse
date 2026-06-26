# Idea-Discovery Search Strategy (empirically derived)

Findings from live back-and-forth probing of the Tavily and Reddit/HN APIs with
the real keys. Use this to shape the scout agent's system prompt and tool usage.

## Headline findings

1. **Tavily relevance score is NOT an idea-quality proxy.** "trending app ideas
   2026" scores 0.87–0.92 but returns pure blogspam/listicles. Authentic
   pain-point threads score 0.1–0.4 yet contain the real signal. → The agent must
   judge results by *content*, never by score, and should distrust high-scoring
   listicle domains.

2. **Domain-scoping is the single biggest quality lever for Tavily.** Adding
   `include_domains: ["reddit.com","news.ycombinator.com","indiehackers.com"]`
   converts weak queries into goldmine threads (e.g. "Ask HN: What software do
   you wish existed", r/SomebodyMakeThis, r/AppIdeas).

3. **Reddit's public JSON API is unusable from this host.** Every request returns
   `429` with `x-ratelimit-remaining: 0.0` (shared/flagged IP; resets ~2 min).
   No Reddit OAuth key is available. → **Route Reddit discovery THROUGH Tavily**
   (`include_domains:["reddit.com"]` + `tavily_extract` for comments). Direct
   Reddit only as opportunistic fallback.

4. **HackerNews Algolia is the one reliable *direct* source.** No auth, no IP
   issues. BUT the only numeric attribute still filterable is `created_at_i` —
   `points` and `num_comments` now return HTTP 400
   ("attribute not specified in numericAttributesForFiltering"). Filter recency
   server-side, sort by points client-side.

5. **`tavily_extract` works on forum threads** and pulls the comment body where
   the actual ideas live — but Tavily search ranks by title match, surfacing old
   threads. Pair extract with API-side recency for freshness.

6. **`topic:"news"` is noise** for idea-finding (PR/funding wires, scores <0.2).
   Skip it.

## High-value subreddits (discovered via Tavily)

r/SomebodyMakeThis · r/AppIdeas · r/SaaS · r/microsaas · r/B2BSaaS ·
r/CustomerSuccess · r/Entrepreneur · r/SideProject · r/productivity

## Winning query patterns

**Demand / pain (authentic forum threads):**
- "what software do you wish existed"
- "app that should exist somebody make this"
- "biggest frustration with current tools"
- "is there a tool that …" (sort by comments)
- "i wish there was an app for"

**Curated idea databases (no domain scope — let these surface):**
- "validated micro saas ideas underserved niches list 2026"
- "low competition saas niches reddit validated"
→ hits bigideasdb, trend-seeker, indiehackers posts.

## Optimized tool playbook (what to tell the agent)

- **Tavily (web + Reddit proxy):** `search_depth:"advanced"`, `max_results:6–8`.
  Run TWO modes per topic:
  (a) domain-scoped to `reddit.com,news.ycombinator.com,indiehackers.com` with
      pain/wish phrasings, optionally `time_range:"month"` for freshness;
  (b) un-scoped with "underserved/validated micro-saas niches" phrasings to hit
      curated idea DBs.
  Then `tavily_extract` the 2–3 best thread URLs to read the comments.
- **HackerNews (direct):**
  - Evergreen idea threads: `/search?tags=ask_hn&query=wish existed`.
  - Fresh launches: `/search?tags=show_hn&numericFilters=created_at_i>{now-90d}`
    (URL-encode `>` as `%3E`), then sort hits by `points` in code.
- **Reddit (direct):** attempt once; on 429 silently rely on the Tavily proxy.

## Core intuition (how the LLM should compress)

The pipeline is **Tavily floods info → LLM filters, does NOT paraphrase.** The
value is in surfacing what real people *actually said*, near-verbatim:

- **Low-diff extraction, not invention.** The agent's job is to FILTER a large
  pool down to the few genuine ideas/complaints and return them with only light
  cleanup (fix grammar, trim). Preserve the original wording, specificity and
  voice. A "paraphrase distance" near zero is the goal — do not abstract a vivid
  complaint into a generic SaaS pitch. Quote the source phrasing in the idea.
- **Two veins to mine:**
  1. *Complaints* — "I hate that…", "why is there no…", "I waste hours doing X
     manually" → the problem statement, almost as written.
  2. *Suggestions* — people literally proposing an app/tool ("somebody should
     make…", "I wish there was…") → the idea, almost as written.
- **Hidden-gem mode (high value):** deliberately surface GOOD ideas posted on
  Reddit/HN a while ago that never got built and aren't being talked about now.
  Tavily's title-match bias toward older threads (2016–2023) — a freshness
  weakness elsewhere — is an ASSET here. For each candidate, do a quick check
  that it isn't already a mainstream product; if it's still unbuilt, it's a gem.
  Run searches WITHOUT a recency filter for this mode.

So the agent runs two intents: **(A) what are people complaining about / asking
for right now**, and **(B) what forgotten unbuilt idea from years ago is still a
good, un-served idea today** — emitting both close to the source's own words.

## Drop-in system-prompt guidance block

> You discover ideas by triangulating REAL demand, not listicles. Rules:
> - Judge every search result by its CONTENT, not its relevance score. Ignore
>   "top N app ideas 2026" blog listicles — they are SEO spam.
> - Your richest veins are forum threads where people state unmet needs:
>   "what software do you wish existed", "app that should exist", "biggest
>   frustration with…". Search the web scoped to reddit.com / news.ycombinator /
>   indiehackers for these, then EXTRACT the best threads to read the comments —
>   individual comments are where concrete ideas hide.
> - Reddit's API is rate-limited here; reach Reddit content via web search
>   instead. HackerNews search is reliable for fresh "Show HN" launches and
>   evergreen "Ask HN: what do you wish existed" threads.
> - For each topic run several varied queries (pain phrasing + niche phrasing),
>   cross-reference what multiple people independently ask for, and prefer
>   specific niches over generic "AI assistant" ideas.
> - FILTER, don't invent. Return the real complaint/suggestion close to the
>   source's own words (light cleanup only — near-zero paraphrase distance). Do
>   not abstract a vivid, specific gripe into a generic pitch. Keep the voice.
> - Run two intents: (A) what people are complaining about / asking for NOW, and
>   (B) "hidden gems" — strong app ideas posted on Reddit/HN years ago that were
>   never built and aren't discussed today (search without a recency filter;
>   sanity-check the idea isn't already a mainstream product).
> - Ground every emitted idea in the actual URLs you retrieved.
