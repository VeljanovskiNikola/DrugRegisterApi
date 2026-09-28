import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface LimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Unix time in ms when the window resets. */
  reset: number;
}

export interface Limiter {
  limit(key: string): Promise<LimitResult>;
}

/**
 * Fixed-window counter in this function instance's memory. Used for local runs and tests.
 * On Vercel each instance has its own memory, so this is weak in production. Use Upstash there.
 */
export class MemoryLimiter implements Limiter {
  private buckets = new Map<string, { count: number; reset: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async limit(key: string): Promise<LimitResult> {
    const t = this.now();
    if (this.buckets.size > 10_000) {
      for (const [k, b] of this.buckets) if (b.reset <= t) this.buckets.delete(k);
    }
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.reset <= t) {
      bucket = { count: 0, reset: t + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count++;
    return {
      success: bucket.count <= this.max,
      limit: this.max,
      remaining: Math.max(0, this.max - bucket.count),
      reset: bucket.reset,
    };
  }
}

/** Sliding window in Upstash Redis, shared by all function instances. */
export class UpstashLimiter implements Limiter {
  private readonly ratelimit: Ratelimit;

  constructor(redis: Redis, name: string, max: number, windowSeconds: number) {
    this.ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(max, `${windowSeconds} s`),
      prefix: `drug-register-api:${name}`,
      // If Redis is slow, let the request through after 1 s instead of hanging.
      timeout: 1000,
      analytics: false,
      ephemeralCache: new Map(),
    });
  }

  async limit(key: string): Promise<LimitResult> {
    try {
      const { success, limit, remaining, reset } = await this.ratelimit.limit(key);
      return { success, limit, remaining, reset };
    } catch (err) {
      // Fail open: the data is public, so staying up matters more than an exact quota.
      console.error("rate limit store error, allowing request:", err instanceof Error ? err.message : "unknown");
      return { success: true, limit: 0, remaining: 0, reset: Date.now() };
    }
  }
}

export interface RateLimitConfig {
  ipMax: number;
  tokenMax: number;
  windowSeconds: number;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d{1,9}$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return n >= 1 ? n : fallback;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  return {
    ipMax: positiveInt(env.RATE_LIMIT_IP_MAX, 120),
    tokenMax: positiveInt(env.RATE_LIMIT_TOKEN_MAX, 3000),
    windowSeconds: positiveInt(env.RATE_LIMIT_WINDOW_SECONDS, 60),
  };
}

let cached: { signature: string; ip: Limiter; token: Limiter } | undefined;
let warned = false;

/** Limiters for this instance. Upstash when its env vars exist (Marketplace or manual names), else memory. */
export function getLimiters(env: NodeJS.ProcessEnv = process.env): { ip: Limiter; token: Limiter } {
  const config = readConfig(env);
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  const signature = JSON.stringify([config, Boolean(url && token)]);
  if (cached?.signature === signature) return cached;

  if (url && token) {
    const redis = new Redis({ url, token });
    cached = {
      signature,
      ip: new UpstashLimiter(redis, "ip", config.ipMax, config.windowSeconds),
      token: new UpstashLimiter(redis, "token", config.tokenMax, config.windowSeconds),
    };
  } else {
    if (env.VERCEL_ENV === "production" && !warned) {
      warned = true;
      console.warn("Upstash Redis is not configured. Rate limits are per instance only.");
    }
    cached = {
      signature,
      ip: new MemoryLimiter(config.ipMax, config.windowSeconds * 1000),
      token: new MemoryLimiter(config.tokenMax, config.windowSeconds * 1000),
    };
  }
  return cached;
}
