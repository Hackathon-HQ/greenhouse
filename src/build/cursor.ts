/**
 * Auto-build step: turn an {@link AppIdea} into a runnable {@link BuildArtifact}.
 *
 * Two paths, exactly as specified by the contract:
 *
 *   1) LIVE — when `config.cursor.enabled && config.cursor.apiKey`, shell out to
 *      the `cursor-agent` headless CLI (per the Cursor research notes) inside a
 *      fresh directory `config.cursor.buildsDir/<idea.id>`. stdout/stderr lines
 *      are streamed to `onLog` and captured into `artifact.logs`. A kill-timeout
 *      guards against the known headless-hang bug; on any failure we fall back.
 *
 *   2) FALLBACK — always available. Deterministically scaffolds a minimal but
 *      real static MVP (index.html + README.md + package.json) into the build
 *      dir. Used whenever the live path is disabled, unavailable, or errors.
 *
 * This module never throws: every failure is captured into the returned
 * artifact with `status: "failed"` and a populated `error` string.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { config } from "../config.js";
import type { AppIdea, BuildArtifact } from "../types.js";

/**
 * PATH for the spawned cursor-agent process. When the backend is launched via
 * `npm`/a service manager, `~/.local/bin` (the CLI's default install location)
 * is often absent from PATH, so we prepend it explicitly.
 */
function cursorSpawnPath(): string {
  const localBin = path.join(os.homedir(), ".local", "bin");
  const current = process.env.PATH ?? "";
  return current.split(path.delimiter).includes(localBin)
    ? current
    : `${localBin}${path.delimiter}${current}`;
}

/** A no-op logger used when the caller does not supply one. */
function noopLog(_line: string): void {
  /* intentionally empty */
}

/**
 * Append a line to the artifact logs and forward it to the caller's sink.
 * Keeps the two in lockstep so the UI and the stored artifact never diverge.
 */
function pushLog(
  artifact: BuildArtifact,
  onLog: (line: string) => void,
  line: string,
): void {
  artifact.logs.push(line);
  try {
    onLog(line);
  } catch {
    /* a faulty consumer must never break the build */
  }
}

/**
 * Recursively walk `dir` and return POSIX-style relative paths of every file
 * found (directories are descended into but not themselves listed). Resilient:
 * returns whatever it managed to collect even if a subtree is unreadable.
 */
async function walkFiles(dir: string, base: string = dir): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip noisy/heavy dirs that a live build might create.
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      out.push(...(await walkFiles(abs, base)));
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs).split(path.sep).join("/"));
    }
  }
  return out;
}

/** Escape a string for safe inclusion in HTML text/attribute content. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the natural-language prompt handed to `cursor-agent`, derived from the
 * idea's title, pitch, MVP features and suggested stack.
 *
 * The prompt is deliberately constrained for a hackathon-style *preview*: we
 * want a SINGLE self-contained `index.html` (inline CSS + vanilla JS, no build
 * step, no npm install) that opens directly via `file://`. This keeps live
 * Cursor builds fast (~30-90s) and the result instantly previewable, rather
 * than a heavy multi-package project that needs `npm install` + a dev server.
 */
function buildPrompt(idea: AppIdea): string {
  const features = (
    idea.mvpFeatures.length
      ? idea.mvpFeatures
      : ["A minimal but functional core experience"]
  )
    .map((f) => `- ${f}`)
    .join("\n");

  const lines = [
    `Build a working MVP web app in the CURRENT directory for a product called "${idea.title}".`,
    ``,
    `Elevator pitch: ${idea.pitch}`,
  ];
  if (idea.description) lines.push(`What it is: ${idea.description}`);
  lines.push(
    `Problem it solves: ${idea.problem}`,
    `Target user: ${idea.targetUser}`,
    ``,
    `Implement these MVP features so they actually work (real interactivity, not mockups):`,
    features,
    ``,
    `HARD CONSTRAINTS — follow exactly:`,
    `1. Produce a SINGLE file named "index.html" in the current directory.`,
    `2. Put ALL CSS in a <style> tag and ALL JavaScript in a <script> tag inline — no external files, no CDN frameworks, no imports, no build step.`,
    `3. Use only vanilla HTML/CSS/JS. It MUST open and fully work by double-clicking the file (file:// protocol) with no server and no "npm install".`,
    `4. Persist any user data with localStorage where it makes sense.`,
    `5. Make it look polished and modern (clean layout, good spacing, a cohesive color theme, responsive). This is a demo people will judge on looks.`,
    `6. Do not create a package.json, README, node_modules, or any other files — just index.html.`,
    ``,
    `Be fast and decisive. Write the file, then stop.`,
  );
  return lines.join("\n");
}

