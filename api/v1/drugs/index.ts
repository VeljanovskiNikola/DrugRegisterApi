import { getDataset } from "../../../lib/data.js";
import { route } from "../../../lib/guard.js";
import { errorResponse, json } from "../../../lib/http.js";
import { parseDrugQuery, QueryError, searchDrugs } from "../../../lib/query.js";

// GET /api/v1/drugs?q=&atc=&ean=&dispensing=&productType=&positiveList=&page=&limit=
const api = route((request) => {
  const params = new URL(request.url).searchParams;
  try {
    const query = parseDrugQuery(params);
    return json(searchDrugs(getDataset(), query));
  } catch (err) {
    if (err instanceof QueryError) return errorResponse(400, "invalidParameter", err.message, err.parameter);
    throw err;
  }
});

export const GET = api.GET;
export const HEAD = api.HEAD;
export const POST = api.POST;
export const PUT = api.PUT;
export const PATCH = api.PATCH;
export const DELETE = api.DELETE;
export const OPTIONS = api.OPTIONS;
