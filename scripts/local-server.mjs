// Local server for tests. It runs the output of `vercel build` (.vercel/output) with Vercel's own
// compiled routing table (config.json), so routes, rewrites and vercel.json headers match production.
// `vercel dev` would be closer still, but it needs a Vercel login.
//
// Usage: node scripts/local-server.mjs [--port 3000]
//   Env vars (API_TOKENS, RATE_LIMIT_*) are passed to the functions as on Vercel.
//
// What it copies from Vercel:
// - Client IP: x-real-ip and x-forwarded-for are overwritten with the socket address (no spoofing).
// - Function headers win over route headers with the same name.
// - Each function is loaded once and kept, like a warm instance.

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(process.env.VERCEL_OUTPUT_DIR ?? join(here, "..", ".vercel", "output"));
const STATIC = join(OUTPUT, "static");
const FUNCTIONS = join(OUTPUT, "functions");
const config = JSON.parse(readFileSync(join(OUTPUT, "config.json"), "utf8"));
const routes = config.routes ?? [];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const loaded = new Map();

function safeDecode(p) {
  try {
    return decodeURIComponent(p);
  } catch {
    return null;
  }
}

/** A path inside `root`, or null if it would escape it. */
function inside(root, p) {
  const full = resolve(root, "." + p);
  return full === root || full.startsWith(root + sep) ? full : null;
}

function findFunction(pathname) {
  const decoded = safeDecode(pathname);
  if (decoded === null) return null;
  for (const candidate of [`${decoded}.func`, `${decoded}/index.func`]) {
    const dir = inside(FUNCTIONS, candidate);
    if (dir && existsSync(join(dir, ".vc-config.json"))) return dir;
  }
  return null;
}

function findStatic(pathname) {
  const decoded = safeDecode(pathname);
  if (decoded === null) return null;
  for (const candidate of decoded.endsWith("/") ? [`${decoded}index.html`] : [decoded]) {
    const file = inside(STATIC, candidate);
    if (file && existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

function substitute(template, match) {
  return template.replace(/\$(\d+)/g, (_, n) => match[Number(n)] ?? "");
}

/** Applies a route `dest`: new path, plus any query in dest merged into the request query. */
function applyDest(state, dest, match) {
  const target = new URL(substitute(dest, match), "http://local");
  state.pathname = target.pathname;
  for (const [k, v] of target.searchParams) state.search.append(k, v);
}

async function invokeFunction(dir, request) {
  let mod = loaded.get(dir);
  if (!mod) {
    const vc = JSON.parse(readFileSync(join(dir, ".vc-config.json"), "utf8"));
    mod = await import(pathToFileURL(join(dir, vc.handler)).href);
    loaded.set(dir, mod);
  }
  const handler = mod[request.method] ?? mod.default?.fetch;
  if (typeof handler !== "function") return new Response("Method Not Allowed", { status: 405 });
  return handler(request);
}

function staticResponse(file, method, status = 200) {
  const body = method === "HEAD" ? null : readFileSync(file);
  return new Response(body, {
    status,
    headers: { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" },
  });
}

function withRouteHeaders(response, routeHeaders) {
  const headers = new Headers(routeHeaders);
  response.headers.forEach((value, key) => headers.set(key, value)); // function headers win
  return new Response(response.body, { status: response.status, headers });
}

async function tryFilesystem(state, request) {
  const fn = findFunction(state.pathname);
  if (fn) {
    const url = new URL(request.url);
    const merged = new URLSearchParams(url.search);
    for (const [k, v] of state.search) if (!merged.getAll(k).includes(v)) merged.append(k, v);
    url.search = merged.toString();
    return invokeFunction(fn, new Request(url, request));
  }
  if (request.method === "GET" || request.method === "HEAD") {
    const file = findStatic(state.pathname);
    if (file) return staticResponse(file, request.method);
  }
  return null;
}

async function routeRequest(request) {
  const url = new URL(request.url);
  const state = { pathname: url.pathname, search: new URLSearchParams() };
  const routeHeaders = new Headers();
  let i = 0;

  // Phase 1: routes before { handle: "filesystem" } (redirects, headers).
  for (; i < routes.length && !routes[i].handle; i++) {
    const r = routes[i];
    const m = new RegExp(r.src).exec(state.pathname);
    if (!m) continue;
    for (const [k, v] of Object.entries(r.headers ?? {})) routeHeaders.set(k, substitute(v, m));
    if (r.status && !r.dest) return new Response(null, { status: r.status, headers: routeHeaders });
    if (r.dest) applyDest(state, r.dest, m);
    if (!r.continue) break;
  }

  // Phase 2: filesystem (static files and functions).
  const fsResponse = await tryFilesystem(state, request);
  if (fsResponse) return withRouteHeaders(fsResponse, routeHeaders);

  // Phase 3: routes after the filesystem (rewrites, dynamic routes, fallbacks).
  i = routes.findIndex((r) => r.handle === "filesystem") + 1;
  for (; i > 0 && i < routes.length && !routes[i].handle; i++) {
    const r = routes[i];
    const m = new RegExp(r.src).exec(state.pathname);
    if (!m) continue;
    for (const [k, v] of Object.entries(r.headers ?? {})) routeHeaders.set(k, substitute(v, m));
    if (r.status && !r.dest) return new Response("NOT_FOUND", { status: r.status, headers: routeHeaders });
    if (r.dest) {
      applyDest(state, r.dest, m);
      if (r.check) {
        const res = await tryFilesystem(state, request);
        if (res) return withRouteHeaders(res, routeHeaders);
      }
    }
    if (!r.continue) break;
  }

  const notFound = findStatic("/404.html");
  return notFound
    ? withRouteHeaders(staticResponse(notFound, request.method, 404), routeHeaders)
    : new Response("NOT_FOUND", { status: 404, headers: routeHeaders });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : null;
}

export function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      }
      // Like Vercel: the platform sets the client IP. Client-sent values are replaced.
      const ip = (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
      headers.set("x-real-ip", ip);
      headers.set("x-forwarded-for", ip);

      const method = req.method ?? "GET";
      // The Fetch API can't represent these methods; platforms reject them before any function runs.
      if (["TRACE", "TRACK", "CONNECT"].includes(method)) {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
        return;
      }
      const body = method === "GET" || method === "HEAD" ? null : await readBody(req);
      const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, {
        method,
        headers,
        body,
        duplex: "half",
      });
      const response = await routeRequest(request);
      const out = {};
      response.headers.forEach((value, key) => (out[key] = value));
      res.writeHead(response.status, out);
      if (response.body && method !== "HEAD") res.end(Buffer.from(await response.arrayBuffer()));
      else res.end();
    } catch (err) {
      // A crash here is a bug in this test server, not in the API. Keep the output generic anyway.
      console.error("local-server error:", err instanceof Error ? err.message : err);
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("local server error");
    }
  });
  return new Promise((resolveListen) => {
    server.listen(port, "127.0.0.1", () => resolveListen(server));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--port");
  const port = i > 0 ? Number(process.argv[i + 1]) : 3000;
  const server = await startServer(port);
  const address = server.address();
  // The test runner waits for this line.
  console.log(`LISTENING ${typeof address === "object" && address ? address.port : port}`);
}
