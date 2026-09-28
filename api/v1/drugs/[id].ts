import { getDataset } from "../../../lib/data.js";
import { route } from "../../../lib/guard.js";
import { errorResponse, json } from "../../../lib/http.js";
import { echo } from "../../../lib/query.js";

const ID = /^\d{1,12}$/;

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // malformed %-encoding: keep raw, the ID check rejects it
  }
}

export type IdResult = { ok: true; id: string } | { ok: false; message: string; parameter: string };

/**
 * Vercel routes /api/v1/drugs/<x> here and adds ?id=<x>. The URL the function sees may be the original
 * path or /api/v1/drugs/[id], so the id can come from the path, the query, or both.
 * Every source must agree, so "/drugs/54923?id=1" can't return a different drug than the path says.
 */
export function readId(request: Request): IdResult {
  const url = new URL(request.url);
  for (const key of url.searchParams.keys()) {
    if (key !== "id") return { ok: false, message: `Unknown parameter "${echo(key)}".`, parameter: echo(key) };
  }
  const candidates = url.searchParams.getAll("id");
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  if (last !== "drugs" && last !== "[id]" && last !== "%5Bid%5D") candidates.push(safeDecode(last));

  const unique = [...new Set(candidates)];
  if (unique.length === 0) return { ok: false, message: "id is missing.", parameter: "id" };
  if (unique.length > 1) return { ok: false, message: "The id in the path and the query don't match.", parameter: "id" };
  const id = unique[0]!;
  if (!ID.test(id)) return { ok: false, message: "id must be 1–12 digits.", parameter: "id" };
  return { ok: true, id };
}

// GET /api/v1/drugs/{id}
const api = route((request) => {
  const result = readId(request);
  if (!result.ok) return errorResponse(400, "invalidParameter", result.message, result.parameter);
  const drug = getDataset().byId.get(result.id);
  if (!drug) return errorResponse(404, "notFound", `No drug with id ${result.id}.`);
  return json(drug);
});

export const GET = api.GET;
export const HEAD = api.HEAD;
export const POST = api.POST;
export const PUT = api.PUT;
export const PATCH = api.PATCH;
export const DELETE = api.DELETE;
export const OPTIONS = api.OPTIONS;
