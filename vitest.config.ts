import { defineConfig } from "vitest/config";

// Unit tests: call the handlers in-process. Security tests have their own config (vitest.security.config.ts).
const TEST_API_TOKEN = "unit-test-token-0123456789abcdef";

export default defineConfig({
  test: {
    include: ["test/*.test.ts"],
    env: {
      API_TOKENS: TEST_API_TOKEN,
      TEST_API_TOKEN,
      // In-process calls all come from one "unknown" IP, so lift the limits for these tests.
      RATE_LIMIT_IP_MAX: "1000000",
      RATE_LIMIT_TOKEN_MAX: "1000000",
      // Never talk to a real Upstash from unit tests.
      UPSTASH_REDIS_REST_URL: "",
      KV_REST_API_URL: "",
    },
  },
});
