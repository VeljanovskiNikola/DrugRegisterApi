import { getDataset } from "../../lib/data.js";
import { handle, json } from "../../lib/http.js";

// GET /api/v1/meta
export const GET = handle(() => json(getDataset().meta));
