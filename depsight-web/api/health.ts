import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Vercel Serverless Function: 健康检查
 * 路由: /api/health
 * 供 Vercel 监控 / 外部 uptime 探测使用，不依赖上游服务
 */

export default function handler(req: VercelRequest, res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  res.status(200).json({
    ok: true,
    service: "depsight",
    version: "0.8.0-wasm",
    ts: new Date().toISOString(),
  });
}
