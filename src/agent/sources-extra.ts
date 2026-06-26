/**
 * Extra KEYLESS idea-mining sources for the scout, plus an optional
 * key-gated YouTube source. Each executor returns READABLE text (title + url +
 * the pain-point snippet) and NEVER throws — upstream/network failures degrade
 * to a short explanatory string. Results are kept compact (truncated) so a
 * single payload can't blow the model's context.
 *
 * All five keyless sources were verified live (no auth required):
 *  - appstore_reviews   : iTunes Search + Customer Reviews RSS (low-star = pain)
 *  - stackexchange_search: StackOverflow Advanced Search (unanswered = tooling gap)
 *  - github_issues      : GitHub Issues Search (help-wanted feature requests)
 *  - devto_search       : dev.to articles (search + tag)
 *  - lobsters_search    : lobste.rs hottest/newest feeds, client-side filtered
 *                         (lobste.rs/search.json rejects query params, so we
 *                          mine the public JSON feeds and match locally instead)
 *  - youtube_comments   : key-gated (YOUTUBE_API_KEY); built but not live-tested
 */
import { config } from "../config.js";

/** A polite, identifiable UA — several of these hosts gate anonymous traffic. */
const UA = "apptok-idea-scout/0.1 (+https://apptok.app)";

/** Strip HTML/entities and collapse whitespace, then hard-truncate. */
function clean(s: string | null | undefined, n = 240): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
}

function errStr(label: string, err: unknown): string {
  return `ERROR ${label}: ${err instanceof Error ? err.message : String(err)}`;
}

/* ----------------------------------------------------------------------- *
 * 1. App Store reviews — KEYLESS                                           *
 *    Low-star (≤3) reviews of apps matching the query are pure, concrete   *
 *    feature-gap pain points: exactly what users hate about what exists.   *
 * ----------------------------------------------------------------------- */
interface ItunesApp {
  trackId?: number;
  trackName?: string;
}
interface RssLabel {
  label?: string;
}
interface RssReview {
  "im:rating"?: RssLabel;
  title?: RssLabel;
  content?: RssLabel;
}

export async function appStoreReviews(
  query: string,
  limit = 8,
): Promise<string> {
  try {
    const sres = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(
        query,
      )}&entity=software&limit=10&country=us`,
      { headers: { "User-Agent": UA } },
    );
    if (!sres.ok) return `ERROR: App Store search ${sres.status}`;
    const sjson = (await sres.json()) as { results?: ItunesApp[] };
    const apps = (sjson.results ?? []).filter((a) => a.trackId);
    if (apps.length === 0) return "(no App Store apps found for query)";

    const out: string[] = [];
    // Walk the top matching apps and harvest recent low-star reviews until we
    // have `limit`. Many apps return an empty review RSS — just skip them.
    for (const app of apps.slice(0, 6)) {
      if (out.length >= limit) break;
      try {
        const rres = await fetch(
          `https://itunes.apple.com/us/rss/customerreviews/page=1/id=${app.trackId}/sortby=mostrecent/json`,
          { headers: { "User-Agent": UA } },
        );
        if (!rres.ok) continue;
        const rjson = (await rres.json()) as {
          feed?: { entry?: RssReview[] };
        };
        const entries = rjson.feed?.entry ?? [];
        for (const e of entries) {
          if (out.length >= limit) break;
          // The first entry is app metadata (no im:rating) — skip it.
          if (!e["im:rating"]) continue;
          const rating = Number(e["im:rating"].label);
          if (!Number.isFinite(rating) || rating > 3) continue;
          out.push(
            `${out.length + 1}. ★${rating} on "${app.trackName ?? "app"}" — ${clean(
              e.title?.label,
              120,
            )}\n   https://apps.apple.com/us/app/id${app.trackId}\n   ${clean(
              e.content?.label,
              220,
            )}`,
          );
        }
      } catch {
        /* one bad app's RSS must not sink the whole result */
      }
    }
    return out.length
      ? out.join("\n")
      : "(no recent low-star reviews found for matching apps)";
  } catch (err) {
    return errStr("App Store reviews", err);
  }
}

/* ----------------------------------------------------------------------- *
 * 2. StackExchange (StackOverflow) — KEYLESS (~300 req/day; key → 10k/day) *
 *    High-vote questions without an accepted answer = unmet tooling needs. *
 * ----------------------------------------------------------------------- */
interface SeItem {
  title?: string;
  link?: string;
  body?: string;
  score?: number;
  answer_count?: number;
  view_count?: number;
}

