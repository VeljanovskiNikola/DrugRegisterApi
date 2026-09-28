// Output size limits, ReDoS / CPU abuse, and concurrency.
import { describe, expect, it } from "vitest";
import { api, isLive, json, MAIN, raw } from "./helpers.js";

const enc = encodeURIComponent;
const MAX_ITEMS = 100;

describe("34. No API request returns more than one page (100 items)", () => {
  const filters = [
    "",
    "q=a",
    "q=e",
    "q=%D0%B0", // Cyrillic а
    "atc=N",
    "atc=A",
    "dispensing=prescription,hospitalOnly,otcPharmacy,otcGeneralSale",
    "productType=generic,original,biosimilar",
    "positiveList=true",
    "positiveList=false",
  ];
  it.each(filters)("ATTACK: dump the dataset with ?%s&limit=100 → SAFE: at most 100 items, bounded size", async (f) => {
    const res = await api(`/api/v1/drugs?${f}${f ? "&" : ""}limit=100`);
    expect(res.status).toBe(200);
    const body = json(res);
    expect(body.data.length).toBeLessThanOrEqual(MAX_ITEMS);
    expect(body.pagination.limit).toBeLessThanOrEqual(MAX_ITEMS);
    expect(res.body.length).toBeLessThan(500_000);
  });

  it.each(["limit=101", "limit=100&limit=5000", "limit=%31%30%30%30", "limit=1e9", "limit=4119"])(
    "ATTACK: bypass the page size with ?%s → SAFE: 400",
    async (qs) => {
      expect((await api(`/api/v1/drugs?${qs}`)).status).toBe(400);
    },
  );

  it("By design: the full dataset exists only as the public static file /data/drug-register.json (documented)", async () => {
    const res = await raw(MAIN, "/data/drug-register.json");
    expect(res.status).toBe(200);
    expect(json(res).count).toBe(4119);
  });
});

describe("35. ReDoS and slow-path inputs finish fast", () => {
  const bound = isLive ? 3000 : 500; // ms per request; locally a search takes a few ms
  const payloads: [string, string][] = [
    ["100 × a", "a".repeat(100)],
    ["99 × a + !", "a".repeat(99) + "!"],
    ["nested-quantifier text", "(a+)+".repeat(20)],
    ["alternating", "ab".repeat(50)],
    ["100 combining marks on a letter", "a" + "́".repeat(99)],
    ["50 astral chars (100 UTF-16 units)", "𝕒".repeat(50)],
    ["100 spaces", " ".repeat(100)],
    ["mixed scripts", "аaаaаa".repeat(16)],
    ["100 × %", "%".repeat(100)],
    ["near-miss of a real name", "keppr".repeat(20)],
  ];
  it.each(payloads)("ATTACK: q = %s → SAFE: answered within the time bound", async (_, q) => {
    const res = await api(`/api/v1/drugs?q=${enc(q)}&limit=100`);
    expect([200, 400]).toContain(res.status);
    expect(res.ms).toBeLessThan(bound);
  });

  it("ATTACK: pathological Authorization header → SAFE: fast 401", async () => {
    const res = await raw(MAIN, "/api/v1/meta", { headers: { Authorization: "Bearer " + "a".repeat(1000) + "=".repeat(20) + "!" } });
    expect(res.status).toBe(401);
    expect(res.ms).toBeLessThan(bound);
  });
});

describe("36. Concurrency", () => {
  it("ATTACK: 50 heavy searches at once → SAFE: all answered, no 5xx", async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => api(`/api/v1/drugs?q=a&limit=100`)));
    for (const res of results) expect([200, 429]).toContain(res.status);
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThan(0);
  });
});
