import http from "node:http";
import https from "node:https";
import { expect, inject } from "vitest";
import type { SecurityConfig, ServerName } from "./global-setup.js";

export const cfg: SecurityConfig = inject("security");
export const isLive = cfg.mode === "live";
export const MAIN = cfg.servers.main!;

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  ms: number;
}

export interface RawOptions {
  method?: string;
  headers?: Record<string, string | string[]>;
  body?: string;
  /** In live mode, wait and retry on 429 so the shared per-IP limit doesn't fail unrelated tests. */
  retryOn429?: boolean;
  /** For methods the platform rejects before our code runs (TRACE, unknown verbs): skip the JSON-shape check. */
  platformError?: boolean;
}

function once(base: string, path: string, opts: RawOptions): Promise<RawResponse> {
  const url = new URL(base);
  const client = url.protocol === "https:" ? https : http;
  const headers: Record<string, string | string[]> = { ...(opts.headers ?? {}) };
  if (cfg.bypass) headers["x-vercel-protection-bypass"] = cfg.bypass;
  // Always frame a body with Content-Length (Node won't chunk GET/DELETE bodies, which would corrupt the stream).
  if (opts.body !== undefined) headers["Content-Length"] = String(Buffer.byteLength(opts.body));
  const started = performance.now();
  return new Promise((resolve, reject) => {
    // `path` is sent exactly as given: no URL normalization, so "../" and odd encodings reach the server.
    const req = client.request(
      { protocol: url.protocol, hostname: url.hostname, port: url.port, method: opts.method ?? "GET", path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            ms: performance.now() - started,
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(20_000, () => req.destroy(new Error("timeout")));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export async function raw(base: string, path: string, opts: RawOptions = {}): Promise<RawResponse> {
  let res = await once(base, path, opts);
  for (let attempt = 0; isLive && opts.retryOn429 !== false && res.status === 429 && attempt < 3; attempt++) {
    const wait = Number(res.headers["retry-after"] ?? 5);
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
    res = await once(base, path, opts);
  }
  checkNoLeak(res);
  // Check the shape on the path the server actually routes ("/api/../x" is "/x").
  const routed = new URL(path, "http://x").pathname;
  if (routed.startsWith("/api") && res.status >= 400 && !opts.platformError) expectCleanError(res);
  return res;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
export const authed = (token = cfg.tokenA) => ({ headers: bearer(token) });

/** GET on the main server with a valid token. */
export const api = (path: string, opts: RawOptions = {}) =>
  raw(MAIN, path, { ...opts, headers: { ...bearer(cfg.tokenA), ...(opts.headers ?? {}) } });

export function server(name: ServerName): string | undefined {
  return cfg.servers[name];
}

export function json<T = any>(res: RawResponse): T {
  return JSON.parse(res.body) as T;
}

// Signs of a stack trace or an internal path in a response.
const LEAKS = [
  /\bat [\w$.<>[\] ]+ \(/, // "at fn (file:1:2)"
  /\.(?:ts|js|mjs):\d+(?::\d+)?/, // file.ts:12:3
  /\/var\/task|\/home\/|\/Users\/|[A-Z]:\\/, // server paths
  /node_modules/,
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError):/,
];

/** No error response may contain a stack trace or a server path. (Success bodies are drug data, which can
 *  contain anything, e.g. "C:\\" inside a text, so they aren't checked.) */
export function checkNoLeak(res: RawResponse): void {
  if (res.status < 400) return;
  for (const pattern of LEAKS) {
    expect(res.body, `response leaks internals (${pattern})`).not.toMatch(pattern);
  }
}

// 413/414/431 come from the platform or Node's HTTP parser before our code runs, so they aren't JSON.
const PLATFORM_STATUSES = new Set([413, 414, 431]);

/** Every API error: JSON { error: { code, message, parameter? } } and nothing else. */
export function expectCleanError(res: RawResponse): void {
  if (PLATFORM_STATUSES.has(res.status)) return;
  expect(res.headers["content-type"], `status ${res.status} should be JSON`).toBe("application/json; charset=utf-8");
  if (res.body === "") return; // HEAD
  const body = JSON.parse(res.body);
  expect(Object.keys(body)).toEqual(["error"]);
  expect(typeof body.error.code).toBe("string");
  expect(typeof body.error.message).toBe("string");
  for (const key of Object.keys(body.error)) expect(["code", "message", "parameter"]).toContain(key);
  expect(res.headers["cache-control"]).toBe("no-store");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
