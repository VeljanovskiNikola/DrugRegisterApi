import { normalize, type Dataset } from "./data.js";
import { DISPENSING, PRODUCT_TYPES, type Dispensing, type Drug, type DrugPage, type ProductType } from "./types.js";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export interface DrugQuery {
  q?: string;
  atc?: string;
  ean?: string;
  dispensing?: Dispensing[];
  productType?: ProductType[];
  positiveList?: boolean;
  page: number;
  limit: number;
}

export class QueryError extends Error {
  constructor(
    readonly parameter: string,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_PAGE = 10_000;
export const MAX_Q_LENGTH = 100;
/** No parameter value needs more than this. Checked before any other work on the value. */
const MAX_VALUE_LENGTH = 200;

// A Set lookup, not an object, so names like "__proto__" or "constructor" are just unknown strings.
const KNOWN_PARAMS: ReadonlySet<string> = new Set([
  "q",
  "atc",
  "ean",
  "dispensing",
  "productType",
  "positiveList",
  "page",
  "limit",
]);

/** Shortens user input before it goes into an error message. */
export function echo(value: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "?");
  return clean.length > 40 ? `${clean.slice(0, 40)}…` : clean;
}

/**
 * Rejects unknown and repeated parameters, and over-long values.
 * Repeated parameters are refused so "limit=10&limit=1000" can't be read differently by different code.
 */
export function checkParams(params: URLSearchParams, known: ReadonlySet<string>): void {
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (!known.has(key)) throw new QueryError(echo(key), `Unknown parameter "${echo(key)}".`);
    if (seen.has(key)) throw new QueryError(key, `Parameter "${key}" appears more than once.`);
    seen.add(key);
    if (value.length > MAX_VALUE_LENGTH) throw new QueryError(key, `${key} is too long.`);
  }
}

function parseEnumList<T extends string>(name: string, raw: string, allowed: readonly T[]): T[] {
  const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (values.length === 0) throw new QueryError(name, `${name} must not be empty.`);
  for (const v of values) {
    if (!allowed.includes(v as T)) {
      throw new QueryError(name, `${name} must be one of: ${allowed.join(", ")}. Got "${echo(v)}".`);
    }
  }
  return values as T[];
}

function parsePositiveInt(name: string, raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) throw new QueryError(name, `${name} must be a whole number.`);
  // Too many digits is too big, before Number() can round it.
  if (raw.length > 6) throw new QueryError(name, `${name} must be ${max} or less.`);
  const n = Number(raw);
  if (n < 1) throw new QueryError(name, `${name} must be 1 or more.`);
  if (n > max) throw new QueryError(name, `${name} must be ${max} or less.`);
  return n;
}

/** Reads and checks the query string. Throws QueryError on bad input. */
export function parseDrugQuery(params: URLSearchParams): DrugQuery {
  checkParams(params, KNOWN_PARAMS);

  const query: DrugQuery = {
    page: parsePositiveInt("page", params.get("page"), 1, MAX_PAGE),
    limit: parsePositiveInt("limit", params.get("limit"), DEFAULT_LIMIT, MAX_LIMIT),
  };

  const q = params.get("q");
  if (q !== null) {
    // Length check on the raw value first, so no work is done on huge input.
    if (q.length > MAX_Q_LENGTH) throw new QueryError("q", `q must be ${MAX_Q_LENGTH} characters or less.`);
    const text = normalize(q);
    if (text.length === 0) throw new QueryError("q", "q must not be empty.");
    if (text.length > MAX_Q_LENGTH) throw new QueryError("q", `q must be ${MAX_Q_LENGTH} characters or less.`);
    query.q = text;
  }

  const atc = params.get("atc");
  if (atc !== null) {
    if (!/^[A-Za-z0-9]{1,10}$/.test(atc)) throw new QueryError("atc", "atc must be 1–10 letters or digits, e.g. N03 or N03AX14.");
    query.atc = atc.toUpperCase();
  }

  const ean = params.get("ean");
  if (ean !== null) {
    if (!/^\d{8,14}$/.test(ean)) throw new QueryError("ean", "ean must be 8–14 digits.");
    query.ean = ean;
  }

  const dispensing = params.get("dispensing");
  if (dispensing !== null) query.dispensing = parseEnumList("dispensing", dispensing, DISPENSING);

  const productType = params.get("productType");
  if (productType !== null) query.productType = parseEnumList("productType", productType, PRODUCT_TYPES);

  const positiveList = params.get("positiveList");
  if (positiveList !== null) {
    if (positiveList !== "true" && positiveList !== "false") {
      throw new QueryError("positiveList", "positiveList must be true or false.");
    }
    query.positiveList = positiveList === "true";
  }

  return query;
}

/**
 * Search rank: 0 = name starts with q, 1 = generic name starts with q,
 * 2 = a word in a name starts with q, 3 = q appears anywhere. -1 = no match.
 */
function rank(q: string, names: string[], generic: string): number {
  if (names.some((n) => n.startsWith(q))) return 0;
  if (generic.startsWith(q)) return 1;
  if (names.some((n) => n.includes(" " + q))) return 2;
  if (names.some((n) => n.includes(q)) || generic.includes(q)) return 3;
  return -1;
}

export function searchDrugs(dataset: Dataset, query: DrugQuery): DrugPage {
  const matches: { drug: Drug; rank: number }[] = [];

  dataset.drugs.forEach((drug, i) => {
    if (query.atc && !(drug.atcCode ?? "").toUpperCase().startsWith(query.atc)) return;
    if (query.ean && drug.ean !== query.ean) return;
    if (query.dispensing && !query.dispensing.includes(drug.dispensing)) return;
    if (query.productType && !query.productType.includes(drug.productType)) return;
    if (query.positiveList !== undefined && drug.isOnPositiveList !== query.positiveList) return;

    let r = 0;
    if (query.q) {
      const key = dataset.searchKeys[i]!;
      r = rank(query.q, key.names, key.generic);
      if (r < 0) return;
    }
    matches.push({ drug, rank: r });
  });

  // Stable sort: drugs keep name order within the same rank.
  if (query.q) matches.sort((a, b) => a.rank - b.rank);

  const total = matches.length;
  const start = (query.page - 1) * query.limit;
  return {
    data: matches.slice(start, start + query.limit).map((m) => m.drug),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}
