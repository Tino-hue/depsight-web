import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clientIp, fetchWithTimeout, log, rateLimit, setCors } from "../_lib";

/**
 * Vercel Serverless Function: proxy mooncakes.io download
 * 路由: /api/download/:name/:version.zip
 */

const DOWNLOAD_BASE = "https://download.mooncakes.io/user";
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
// version 白名单字符：防止注入上游 URL 的畸形串
const VERSION_RE = /^[A-Za-z0-9._+-]{1,64}$/;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  if (!rateLimit(req, res)) return;

  // 参数解析：优先 Vercel 原生 catch-all 注入的 query.path（string 按 "/" 拆）；
  // 缺失时回退 req.url 手工解析，兼容本地 dev 直连形态
  const q = req.query.path;
  let segments: string[];
  if (typeof q === "string") {
    segments = q.split("/").filter(Boolean);
  } else if (Array.isArray(q)) {
    segments = q;
  } else {
    const raw = req.url?.replace(/^\/api\/download\//, "") || "";
    segments = raw.split("?")[0].split("/").filter(Boolean);
  }
  // 末段可能带 .zip 后缀（catch-all 不剥扩展名），统一剥除
  const lastSeg = segments[segments.length - 1];
  if (lastSeg) segments[segments.length - 1] = lastSeg.replace(/\.zip$/, "");

  // 倒数第一段为 version，其余 join("/") 为 name
  if (segments.length < 2) {
    log("download.bad_request", { reason: "missing_segments", url: req.url });
    res
      .status(400)
      .json({ error: "expected /api/download/:name/:version.zip" });
    return;
  }

  const version = segments[segments.length - 1];
  const name = segments.slice(0, -1).join("/");

  // 包名格式校验：防止路径遍历/开放代理
  const NAME_RE = /^[a-z0-9_-]+\/[a-z0-9_-]+$/;
  if (
    !NAME_RE.test(name) ||
    name.includes("..") ||
    name.includes("%") ||
    name.includes("\\")
  ) {
    log("download.bad_request", { reason: "invalid_name", name });
    res.status(400).json({ error: "invalid package name format" });
    return;
  }

  if (!VERSION_RE.test(version)) {
    log("download.bad_request", { reason: "invalid_version", name, version });
    res.status(400).json({ error: "invalid version" });
    return;
  }

  log("download.start", { name, version, ip: clientIp(req) });

  try {
    const target = `${DOWNLOAD_BASE}/${encodeURIComponent(name)}/${encodeURIComponent(version)}.zip`;
    const resp = await fetchWithTimeout(target, { redirect: "follow" });

    // 非 2xx 脱敏：不回显上游原始 body/Content-Type/内部细节，统一错误格式；错误响应不走 immutable 缓存
    if (!resp.ok) {
      log("download.upstream_error", { status: resp.status, name, version });
      res.setHeader("Cache-Control", "no-store");
      res
        .status(502)
        .json({ error: "upstream request failed", status: resp.status });
      return;
    }

    // content-length 预检：超上限直接 413，不落内存
    const len = Number(resp.headers.get("content-length") || "0");
    if (len > MAX_ZIP_BYTES) {
      res.status(413).json({ error: "archive too large" });
      return;
    }

    if (!resp.body) {
      res.setHeader("Cache-Control", "no-store");
      res
        .status(502)
        .json({ error: "upstream request failed", status: resp.status });
      return;
    }

    const ct = resp.headers.get("content-type") || "application/zip";
    res.setHeader("Content-Type", ct);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // name@version 归档内容不可变：长缓存 + immutable，浏览器/CDN 不再回源
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    res.status(resp.status);

    // 中途计数上限：防 chunked 编码谎报/缺失 content-length
    let received = 0;
    const limited = new Readable({
      async read() {
        const reader = resp.body!.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > MAX_ZIP_BYTES) {
              res.destroy(new Error("archive exceeds 64MB limit"));
              return;
            }
            this.push(value);
          }
          this.push(null);
        } catch (e) {
          this.destroy(e as Error);
        } finally {
          reader.releaseLock();
        }
      },
    });

    // 客户端断开时取消上游，避免继续计费传输
    req.on("close", () => {
      if (!res.writableEnded) resp.body!.cancel().catch(() => {});
    });

    // 流式转发带背压，替代全量 Buffer 缓冲
    await pipeline(limited, res);
  } catch (e) {
    // 内部细节只进日志，响应脱敏（与 modules/health 行为一致）
    log("download.error", {
      message: e instanceof Error ? e.message : String(e),
      name,
      version,
    });
    if (!res.headersSent) {
      res.setHeader("Cache-Control", "no-store");
      res.status(502).json({ error: "internal proxy error" });
    }
  }
}
