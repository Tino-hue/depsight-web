/// <reference types="@cloudflare/workers-types" />

/**
 * depsight-web API proxy — Cloudflare Workers
 *
 * 解决浏览器直连 mooncakes.io / download.mooncakes.io 的 CORS 问题。
 *
 * 路由：
 *   GET /api/modules           → https://mooncakes.io/api/v0/modules
 *   GET /api/modules/:name     → https://mooncakes.io/api/v0/modules/:name
 *   GET /api/download/:name/:version.zip → https://download.mooncakes.io/user/:name/:version.zip
 *     （follow 302 到 CloudFront，注入 CORS 头后返回）
 */

const MOONCAKES_API = "https://mooncakes.io/api/v0";
const DOWNLOAD_BASE = "https://download.mooncakes.io/user";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(headers: Headers): Headers {
  const h = new Headers(headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  return h;
}

export default {
  async fetch(request: Request): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---- /api/modules ----
      if (path === "/api/modules") {
        const resp = await fetch(`${MOONCAKES_API}/modules`);
        return new Response(resp.body, {
          status: resp.status,
          headers: withCors(resp.headers),
        });
      }

      // ---- /api/modules/:name ----
      const modMatch = path.match(/^\/api\/modules\/(.+)$/);
      if (modMatch) {
        const name = modMatch[1];
        const resp = await fetch(`${MOONCAKES_API}/modules/${name}`);
        return new Response(resp.body, {
          status: resp.status,
          headers: withCors(resp.headers),
        });
      }

      // ---- /api/download/:name/:version.zip ----
      const dlMatch = path.match(/^\/api\/download\/(.+)\/(.+)\.zip$/);
      if (dlMatch) {
        const [, name, version] = dlMatch;
        const target = `${DOWNLOAD_BASE}/${name}/${encodeURIComponent(version)}.zip`;
        const resp = await fetch(target, { redirect: "follow" });
        const headers = withCors(resp.headers);
        // zip 内容类型
        if (!headers.get("Content-Type")) {
          headers.set("Content-Type", "application/zip");
        }
        return new Response(resp.body, { status: resp.status, headers });
      }

      // 404
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        {
          status: 502,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        },
      );
    }
  },
};
