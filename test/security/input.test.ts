// Input abuse on query parameters and the {id} path. There is no database, so the risks are crashes (500),
// wrong data (param confusion), reading files (path traversal), and slow requests.
import { describe, expect, it } from "vitest";
import { api, json, MAIN, raw } from "./helpers.js";

const enc = encodeURIComponent;

async function expectStatus(path: string, allowed: number[]) {
  const res = await api(path);
  expect(allowed, `${path} → ${res.status} ${res.body.slice(0, 120)}`).toContain(res.status);
  expect(res.status).not.toBe(500);
  return res;
}

describe("22. page and limit abuse", () => {
  const bad = [
    "limit=101",
    "limit=1000000",
    "limit=99999999999999999999999",
    "limit=0",
    "limit=-1",
    "limit=1.5",
    "limit=1e2",
    "limit=0x10",
    "limit=+5", // "+" decodes to a space
    "limit=%2B5",
    "limit=",
    "limit=NaN",
    "limit=Infinity",
    "limit=%EF%BC%95", // full-width 5
    "page=0",
    "page=-1",
    "page=10001",
    "page=999999999999999999999",
    "page=1.0",
    "page=",
  ];
  it.each(bad)("ATTACK: ?%s → SAFE: 400 invalidParameter", async (qs) => {
    const res = await expectStatus(`/api/v1/drugs?${qs}`, [400]);
    expect(json(res).error.code).toBe("invalidParameter");
  });

  it("Edge values still work: limit=100, limit=0100, page=10000 (empty page)", async () => {
    expect(json(await expectStatus("/api/v1/drugs?limit=100", [200])).data).toHaveLength(100);
    expect(json(await expectStatus("/api/v1/drugs?limit=0100", [200])).data).toHaveLength(100);
    expect(json(await expectStatus("/api/v1/drugs?page=10000", [200])).data).toEqual([]);
  });
});

describe("23. Very long input", () => {
  it("ATTACK: q with 101 characters → SAFE: 400", async () => {
    await expectStatus(`/api/v1/drugs?q=${"a".repeat(101)}`, [400]);
  });

  it("ATTACK: q with 10 KB → SAFE: 400, fast", async () => {
    const res = await expectStatus(`/api/v1/drugs?q=${"a".repeat(10_000)}`, [400]);
    expect(res.ms).toBeLessThan(2000);
  });

  it("ATTACK: 20 KB URL → SAFE: rejected by the platform or the API (400/414/431), never 500", async () => {
    const res = await raw(MAIN, `/api/v1/drugs?q=${"a".repeat(20_000)}`);
    expect([400, 401, 414, 431]).toContain(res.status);
  });

  it("ATTACK: 1,000 junk parameters → SAFE: 400, fast", async () => {
    const qs = Array.from({ length: 1000 }, (_, i) => `p${i}=${i}`).join("&");
    const res = await expectStatus(`/api/v1/drugs?${qs}`, [400, 414, 431]);
    expect(res.ms).toBeLessThan(2000);
  });
});

describe("24. Unicode and encoding tricks in q", () => {
  const values: [string, string][] = [
    ["Cyrillic", enc("кепра")],
    ["zero-width space", enc("​keppra")],
    ["right-to-left override", enc("‮keppra")],
    ["full-width letters", enc("ｋｅｐｐｒａ")],
    ["emoji", enc("💊".repeat(10))],
    ["100 combining marks", enc("́".repeat(100))],
    ["NUL byte", "%00"],
    ["keppra + NUL", "keppra%00"],
    ["overlong UTF-8 '/'", "%C0%AF"],
    ["invalid byte", "%FF"],
    ["lone surrogate", "%ED%A0%80"],
    ["cut-off sequence", "%E0%A4%A"],
    ["lone %", "%"],
    ["%%%", "%25%25%25"],
    ["HTML/script", enc("<script>alert(1)</script>")],
    ["SQL-looking", enc("' OR 1=1 --")],
    ["regex-looking", enc("(a+)+$[^]*.*")],
    ["JSON-looking", enc('{"$gt":""}')],
    ["CRLF", "keppra%0D%0AX-Injected:%201"],
  ];
  it.each(values)("ATTACK: q = %s → SAFE: 200 or 400, never 500", async (_, value) => {
    const res = await expectStatus(`/api/v1/drugs?q=${value}`, [200, 400]);
    expect(res.headers["x-injected"]).toBeUndefined();
  });

  it("ATTACK: query text that looks like more parameters → SAFE: stays inside q", async () => {
    const res = await expectStatus(`/api/v1/drugs?q=${enc("keppra&limit=1000")}`, [200]);
    expect(json(res).pagination.limit).toBe(20);
  });
});

