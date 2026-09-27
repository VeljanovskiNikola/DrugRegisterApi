import { getDataset } from "../../../lib/data.js";
import { errorResponse, handle, json } from "../../../lib/http.js";
import { parseDrugQuery, QueryError, searchDrugs } from "../../../lib/query.js";

// GET /api/v1/drugs?q=&atc=&ean=&dispensing=&productType=&positiveList=&page=&limit=
export const GET = handle((request) => {
  const params = new URL(request.url).searchParams;
  try {
    const query = parseDrugQuery(params);
    return json(searchDrugs(getDataset(), query));
  } catch (err) {
    if (err instanceof QueryError) return errorResponse(400, "invalidParameter", err.message, err.parameter);
    throw err;
  }
});
