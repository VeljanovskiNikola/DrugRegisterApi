export type ErrorCode =
  | "invalidParameter"
  | "notFound"
  | "unauthorized"
  | "methodNotAllowed"
  | "rateLimited"
  | "internalError";

/** JSON body. Security and cache headers are added by the guard (lib/guard.ts). */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

/** Every error has the same shape: { error: { code, message, parameter? } }. Never a stack trace. */
export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  parameter?: string,
  headers: Record<string, string> = {},
): Response {
  return json({ error: { code, message, ...(parameter ? { parameter } : {}) } }, status, headers);
}
