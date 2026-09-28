// Rate limits. Locally: dedicated servers with tiny limits (5 per 2 s). Live: opt-in with SECURITY_TEST_RATE_LIMIT=1.
import { describe, expect, it } from "vitest";
import { bearer, cfg, isLive, json, MAIN, raw, server, sleep, type RawResponse } from "./helpers.js";

const LIMIT = 5;

function expect429(res: RawResponse) {
  expect(res.status).toBe(429);
  expect(json(res).error.code).toBe("rateLimited");
  const retry = Number(res.headers["retry-after"]);
  expect(Number.isInteger(retry)).toBe(true);
  expect(retry).toBeGreaterThanOrEqual(1);
  expect(retry).toBeLessThanOrEqual(cfg.rateWindowSeconds);
  expect(res.headers["cache-control"]).toBe("no-store"); // 21: a 429 must never be cached
  return retry;
}

async function burst(base: string, n: number, headers: Record<string, string> = {}, path = "/api/v1/meta") {
  const out: RawResponse[] = [];
  for (let i = 0; i < n; i++) out.push(await raw(base, path, { headers, retryOn429: false }));
  return out;
}

/** Waits until a fresh window starts, so each test begins with an empty bucket. */
async function freshWindow() {
  await sleep(cfg.rateWindowSeconds * 1000 + 300);
}

describe.skipIf(isLive)("Rate limits (local servers)", () => {
  const ipBase = server("ipLimited")!;
  const tokenBase = server("tokenLimited")!;

  it("16. ATTACK: flood from one IP → SAFE: 429 + Retry-After after the limit", async () => {
    await freshWindow();
    const results = await burst(ipBase, LIMIT + 1, bearer(cfg.tokenA));
    expect(results.slice(0, LIMIT).map((r) => r.status)).toEqual(Array(LIMIT).fill(200));
    expect429(results[LIMIT]!);
  });

  it("17. The limit resets after the window (Retry-After is honest)", async () => {
    await freshWindow();
    const results = await burst(ipBase, LIMIT + 1, bearer(cfg.tokenA));
    const retry = expect429(results[LIMIT]!);
    await sleep(retry * 1000 + 300);
    expect((await raw(ipBase, "/api/v1/meta", { headers: bearer(cfg.tokenA) })).status).toBe(200);
  });

  it("19. ATTACK: spoof the client IP with X-Forwarded-For / X-Real-IP / Forwarded → SAFE: still limited", async () => {
    await freshWindow();
    await burst(ipBase, LIMIT, bearer(cfg.tokenA));
    const spoofs: Record<string, string>[] = [
      { "X-Forwarded-For": "203.0.113.7" },
      { "X-Real-IP": "203.0.113.8" },
      { Forwarded: "for=203.0.113.9" },
      { "X-Forwarded-For": "203.0.113.10, 198.51.100.1" },
      { "True-Client-IP": "203.0.113.11", "CF-Connecting-IP": "203.0.113.12" },
    ];
    for (const spoof of spoofs) {
      const res = await raw(ipBase, "/api/v1/meta", { headers: { ...bearer(cfg.tokenA), ...spoof }, retryOn429: false });
      expect429(res);
    }
  });

  it("20. ATTACK: guess tokens fast (brute force) → SAFE: failed attempts count against the IP, then 429", async () => {
    await freshWindow();
    const guesses = await burst(ipBase, LIMIT + 1, bearer("guess-000000000000000000"));
    expect(guesses.slice(0, LIMIT).map((r) => r.status)).toEqual(Array(LIMIT).fill(401));
    expect429(guesses[LIMIT]!);
    // and a real token from the same IP is limited too, until the window ends
    expect429(await raw(ipBase, "/api/v1/meta", { headers: bearer(cfg.tokenA), retryOn429: false }));
  });

  it("18. ATTACK: one token used from many places → SAFE: per-token limit hits, other tokens unaffected", async () => {
    await freshWindow();
    const results = await burst(tokenBase, LIMIT + 1, bearer(cfg.tokenA));
    expect(results.slice(0, LIMIT).map((r) => r.status)).toEqual(Array(LIMIT).fill(200));
    expect429(results[LIMIT]!);
    // A different token has its own bucket.
    expect((await raw(tokenBase, "/api/v1/meta", { headers: bearer(cfg.tokenB!) })).status).toBe(200);
  });

  it("18b. Wrong tokens don't use up a real token's quota", async () => {
    await freshWindow();
    await burst(tokenBase, LIMIT * 2, bearer("wrong-token-0000000000000000"));
    expect((await raw(tokenBase, "/api/v1/meta", { headers: bearer(cfg.tokenA) })).status).toBe(200);
  });

  it("21. A 429 is JSON and not cacheable (checked in every case above)", async () => {
    await freshWindow();
    const results = await burst(ipBase, LIMIT + 1, bearer(cfg.tokenA));
    expect429(results[LIMIT]!);
  });
});

describe.skipIf(!isLive || !cfg.liveRateLimit)("Rate limits (live, opt-in)", () => {
  it(`16–17 live. ATTACK: flood one endpoint → SAFE: 429 by limit + a little slack, then it resets`, async () => {
    const max = cfg.liveIpLimit;
    let first429: RawResponse | undefined;
    let sent = 0;
    // Sliding window in Upstash: allow a little slack for requests already counted.
    for (; sent < max + 20 && !first429; sent++) {
      const res = await raw(MAIN, "/api/v1/meta", { headers: bearer(cfg.tokenA), retryOn429: false });
      if (res.status === 429) first429 = res;
      else expect(res.status).toBe(200);
    }
    expect(first429, `no 429 after ${sent} requests`).toBeDefined();
    const retry = expect429(first429!);
    await sleep(retry * 1000 + 1000);
    expect((await raw(MAIN, "/api/v1/meta", { headers: bearer(cfg.tokenA), retryOn429: false })).status).toBe(200);
  }, 300_000);

  it("19 live. ATTACK: spoofed X-Forwarded-For while limited → SAFE: still 429 (Vercel overwrites it)", async () => {
    for (let i = 0; i < cfg.liveIpLimit + 20; i++) {
      const res = await raw(MAIN, "/api/v1/meta", { headers: bearer(cfg.tokenA), retryOn429: false });
      if (res.status === 429) break;
    }
    const res = await raw(MAIN, "/api/v1/meta", {
      headers: { ...bearer(cfg.tokenA), "X-Forwarded-For": "203.0.113.7", "X-Real-IP": "203.0.113.8" },
      retryOn429: false,
    });
    expect(res.status).toBe(429);
  }, 300_000);
});
