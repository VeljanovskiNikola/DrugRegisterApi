// Error hygiene: every error is the same clean JSON, with no stack traces or internal paths.
// (helpers.ts also checks this on every single response in every test file.)
import { describe, expect, it } from "vitest";
import { api, bearer, cfg, expectCleanError, isLive, json, MAIN, raw, server } from "./helpers.js";

describe("37. Every error has the same clean shape", () => {
  const errors: [string, () => ReturnType<typeof raw>, number, string][] = [
    ["400", () => api("/api/v1/drugs?limit=0"), 400, "invalidParameter"],
    ["401", () => raw(MAIN, "/api/v1/meta"), 401, "unauthorized"],
    ["404 drug", () => api("/api/v1/drugs/1"), 404, "notFound"],
    ["404 route", () => api("/api/v1/nope"), 404, "notFound"],
    ["405", () => api("/api/v1/meta", { method: "DELETE" }), 405, "methodNotAllowed"],
  ];
  it.each(errors)("%s → { error: { code, message } }, JSON, no-store, no internals", async (_, get, status, code) => {
    const res = await get();
    expect(res.status).toBe(status);
    expectCleanError(res);
    expect(json(res).error.code).toBe(code);
  });

  it("Error messages echo at most a short, cleaned piece of the input", async () => {
    const long = "x".repeat(150);
    const res = await api(`/api/v1/drugs?dispensing=${long}`);
    expect(res.status).toBe(400);
    expect(json(res).error.message.length).toBeLessThan(200);
    expect(res.body).not.toContain(long);
  });
});

describe("38. Internal errors", () => {
  it.skipIf(isLive)("ATTACK: force a server fault (data file missing) → SAFE: 500 JSON 'internalError', no path or stack", async () => {
    const res = await raw(server("brokenData")!, "/api/v1/meta", { headers: bearer(cfg.tokenA) });
    expect(res.status).toBe(500);
    expectCleanError(res);
    expect(json(res)).toEqual({ error: { code: "internalError", message: "Something went wrong." } });
    expect(res.body).not.toMatch(/drug-register\.json|ENOENT|public\/data/);
  });
});
