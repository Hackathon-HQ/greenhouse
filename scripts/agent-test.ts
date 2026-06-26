/**
 * Live end-to-end test of the agentic idea scout.
 * Runs runAgenticDiscovery against the real umans-7 + Tavily MCP + Reddit/HN.
 */
import { runAgenticDiscovery, agenticAvailable } from "../src/agent/discover-agent.js";
import { closeTavilyMcp } from "../src/agent/mcp.js";

async function main(): Promise<void> {
  console.log("agentic available:", agenticAvailable());
  const topic = process.argv.slice(2).join(" ") || "developer productivity";
  console.log(`\n=== Running agentic discovery for: "${topic}" ===\n`);

  const t0 = Date.now();
  const ideas = await runAgenticDiscovery(
    { topics: [topic] },
    (line) => console.log(line),
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n=== ${ideas.length} idea(s) in ${secs}s ===\n`);
  for (const idea of ideas) {
    console.log(`● ${idea.title}  [score ${idea.score.toFixed(3)} | ${idea.buildability} | ${idea.intent ?? "?"} | ${idea.sources.join("+")}]`);
    console.log(`   ${idea.pitch}`);
    console.log(`   desc: ${idea.description}`);
    if (idea.sourceQuote) console.log(`   quote: "${idea.sourceQuote}"`);
    console.log(`   features: ${idea.mvpFeatures.join("; ")}`);
    console.log(`   evidence: ${idea.sourceSignalIds.slice(0, 3).join(", ") || "(none)"}`);
    console.log();
  }

  await closeTavilyMcp();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
