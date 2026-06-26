/**
 * Deploy a freshly-built MVP to Vercel so it gets a real public URL.
 *
 * Uses the Vercel REST API (v13 inline-file deployments) with the user's token
 * (seeded from Fly secrets). After creating the deployment we best-effort
 * disable the project's SSO "deployment protection" so the MVP is publicly
 * viewable. Never throws — returns null on any failure (the build still works,
 * it just falls back to the local preview route).
 */
import { config } from "../config.js";

export interface DeployFile {
  /** Relative path, e.g. "index.html". */
  path: string;
  /** UTF-8 file content. */
  content: string;
}

/** True when a Vercel token is configured. */
export function vercelDeployAvailable(): boolean {
  return Boolean(config.vercel.token);
}

/**
 * Deploy `files` as a static Vercel project named `name`. Returns the public
 * URL (https://…) on success, or null.
 */
export async function deployToVercel(
  name: string,
  files: DeployFile[],
): Promise<string | null> {
  if (!config.vercel.token || files.length === 0) return null;
  const team = config.vercel.teamId ? `?teamId=${config.vercel.teamId}` : "";
  try {
    const res = await fetch(`https://api.vercel.com/v13/deployments${team}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.vercel.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        files: files.map((f) => ({ file: f.path, data: f.content })),
        projectSettings: { framework: null },
        target: "production",
      }),
    });
    if (!res.ok) {
      console.warn(
        `[vercel] deploy ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
      return null;
    }
    const json = (await res.json()) as { url?: string; projectId?: string };

    // Make the MVP public: disable SSO/deployment protection on the new project.
    if (json.projectId) {
      await fetch(
        `https://api.vercel.com/v9/projects/${json.projectId}${team}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${config.vercel.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ssoProtection: null }),
        },
      ).catch(() => {});
    }
    return json.url ? `https://${json.url}` : null;
  } catch (err) {
    console.warn(
      "[vercel] deploy failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
