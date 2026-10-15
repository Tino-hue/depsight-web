import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Vercel Serverless Function 共享辅助：CORS、带超时 fetch、内存令牌桶限流
 */

/**
 * 结构化日志：单行 JSON，供 Vercel 日志检索；内部细节只进日志不回显响应
 */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), event, ...fields }),
  );
}

/**
 * CORS 仅此一处配置（vercel.json 不配）：/api/* 同时服务同源前端与跨域调用者；
 * Access-Control-Max-Age 缓存预检结果，减少 OPTIONS 请求
 */
export function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

const FETCH_TIMEOUT_MS = 12_000;

/**
 * undici 无默认超时：慢连接/丢包会挂到平台超时才被杀，按满额 GB·s 计费。
 * 统一加 12s 上限，timeoutMs 可收紧（如 health 探测短于 maxDuration）；
 * init.signal 可联动外部 AbortController（客户端断开等），任一触发即中止，且中止对 body 读取阶段同样生效
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // 联动外部 signal：外部 abort 与超时共用同一内部 ctrl
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();

// 防 Map 无限增长：随请求周期性清理已过窗口的桶
function pruneBuckets(now: number): void {
  if (buckets.size < 10_000) return;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

/**
 * 客户端 IP：x-forwarded-for 首段即客户端 IP，缺失退回 socket 地址
 */
export function clientIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  return (
    (typeof fwd === "string"
      ? fwd.split(",")[0].trim()
      : req.socket?.remoteAddress) || "unknown"
  );
}

/**
 * 内存滑动窗口限流：60 req/min/IP，单实例内生效。
 * 超限返回 429；x-forwarded-for 首段即客户端 IP。
 */
export function rateLimit(req: VercelRequest, res: VercelResponse): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  pruneBuckets(now);
  const b = buckets.get(ip);
  if (!b || b.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  b.count += 1;
  if (b.count > RATE_LIMIT) {
    log("ratelimit.hit", { ip });
    res.setHeader("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
    res.status(429).json({ error: "rate limit exceeded" });
    return false;
  }
  return true;
}
