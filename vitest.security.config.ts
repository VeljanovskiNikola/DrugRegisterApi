import { defineConfig } from "vitest/config";

// Security tests: real HTTP against local servers (default) or a deployment (BASE_URL=... API_TOKEN=...).
export default defineConfig({
  test: {
    include: ["test/security/**/*.test.ts"],
    globalSetup: ["test/security/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Rate-limit and timing tests are easier to read and more stable one file at a time.
    fileParallelism: false,
    env: {
      // Only for the in-process tests (inprocess.test.ts). The HTTP servers get their own env.
      API_TOKENS: "inprocess-token-0123456789abcdef",
      TEST_API_TOKEN: "inprocess-token-0123456789abcdef",
      RATE_LIMIT_IP_MAX: "1000000",
      RATE_LIMIT_TOKEN_MAX: "1000000",
      UPSTASH_REDIS_REST_URL: "",
      KV_REST_API_URL: "",
    },
  },
});
