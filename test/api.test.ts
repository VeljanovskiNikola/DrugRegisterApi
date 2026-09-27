import { describe, expect, it } from "vitest";
import { GET as getDrug } from "../api/v1/drugs/[id].js";
import { GET as listDrugs } from "../api/v1/drugs/index.js";
import { GET as getMeta } from "../api/v1/meta.js";
import type { Drug, DrugPage, Meta } from "../lib/types.js";

const BASE = "https://api.test";

async function call<T>(handler: (r: Request) => Response, path: string): Promise<{ status: number; body: T; res: Response }> {
  const res = handler(new Request(BASE + path));
  return { status: res.status, body: (await res.json()) as T, res };
}

const list = (qs = "") => call<DrugPage>(listDrugs, `/api/v1/drugs${qs}`);

describe("GET /api/v1/meta", () => {
  it("returns dataset info", async () => {
    const { status, body } = await call<Meta>(getMeta, "/api/v1/meta");
    expect(status).toBe(200);
    expect(body).toMatchObject({ count: 4119, currency: "MKD", scrapedDate: "2026-09-27", apiVersion: "v1" });
  });
});

describe("GET /api/v1/drugs", () => {
  it("returns the first page with defaults", async () => {
    const { status, body, res } = await list();
    expect(status).toBe(200);
    expect(body.data).toHaveLength(20);
    expect(body.pagination).toEqual({ page: 1, limit: 20, total: 4119, totalPages: 206 });
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
  });

  it("pages through all drugs without gaps or repeats", async () => {
    const ids = new Set<string>();
    for (let page = 1; page <= 42; page++) {
      const { body } = await list(`?limit=100&page=${page}`);
      body.data.forEach((d) => ids.add(d.id));
    }
    expect(ids.size).toBe(4119);
  });

  it("returns an empty page past the end", async () => {
    const { status, body } = await list("?page=999");
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(4119);
  });

  it("searches Latin names, name matches first", async () => {
    const { body } = await list("?q=keppra");
    expect(body.pagination.total).toBeGreaterThan(0);
    expect(body.data.every((d) => d.nameLatin.startsWith("KEPPRA"))).toBe(true);
  });

  it("searches Cyrillic names", async () => {
    const { body } = await list("?q=" + encodeURIComponent("кепра"));
    expect(body.data[0]?.nameLatin).toBe("KEPPRA");
  });

  it("searches generic names", async () => {
    const { body } = await list("?q=levetiracetam&limit=100");
    expect(body.pagination.total).toBeGreaterThan(1);
    expect(body.data.every((d) => d.genericName.toLowerCase().includes("levetiracetam"))).toBe(true);
  });

  it("is case and accent insensitive", async () => {
    const a = await list("?q=KePpRa");
    const b = await list("?q=keppra");
    expect(a.body.pagination.total).toBe(b.body.pagination.total);
  });

  it("filters by ATC prefix", async () => {
    const { body } = await list("?atc=n03&limit=100");
    expect(body.pagination.total).toBeGreaterThan(0);
    expect(body.data.every((d) => d.atcCode?.startsWith("N03"))).toBe(true);
  });

  it("filters by EAN", async () => {
    const { body } = await list("?ean=3837000096408");
    expect(body.data.map((d) => d.id)).toContain("54923");
  });

  it("filters by dispensing, several values", async () => {
    const { body } = await list("?dispensing=otcPharmacy,otcGeneralSale");
    expect(body.pagination.total).toBe(441 + 70);
  });

  it("filters by product type and positive list", async () => {
    expect((await list("?productType=biosimilar")).body.pagination.total).toBe(58);
    expect((await list("?positiveList=true")).body.pagination.total).toBe(1363);
    expect((await list("?positiveList=false")).body.pagination.total).toBe(2756);
  });

  it("combines filters", async () => {
    const { body } = await list("?q=keppra&positiveList=true&dispensing=prescription&limit=100");
    expect(body.data.every((d) => d.isOnPositiveList && d.dispensing === "prescription")).toBe(true);
  });

  it.each([
    ["?limit=101", "limit"],
    ["?limit=0", "limit"],
    ["?page=abc", "page"],
    ["?dispensing=Rp", "dispensing"],
    ["?productType=", "productType"],
    ["?positiveList=yes", "positiveList"],
    ["?ean=12", "ean"],
    ["?atc=N0-3", "atc"],
    ["?q=%20%20", "q"],
    ["?foo=1", "foo"],
  ])("rejects %s with 400", async (qs, parameter) => {
    const { status, body } = await call<{ error: { code: string; parameter: string } }>(listDrugs, `/api/v1/drugs${qs}`);
    expect(status).toBe(400);
    expect(body.error).toMatchObject({ code: "invalidParameter", parameter });
  });
});

describe("GET /api/v1/drugs/{id}", () => {
  it("returns one drug (id from query, as Vercel passes it)", async () => {
    const { status, body } = await call<Drug>(getDrug, "/api/v1/drugs/54923?id=54923");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: "54923",
      nameLatin: "KEPPRA",
      dispensing: "prescription",
      productType: "original",
      prices: { wholesaleExVat: 1908.94, retailWithVat: 2405.26, reference: 1394 },
      authorization: { issuedDate: "2020-06-15", expiryDate: null },
    });
  });

  it("reads the id from the path when there is no query", async () => {
    const { status, body } = await call<Drug>(getDrug, "/api/v1/drugs/54923");
    expect(status).toBe(200);
    expect(body.id).toBe("54923");
  });

  it("returns 404 for an unknown id", async () => {
    const { status, body } = await call<{ error: { code: string } }>(getDrug, "/api/v1/drugs/1");
    expect(status).toBe(404);
    expect(body.error.code).toBe("notFound");
  });

  it("returns 400 for a bad id", async () => {
    const { status } = await call(getDrug, "/api/v1/drugs/abc");
    expect(status).toBe(400);
  });
});
