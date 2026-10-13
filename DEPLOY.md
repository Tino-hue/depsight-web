# Deploy to Cloudflare (Global)

面向全球开发者的部署方案：Cloudflare Pages（前端）+ Workers（API 代理）。

## 前置条件

```bash
npm install -g wrangler
npx wrangler login
```

## 1. 部署 API Worker

```bash
cd worker
npx wrangler deploy
# 输出: https://depsight-api.<your-subdomain>.workers.dev
```

## 2. 构建并部署前端

```bash
cd depsight-web
npm run build
npx wrangler pages deploy dist --project-name=depsight-web
# 输出: https://depsight-web.pages.dev
```

## 3. 绑定自定义域名（可选）

在 Cloudflare Dashboard：
- Pages 项目 → Settings → Domains → 添加 `depsight.yourdomain.com`
- Workers 项目 → Settings → Domains → 添加 `api.yourdomain.com`

然后在 Pages 的 `_routes.json` 中把 `/api/*` 指向 Worker 域名，或者直接用 Workers 的 `workers.dev` 域名做 API。

## 4. 验证

```bash
curl https://depsight-api.<subdomain>.workers.dev/api/modules | head -c 200
curl https://depsight-web.pages.dev | head -c 200
```

## 架构

```
用户浏览器
  ├── depsight-web.pages.dev (静态资源, 全球 CDN)
  └── depsight-api.workers.dev/api/* (代理 mooncakes.io)
        ├── /api/modules → mooncakes.io/api/v0/modules
        └── /api/download/:name/:ver.zip → download.mooncakes.io
```
