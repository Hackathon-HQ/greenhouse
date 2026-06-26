/**
 * The LLM provider for the agentic idea scout, isolated here so the backend can
 * be swapped (umans.ai today; Google DeepMind / Gemini later) by changing this
 * one file + config. Uses the Vercel AI SDK's OpenAI-compatible provider, which
 * is what umans.ai speaks.
 *
 * Key rotation: umans free-tier keys are rate-limited, so we install a custom
 * fetch that retries a request across all configured keys on 429/5xx before
 * giving up — transparent to the AI SDK.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { config } from "../config.js";

// Silence the noisy (auto-recovered) Gemini 3 "thoughtSignature" warning the AI
// SDK logs on every tool-call replay — it floods server logs and is benign.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

/** True when some scout LLM credential is available (Gemini or umans). */
export function providerAvailable(): boolean {
  return Boolean(config.gemini.apiKey) || config.umans.apiKeys.length > 0;
}

/**
 * Build a fetch that rotates the Authorization header across all umans keys on
 * transient failures. Falls back to plain fetch when only one key is present.
 */
function rotatingFetch(keys: string[]): typeof fetch {
  if (keys.length <= 1) return fetch;
  return (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    let last: Response | undefined;
    for (let i = 0; i < keys.length; i++) {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${keys[i]}`);
      const res = await fetch(input, { ...init, headers });
      if (res.status !== 429 && res.status < 500) return res;
      last = res;
      // brief backoff before the next key
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
    return last as Response;
  }) as typeof fetch;
}

/**
 * The language model the scout uses. Prefers Gemini (DeepMind) when a key is
 * present, otherwise falls back to umans. Swapping providers is isolated here.
 */
export function scoutModel(): LanguageModel {
  if (config.gemini.apiKey) {
    const google = createGoogleGenerativeAI({ apiKey: config.gemini.apiKey });
    return google(config.gemini.model);
  }
  const keys = config.umans.apiKeys;
  const provider = createOpenAICompatible({
    name: "umans",
    baseURL: config.umans.baseUrl,
    apiKey: keys[0] ?? "",
    fetch: rotatingFetch(keys),
  });
  return provider(config.umans.model);
}
