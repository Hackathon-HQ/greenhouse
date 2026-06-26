/**
 * Full-fidelity observability log. Appends everything the system does —
 * discovery tool calls, agent reasoning/text, emitted ideas, the RAW cursor
 * stream, build lifecycle, Vercel deploys — to a single file on disk, so we can
 * observe the whole pipeline after the fact.
 *
 * Read it over HTTP at GET /api/logs (tail), or on the box at OBSERVE_LOG_PATH.
 * Mirrored to stdout so it also shows in `fly logs`.
 */
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const LOG_PATH = process.env.OBSERVE_LOG_PATH ?? "/app/.builds/observe.log";
/** Rotate when the file exceeds this, so it can't grow unbounded. */
const MAX_BYTES = 8 * 1024 * 1024;

let chain: Promise<void> = Promise.resolve();
let dirReady = false;

function fmt(data: unknown): string {
  if (data === undefined) return "";
  try {
    const s = typeof data === "string" ? data : JSON.stringify(data);
    return " " + s.replace(/\s+/g, " ").slice(0, 4000);
  } catch {
    return " [unserializable]";
  }
}

/**
 * Record an observation. Non-blocking and never throws — writes are serialized
 * on an internal promise chain.
 *
 * @param category short tag, e.g. "discover", "agent:reasoning", "cursor:raw", "build", "deploy".
 */
export function observe(category: string, message: string, data?: unknown): void {
  const line = `${new Date().toISOString()} [${category}] ${message}${fmt(data)}`;
  // Mirror to stdout (shows in `fly logs`).
  console.log(line);
  chain = chain
    .then(async () => {
      if (!dirReady) {
        await mkdir(path.dirname(LOG_PATH), { recursive: true }).catch(() => {});
        dirReady = true;
      }
      try {
        const s = await stat(LOG_PATH).catch(() => null);
        if (s && s.size > MAX_BYTES) {
          // Keep the most recent half on rotation.
          const buf = await readFile(LOG_PATH, "utf8").catch(() => "");
          await writeFile(LOG_PATH, buf.slice(buf.length / 2));
        }
      } catch {
        /* ignore rotation errors */
      }
      await appendFile(LOG_PATH, line + "\n").catch(() => {});
    })
    .catch(() => {});
}

/** Return the last `n` lines of the observability log (for GET /api/logs). */
export async function readObserveLog(n = 500): Promise<string> {
  try {
    const buf = await readFile(LOG_PATH, "utf8");
    return buf.split("\n").slice(-n).join("\n");
  } catch {
    return "(no observability log yet)";
  }
}
