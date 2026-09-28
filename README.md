# North Macedonia Drug Register API

Read-only REST API for all 4,119 drugs in the North Macedonia drug register
([lekovi.zdravstvo.gov.mk/drugsregister](https://lekovi.zdravstvo.gov.mk/drugsregister)), scraped on 27.09.2026.
Runs on Vercel Functions (Node.js 22, TypeScript). No database: the data is one JSON file shipped with the functions.

Live: https://drug-register-api.vercel.app · Docs: https://drug-register-api.vercel.app/docs

## Endpoints

| Method | Path | What it returns |
| --- | --- | --- |
| Method | Path | Token | What it returns |
| --- | --- | --- | --- |
| GET | `/api/v1/drugs` | yes | Search and filter, one page at a time (max 100 per page) |
| GET | `/api/v1/drugs/{id}` | yes | One drug by its site ID |
| GET | `/api/v1/meta` | yes | Source, scrape date, count |
| GET | `/data/drug-register.json` | no | All drugs in one static file (7.7 MB, 0.9 MB gzipped), for an offline copy |
| GET | `/openapi.yaml` | no | OpenAPI 3.1 spec |
| GET | `/docs` | no | Readable API docs with a "Test Request" button (works on a phone) |

`/` redirects to `/docs`. `HEAD` works like `GET`. Other methods get `405`.

## Authentication

Every `/api/v1/*` call needs `Authorization: Bearer <token>`. Tokens anywhere else (query string, cookie,
`X-API-Key`) are ignored. A missing or wrong token gets:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="drug-register-api", error="invalid_token"

{ "error": { "code": "unauthorized", "message": "Invalid API token." } }
```

Valid tokens come from the `API_TOKENS` env var (comma-separated, so you can rotate: add the new one, ship the
app, then remove the old one). If `API_TOKENS` is empty, every call gets `401`.

**What the token is for:** the data is public, and a token inside an iOS app can be pulled out of the app. So the
token is an app ID and a quota key, not a lock. Use one token per client (app version, partner) if you want
per-client quotas or to cut one client off.

## Rate limits

| Limit | Default | Env var |
| --- | --- | --- |
| Per IP | 120 / window | `RATE_LIMIT_IP_MAX` |
| Per token | 3,000 / window | `RATE_LIMIT_TOKEN_MAX` |
| Window | 60 s | `RATE_LIMIT_WINDOW_SECONDS` |

Order: per-IP limit, then the token check, then the per-token limit. So token guessing is throttled too.
Over a limit you get `429` with `Retry-After` (seconds) and `{"error":{"code":"rateLimited",...}}`.

- **Store:** Upstash Redis (sliding window), shared by all function instances. Add it from the Vercel Marketplace
  (Storage → Upstash for Redis, free tier). The code reads `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` or
  `KV_REST_API_URL`/`KV_REST_API_TOKEN`, whichever the integration sets.
- **Without Upstash** the limits are kept in each instance's memory. Fine locally, weak in production
  (each instance counts on its own). A warning is logged.
- **If Upstash is down or slow** (over 1 s), requests are allowed and the error is logged. The data is public, so
  staying up matters more than an exact quota.
- **One shared app token** means the per-token limit caps all users together. Keep it high, or use one token per
  client.
- **Mobile carriers** put many users behind one IP, so keep the per-IP limit generous.
- **Optional outer layer:** a Vercel Firewall rate-limit rule by IP (Hobby includes 1 rule) blocks floods at the
  edge, before a function runs. Code limits still cost one function run per blocked call.

### `GET /api/v1/drugs` parameters

| Parameter | Example | Notes |
| --- | --- | --- |
| `q` | `keppra`, `кепра`, `levetiracetam` | 1–100 characters. Searches Latin name, Cyrillic name and generic name. Case- and accent-insensitive. Best matches first. |
| `atc` | `N03` | ATC code prefix |
| `ean` | `3837000096408` | Exact barcode (8–14 digits) |
| `dispensing` | `otcPharmacy,otcGeneralSale` | `prescription`, `hospitalOnly`, `otcPharmacy`, `otcGeneralSale`. Comma-separated. |
| `productType` | `generic` | `generic`, `original`, `biosimilar`. Comma-separated. |
| `positiveList` | `true` | `true` or `false` |
| `page` | `2` | Default 1, max 10,000 |
| `limit` | `50` | Default 20, max 100 |

Response:

```json
{
  "data": [ { "id": "54923", "nameLatin": "KEPPRA", "...": "..." } ],
  "pagination": { "page": 1, "limit": 20, "total": 12, "totalPages": 1 }
}
```

Unknown, repeated or wrong parameters return `400` (after the token check):

```json
{ "error": { "code": "invalidParameter", "message": "limit must be 100 or less.", "parameter": "limit" } }
```

A missing drug or an unknown `/api` path returns `404` with `"code": "notFound"`.

### Errors

Every error from `/api` has the same shape, `{ "error": { "code", "message", "parameter"? } }`, and never includes
a stack trace or a file path.

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalidParameter` | Bad, unknown or repeated query parameter; bad `{id}` |
| 401 | `unauthorized` | Missing or wrong token |
| 404 | `notFound` | No such drug or endpoint |
| 405 | `methodNotAllowed` | Not `GET`/`HEAD` (see the `Allow` header) |
| 429 | `rateLimited` | Over a rate limit (see `Retry-After`) |
| 500 | `internalError` | Server fault |

### Data rules

- Keys are English camelCase. Macedonian text is kept exactly as on the site.
- Empty values on the site are `null`. Every key is always present.
- Prices are numbers in MKD. A price of `0` on the site is `null` (no price set).
- Dates are `yyyy-MM-dd`.
- Placeholder dosage text (`xx`, `хх`, `x`, `/`, `0`) is `null`.
- PDF links point to the site's own URLs.

Full field list: `schema/drug-register.schema.json` or `public/openapi.yaml`.

### Headers and caching

| Route | Cache-Control | Other headers |
| --- | --- | --- |
| `/api/v1/*` 200 | `private, max-age=300` | `Vary: Authorization` |
| `/api/v1/*` errors | `no-store` | |
| `/data/drug-register.json` | `public, max-age=3600, s-maxage=86400` | |
| `/openapi.yaml` | `public, max-age=300` | `Access-Control-Allow-Origin: *` |
| `/docs` | `public, max-age=300` | strict `Content-Security-Policy` (scripts from this site only) |

Every response also has `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY` and a `Permissions-Policy`. API responses add
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and `Cross-Origin-Resource-Policy: same-origin`.

- **No CDN caching for the API.** Vercel's CDN never caches requests that carry an `Authorization` header, so every
  API call runs a function. `private` lets the app cache for 5 minutes but stops any shared cache.
- **No CORS** on the API or the data file. iOS apps don't use CORS, and the docs page is on the same site. Web pages on
  other sites can't read the API from a browser, which is intended (they would expose the token).
- `Server: Vercel`, `x-vercel-id` and `Strict-Transport-Security` come from Vercel. There is no `X-Powered-By`.

## iOS

`swift/DrugRegister.swift` has `Codable` models for every response. Decode with `JSONDecoder.drugRegister()` so the
date-only strings work.

```swift
var request = URLRequest(url: URL(string: "https://drug-register-api.vercel.app/api/v1/drugs?q=keppra")!)
request.setDrugRegisterToken(apiToken)  // from a git-ignored .xcconfig, not from source
let (data, response) = try await URLSession.shared.data(for: request)
if let http = response as? HTTPURLResponse, http.statusCode != 200 {
    let error = try JSONDecoder().decode(APIErrorResponse.self, from: data)
    // error.error.kind == .rateLimited → wait http.retryAfterSeconds
}
let page = try JSONDecoder.drugRegister().decode(DrugPage.self, from: data)
```

## Project layout

```
api/v1/drugs/index.ts     GET /api/v1/drugs
api/v1/drugs/[id].ts      GET /api/v1/drugs/{id}
api/v1/meta.ts            GET /api/v1/meta
api/not-found.ts          JSON 404 for unknown /api paths
lib/guard.ts              runs before every API handler: rate limits, method, token, headers
lib/auth.ts               Bearer token check (constant time)
lib/ratelimit.ts          Upstash / in-memory rate limiters
lib/                      data loading, search, HTTP helpers
public/data/              drug-register.json (served as a static file and read by the functions)
public/openapi.yaml       API spec
public/docs/              docs page (Scalar API Reference, hosted here; settings in init.js)
schema/                   JSON Schema for one data file
scripts/transform.py      raw scrape -> drug-register.json
scripts/local-server.mjs  local server that runs `vercel build` output with Vercel's routing (for tests)
raw/                      raw Firecrawl scrape (not deployed)
swift/                    Codable models (not deployed)
test/                     unit tests; test/security/ has the attack tests (not deployed)
```

## Develop

```bash
npm install
npm test               # 27 unit tests against the real data
npm run test:security  # attack tests: builds with `vercel build`, starts local servers, attacks them
npm run typecheck
npx vercel dev         # local dev server (needs a Vercel login)
```

### Security tests

`npm run test:security` runs about 290 checks: token attacks, headers and CORS, rate limits (trigger and reset),
input abuse (huge/negative/non-numeric values, long `q`, unicode and %-encoding tricks, parameter pollution,
prototype pollution, path traversal, open redirects, odd methods), output size, ReDoS time bounds, and clean
errors. Each test name says the attack and the safe response.

Locally it starts six servers from the same build with different settings (normal, tiny IP limit, tiny token
limit, no tokens, a rotated token, a missing data file). The browser CSP check needs Chromium: set `CHROMIUM_PATH`
or run `npx playwright install chromium`; without it that one check is skipped.

Against a deployment:

```bash
BASE_URL=https://drug-register-api.vercel.app API_TOKEN=<a real token> npm run test:security
# add SECURITY_TEST_RATE_LIMIT=1 to also flood /api/v1/meta until it returns 429 (sends ~140 requests)
# add VERCEL_PROTECTION_BYPASS=<secret> for a protected preview deployment
```

Live mode skips the tests that need special server settings. It waits and retries on `429`, so it's slower
if your IP limit is low.

## Update the data

1. Scrape again and replace `raw/drugs_raw.jsonl`.
2. Run `npm run build:data` (needs Python 3). This rewrites `public/data/drug-register.json`.
3. Update `scrapedDate` in `scripts/transform.py`.
4. Run `npm test`, then commit and push. Vercel deploys on push.

## Deploy

1. Push this repo to GitHub.
2. In Vercel: **Add New… → Project → Import** the repo. Keep the defaults (Framework Preset: **Other**, no build command).
3. **Settings → Environment Variables:** add `API_TOKENS` for Production and Preview. Make tokens long and random,
   e.g. `openssl rand -hex 32`. Never commit them.
4. **Storage → Upstash for Redis** (Marketplace, free tier) → connect it to the project. This adds its env vars.
   Pick the Frankfurt region (eu-central-1) so each rate-limit check stays close to the functions in `fra1`.
5. Optional: **Firewall → Rate limit rule** by IP as an outer layer.
6. Deploy. Without `API_TOKENS`, every API call returns `401`.

Functions run in Frankfurt (`fra1`, set in `vercel.json`), close to users in North Macedonia.

## Third-party code

`public/docs/scalar-api-reference-1.72.1.js` is [Scalar API Reference](https://github.com/scalar/scalar) 1.72.1 (MIT license).
It is hosted with the API so the docs page doesn't depend on a CDN. Telemetry, Scalar's AI agent and the
"Open API Client" link are turned off in `public/docs/init.js`. To update it, see the comment in `public/docs/index.html`.
