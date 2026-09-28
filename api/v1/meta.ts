import { getDataset } from "../../lib/data.js";
import { route } from "../../lib/guard.js";
import { json } from "../../lib/http.js";

// GET /api/v1/meta (reads no query parameters, so any are ignored, as before)
const api = route(() => json(getDataset().meta));

export const GET = api.GET;
export const HEAD = api.HEAD;
export const POST = api.POST;
export const PUT = api.PUT;
export const PATCH = api.PATCH;
export const DELETE = api.DELETE;
export const OPTIONS = api.OPTIONS;
