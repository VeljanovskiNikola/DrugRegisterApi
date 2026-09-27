// Data only changes on a new deploy, and Vercel's CDN cache is cleared on each deploy.
// So the CDN can keep responses for a day. Apps keep them for an hour.
const CACHE_OK = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";
const CACHE_ERROR = "public, max-age=60, s-maxage=300";

export type ErrorCode = "invalidParameter" | "notFound" | "internalError";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status < 400 ? CACHE_OK : status < 500 ? CACHE_ERROR : "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function errorResponse(status: number, code: ErrorCode, message: string, parameter?: string): Response {
  return json({ error: { code, message, ...(parameter ? { parameter } : {}) } }, status);
}

/** Wraps a handler so unexpected errors become a clean 500 JSON response. */
export function handle(fn: (request: Request) => Response): (request: Request) => Response {
  return (request) => {
    try {
      return fn(request);
    } catch (err) {
      console.error(err);
      return errorResponse(500, "internalError", "Something went wrong.");
    }
  };
}
