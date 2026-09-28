// Attacks on the Bearer token check. Safe response: 401 JSON + WWW-Authenticate, never data, never 500.
import { describe, expect, it } from "vitest";
import { api, bearer, cfg, isLive, json, MAIN, raw, server } from "./helpers.js";

const A = cfg.tokenA;
const PROTECTED = ["/api/v1/meta", "/api/v1/drugs?limit=1", "/api/v1/drugs/54923", "/api/v1/unknown"];

function expect401(res: Awaited<ReturnType<typeof raw>>, invalidToken: boolean) {
  expect(res.status).toBe(401);
  expect(json(res).error.code).toBe("unauthorized");
  const challenge = String(res.headers["www-authenticate"]);
  expect(challenge).toMatch(/^Bearer realm="drug-register-api"/);
  if (invalidToken) expect(challenge).toContain('error="invalid_token"');
  expect(res.body).not.toContain(A); // never echo a token back
}

describe("1. No token", () => {
  it.each(PROTECTED)("ATTACK: call %s with no Authorization header → SAFE: 401 + WWW-Authenticate", async (path) => {
    expect401(await raw(MAIN, path), false);
  });

  it("ATTACK: HEAD with no token → SAFE: 401, no body", async () => {
    const res = await raw(MAIN, "/api/v1/meta", { method: "HEAD" });
    expect(res.status).toBe(401);
    expect(res.body).toBe("");
  });
});

describe("2. Wrong token", () => {
  it("ATTACK: made-up token → SAFE: 401 invalid_token", async () => {
    expect401(await raw(MAIN, "/api/v1/meta", { headers: bearer("definitely-not-a-real-token-123456") }), true);
  });
});

describe("3. Edited token", () => {
  const edits: [string, string][] = [
    ["last character changed", A.slice(0, -1) + (A.endsWith("x") ? "y" : "x")],
    ["first character changed", (A.startsWith("x") ? "y" : "x") + A.slice(1)],
    ["cut short by one", A.slice(0, -1)],
    ["one extra character", A + "0"],
    ["upper-cased", A.toUpperCase()],
    ["padding added", A + "="],
    ["doubled", A + A],
  ];
  it.each(edits)("ATTACK: valid token with %s → SAFE: 401", async (_, token) => {
    expect401(await raw(MAIN, "/api/v1/meta", { headers: bearer(token) }), true);
  });
});

describe("4. Revoked token (static tokens don't expire; removing one from API_TOKENS is how you revoke it)", () => {
  it.skipIf(isLive)("ATTACK: token A after it was rotated out of API_TOKENS → SAFE: 401, while token B still works", async () => {
    const rotated = server("rotated")!;
    expect401(await raw(rotated, "/api/v1/meta", { headers: bearer(A) }), true);
    expect((await raw(rotated, "/api/v1/meta", { headers: bearer(cfg.tokenB!) })).status).toBe(200);
  });
});

describe("5. Token in the wrong place (only the Authorization header counts)", () => {
  const cases: [string, string, Record<string, string>][] = [
    ["query ?token=", `/api/v1/meta?token=${A}`, {}],
    ["query ?access_token=", `/api/v1/meta?access_token=${A}`, {}],
    ["X-API-Key header", "/api/v1/meta", { "X-API-Key": A }],
    ["X-Auth-Token header", "/api/v1/meta", { "X-Auth-Token": A }],
    ["cookie", "/api/v1/meta", { Cookie: `token=${A}; access_token=${A}` }],
    ["Basic scheme", "/api/v1/meta", { Authorization: `Basic ${Buffer.from(`${A}:`).toString("base64")}` }],
    ["no scheme", "/api/v1/meta", { Authorization: A }],
    ["Token scheme", "/api/v1/meta", { Authorization: `Token ${A}` }],
    ["Proxy-Authorization header", "/api/v1/meta", { "Proxy-Authorization": `Bearer ${A}` }],
  ];
  it.each(cases)("ATTACK: token sent as %s → SAFE: 401", async (_, path, headers) => {
    const res = await raw(MAIN, path, { headers });
    expect(res.status).toBe(401);
    expect(json(res).error.code).toBe("unauthorized");
  });

  it("NOT AN ATTACK: scheme in lower case and extra spaces are valid per RFC 6750 → 200", async () => {
    expect((await raw(MAIN, "/api/v1/meta", { headers: { Authorization: `bearer ${A}` } })).status).toBe(200);
    expect((await raw(MAIN, "/api/v1/meta", { headers: { Authorization: `Bearer   ${A}` } })).status).toBe(200);
  });
});

describe("6. Broken Authorization header", () => {
  const cases: [string, string | string[]][] = [
    ["'Bearer' with no token", "Bearer"],
    ["'Bearer ' with only a space", "Bearer "],
    ["two tokens", `Bearer ${A} ${A}`],
    ["token + junk", `Bearer ${A};admin=true`],
    ["10 KB token", `Bearer ${"a".repeat(10_000)}`],
    ["non-ASCII (latin-1) in token", `Bearer ${A}é`],
    ["tab inside the token", `Bearer ${A.slice(0, 5)}\t${A.slice(5)}`],
  ];
  it.each(cases)("ATTACK: %s → SAFE: 400/401, never 200 or 500", async (_, value) => {
    const res = await raw(MAIN, "/api/v1/meta", { headers: { Authorization: value } });
    expect([400, 401, 431]).toContain(res.status);
  });

  it("ATTACK: 10 KB token is rejected quickly (no expensive work on huge input)", async () => {
    const res = await raw(MAIN, "/api/v1/meta", { headers: bearer("a".repeat(10_000)) });
    expect(res.status).toBe(401);
    expect(res.ms).toBeLessThan(isLive ? 3000 : 500);
  });
});

describe("7. Auth runs before anything that could leak information", () => {
  const cases = [
    "/api/v1/drugs?limit=abc",
    "/api/v1/drugs?foo=1",
    "/api/v1/drugs/not-a-number",
    "/api/v1/drugs/1",
    "/api/v1/no-such-endpoint",
  ];
  it.each(cases)("ATTACK: probe %s without a token → SAFE: 401 (not 400/404, which would reveal validation or existence)", async (path) => {
    expect((await raw(MAIN, path)).status).toBe(401);
  });
});

describe("8. Missing configuration fails closed", () => {
  it.skipIf(isLive)("ATTACK: server started without API_TOKENS → SAFE: every call 401, even with a plausible token", async () => {
    const s = server("noTokens")!;
    expect((await raw(s, "/api/v1/meta")).status).toBe(401);
    expect((await raw(s, "/api/v1/meta", { headers: bearer(A) })).status).toBe(401);
    expect((await raw(s, "/api/v1/meta", { headers: bearer("") })).status).toBe(401);
  });
});

describe("10. Public routes stay open", () => {
  it.each(["/docs", "/docs/", "/openapi.yaml", "/data/drug-register.json"])(
    "%s loads without a token (docs and the public dataset don't need one)",
    async (path) => {
      expect((await raw(MAIN, path)).status).toBe(200);
    },
  );


  it("valid token → 200 (control case)", async () => {
    const res = await api("/api/v1/meta");
    expect(res.status).toBe(200);
    expect(json(res).count).toBe(4119);
  });
});
