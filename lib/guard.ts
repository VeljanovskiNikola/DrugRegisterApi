import { authenticate, wwwAuthenticate } from "./auth.js";
import { errorResponse } from "./http.js";
import { getLimiters, type LimitResult } from "./ratelimit.js";
import { API_SECURITY_HEADERS, CACHE_NONE, CACHE_PRIVATE, clientIp, hashKey } from "./security.js";

export type Handler = (request: Request) => Response | Promise<Response>;

const ALLOWED = "GET, HEAD";

function retryAfter(result: LimitResult): Record<string, string> {
  const seconds = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return { "Retry-After": String(seconds) };
}

function tooMany(result: LimitResult): Response {
  const headers = retryAfter(result);
  return errorResponse(
    429,
    "rateLimited",
    `Too many requests. Try again in ${headers["Retry-After"]} seconds.`,
    undefined,
    headers,
  );
}

/** Same headers on every API response, whatever the handler set. Removes CORS and stack-revealing headers. */
function finalize(response: Response, method: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(API_SECURITY_HEADERS)) headers.set(key, value);
  headers.set("Cache-Control", response.status === 200 ? CACHE_PRIVATE : CACHE_NONE);
  headers.set("Vary", "Authorization");
  for (const key of ["access-control-allow-origin", "access-control-allow-credentials", "x-powered-by", "server"]) {
    headers.delete(key);
  }
  return new Response(method === "HEAD" ? null : response.body, { status: response.status, headers });
}

/**
 * Runs before every API handler, in this order:
 * 1. per-IP rate limit (so floods and token guessing are throttled before any other work)
 * 2. method check (GET and HEAD only)
 * 3. Bearer token
 * 4. per-token rate limit
 * 5. the handler, with any thrown error turned into a clean 500
 */
async function guard(request: Request, handler: Handler): Promise<Response> {
  const method = request.method.toUpperCase();
  try {
    const limiters = getLimiters();

    const ipResult = await limiters.ip.limit(`ip:${hashKey(clientIp(request))}`);
    if (!ipResult.success) return finalize(tooMany(ipResult), method);

    if (method !== "GET" && method !== "HEAD") {
      return finalize(
        errorResponse(405, "methodNotAllowed", `Method ${method.slice(0, 16)} is not allowed. Use GET.`, undefined, {
          Allow: ALLOWED,
        }),
        method,
      );
    }

    const auth = authenticate(request);
    if (!auth.ok) {
      const message =
        auth.reason === "invalid"
          ? "Invalid API token."
          : "Missing API token. Send the header Authorization: Bearer <token>.";
      if (auth.reason === "notConfigured") console.error("API_TOKENS is not set. All API requests are refused.");
      return finalize(
        errorResponse(401, "unauthorized", message, undefined, { "WWW-Authenticate": wwwAuthenticate(auth.reason) }),
        method,
      );
    }

    const tokenResult = await limiters.token.limit(`token:${hashKey(auth.token)}`);
    if (!tokenResult.success) return finalize(tooMany(tokenResult), method);

    return finalize(await handler(request), method);
  } catch (err) {
    // Log only the message. Never send details to the client.
    console.error("unhandled error:", err instanceof Error ? err.message : "unknown");
    return finalize(errorResponse(500, "internalError", "Something went wrong."), method);
  }
}

/** Method exports for a Vercel function file. Every method goes through the guard. */
export function route(handler: Handler) {
  const run = (request: Request) => guard(request, handler);
  return { GET: run, HEAD: run, POST: run, PUT: run, PATCH: run, DELETE: run, OPTIONS: run };
}
