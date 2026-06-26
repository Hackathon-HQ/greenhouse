/**
 * HTTP + SSE surface for Idea Forge, registered onto a Fastify v5 instance.
 *
 * Endpoints:
 *   GET  /health                  liveness probe
 *   GET  /api/feed                ranked idea feed (?tag, ?limit)
 *   GET  /api/ideas/:id           single idea or 404
 *   POST /api/discover            run discovery, upsert, return new ideas
 *   POST /api/ideas/:id/build     kick off an async build, return queued artifact
 *   GET  /api/builds/:ideaId      latest build artifact or 404
 *   GET  /api/stream              Server-Sent Events feed of idea + build updates
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppIdea, BuildArtifact } from "../types.js";
import { store } from "../store/store.js";
import { runDiscovery } from "../pipeline/discover.js";
import { buildIdea } from "../build/cursor.js";

interface FeedQuery {
  tag?: string;
  limit?: string;
}

interface DiscoverBody {
  topics?: string[];
}

interface IdParams {
  id: string;
}

interface IdeaIdParams {
  ideaId: string;
}

/**
 * Register all Idea Forge routes on the given Fastify instance.
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ ok: true }));

  app.get<{ Querystring: FeedQuery }>("/api/feed", async (req) => {
    const { tag } = req.query;
    const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : undefined;
    return store.getFeed({
      tag: tag || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  });

  app.get<{ Params: IdParams }>("/api/ideas/:id", async (req, reply) => {
    const idea = store.getIdea(req.params.id);
    if (!idea) return reply.code(404).send({ error: "idea not found" });
    return idea;
  });

  app.post<{ Body: DiscoverBody }>("/api/discover", async (req, reply) => {
    const topics = Array.isArray(req.body?.topics)
      ? req.body.topics.map((t) => String(t).trim()).filter(Boolean)
      : undefined;
    try {
      // Stream each idea to the live feed (SSE) the moment the scout emits it,
      // instead of waiting for the whole run to finish.
      const ideas = await runDiscovery(
        topics && topics.length ? { topics } : {},
        () => {},
        (idea) => store.upsertIdeas([idea]),
      );
      store.upsertIdeas(ideas);
      return ideas;
    } catch (err) {
      req.log.error({ err }, "discovery failed");
      return reply.code(500).send({ error: "discovery failed" });
    }
  });

  app.post<{ Params: IdParams }>("/api/ideas/:id/build", async (req, reply) => {
    const idea = store.getIdea(req.params.id);
    if (!idea) return reply.code(404).send({ error: "idea not found" });

    const queued: BuildArtifact = {
      ideaId: idea.id,
      status: "queued",
      files: [],
      logs: [`Build queued for "${idea.title}"`],
      startedAt: new Date().toISOString(),
    };
    store.setBuild(queued);

    // Fire-and-forget: run the build in the background, streaming progress
    // through the store (which fans out to SSE via onBuild).
    void runBuild(idea, queued);

    return reply.code(202).send(queued);
  });

  app.get<{ Params: IdeaIdParams }>("/api/builds/:ideaId", async (req, reply) => {
    const artifact = store.getBuild(req.params.ideaId);
    if (!artifact) return reply.code(404).send({ error: "build not found" });
    return artifact;
  });

  app.get("/api/stream", async (req, reply) => {
    openSseStream(req, reply);
    // Keep the request open; reply is driven manually via reply.raw.
    return reply;
  });
}

/**
 * Execute a build for an idea, persisting progress + final state to the store.
 * Never throws — failures are captured into a failed artifact.
 */
async function runBuild(idea: AppIdea, queued: BuildArtifact): Promise<void> {
  const logs: string[] = [...queued.logs];
  store.setBuild({ ...queued, status: "building", logs });
  try {
    const artifact = await buildIdea(idea, (line: string) => {
      logs.push(line);
      store.setBuild({
        ideaId: idea.id,
        status: "building",
        files: [],
        logs: [...logs],
        startedAt: queued.startedAt,
      });
    });
    store.setBuild(artifact);
  } catch (err) {
    store.setBuild({
      ideaId: idea.id,
      status: "failed",
      files: [],
      logs: [...logs, `Build crashed: ${String(err)}`],
      error: err instanceof Error ? err.message : String(err),
      startedAt: queued.startedAt,
      finishedAt: new Date().toISOString(),
    });
  }
}

/**
 * Wire a long-lived Server-Sent-Events response to store pub/sub. Subscriptions
 * are torn down when the client disconnects.
 */
function openSseStream(req: FastifyRequest, reply: FastifyReply): void {
  const raw = reply.raw;
  raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Open the stream and nudge any proxy buffering.
  raw.write(": connected\n\n");

  const send = (type: "idea" | "build", data: unknown): void => {
    try {
      raw.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    } catch (err) {
      req.log.warn({ err }, "sse write failed");
    }
  };

  const offIdea = store.onIdea((ideas) => send("idea", ideas));
  const offBuild = store.onBuild((artifact) => send("build", artifact));

  // Periodic heartbeat keeps intermediaries from closing an idle connection.
  const heartbeat = setInterval(() => {
    try {
      raw.write(": ping\n\n");
    } catch {
      /* ignore — close handler will clean up */
    }
  }, 25_000);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    offIdea();
    offBuild();
  };

  req.raw.on("close", cleanup);
  req.raw.on("error", cleanup);
}
