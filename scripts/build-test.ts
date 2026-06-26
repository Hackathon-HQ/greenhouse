/**
 * Throwaway end-to-end test of the auto-build feature.
 *
 *   timeout 360 npx tsx scripts/build-test.ts
 *
 * Constructs a small sample AppIdea and runs buildIdea against the REAL
 * cursor-agent CLI, streaming logs to stdout, then prints the produced files.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { buildIdea } from "../src/build/cursor.js";
import type { AppIdea } from "../src/types.js";

const idea: AppIdea = {
  id: "idea-freelance-tip-calculator",
  title: "Tip Calculator for Freelancers",
  pitch: "Quickly split a client invoice tip and see your take-home per hour.",
  description:
    "A tiny calculator that helps freelancers add a service tip to an invoice, split it across collaborators, and instantly see the per-person and effective hourly amount.",
  problem:
    "Freelancers waste time doing tip/split math by hand when invoicing clients.",
  targetUser: "Independent freelancers and small creative collectives.",
  mvpFeatures: [
    "Enter an invoice/bill amount and pick a tip percentage (with quick presets)",
    "Split the total across an adjustable number of people",
    "Show tip, grand total, and per-person amount live as you type",
  ],
  suggestedStack: ["static", "vanilla-js"],
  buildability: "trivial",
  tags: ["finance", "freelance", "calculator"],
  score: 0.5,
  signals: { demand: 0.5, recency: 0.5, novelty: 0.5, feasibility: 0.9 },
  evidence: [],
  sourceSignalIds: [],
  sources: [],
  createdAt: new Date().toISOString(),
};

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log(`=== buildIdea("${idea.id}") ===\n`);

  const artifact = await buildIdea(idea, (line) => console.log(line));

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== build ${artifact.status} in ${secs}s ===`);
  console.log("workdir:   ", artifact.workdir);
  console.log("previewUrl:", artifact.previewUrl);
  console.log("error:     ", artifact.error ?? "(none)");
  console.log("files:     ", artifact.files);

  // Peek at the produced entrypoint to prove it's real.
  if (artifact.workdir) {
    const index = path.join(artifact.workdir, "index.html");
    try {
      const html = await fs.readFile(index, "utf8");
      console.log(`\n=== index.html (${html.length} bytes), first 25 lines ===`);
      console.log(html.split("\n").slice(0, 25).join("\n"));
    } catch {
      console.log("\n(no index.html to preview)");
    }
  }

  process.exit(artifact.status === "succeeded" ? 0 : 1);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
