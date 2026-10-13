import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Vercel Serverless Function: proxy mooncakes.io download
 * 路由: /api/download/:name/:version.zip
 */

const DOWNLOAD_BASE = "https://download.mooncakes.io/user";

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

  // Vercel dynamic route: /api/download/[name]/[version].zip
  // 但 .zip 后缀会被当成文件扩展名，所以用 catch-all 解析
  const raw = req.url?.replace(/^\/api\/download\//, "") || "";
  // 去掉查询参数
  const clean = raw.split("?")[0];
  // 去掉 .zip 后缀
  const withoutExt = clean.replace(/\.zip$/, "");
  // 最后一个 / 前面是 name，后面是 version
  const lastSlash = withoutExt.lastIndexOf("/");
  if (lastSlash === -1) {
    res.status(400).json({ error: "expected /api/download/:name/:version.zip" });
    return;
  }

  const name = withoutExt.slice(0, lastSlash);
  const version = withoutExt.slice(lastSlash + 1);

  try {
    const target = `${DOWNLOAD_BASE}/${name}/${encodeURIComponent(version)}.zip`;
    const resp = await fetch(target, { redirect: "follow" });
    const buf = Buffer.from(await resp.arrayBuffer());
    const ct = resp.headers.get("content-type") || "application/zip";
    res.setHeader("Content-Type", ct);
    res.status(resp.status).send(buf);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