describe("25. Percent-encoded parameter names", () => {
  it("ATTACK: %6C%69%6D%69%74=1000 (\"limit\" encoded) → SAFE: decoded and checked, 400", async () => {
    await expectStatus("/api/v1/drugs?%6C%69%6D%69%74=1000", [400]);
  });
  it("Encoded q name still works (%71=keppra)", async () => {
    expect(json(await expectStatus("/api/v1/drugs?%71=keppra", [200])).pagination.total).toBeGreaterThan(0);
  });
});

describe("26. Parameter pollution", () => {
  it.each(["limit=10&limit=1000", "q=a&q=b", "page=1&page=2", "limit=10&%6C%69%6D%69%74=1000"])(
    "ATTACK: ?%s → SAFE: 400 (repeated parameter)",
    async (qs) => {
      const res = await expectStatus(`/api/v1/drugs?${qs}`, [400]);
      expect(json(res).error.message).toMatch(/more than once/);
    },
  );
});

describe("27. Type confusion", () => {
  const cases = [
    "limit[]=5",
    "limit[$gt]=0",
    "q[]=a",
    "q[0]=a",
    "positiveList=1",
    "positiveList=TRUE",
    "positiveList=yes",
    "dispensing=,,,",
    "dispensing=Rp",
    "dispensing=__proto__",
    "productType=constructor",
    "atc=N03%00",
    "atc=N0-3",
    "atc=" + "A".repeat(11),
    "ean=123",
    "ean=123456789012345678",
    "ean=12345678a",
  ];
  it.each(cases)("ATTACK: ?%s → SAFE: 400", async (qs) => {
    await expectStatus(`/api/v1/drugs?${qs}`, [400]);
  });
});

describe("28. Prototype pollution through parameter names", () => {
  it.each([
    "__proto__=x",
    "__proto__[admin]=1",
    "constructor[prototype][admin]=1",
    "constructor=x",
    "hasOwnProperty=x",
    "toString=x",
  ])("ATTACK: ?%s → SAFE: 400 unknown parameter (names are looked up in a Set, never assigned to objects)", async (qs) => {
    await expectStatus(`/api/v1/drugs?${qs}`, [400]);
  });

  it.each(["__proto__", "constructor", "prototype", "toString"])(
    "ATTACK: /api/v1/drugs/%s → SAFE: 400 (ids are digits only; byId is a Map)",
    async (id) => {
      await expectStatus(`/api/v1/drugs/${id}`, [400]);
    },
  );
});

describe("29. Path traversal", () => {
  const onId = [
    "..%2F..%2Fpublic%2Fdata%2Fdrug-register.json",
    "%2e%2e%2f%2e%2e%2fvercel.json",
    "..%5C..%5Cpackage.json",
    "..%252F..%252Fpackage.json",
    "54923%00",
    "54923%00.json",
    "54923.json",
    "54923%2F",
    "54923%2F..%2F1",
    "%C0%AE%C0%AE%C0%AF",
    "....%2F%2F",
  ];
  it.each(onId)("ATTACK: /api/v1/drugs/%s → SAFE: 400/404 JSON, no file contents", async (id) => {
    const res = await expectStatus(`/api/v1/drugs/${id}`, [400, 404]);
    expect(res.body).not.toContain('"devDependencies"');
    expect(res.body).not.toContain('"drugs":[');
  });

  const anywhere = [
    "/api/v1/drugs/../../../../etc/passwd",
    "/api/v1/drugs/%2e%2e/%2e%2e/%2e%2e/package.json",
    "/docs/..%2F..%2Fpackage.json",
    "/docs/%2e%2e/%2e%2e/vercel.json",
    "/data/..%2F..%2Fpackage.json",
    "/%2e%2e/%2e%2e/package.json",
    "/..%2F..%2F..%2Fetc%2Fpasswd",
    "/docs/..%5C..%5Cpackage.json",
    "/.vercel/project.json",
    "/.env",
    "/api/v1/meta.ts",
    "/lib/auth.ts",
    "/raw/drugs_raw.jsonl",
  ];
  it.each(anywhere)("ATTACK: %s → SAFE: no source, config, env or system files", async (path) => {
    const res = await raw(MAIN, path, { headers: { Authorization: `Bearer x` } });
    expect(res.status).not.toBe(500);
    for (const secret of ['"devDependencies"', "root:x:0:0", '"projectId"', "API_TOKENS=", "timingSafeEqual", "import {", '"table":{']) {
      expect(res.body).not.toContain(secret);
    }
  });
});

