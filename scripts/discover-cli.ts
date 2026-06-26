/**
 * CLI runner for the discovery pipeline.
 *
 * Usage:
 *   npm run discover                      # uses config.defaultTopics
 *   npm run discover -- "ai tools" devtools
 *
 * Prints a ranked table (rank, score, title, buildability, sources) followed by
 * the full ranked JSON, then exits 0.
 */
import { runDiscovery } from "../src/pipeline/discover.js";
import type { AppIdea } from "../src/types.js";

function pad(value: string, width: number): string {
  const s = value.length > width ? `${value.slice(0, width - 1)}…` : value;
  return s.padEnd(width);
}

function printTable(ideas: AppIdea[]): void {
  const header =
    `${pad("#", 4)}${pad("SCORE", 8)}${pad("TITLE", 40)}` +
    `${pad("BUILDABILITY", 14)}SOURCES`;
  console.log(header);
  console.log("-".repeat(header.length + 10));
  ideas.forEach((idea, i) => {
    console.log(
      `${pad(String(i + 1), 4)}` +
        `${pad((idea.score ?? 0).toFixed(3), 8)}` +
        `${pad(idea.title ?? "", 40)}` +
        `${pad(idea.buildability ?? "", 14)}` +
        `${(idea.sources ?? []).join(", ")}`,
    );
  });
}

async function main(): Promise<void> {
  const topics = process.argv.slice(2).map((t) => t.trim()).filter(Boolean);
  const input = topics.length ? { topics } : {};

  console.log(
    topics.length
      ? `Discovering ideas for topics: ${topics.join(", ")}`
      : "Discovering ideas for default topics...",
  );

  const ideas = await runDiscovery(input);

  console.log(`\nFound ${ideas.length} ranked idea(s):\n`);
  printTable(ideas);
  console.log("\nFull JSON:\n");
  console.log(JSON.stringify(ideas, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("discovery failed:", err);
  process.exit(1);
});
