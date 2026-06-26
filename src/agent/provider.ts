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
import type { LanguageModel } from "ai";
import { config } from "../config.js";

/** True when the provider has at least one credential. */
export function providerAvailable(): boolean {
  return config.umans.apiKeys.length > 0;
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
 * The language model the scout uses. Centralizing this means a future switch to
 * Gemini is `createGoogleGenerativeAI(...)` here + a config change, nothing else.
 */
export function scoutModel(): LanguageModel {
  const keys = config.umans.apiKeys;
  const provider = createOpenAICompatible({
    name: "umans",
    baseURL: config.umans.baseUrl,
    apiKey: keys[0] ?? "",
    fetch: rotatingFetch(keys),
  });
  return provider(config.umans.model);
}