/**
 * Best-effort human-readable rendering of a single `stream-json` event line
 * emitted by `cursor-agent --output-format stream-json`. Returns `null` when
 * the event carries nothing worth logging. Also reports whether the event was
 * the terminal `result` event and, if so, whether it signalled an error.
 */
function renderStreamEvent(raw: string): {
  line: string | null;
  result?: { isError: boolean };
} {
  let ev: any;
  try {
    ev = JSON.parse(raw);
  } catch {
    // Not JSON — surface verbatim so nothing is silently swallowed.
    return { line: raw };
  }

  switch (ev?.type) {
    case "system":
      if (ev.subtype === "init") {
        return { line: `init — model=${ev.model ?? "?"} cwd=${ev.cwd ?? "?"}` };
      }
      return { line: null };
    case "tool_call": {
      const tc = ev.tool_call ?? {};
      const edit = tc.editToolCall;
      const shell = tc.shellToolCall ?? tc.bashToolCall;
      if (edit) {
        const p = edit.args?.path ?? "(file)";
        const name = path.basename(String(p));
        if (ev.subtype === "started") return { line: `editing ${name}…` };
        const added = edit.args?.result?.success?.linesAdded;
        return {
          line: `wrote ${name}${added != null ? ` (+${added} lines)` : ""}`,
        };
      }
      if (shell) {
        const cmd = shell.args?.command ?? shell.args?.cmd ?? "(command)";
        if (ev.subtype === "started")
          return { line: `running: ${String(cmd).slice(0, 120)}` };
        return { line: null };
      }
      // Unknown tool — only log the start so we don't double up.
      return { line: ev.subtype === "started" ? `tool: ${Object.keys(tc)[0] ?? "?"}` : null };
    }
    case "assistant": {
      const parts = ev.message?.content;
      if (Array.isArray(parts)) {
        const text = parts
          .filter((p: any) => p?.type === "text")
          .map((p: any) => p.text)
          .join(" ")
          .trim();
        return { line: text ? `agent: ${text}` : null };
      }
      return { line: null };
    }
    case "result": {
      const secs = ev.duration_ms ? (ev.duration_ms / 1000).toFixed(1) : "?";
      return {
        line: `finished in ${secs}s (${ev.is_error ? "error" : "ok"})`,
        result: { isError: Boolean(ev.is_error) },
      };
    }
    default:
      return { line: null };
  }
}

/**
 * Run the live `cursor-agent` headless build inside `dir`. Resolves to `true`
 * on a clean exit (code 0), `false` otherwise. Never rejects — failures are
 * logged into the artifact and surfaced as a `false` return so the caller can
 * fall back to the deterministic scaffold.
 */
