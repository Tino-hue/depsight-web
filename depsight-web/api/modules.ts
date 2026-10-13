import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Vercel Serverless Function: proxy mooncakes.io modules API
 * 路由: /api/modules 或 /api/modules/:name
 */

const MOONCAKES_API = "https://mooncakes.io/api/v0";

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

  const { name } = req.query;

  try {
    const url = name
      ? `${MOONCAKES_API}/modules/${encodeURIComponent(String(name))}`
      : `${MOONCAKES_API}/modules`;

    const resp = await fetch(url);
    const body = await resp.text();
    res.status(resp.status).send(body);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
