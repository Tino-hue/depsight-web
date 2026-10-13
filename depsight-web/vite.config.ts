import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

// 自定义代理：处理 download.mooncakes.io 的 302 重定向，
// 在最终响应（CloudFront）上注入 CORS 头，使外部浏览器也能下载
function downloadProxy(): Plugin {
  return {
    name: "download-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        console.log(`[download-proxy] middleware hit: ${req.url}`);
        if (!req.url?.startsWith("/download-proxy/")) return next();
        const target =
          "https://download.mooncakes.io" +
          req.url.replace(/^\/download-proxy/, "");
        try {
          const resp = await fetch(target, { redirect: "follow" });
          console.log(`[download-proxy] ${resp.status} ${target}`);
          if (!resp.ok) {
            const text = await resp.text();
            console.error(`[download-proxy] error body: ${text.slice(0, 500)}`);
          }
          res.statusCode = resp.status;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader(
            "Content-Type",
            resp.headers.get("content-type") ?? "application/octet-stream",
          );
          const buf = Buffer.from(await resp.arrayBuffer());
          res.end(buf);
        } catch (e) {
          res.statusCode = 502;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(String(e));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), downloadProxy()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
  },
});
