import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Vercel Serverless Function: proxy assets.mooncakes.io source files
 * 路由: /api/assets/:name@:version/:file
 * 用途：moon.mod.json 等源码资产在国内不可直达，走 Vercel 代理
 */

const ASSETS_BASE = "https://assets.mooncakes.io/source";

function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // catch-all：/api/assets/{name}@{version}/{file...}
  const raw = req.url?.replace(/^\/api\/assets\//, "") || "";
  const clean = raw.split("?")[0];
  // 文件名中可能含子目录（如 lib/foo.mbt），整体透传
  const target = `${ASSETS_BASE}/${clean}`;

  try {
    const resp = await fetch(target, { redirect: "follow" });
    const body = await resp.text();
    const ct = resp.headers.get("content-type") || "application/json";
    res.setHeader("Content-Type", ct);
    // 源码资产按版本不可变，允许 CDN 缓存 1 小时，降低函数重复执行
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(resp.status).send(body);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
