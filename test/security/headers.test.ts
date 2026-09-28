// Security headers, caching and CORS.
import { describe, expect, it } from "vitest";
import { api, cfg, isLive, MAIN, raw } from "./helpers.js";

type R = Awaited<ReturnType<typeof raw>>;
const routes: [string, () => Promise<R>][] = [
  ["API 200", () => api("/api/v1/meta")],
  ["API 400", () => api("/api/v1/drugs?limit=0")],
  ["API 401", () => raw(MAIN, "/api/v1/meta")],
  ["API 404", () => api("/api/v1/drugs/1")],
  ["API 405", () => raw(MAIN, "/api/v1/meta", { method: "POST" })],
  ["/docs", () => raw(MAIN, "/docs")],
  ["/docs script", () => raw(MAIN, "/docs/init.js")],
  ["/openapi.yaml", () => raw(MAIN, "/openapi.yaml")],
  ["/data file", () => raw(MAIN, "/data/drug-register.json", { method: "HEAD" })],
];

describe("11. Base headers on every route and status", () => {
  it.each(routes)("%s has nosniff + Referrer-Policy", async (_, get) => {
    const res = await get();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });
});

describe("12. Nothing reveals the server stack", () => {
  it.each(routes)("%s: no X-Powered-By, no version in Server", async (_, get) => {
    const res = await get();
    expect(res.headers["x-powered-by"]).toBeUndefined();
    // Vercel adds "Server: Vercel" and x-vercel-id; they can't be removed and show no version.
    if (res.headers.server) expect(res.headers.server).not.toMatch(/\d+\.\d+/);
  });

  it.skipIf(!isLive)("HSTS is sent (Vercel adds it on its domains)", async () => {
    const res = await api("/api/v1/meta");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=\d{7,}/);
  });
});

describe("13. API responses can't be stored by shared caches", () => {
  it.each(routes.slice(0, 5))("ATTACK: shared-cache poisoning / auth bypass via cache on %s → SAFE: private or no-store", async (_, get) => {
    const res = await get();
    const cc = String(res.headers["cache-control"]);
    expect(cc).not.toMatch(/public|s-maxage/);
    expect(cc === "private, max-age=300" || cc === "no-store").toBe(true);
    if (res.status !== 200) expect(cc).toBe("no-store");
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("A 200 response says it varies by Authorization", async () => {
    expect((await api("/api/v1/meta")).headers.vary).toContain("Authorization");
  });
});

describe("14. /docs has a strict Content-Security-Policy", () => {
  it("CSP allows only this site's scripts, and no inline scripts", async () => {
    const csp = String((await raw(MAIN, "/docs")).headers["content-security-policy"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*(unsafe-inline|unsafe-eval|\*|https?:)/);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it("the HTML page has no inline scripts", async () => {
    const html = (await raw(MAIN, "/docs")).body;
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
    expect(inline).toHaveLength(0);
  });

  it("ATTACK: XSS in the docs page loaded in a real browser → SAFE: page renders with zero CSP violations and loads only from this site", async () => {
    let chromium: typeof import("playwright-core").chromium;
    try {
      ({ chromium } = await import("playwright-core"));
    } catch {
      console.warn("playwright-core not installed; skipping the browser check");
      return;
    }
    let browser;
    try {
      browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    } catch {
      console.warn("No Chromium found (set CHROMIUM_PATH or run `npx playwright install chromium`); skipping");
      return;
    }
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
      const problems: string[] = [];
      const hosts = new Set<string>();
      page.on("console", (m) => {
        if (m.type() === "error" || /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
      });
      page.on("pageerror", (e) => problems.push(String(e)));
      page.on("request", (r) => hosts.add(new URL(r.url()).host));
      await page.goto(`${MAIN}/docs`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      expect(await page.locator("h1").first().innerText()).toContain("North Macedonia Drug Register API");
      expect(problems).toEqual([]);
      expect([...hosts]).toEqual([new URL(MAIN).host]);
    } finally {
      await browser.close();
    }
  });
});

describe("15. CORS", () => {
  const evil = { Origin: "https://evil.example" };

  it("ATTACK: another website reads the API from a user's browser → SAFE: no Access-Control-Allow-Origin", async () => {
    const res = await api("/api/v1/drugs?limit=1", { headers: evil });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("ATTACK: CORS preflight asking to send Authorization → SAFE: not allowed (405, no CORS headers)", async () => {
    const res = await raw(MAIN, "/api/v1/drugs", {
      method: "OPTIONS",
      headers: { ...evil, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
    });
    expect(res.status).toBe(405);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-headers"]).toBeUndefined();
  });

  it("ATTACK: another website reads the full dataset file → SAFE: no Access-Control-Allow-Origin", async () => {
    const res = await raw(MAIN, "/data/drug-register.json", { method: "HEAD", headers: evil });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("By design: /openapi.yaml allows any origin, so online tools can load the public spec", async () => {
    const res = await raw(MAIN, "/openapi.yaml", { headers: evil });
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("ATTACK: /docs framed by another site (clickjacking) → SAFE: frame-ancestors 'none' + X-Frame-Options DENY", async () => {
    const res = await raw(MAIN, "/docs");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(String(res.headers["content-security-policy"])).toContain("frame-ancestors 'none'");
  });
});

// Keep cfg referenced so live mode prints which base it tested.
it("target", () => {
  expect(cfg.servers.main).toBeTruthy();
});
