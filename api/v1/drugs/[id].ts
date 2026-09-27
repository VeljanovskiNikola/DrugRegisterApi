import { getDataset } from "../../../lib/data.js";
import { errorResponse, handle, json } from "../../../lib/http.js";

/** Vercel passes the path segment as ?id=…; fall back to the last path segment. */
export function readId(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get("id") ?? decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
}

// GET /api/v1/drugs/{id}
export const GET = handle((request) => {
  const id = readId(request);
  if (!/^\d{1,12}$/.test(id)) {
    return errorResponse(400, "invalidParameter", "id must be digits only.", "id");
  }
  const drug = getDataset().byId.get(id);
  if (!drug) return errorResponse(404, "notFound", `No drug with id ${id}.`);
  return json(drug);
});