export async function stackExchangeSearch(
  query: string,
  limit = 8,
): Promise<string> {
  try {
    const keyParam = config.stackexchange.apiKey
      ? `&key=${encodeURIComponent(config.stackexchange.apiKey)}`
      : "";
    const url =
      `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes` +
      `&q=${encodeURIComponent(query)}&accepted=False&site=stackoverflow` +
      `&pagesize=10&filter=withbody${keyParam}`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return `ERROR: StackExchange ${res.status}`;
    const json = (await res.json()) as {
      items?: SeItem[];
      error_message?: string;
    };
    if (json.error_message) return `ERROR StackExchange: ${json.error_message}`;
    const items = json.items ?? [];
    if (items.length === 0) return "(no unanswered StackOverflow questions found)";
    return items
      .slice(0, limit)
      .map(
        (it, i) =>
          `${i + 1}. ${clean(it.title, 140)} [${it.score ?? 0} votes, ${
            it.answer_count ?? 0
          } answers, ${it.view_count ?? 0} views]\n   ${
            it.link ?? ""
          }\n   ${clean(it.body, 200)}`,
      )
      .join("\n");
  } catch (err) {
    return errStr("StackExchange", err);
  }
}

/* ----------------------------------------------------------------------- *
 * 3. GitHub Issues — KEYLESS (10 req/min; GITHUB_TOKEN → 30 req/min)       *
 *    Open "help wanted" + "feature request" issues = developer-tool gaps   *
 *    the maintainers themselves admit aren't built yet.                    *
 * ----------------------------------------------------------------------- */
interface GhIssue {
  title?: string;
  html_url?: string;
  body?: string;
  reactions?: { total_count?: number };
  comments?: number;
}

export async function githubIssues(
  query: string,
  limit = 8,
): Promise<string> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "apptok",
    };
    if (config.github.token) headers.Authorization = `Bearer ${config.github.token}`;
    const q = `${query} label:"help wanted" label:"feature request" state:open`;
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(
      q,
    )}&sort=reactions&per_page=10`;
    const res = await fetch(url, { headers });
    if (!res.ok) return `ERROR: GitHub ${res.status}`;
    const json = (await res.json()) as { items?: GhIssue[]; message?: string };
    if (json.message && !json.items) return `ERROR GitHub: ${json.message}`;
    const items = json.items ?? [];
    if (items.length === 0)
      return "(no open help-wanted feature-request issues found)";
    return items
      .slice(0, limit)
      .map(
        (it, i) =>
          `${i + 1}. ${clean(it.title, 140)} [${
            it.reactions?.total_count ?? 0
          } reactions, ${it.comments ?? 0} comments]\n   ${
            it.html_url ?? ""
          }\n   ${clean(it.body, 200)}`,
      )
      .join("\n");
  } catch (err) {
    return errStr("GitHub issues", err);
  }
}

/* ----------------------------------------------------------------------- *
 * 4. dev.to — KEYLESS                                                      *
 *    Practitioner write-ups ("I built X because nothing did Y") surface    *
 *    workflow gaps and tool wishes. We try full-text search and fall back  *
 *    to a tag feed derived from the query's first word.                    *
 * ----------------------------------------------------------------------- */
interface DevtoArticle {
  title?: string;
  url?: string;
  description?: string;
  positive_reactions_count?: number;
  comments_count?: number;
}

export async function devtoSearch(query: string, limit = 8): Promise<string> {
  try {
    const sres = await fetch(
      `https://dev.to/api/articles/search?q=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": UA, Accept: "application/json" } },
    );
    let articles: DevtoArticle[] = [];
    if (sres.ok) {
      const j = (await sres.json()) as DevtoArticle[];
      if (Array.isArray(j)) articles = j;
    }
    // Fall back / supplement with a tag feed if search came back thin.
    if (articles.length < 3) {
      const tag = (query.trim().split(/\s+/)[0] || "").toLowerCase();
      if (tag) {
        const tres = await fetch(
          `https://dev.to/api/articles?per_page=15&tag=${encodeURIComponent(tag)}`,
          { headers: { "User-Agent": UA, Accept: "application/json" } },
        );
        if (tres.ok) {
          const tj = (await tres.json()) as DevtoArticle[];
          if (Array.isArray(tj)) articles = articles.concat(tj);
        }
      }
    }
    if (articles.length === 0) return "(no dev.to articles found)";
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const a of articles) {
      if (!a.url || seen.has(a.url)) continue;
      seen.add(a.url);
      lines.push(
        `${lines.length + 1}. ${clean(a.title, 140)} [${
          a.positive_reactions_count ?? 0
        } reactions, ${a.comments_count ?? 0} comments]\n   ${
          a.url
        }\n   ${clean(a.description, 200)}`,
      );
      if (lines.length >= limit) break;
    }
    return lines.length ? lines.join("\n") : "(no dev.to articles found)";
  } catch (err) {
    return errStr("dev.to", err);
  }
}