function runCursorAgent(
  idea: AppIdea,
  dir: string,
  artifact: BuildArtifact,
  onLog: (line: string) => void,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const prompt = buildPrompt(idea);
    pushLog(artifact, onLog, `[cursor] spawning cursor-agent in ${dir}`);

    let child;
    try {
      child = spawn(
        config.cursor.cliPath,
        [
          "--print",
          "--force",
          "--trust",
          "--output-format",
          "stream-json",
          "--model",
          config.cursor.model,
          prompt,
        ],
        {
          cwd: dir,
          env: {
            ...process.env,
            PATH: cursorSpawnPath(),
            CURSOR_API_KEY: config.cursor.apiKey,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (err) {
      pushLog(
        artifact,
        onLog,
        `[cursor] failed to spawn: ${err instanceof Error ? err.message : String(err)}`,
      );
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };

    // Guard against the documented headless-hang bug.
    const timer = setTimeout(() => {
      pushLog(
        artifact,
        onLog,
        `[cursor] timed out after ${config.cursor.timeoutMs}ms — killing agent`,
      );
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      finish(false);
    }, config.cursor.timeoutMs);

    // Tracks the terminal `result` event's error flag, if seen.
    let resultIsError: boolean | undefined;

    // stdout carries newline-delimited stream-json events; parse + humanize.
    let outBuf = "";
    child.stdout?.on("data", (chunk: Buffer): void => {
      outBuf += chunk.toString("utf8");
      let nl = outBuf.indexOf("\n");
      while (nl !== -1) {
        const raw = outBuf.slice(0, nl).replace(/\r$/, "");
        outBuf = outBuf.slice(nl + 1);
        nl = outBuf.indexOf("\n");
        if (!raw.length) continue;
        const { line, result } = renderStreamEvent(raw);
        if (result) resultIsError = result.isError;
        if (line) pushLog(artifact, onLog, `[cursor] ${line}`);
      }
    });

    // stderr is plain text (warnings/errors); surface verbatim.
    let errBuf = "";
    child.stderr?.on("data", (chunk: Buffer): void => {
      errBuf += chunk.toString("utf8");
      let nl = errBuf.indexOf("\n");
      while (nl !== -1) {
        const line = errBuf.slice(0, nl).replace(/\r$/, "");
        errBuf = errBuf.slice(nl + 1);
        nl = errBuf.indexOf("\n");
        if (line.length) pushLog(artifact, onLog, `[cursor:stderr] ${line}`);
      }
    });

    child.on("error", (err) => {
      pushLog(
        artifact,
        onLog,
        `[cursor] process error: ${err instanceof Error ? err.message : String(err)}`,
      );
      finish(false);
    });

    child.on("close", (code) => {
      pushLog(artifact, onLog, `[cursor] exited with code ${code}`);
      // Success requires a clean exit AND no error signalled by the agent.
      finish(code === 0 && resultIsError !== true);
    });
  });
}

/**
 * Deterministically scaffold a minimal, runnable static MVP into `dir`:
 * a styled `index.html` (pitch + MVP feature checklist), a `README.md`, and a
 * `package.json` whose `start` script serves the folder. Returns nothing; the
 * caller walks the directory to populate `files[]`.
 */
async function writeFallbackScaffold(
  idea: AppIdea,
  dir: string,
  artifact: BuildArtifact,
  onLog: (line: string) => void,
): Promise<void> {
  pushLog(artifact, onLog, "[fallback] writing deterministic MVP scaffold");

  const safeTitle = escapeHtml(idea.title);
  const safePitch = escapeHtml(idea.pitch);
  const safeProblem = escapeHtml(idea.problem);
  const safeTarget = escapeHtml(idea.targetUser);

  const featureItems = (
    idea.mvpFeatures.length ? idea.mvpFeatures : ["Core experience"]
  )
    .map(
      (f) =>
        `        <li><label><input type="checkbox" /> <span>${escapeHtml(
          f,
        )}</span></label></li>`,
    )
    .join("\n");

  const stackChips = (idea.suggestedStack.length ? idea.suggestedStack : ["static"])
    .map((s) => `<span class="chip">${escapeHtml(s)}</span>`)
    .join("\n          ");

  const tagChips = (idea.tags.length ? idea.tags : [])
    .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
    .join(" ");

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root {
        --bg: #0b0d12;
        --card: #151923;
        --fg: #e8ecf4;
        --muted: #9aa6b8;
        --accent: #6ea8fe;
        --accent2: #b58cff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background: radial-gradient(1200px 600px at 20% -10%, #1c2536 0%, var(--bg) 55%);
        color: var(--fg);
        min-height: 100vh;
        display: flex;
        justify-content: center;
        padding: 48px 20px;
      }
      .card {
        width: 100%;
        max-width: 720px;
        background: var(--card);
        border: 1px solid #232a38;
        border-radius: 18px;
        padding: 40px;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
      }
      h1 {
        margin: 0 0 6px;
        font-size: 2rem;
        background: linear-gradient(90deg, var(--accent), var(--accent2));
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }
      .pitch { font-size: 1.15rem; color: var(--fg); margin: 0 0 20px; }
      .meta { color: var(--muted); font-size: 0.95rem; line-height: 1.6; margin-bottom: 24px; }
      .meta b { color: var(--fg); font-weight: 600; }
      h2 { font-size: 1rem; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); margin: 28px 0 12px; }
      ul { list-style: none; padding: 0; margin: 0; }
      li { margin: 8px 0; }
      label { display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 10px 12px; border: 1px solid #232a38; border-radius: 10px; transition: border-color 0.15s ease, transform 0.05s ease; }
      label:hover { border-color: var(--accent); }
      input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--accent); }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      .chip { font-size: 0.8rem; color: var(--accent); border: 1px solid #2a3650; background: #121a2a; padding: 4px 10px; border-radius: 999px; }
      .tags { margin-top: 24px; color: var(--muted); font-size: 0.85rem; }
      .tag { color: var(--accent2); }
      footer { margin-top: 28px; color: var(--muted); font-size: 0.8rem; border-top: 1px solid #232a38; padding-top: 16px; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${safeTitle}</h1>
      <p class="pitch">${safePitch}</p>
      <p class="meta">
        <b>Problem:</b> ${safeProblem}<br />
        <b>For:</b> ${safeTarget}<br />
        <b>Buildability:</b> ${escapeHtml(idea.buildability)}
      </p>

      <h2>MVP Checklist</h2>
      <ul>
${featureItems}
      </ul>

      <h2>Suggested Stack</h2>
      <div class="chips">
          ${stackChips}
      </div>

      ${tagChips ? `<div class="tags">${tagChips}</div>` : ""}

      <footer>Scaffolded by AppTok — generated MVP for idea <code>${escapeHtml(
        idea.id,
      )}</code>.</footer>
    </main>
  </body>
</html>
`;

  const readme = `# ${idea.title}

> ${idea.pitch}

**Problem.** ${idea.problem}

**Target user.** ${idea.targetUser}

**Buildability.** ${idea.buildability}

## MVP Features

${(idea.mvpFeatures.length ? idea.mvpFeatures : ["Core experience"]).map((f) => `- [ ] ${f}`).join("\n")}

## Suggested Stack

${(idea.suggestedStack.length ? idea.suggestedStack : ["static"]).map((s) => `- ${s}`).join("\n")}

## Run it

\`\`\`bash
npm start
\`\`\`

This serves the static \`index.html\` on a local port using \`npx serve\`.

${idea.tags.length ? `## Tags\n\n${idea.tags.map((t) => `\`${t}\``).join(" ")}\n` : ""}
---
_Auto-generated by AppTok for idea \`${idea.id}\`._
`;

  const pkg = {
    name: idea.id,
    version: "0.1.0",
    private: true,
    description: idea.pitch,
    scripts: {
      start: "npx serve .",
    },
  };

  await fs.writeFile(path.join(dir, "index.html"), indexHtml, "utf8");
  await fs.writeFile(path.join(dir, "README.md"), readme, "utf8");
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n",
    "utf8",
  );

  pushLog(
    artifact,
    onLog,
    "[fallback] wrote index.html, README.md, package.json",
  );
}

/**
 * Build a minimal MVP for `idea`.
 *
 * Attempts the live `cursor-agent` headless build when configured; otherwise
 * (or on any live-path failure) deterministically scaffolds a runnable static
 * MVP. Streams progress to `onLog` and never throws — errors are captured into
 * the returned {@link BuildArtifact}.
 *
 * @param idea  The idea to materialize into a project on disk.
 * @param onLog Optional sink for streamed build log lines (mirrors artifact.logs).
 * @returns A fully populated BuildArtifact (status, files, logs, timing).
 */
export async function buildIdea(
  idea: AppIdea,
  onLog?: (line: string) => void,
): Promise<BuildArtifact> {
  const log = onLog ?? noopLog;
  const buildsDir = path.resolve(config.cursor.buildsDir);
  const dir = path.join(buildsDir, idea.id);

  const artifact: BuildArtifact = {
    ideaId: idea.id,
    status: "building",
    workdir: dir,
    files: [],
    logs: [],
    startedAt: new Date().toISOString(),
  };

  try {
    // Fresh build directory.
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    pushLog(artifact, log, `[build] prepared ${dir}`);

    const liveAvailable = config.cursor.enabled && Boolean(config.cursor.apiKey);
    let liveOk = false;

    if (liveAvailable) {
      pushLog(artifact, log, "[build] attempting live Cursor build");
      try {
        liveOk = await runCursorAgent(idea, dir, artifact, log);
      } catch (err) {
        pushLog(
          artifact,
          log,
          `[build] live path threw: ${err instanceof Error ? err.message : String(err)}`,
        );
        liveOk = false;
      }
      if (!liveOk) {
        pushLog(
          artifact,
          log,
          "[build] live Cursor build unavailable/failed — using fallback scaffold",
        );
      }
    } else {
      pushLog(
        artifact,
        log,
        "[build] Cursor disabled or no API key — using fallback scaffold",
      );
    }

    // If the live build produced nothing usable, scaffold deterministically.
    let producedFiles = liveOk ? await walkFiles(dir) : [];
    if (!liveOk || producedFiles.length === 0) {
      await writeFallbackScaffold(idea, dir, artifact, log);
      producedFiles = await walkFiles(dir);
    }

    artifact.files = producedFiles;

    // Prefer index.html as the preview entrypoint when present.
    const indexRel = producedFiles.find((f) => f === "index.html");
    if (indexRel) {
      artifact.previewUrl = pathToFileURL(path.join(dir, indexRel)).href;
    } else {
      artifact.previewUrl = undefined;
    }

    artifact.status = "succeeded";
    pushLog(
      artifact,
      log,
      `[build] succeeded with ${artifact.files.length} file(s)`,
    );
  } catch (err) {
    artifact.status = "failed";
    artifact.error = err instanceof Error ? err.message : String(err);
    // Best-effort: surface whatever was written so far.
    try {
      artifact.files = await walkFiles(dir);
    } catch {
      /* ignore */
    }
    pushLog(artifact, log, `[build] failed: ${artifact.error}`);
  } finally {
    artifact.finishedAt = new Date().toISOString();
  }

  return artifact;
}
