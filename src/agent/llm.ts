/**
 * Shared tool-schema type. The agent now runs on the Vercel AI SDK (see
 * provider.ts + discover-agent.ts); this file only carries the OpenAI-style
 * function-tool shape that mcp.ts emits when listing the Tavily MCP tools, which
 * discover-agent.ts converts into AI SDK `dynamicTool`s.
 */

/** OpenAI-style function tool definition (as produced from MCP tool listings). */
export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