describe("30. {id} type confusion", () => {
  it.each(["-1", "1e3", "0x1F", enc("５４９２３"), "1234567890123", "%2054923", "54923%20", "54923.0", "+54923", "%2B54923", "5%204923"])(
    "ATTACK: /api/v1/drugs/%s → SAFE: 400",
    async (id) => {
      await expectStatus(`/api/v1/drugs/${id}`, [400]);
    },
  );
  it("Well-formed but unknown ids → 404 (000054923 is not 54923)", async () => {
    await expectStatus("/api/v1/drugs/000054923", [404]);
    await expectStatus("/api/v1/drugs/999999999999", [404]);
  });
});

describe("31. {id} conflicts", () => {
  it("ATTACK: /api/v1/drugs/54923?id=1 (smuggle a different id) → SAFE: 400", async () => {
    await expectStatus("/api/v1/drugs/54923?id=1", [400]);
  });
  it("ATTACK: /api/v1/drugs/54923?id=1&id=54923 → SAFE: 400", async () => {
    await expectStatus("/api/v1/drugs/54923?id=1&id=54923", [400]);
  });
  it("ATTACK: unknown params on the id route (?foo=1, ?__proto__=1) → SAFE: 400", async () => {
    await expectStatus("/api/v1/drugs/54923?foo=1", [400]);
    await expectStatus("/api/v1/drugs/54923?__proto__=1", [400]);
  });
  it("Matching ids are fine: /api/v1/drugs/54923?id=54923 → 200", async () => {
    expect(json(await expectStatus("/api/v1/drugs/54923?id=54923", [200])).id).toBe("54923");
  });
});

describe("32. Unknown API paths", () => {
  it.each([
    "/api/v1/drug",
    "/api/v2/drugs",
    "/api/v1/drugs/54923/extra",
    "/api/v1/meta/x",
    "/api",
    "/api/",
    "/api/v1/",
    "/api/v1/drugs/54923/",
    "/api/not-found",
    "/api/v1/drugs/%5Bid%5D",
  ])(
    "ATTACK: %s → SAFE: JSON 400/404 after the token check",
    async (path) => {
      const res = await expectStatus(path, [200, 400, 404]);
      if (res.status === 200) expect(json(res).id).toBeDefined(); // only /drugs/[id] with a valid id could be 200
    },
  );
});

describe("33. Unexpected HTTP methods", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("ATTACK: %s /api/v1/drugs → SAFE: 405 JSON + Allow: GET, HEAD", async (method) => {
    const res = await api("/api/v1/drugs", { method, body: method === "OPTIONS" ? undefined : '{"q":"x"}', headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET, HEAD");
    expect(json(res).error.code).toBe("methodNotAllowed");
  });

  it.each(["TRACE", "PROPFIND", "FOO"])("ATTACK: %s → SAFE: rejected (4xx), never 2xx or 5xx", async (method) => {
    const res = await raw(MAIN, "/api/v1/meta", { method, headers: { Authorization: "Bearer x" }, platformError: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("HEAD with a token → 200 and no body", async () => {
    const res = await api("/api/v1/meta", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
  });

  it("ATTACK: GET with a JSON body trying to change the limit → SAFE: body ignored (or the request refused)", async () => {
    const res = await api("/api/v1/drugs?limit=1", { body: '{"limit":1000}', headers: { "Content-Type": "application/json" } });
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) expect(json(res).data).toHaveLength(1);
  });
});

describe("33b. Open redirects", () => {
  it.each(["//evil.example/", "//evil.example/%2F..", "/%2F%2Fevil.example/", "/\\evil.example/", "/docs//evil.example/", "/?next=//evil.example"])(
    "ATTACK: %s → SAFE: never redirects to another host",
    async (path) => {
      const res = await raw(MAIN, path);
      const location = res.headers.location;
      if (location) {
        expect(location).toMatch(/^\/(?![\/\\])/); // same-site path only, not //host or /\host
        expect(location).not.toContain("evil.example");
      }
    },
  );
});
