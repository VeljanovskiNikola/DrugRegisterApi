import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TestProject } from "vitest/node";

// Two made-up tokens for local runs only. Real tokens live in Vercel env vars, never in git.
export const TOKEN_A = "local-test-token-a-8f3c1e0b9d2a4f6c";
export const TOKEN_B = "local-test-token-b-51d7a9e2c4b8f03e";

export type ServerName = "main" | "ipLimited" | "tokenLimited" | "noTokens" | "rotated" | "brokenData";

export interface SecurityConfig {
  mode: "local" | "live";
  servers: Partial<Record<ServerName, string>>;
  tokenA: string;
  tokenB?: string;
  bypass?: string;
  liveRateLimit: boolean;
  liveIpLimit: number;
  rateWindowSeconds: number;
}

declare module "vitest" {
  export interface ProvidedContext {
    security: SecurityConfig;
  }
}

const ROOT = resolve(import.meta.dirname, "..", "..");
const children: ChildProcess[] = [];

function buildWithVercel(): void {
  if (process.env.SKIP_VERCEL_BUILD === "1" && existsSync(join(ROOT, ".vercel", "output", "config.json"))) return;
  const projectFile = join(ROOT, ".vercel", "project.json");
  if (!existsSync(projectFile)) {
    // A local-only project file so `vercel build` runs without a login. Not committed (.vercel/ is ignored).
    mkdirSync(join(ROOT, ".vercel"), { recursive: true });
    writeFileSync(
      projectFile,
      JSON.stringify({
        projectId: "prj_local",
        orgId: "team_local",
        settings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null, nodeVersion: "22.x" },
      }),
    );
  }
  const result = spawnSync("npx", ["--yes", "vercel@60", "build", "--yes"], {
    cwd: ROOT,
    env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`vercel build failed:\n${result.stdout}\n${result.stderr}`);
}

function startServer(env: Record<string, string>, cwd = ROOT): Promise<string> {
  const child = spawn(process.execPath, [join(ROOT, "scripts", "local-server.mjs"), "--port", "0"], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      // Never let a local test server talk to a real Upstash.
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error("local server did not start")), 15_000);
    let log = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      log += chunk.toString();
      const m = /LISTENING (\d+)/.exec(log);
      if (m) {
        clearTimeout(timer);
        resolveUrl(`http://127.0.0.1:${m[1]}`);
      }
    });
    child.stderr!.on("data", () => {}); // functions log expected errors (e.g. missing data file)
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`local server exited early (code ${code}): ${log}`));
    });
  });
}

export default async function setup(project: TestProject) {
  const window = 2;
  const liveBase = process.env.BASE_URL?.replace(/\/$/, "");

  if (liveBase) {
    const token = process.env.API_TOKEN;
    if (!token) throw new Error("Live mode needs API_TOKEN (a real token from your Vercel env vars).");
    project.provide("security", {
      mode: "live",
      servers: { main: liveBase },
      tokenA: token,
      tokenB: process.env.API_TOKEN_2,
      bypass: process.env.VERCEL_PROTECTION_BYPASS,
      liveRateLimit: process.env.SECURITY_TEST_RATE_LIMIT === "1",
      liveIpLimit: Number(process.env.LIVE_IP_LIMIT ?? 120),
      rateWindowSeconds: Number(process.env.LIVE_WINDOW_SECONDS ?? 60),
    });
    return;
  }

  buildWithVercel();
  const both = `${TOKEN_A},${TOKEN_B}`;
  const high = "1000000";
  const brokenCwd = mkdtempSync(join(tmpdir(), "drug-api-broken-")); // no public/data here → load fails

  const [main, ipLimited, tokenLimited, noTokens, rotated, brokenData] = await Promise.all([
    startServer({ API_TOKENS: both, RATE_LIMIT_IP_MAX: high, RATE_LIMIT_TOKEN_MAX: high }),
    startServer({ API_TOKENS: both, RATE_LIMIT_IP_MAX: "5", RATE_LIMIT_TOKEN_MAX: high, RATE_LIMIT_WINDOW_SECONDS: String(window) }),
    startServer({ API_TOKENS: both, RATE_LIMIT_IP_MAX: high, RATE_LIMIT_TOKEN_MAX: "5", RATE_LIMIT_WINDOW_SECONDS: String(window) }),
    startServer({ API_TOKENS: "", RATE_LIMIT_IP_MAX: high }),
    startServer({ API_TOKENS: TOKEN_B, RATE_LIMIT_IP_MAX: high }), // TOKEN_A was rotated out
    startServer({ API_TOKENS: both, RATE_LIMIT_IP_MAX: high }, brokenCwd),
  ]);

  project.provide("security", {
    mode: "local",
    servers: { main, ipLimited, tokenLimited, noTokens, rotated, brokenData },
    tokenA: TOKEN_A,
    tokenB: TOKEN_B,
    liveRateLimit: false,
    liveIpLimit: 0,
    rateWindowSeconds: window,
  });

  return async () => {
    for (const child of children) child.kill();
  };
}
