// Code-level checks that HTTP tests can't see: constant-time token comparison, regex worst cases,
// and Object.prototype staying clean. These run in-process against the source, in both local and live mode.
import { beforeEach, describe, expect, it, vi } from "vitest";

// Count every timingSafeEqual call, while keeping the real behavior.
const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      calls.n++;
      return real.timingSafeEqual(a, b);
    },
  };
});

const { BEARER_PATTERN, isValidToken } = await import("../../lib/auth.js");
const { normalize } = await import("../../lib/data.js");
const { echo, parseDrugQuery } = await import("../../lib/query.js");
const { readId } = await import("../../api/v1/drugs/[id].js");
const { GET: listDrugs } = await import("../../api/v1/drugs/index.js");

const TOKENS = ["tok-one-0000000000000000", "tok-two-1111111111111111", "tok-three-222222222222222"];

describe("9. Constant-time token check (code level; network timing is too noisy to test)", () => {
  beforeEach(() => {
    process.env.API_TOKENS = TOKENS.join(",");
    calls.n = 0;
  });

  it.each([
    ["matches the first token", TOKENS[0]!, true],
    ["matches the last token", TOKENS[2]!, true],
    ["matches none", "nope", false],
    ["much longer than any token", "x".repeat(500), false],
  ])("%s → compares against every token, the same number of times", (_, candidate, expected) => {
    expect(isValidToken(candidate)).toBe(expected);
    expect(calls.n).toBe(TOKENS.length);
  });

  it("whitespace around tokens in API_TOKENS is ignored; empty entries don't create an empty valid token", () => {
    process.env.API_TOKENS = ` ${TOKENS[0]} ,, ,${TOKENS[1]}, `;
    expect(isValidToken(TOKENS[0]!)).toBe(true);
    expect(isValidToken("")).toBe(false);
    expect(isValidToken(" ")).toBe(false);
  });
});

function timed(fn: () => void): number {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

describe("35b. Every regex in the request path is linear (worst-case strings, 100k chars)", () => {
  const big = 100_000;
  const worst = [
    "a".repeat(big),
    "a".repeat(big) + "!",
    "=".repeat(big) + "!",
    "Bearer " + "a".repeat(big) + "=".repeat(big) + " ",
    "Bearer " + " ".repeat(big) + "x!",
    "́".repeat(big),
    "\u0000".repeat(big),
    "ab".repeat(big / 2),
  ];
  it.each(worst.map((w, i) => [i, w] as const))("worst case #%s: auth regex, normalize, echo, param checks < 100 ms", (_, input) => {
    expect(timed(() => BEARER_PATTERN.test(input))).toBeLessThan(100);
    expect(timed(() => normalize(input))).toBeLessThan(100);
    expect(timed(() => echo(input))).toBeLessThan(100);
    expect(
      timed(() => {
        try {
          parseDrugQuery(new URLSearchParams({ q: input }));
        } catch {
          /* rejected: fine */
        }
      }),
    ).toBeLessThan(100);
  });
});

describe("28b. Prototype pollution (in-process: Object.prototype must stay clean)", () => {
  it("ATTACK: requests with __proto__ / constructor.prototype params → SAFE: 400 and no new properties on Object.prototype", async () => {
    process.env.API_TOKENS = TOKENS[0];
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    for (const qs of ["__proto__[polluted]=1", "constructor[prototype][polluted]=1", "__proto__.polluted=1", "q=a&__proto__=x"]) {
      const res = await listDrugs(
        new Request(`https://api.test/api/v1/drugs?${qs}`, { headers: { Authorization: `Bearer ${TOKENS[0]}` } }),
      );
      expect(res.status).toBe(400);
    }
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("31b. {id} is read the same way whatever URL shape the platform passes", () => {
  it.each([
    ["original path", "https://x/api/v1/drugs/54923", "54923"],
    ["original path + platform ?id", "https://x/api/v1/drugs/54923?id=54923", "54923"],
    ["rewritten path", "https://x/api/v1/drugs/[id]?id=54923", "54923"],
    ["encoded rewritten path", "https://x/api/v1/drugs/%5Bid%5D?id=54923", "54923"],
  ])("%s → %s", (_, url, id) => {
    expect(readId(new Request(url))).toEqual({ ok: true, id });
  });

  it.each([
    ["conflict", "https://x/api/v1/drugs/54923?id=1"],
    ["rewritten, conflicting ids", "https://x/api/v1/drugs/[id]?id=54923&id=1"],
    ["missing", "https://x/api/v1/drugs/[id]"],
    ["bad encoding", "https://x/api/v1/drugs/%E0%A4%A"],
  ])("%s → rejected", (_, url) => {
    expect(readId(new Request(url)).ok).toBe(false);
  });
});
