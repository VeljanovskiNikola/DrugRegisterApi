# North Macedonia Drug Register API

Read-only REST API for all 4,119 drugs in the North Macedonia drug register
([lekovi.zdravstvo.gov.mk/drugsregister](https://lekovi.zdravstvo.gov.mk/drugsregister)), scraped on 27.09.2026.
Runs on Vercel Functions (Node.js 22, TypeScript). No database: the data is one JSON file shipped with the functions.

Live: https://drug-register-api.vercel.app · Docs: https://drug-register-api.vercel.app/docs

## Endpoints

| Method | Path | What it returns |
| --- | --- | --- |
| GET | `/api/v1/drugs` | Search and filter, one page at a time |
| GET | `/api/v1/drugs/{id}` | One drug by its site ID |
| GET | `/api/v1/meta` | Source, scrape date, count |
| GET | `/data/drug-register.json` | All drugs in one static file (7.7 MB, 0.9 MB gzipped), for an offline copy |
| GET | `/openapi.yaml` | OpenAPI 3.1 spec |
| GET | `/docs` | Readable API docs with a "Test Request" button (works on a phone) |

`/` redirects to `/docs`.

### `GET /api/v1/drugs` parameters

| Parameter | Example | Notes |
| --- | --- | --- |
| `q` | `keppra`, `кепра`, `levetiracetam` | Searches Latin name, Cyrillic name and generic name. Case- and accent-insensitive. Best matches first. |
| `atc` | `N03` | ATC code prefix |
| `ean` | `3837000096408` | Exact barcode (8–14 digits) |
| `dispensing` | `otcPharmacy,otcGeneralSale` | `prescription`, `hospitalOnly`, `otcPharmacy`, `otcGeneralSale`. Comma-separated. |
| `productType` | `generic` | `generic`, `original`, `biosimilar`. Comma-separated. |
| `positiveList` | `true` | `true` or `false` |
| `page` | `2` | Default 1 |
| `limit` | `50` | Default 20, max 100 |

Response:

```json
{
  "data": [ { "id": "54923", "nameLatin": "KEPPRA", "...": "..." } ],
  "pagination": { "page": 1, "limit": 20, "total": 12, "totalPages": 1 }
}
```

Unknown or wrong parameters return `400`:

```json
{ "error": { "code": "invalidParameter", "message": "limit must be 100 or less.", "parameter": "limit" } }
```

A missing drug returns `404` with `"code": "notFound"`.

### Data rules

- Keys are English camelCase. Macedonian text is kept exactly as on the site.
- Empty values on the site are `null`. Every key is always present.
- Prices are numbers in MKD. A price of `0` on the site is `null` (no price set).
- Dates are `yyyy-MM-dd`.
- Placeholder dosage text (`xx`, `хх`, `x`, `/`, `0`) is `null`.
- PDF links point to the site's own URLs.

Full field list: `schema/drug-register.schema.json` or `public/openapi.yaml`.

### Caching

Responses send `Cache-Control: public, max-age=3600, s-maxage=86400`. Vercel's CDN clears its cache on every deploy,
so new data shows up right after you deploy it.

## iOS

`swift/DrugRegister.swift` has `Codable` models for every response. Decode with `JSONDecoder.drugRegister()` so the
date-only strings work.

```swift
let url = URL(string: "https://drug-register-api.vercel.app/api/v1/drugs?q=keppra")!
let (data, _) = try await URLSession.shared.data(from: url)
let page = try JSONDecoder.drugRegister().decode(DrugPage.self, from: data)
```

## Project layout

```
api/v1/drugs/index.ts     GET /api/v1/drugs
api/v1/drugs/[id].ts      GET /api/v1/drugs/{id}
api/v1/meta.ts            GET /api/v1/meta
lib/                      data loading, search, HTTP helpers
public/data/              drug-register.json (served as a static file and read by the functions)
public/openapi.yaml       API spec
public/docs/              docs page (Scalar API Reference, hosted here)
schema/                   JSON Schema for one data file
scripts/transform.py      raw scrape -> drug-register.json
raw/                      raw Firecrawl scrape (not deployed)
swift/                    Codable models (not deployed)
test/                     Vitest tests (not deployed)
```

## Develop

```bash
npm install
npm test            # 27 tests against the real data
npm run typecheck
npx vercel dev      # local server on http://localhost:3000 (needs a Vercel login)
```

## Update the data

1. Scrape again and replace `raw/drugs_raw.jsonl`.
2. Run `npm run build:data` (needs Python 3). This rewrites `public/data/drug-register.json`.
3. Update `scrapedDate` in `scripts/transform.py`.
4. Run `npm test`, then commit and push. Vercel deploys on push.

## Deploy

1. Push this repo to GitHub.
2. In Vercel: **Add New… → Project → Import** the repo. Keep the defaults (Framework Preset: **Other**, no build command).
3. Click **Deploy**.

Functions run in Frankfurt (`fra1`, set in `vercel.json`), close to users in North Macedonia.

## Third-party code

`public/docs/scalar-api-reference-1.72.1.js` is [Scalar API Reference](https://github.com/scalar/scalar) 1.72.1 (MIT license).
It is hosted with the API so the docs page doesn't depend on a CDN. Telemetry and Scalar's AI agent are turned off in
`public/docs/index.html`. To update it, see the comment in that file.
