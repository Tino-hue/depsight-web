import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createRequire } from "node:module";
import { fetchWithTimeout, log, setCors } from "./_lib";

// ESM 下读取自身包版本：createRequire 是官方推荐写法（nft 构建时会追踪 ../package.json）
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/**
 * Vercel Serverless Function: 健康检查
 * 路由: /api/health
 * 供 Vercel 监控 / 外部 uptime 探测使用；带短超时探测上游真实可用性，避免假健康
 */

// 廉价上游探测端点：仅看状态码，不解析 body
const UPSTREAM_PROBE_URL = "https://mooncakes.io/api/v0/modules";
// 必须小于 vercel.json 里 health 的 maxDuration(5s)，留出平台开销余量
const PROBE_TIMEOUT_MS = 4_000;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  setCors(res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  let upstream: "up" | "degraded" | "down";
  let upstreamStatus = 0;
  try {
    const resp = await fetchWithTimeout(
      UPSTREAM_PROBE_URL,
      { method: "GET" },
      PROBE_TIMEOUT_MS,
    );
    upstreamStatus = resp.status;
    // 能连通但状态异常（5xx/429 等）算 degraded；只有网络失败/超时才算 down
    upstream = resp.ok ? "up" : "degraded";
  } catch (e) {
    log("health.upstream_down", {
      message: e instanceof Error ? e.message : String(e),
    });
    upstream = "down";
  }

  const ok = upstream === "up";
  res.status(ok ? 200 : 503).json({
    ok,
    upstream,
    upstreamStatus,
    service: "depsight",
    version: pkg.version + "-wasm",
    ts: new Date().toISOString(),
  });
}
