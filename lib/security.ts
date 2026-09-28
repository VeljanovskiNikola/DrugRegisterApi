import { createHash } from "node:crypto";

/** Headers on every API response. JSON never needs to render, run scripts, or be framed. */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
};

// Responses need a token, so no shared cache (CDN, proxy) may store them. The app may keep them briefly.
export const CACHE_PRIVATE = "private, max-age=300";
export const CACHE_NONE = "no-store";

/** Short SHA-256 hex, used so raw tokens and IPs never reach logs or the rate-limit store. */
export function hashKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

/**
 * Client IP. On Vercel, x-real-ip and x-forwarded-for are set by the platform and client values are
 * overwritten, so they can't be spoofed. The local test server does the same.
 */
export function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded.slice(0, 64);
  return "unknown";
}
