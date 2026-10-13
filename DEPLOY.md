# Deploy to Vercel (Global)

面向全球开发者的部署方案：Vercel（前端 CDN + Serverless API）。

## 架构

```
用户浏览器（全球）
  │
  ├─→ depsight-web.vercel.app          （Vercel CDN，静态资源）
  │
  └─→ depsight-web.vercel.app/api/*    （Vercel Serverless Functions）
        ├── /api/modules           → mooncakes.io/api/v0/modules
        ├── /api/modules/:name     → mooncakes.io/api/v0/modules/:name
        └── /api/download/:name/:version → download.mooncakes.io
```

## 部署步骤

### 1. 安装 Vercel CLI

```bash
npm i -g vercel
vercel login
```

### 2. 部署

```bash
cd depsight-web
vercel --prod
```

### 3. 验证

```bash
curl https://your-app.vercel.app/api/modules | head -c 200
curl https://your-app.vercel.app/api/download/moonbitlang/core/0.1.20261012%2B943464bfa -o test.zip -w "%{http_code}"
```

## 文件说明

| 文件                 | 作用                                       |
| -------------------- | ------------------------------------------ |
| `vercel.json`        | CORS headers for `/api/*`                  |
| `api/modules.ts`     | 代理 mooncakes.io modules API              |
| `api/download.ts`    | 代理 download.mooncakes.io zip 下载        |
| `src/lib/fetcher.ts` | 前端自动选择 dev proxy 或 prod `/api` 路径 |
