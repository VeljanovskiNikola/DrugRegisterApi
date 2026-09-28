import { createHash, timingSafeEqual } from "node:crypto";

export const AUTH_REALM = "drug-register-api";

// RFC 6750 b64token. One or more spaces after the scheme; the scheme is case-insensitive.
// No nested quantifiers, and "=" is not in the first class, so matching is linear.
export const BEARER_PATTERN = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;
const MAX_HEADER_LENGTH = 1024;

export type AuthResult =
  | { ok: true; token: string }
  | { ok: false; reason: "missing" | "invalid" | "notConfigured" };

let cachedRaw: string | undefined;
let cachedDigests: Buffer[] = [];

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Valid tokens from API_TOKENS (comma-separated). Stored only as SHA-256 digests. */
function validDigests(): Buffer[] {
  const raw = process.env.API_TOKENS ?? "";
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedDigests = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .map(sha256);
  }
  return cachedDigests;
}

/**
 * Constant-time check. Both sides are hashed to 32 bytes first, so timingSafeEqual always compares
 * equal lengths and the token length doesn't leak. Every valid token is checked, even after a match,
 * so timing doesn't reveal which token matched or how many there are before it.
 */
export function isValidToken(candidate: string): boolean {
  const digest = sha256(candidate);
  let match = false;
  for (const valid of validDigests()) {
    if (timingSafeEqual(digest, valid)) match = true;
  }
  return match;
}

/** Reads only the Authorization header. Tokens in the query string, cookies or other headers are ignored. */
export function authenticate(request: Request): AuthResult {
  if (validDigests().length === 0) return { ok: false, reason: "notConfigured" };

  const header = request.headers.get("authorization");
  if (header === null || header.trim() === "") return { ok: false, reason: "missing" };
  if (header.length > MAX_HEADER_LENGTH) return { ok: false, reason: "invalid" };

  const match = BEARER_PATTERN.exec(header.trim());
  if (!match?.[1]) return { ok: false, reason: "invalid" };
  const token = match[1];
  return isValidToken(token) ? { ok: true, token } : { ok: false, reason: "invalid" };
}

/** RFC 6750 challenge. error="invalid_token" only when a token was sent. */
export function wwwAuthenticate(reason: "missing" | "invalid" | "notConfigured"): string {
  return reason === "invalid"
    ? `Bearer realm="${AUTH_REALM}", error="invalid_token"`
    : `Bearer realm="${AUTH_REALM}"`;
}
