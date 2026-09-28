import { route } from "../lib/guard.js";
import { errorResponse } from "../lib/http.js";

// Any /api path without its own function is rewritten here (see vercel.json), so unknown
// paths get the same token check and the same JSON error shape as real endpoints.
const api = route(() => errorResponse(404, "notFound", "No such API endpoint."));

export const GET = api.GET;
export const HEAD = api.HEAD;
export const POST = api.POST;
export const PUT = api.PUT;
export const PATCH = api.PATCH;
export const DELETE = api.DELETE;
export const OPTIONS = api.OPTIONS;
