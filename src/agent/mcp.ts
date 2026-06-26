/**
 * Tavily MCP integration. Spawns the `tavily-mcp` server over stdio, lists its
 * tools, and exposes them to the agent loop as OpenAI-style function tools.
 *
 * The agent calls e.g. `tavily_search` / `tavily_extract` exactly as it would
 * any other function; {@link callMcpTool} bridges the call to the MCP server and
 * returns the textual result. A single connection is reused per process.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { config } from "../config.js";
import type { ToolDef } from "./llm.js";

interface McpHandle {
  client: Client;
  /** MCP tool name -> nothing; presence means "this tool routes to MCP". */
  toolNames: Set<string>;
  toolDefs: ToolDef[];
}

let handlePromise: Promise<McpHandle | null> | null = null;

/** JSON-schema-ish shape MCP advertises for a tool's input. */
interface McpInputSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

/**
 * Connect to the Tavily MCP server (idempotent — the connection is cached).
 * Returns null when MCP is disabled or the Tavily key is missing, so callers
 * can degrade gracefully to the non-MCP tools.
 */
export function getTavilyMcp(): Promise<McpHandle | null> {
  if (!config.tavilyMcp.enabled || !config.tavily.apiKey) {
    return Promise.resolve(null);
  }
  if (!handlePromise) {
    handlePromise = connect().catch((err) => {
      // Reset so a later call can retry a fresh connection.
      handlePromise = null;
      console.warn(
        `[mcp] Tavily MCP connection failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    });
  }
  return handlePromise;
}

async function connect(): Promise<McpHandle> {
  const transport = new StdioClientTransport({
    command: config.tavilyMcp.command,
    args: config.tavilyMcp.args,
    env: { ...process.env, TAVILY_API_KEY: config.tavily.apiKey },
  });
  const client = new Client(
    { name: "apptok-agent", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  const { tools } = await client.listTools();
  const toolNames = new Set<string>();
  const toolDefs: ToolDef[] = [];
  for (const t of tools) {
    toolNames.add(t.name);
    const schema = (t.inputSchema ?? {}) as McpInputSchema;
    toolDefs.push({
      type: "function",
      function: {
        name: t.name,
        description: (t.description ?? "").slice(0, 1024),
        parameters: {
          type: "object",
          properties: schema.properties ?? {},
          required: schema.required ?? [],
        },
      },
    });
  }
  console.log(
    `[mcp] Tavily MCP connected — ${toolDefs.length} tools: ${[...toolNames].join(", ")}`,
  );
  return { client, toolNames, toolDefs };
}

/**
 * Invoke an MCP tool by name and return its result flattened to text (the agent
 * only consumes text). Never throws — errors are returned as a string the model
 * can read and react to.
 */
export async function callMcpTool(
  handle: McpHandle,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    const result = await handle.client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as Array<{
      type: string;
      text?: string;
    }>;
    const text = content
      .map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`))
      .join("\n")
      .trim();
    return text || "(empty result)";
  } catch (err) {
    return `ERROR calling ${name}: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}

/** Cleanly close the MCP connection (called on server shutdown). */
export async function closeTavilyMcp(): Promise<void> {
  const handle = await handlePromise?.catch(() => null);
  if (handle) {
    await handle.client.close().catch(() => {});
  }
  handlePromise = null;
}
