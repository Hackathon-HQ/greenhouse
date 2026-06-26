/**
 * xAI / Grok client for the `search_x_posts` tool.
 *
 * Reimplements (does NOT depend on) the opencode `xai-oauth-rebirth` plugin:
 *   - Auth is a Grok OAuth token (access + refresh), not an API key.
 *   - When the access token is expiring, refresh it at auth.x.ai/oauth2/token
 *     (grant_type=refresh_token, client_id=<plugin client id>).
 *   - Call api.x.ai/v1/chat/completions with `Authorization: Bearer <access>`,
 *     using xAI Live Search (`search_parameters.sources = [{type:"x"}]`) to pull
 *     real X posts about a query.
 *
 * Tokens are seeded from config (Fly secrets / .env). Rotated refresh tokens are
 * kept in-memory for the process lifetime (we can't write back to Fly here).
 */
import { config } from "../config.js";

const REFRESH_SKEW_MS = 120_000;

interface TokenState {
  access: string;
  refresh: string;
  /** ms-epoch expiry, best-effort. */
  expires: number;
}

const state: TokenState = {
  access: config.xai.accessToken,
  refresh: config.xai.refreshToken,
  expires: config.xai.tokenExpires,
};

let refreshPromise: Promise<void> | null = null;

/** True when xAI search is usable (enabled + at least a refresh or access token). */
export function xaiAvailable(): boolean {
  return (
    config.xai.enabled && Boolean(state.refresh || state.access)
  );
}

/** Decode a JWT's `exp` and report whether it's within the refresh skew window. */
function accessTokenIsExpiring(token: string, skewMs = REFRESH_SKEW_MS): boolean {
  const parts = token.split(".");
  if (parts.length < 2) return false;
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4 !== 0) payload += "=";
    const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    if (typeof claims?.exp !== "number") return false;
    return claims.exp * 1000 <= Date.now() + Math.max(0, skewMs);
  } catch {
    return false;
  }
}

/** Exchange the refresh token for a fresh access token (and possibly a rotated refresh). */
async function refreshAccessToken(): Promise<void> {
  if (!state.refresh) throw new Error("xAI: no refresh token to refresh with");
  const res = await fetch(config.xai.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "apptok-xai/0.1",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: state.refresh,
      client_id: config.xai.clientId,
    }).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`xAI token refresh failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  state.access = tokens.access_token;
  state.refresh = tokens.refresh_token || state.refresh;
  state.expires = Date.now() + (tokens.expires_in ?? 3600) * 1000;
}

/** Ensure a non-expiring access token, refreshing once (single-flight) if needed. */
async function ensureAccessToken(): Promise<string> {
  const expiringByClock =
    !state.expires || state.expires - Date.now() <= REFRESH_SKEW_MS;
  const expiringByJwt = state.access
    ? accessTokenIsExpiring(state.access)
    : true;

  if ((expiringByClock || expiringByJwt) && state.refresh) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    await refreshPromise;
  }
  if (!state.access) throw new Error("xAI: no usable access token");
  return state.access;
}

export interface XPostResult {
  /** Grok's synthesized summary of what people are posting. */
  summary: string;
  /** Source X post / citation URLs. */
  citations: string[];
}

/**
 * Search recent X (Twitter) posts for `query` via xAI Live Search and return a
 * synthesis of the real complaints/requests/pain points people express, plus
 * citation URLs. Never throws — returns an error summary the agent can read.
 */
export async function searchXPosts(
  query: string,
  maxResults = 15,
): Promise<XPostResult> {
  try {
    const token = await ensureAccessToken();
    // Agent Tools API: call Grok with the server-side `x_search` tool — it
    // natively searches X and returns an answer + citations. (Live Search via
    // `search_parameters` is deprecated.)
    const res = await fetch(`${config.xai.apiBase}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: config.xai.model,
        instructions:
          "You surface raw demand signal from X. Summarize the real complaints, " +
          "feature requests and 'I wish there was an app for…' posts people are " +
          "making — keep their actual wording where possible. Be concrete and quote notable posts.",
        input: `Search X for recent posts about: ${query}. What are people complaining about, asking for, or wishing existed?`,
        tools: [{ type: "x_search" }],
        max_tool_calls: Math.max(1, Math.ceil(maxResults / 5)),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        summary: `ERROR: xAI ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        citations: [],
      };
    }
    const json = (await res.json()) as {
      output_text?: string;
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      citations?: string[];
    };
    // Responses API: prefer output_text; else walk output[].content[].text.
    let summary = json.output_text ?? "";
    if (!summary && Array.isArray(json.output)) {
      summary = json.output
        .flatMap((o) => o.content ?? [])
        .map((c) => c.text ?? "")
        .filter(Boolean)
        .join("\n")
        .trim();
    }
    return {
      summary: summary || "(no content)",
      citations: json.citations ?? [],
    };
  } catch (err) {
    return {
      summary: `ERROR searching X: ${err instanceof Error ? err.message : String(err)}`,
      citations: [],
    };
  }
}