/* ----------------------------------------------------------------------- *
 * 5. Lobsters — KEYLESS                                                    *
 *    lobste.rs/search.json rejects query params (400), so we mine the      *
 *    public hottest/newest JSON feeds and filter locally for the query     *
 *    terms — a polite, single-pass approach to a tech-savvy crowd's takes. *
 * ----------------------------------------------------------------------- */
interface LobsterStory {
  title?: string;
  url?: string;
  short_id_url?: string;
  comments_url?: string;
  score?: number;
  comment_count?: number;
  description_plain?: string;
  description?: string;
  tags?: string[];
}

export async function lobstersSearch(query: string, limit = 8): Promise<string> {
  try {
    const feeds = await Promise.allSettled([
      fetch("https://lobste.rs/hottest.json", { headers: { "User-Agent": UA } }),
      fetch("https://lobste.rs/newest.json", { headers: { "User-Agent": UA } }),
    ]);
    const stories: LobsterStory[] = [];
    const seen = new Set<string>();
    for (const f of feeds) {
      if (f.status !== "fulfilled" || !f.value.ok) continue;
      const arr = (await f.value.json()) as LobsterStory[];
      if (!Array.isArray(arr)) continue;
      for (const s of arr) {
        const key = s.short_id_url ?? s.url ?? s.title ?? "";
        if (key && !seen.has(key)) {
          seen.add(key);
          stories.push(s);
        }
      }
    }
    if (stories.length === 0) return "(lobste.rs feeds unavailable)";

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    const hay = (s: LobsterStory) =>
      `${s.title ?? ""} ${(s.tags ?? []).join(" ")} ${
        s.description_plain ?? s.description ?? ""
      }`.toLowerCase();
    const matched = terms.length
      ? stories.filter((s) => terms.some((t) => hay(s).includes(t)))
      : stories;
    // If nothing matched the query, fall back to the hottest stories so the
    // scout still gets a fresh read on what this crowd cares about.
    const picked = (matched.length ? matched : stories).slice(0, limit);
    const note = matched.length
      ? ""
      : " (no query match; showing current hottest)";
    return (
      picked
        .map(
          (s, i) =>
            `${i + 1}. ${clean(s.title, 140)} [${s.score ?? 0} pts, ${
              s.comment_count ?? 0
            } comments]\n   ${s.url || s.short_id_url || ""}\n   ${clean(
              s.description_plain ?? s.description,
              180,
            )}`,
        )
        .join("\n") + note
    );
  } catch (err) {
    return errStr("Lobsters", err);
  }
}

/* ----------------------------------------------------------------------- *
 * 6. YouTube comments — KEY-GATED (YOUTUBE_API_KEY)                        *
 *    Comments on review/"X vs Y"/tutorial videos are loud, specific gripes *
 *    about existing tools. Built but NOT live-tested (key only on server). *
 * ----------------------------------------------------------------------- */
export async function youtubeComments(
  query: string,
  limit = 10,
): Promise<string> {
  const key = config.youtube.apiKey;
  if (!key) return "(youtube key not configured)";
  try {
    const sres = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=relevance&maxResults=3&q=${encodeURIComponent(
        query,
      )}&key=${encodeURIComponent(key)}`,
      { headers: { "User-Agent": UA } },
    );
    if (!sres.ok) return `ERROR: YouTube search ${sres.status}`;
    const sjson = (await sres.json()) as {
      items?: Array<{
        id?: { videoId?: string };
        snippet?: { title?: string };
      }>;
    };
    const videos = (sjson.items ?? []).filter((v) => v.id?.videoId);
    if (videos.length === 0) return "(no YouTube videos found)";

    const out: string[] = [];
    for (const v of videos) {
      if (out.length >= limit) break;
      const videoId = v.id!.videoId!;
      try {
        const cres = await fetch(
          `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(
            videoId,
          )}&maxResults=50&order=relevance&textFormat=plainText&key=${encodeURIComponent(
            key,
          )}`,
          { headers: { "User-Agent": UA } },
        );
        if (!cres.ok) continue;
        const cjson = (await cres.json()) as {
          items?: Array<{
            snippet?: {
              topLevelComment?: {
                snippet?: { textDisplay?: string; likeCount?: number };
              };
            };
          }>;
        };
        for (const c of cjson.items ?? []) {
          if (out.length >= limit) break;
          const top = c.snippet?.topLevelComment?.snippet;
          const text = clean(top?.textDisplay, 220);
          if (!text) continue;
          out.push(
            `${out.length + 1}. on "${clean(v.snippet?.title, 80)}" [${
              top?.likeCount ?? 0
            } likes]\n   https://youtu.be/${videoId}\n   ${text}`,
          );
        }
      } catch {
        /* skip a bad video */
      }
    }
    return out.length ? out.join("\n") : "(no YouTube comments found)";
  } catch (err) {
    return errStr("YouTube comments", err);
  }
}
