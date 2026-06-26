/**
 * AppTok backend entrypoint.
 *
 * Boots a Fastify v5 server with permissive CORS (so the live feed frontend can
 * connect from any origin), registers all routes, and listens on the configured
 * host/port. Handles graceful shutdown on SIGINT/SIGTERM (closing the Tavily MCP
 * connection too).
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { registerRoutes } from "./api/routes.js";
import { closeTavilyMcp } from "./agent/mcp.js";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await registerRoutes(app);

  try {
    const address = await app.listen({ port: config.port, host: config.host });
    app.log.info(`Idea Forge backend listening at ${address}`);
  } catch (err) {
    app.log.error(err, "failed to start server");
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down...`);
    try {
      await closeTavilyMcp();
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err, "error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
