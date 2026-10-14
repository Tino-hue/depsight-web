# Depsight — 工业级交付文档

**版本**: 0.8.0  
**交付日期**: 2026-10-14  
**交付目标**: GitHub 代码仓库 + mooncakes.io 软件包仓库

---

## 1. 项目概述

Depsight 是 MoonBit 依赖健康分析工具，在过期依赖进入生产环境前发现风险。

| 属性         | 值                                                         |
| ------------ | ---------------------------------------------------------- |
| **项目名称** | depsight-web                                               |
| **版本**     | 0.8.0                                                      |
| **许可证**   | MIT（Web 应用）/ Apache-2.0（WASM 引擎）                   |
| **技术栈**   | React 19 + TypeScript + Vite + Tailwind CSS + MoonBit WASM |
| **部署目标** | Vercel Serverless Functions                                |
| **包管理**   | npm（Web）/ mooncakes.io（MoonBit 库）                     |

---

## 2. 交付物清单

| 交付物           | 位置                                     | 说明                        |
| ---------------- | ---------------------------------------- | --------------------------- |
| **源代码仓库**   | https://github.com/Tino-hue/depsight-web | GitHub 主仓库               |
| **MoonBit 引擎** | `d:\MoonStep\moonbit\`                   | MoonBit 源码，编译为 WASM   |
| **WASM 产物**    | `depsight-web/public/depsight.wasm`      | 128KB，wasm-gc + js-string  |
| **npm 包**       | `depsight-web/package.json`              | Web 应用依赖配置            |
| **moon.mod**     | `moonbit/moon.mod`                       | MoonBit 模块清单            |
| **API 函数**     | `depsight-web/api/*.ts`                  | Vercel Serverless Functions |
| **文档**         | `README.md`、`DELIVERY.md`               | 项目说明和交付文档          |
| **许可证**       | `LICENSE`（MIT）                         | Web 应用许可证              |
| **测试**         | `src/lib/*.test.ts`                      | 42 个离线测试用例           |

---

## 3. 构建流程说明

### 3.1 环境要求

| 依赖        | 版本    | 用途                                     |
| ----------- | ------- | ---------------------------------------- |
| Node.js     | >= 18.x | Web 应用构建                             |
| npm         | >= 9.x  | 包管理                                   |
| MoonBit CLI | 最新版  | 编译 WASM 引擎（可选，预编译产物已包含） |

### 3.2 Web 应用构建

```bash
# 1. 克隆仓库
git clone https://github.com/Tino-hue/depsight-web.git
cd depsight-web

# 2. 安装依赖
npm install

# 3. 本地开发
npm run dev

# 4. 生产构建
npm run build

# 5. 运行测试
npm test              # 完整测试（含在线测试）
OFFLINE=1 npm test    # 仅离线测试（CI 推荐）

# 6. 代码检查
npm run lint
```

### 3.3 MoonBit WASM 引擎构建（可选）

预编译产物已包含在 `public/depsight.wasm`，如需重新编译：

```bash
# 进入 MoonBit 引擎目录
cd d:\MoonStep\moonbit

# 编译 WASM（需要 MoonBit CLI）
moon build --target wasm-gc --release

# 复制产物到 Web 应用
cp _build/wasm-gc/release/build/main/main.wasm ../depsight-web/public/depsight.wasm
```

### 3.4 Vercel 部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署到生产环境
vercel --prod
```

**注意**: `api/*.ts` 是 Vercel Serverless Functions，部署到其他平台需要适配。

---

## 4. mooncakes.io 发布说明

### 4.1 模块信息

```toml
# moonbit/moon.mod
name = "Tino-hue/depsight-wasm-api"
version = "0.8.0"
license = "Apache-2.0"
preferred_target = "wasm-gc"
description = "MoonBit dependency health analysis engine — WASM API"
repository = "https://github.com/Tino-hue/depsight-web"
keywords = ["dependency-analysis", "health-score", "moonbit", "wasm"]
```

### 4.2 发布步骤

**状态：已完成（2026-10-14 08:38 UTC）**，`moon publish` 返回 `Server status: 200 OK`。

后续版本发布流程：

```bash
# 1. 登录 mooncakes.io（凭据位于 ~/.moon/credentials.json）
moon login

# 2. 本地验证
moon check        # 26 项测试须全部通过
moon test
moon build --target wasm-gc --release

# 3. 发布
cd d:\MoonStep\moonbit
moon publish
```

### 4.3 发布后验证（实测）

以下验证均于 2026-10-14 实测通过：

```bash
# 1. 模块 manifest 在线可查
curl "https://mooncakes.io/api/v0/manifest/Tino-hue/depsight-wasm-api"
# 返回：version=0.8.0, build_status=success, license=Apache-2.0, downloads>=2

# 2. 消费方安装验证（临时目录新建空模块）
moon add Tino-hue/depsight-wasm-api
# 结果：moon.mod 自动写入 import { "Tino-hue/depsight-wasm-api@0.8.0" }，包下载成功

# 3. 消费方编译验证
moon check        # 通过
moon test         # 1 passed —— 测试体内真实调用 @main.version() 与 @main.analyze_from_mod_text()
```

### 4.4 消费方使用

其他 MoonBit 项目引用方式：

```toml
# moon.mod
import {
  "Tino-hue/depsight-wasm-api@0.8.0"
}
```

```moonbit
# main/moon.pkg
import {
  "Tino-hue/depsight-wasm-api/main"
}
```

```moonbit
fn main {
  let report = @main.analyze_from_mod_text(moon_mod_text)
  println(report)
}
```

---

## 5. 功能验证清单

### 5.1 核心功能

| 功能                       | 状态 | 验证方式                        |
| -------------------------- | ---- | ------------------------------- |
| 依赖分析（粘贴/上传/包名） | ✅   | 输入 `moon.mod` 文本测试        |
| 健康评分（0-100）          | ✅   | 检查五维度加权计算              |
| 风险诊断（8 种诊断码）     | ✅   | 触发 YANKED/OUTDATED/LICENSE 等 |
| 3D 依赖图                  | ✅   | three.js 力导向图渲染           |
| 趋势追踪                   | ✅   | localStorage 历史记录           |
| 生态看板                   | ✅   | mooncakes.io 全量数据分析       |
| AI 诊断                    | ✅   | OpenAI 兼容 API + 规则引擎降级  |
| 结果分享                   | ✅   | `#share=<payload>` URL          |

### 5.2 API 端点

| 端点                               | 方法 | 状态                                       |
| ---------------------------------- | ---- | ------------------------------------------ |
| `/api/modules`                     | GET  | ✅ 代理 mooncakes.io 模块列表              |
| `/api/modules/:name`               | GET  | ✅ 代理单包 manifest                       |
| `/api/download/:name/:version.zip` | GET  | ✅ 代理下载 ZIP（含路径遍历防护）          |
| `/api/health`                      | GET  | ✅ 健康检查 `{ ok, service, version, ts }` |

### 5.3 测试覆盖

| 测试文件           | 用例数            | 说明                          |
| ------------------ | ----------------- | ----------------------------- |
| `analyzer.test.ts` | 36                | MoonBit 引擎 JS fallback 测试 |
| `fetcher.test.ts`  | 19（13 在线跳过） | mooncakes.io 客户端测试       |
| **总计**           | **42（离线）**    | 全部通过                      |

MoonBit 引擎侧：`moon test` 26 项全部通过。

### 5.4 交付验证记录（2026-10-14 实测）

| 验证项            | 方法                                                                        | 结果      |
| ----------------- | --------------------------------------------------------------------------- | --------- |
| GitHub 可克隆     | `git clone --depth 1 https://github.com/Tino-hue/depsight-web.git`          | ✅        |
| 依赖可安装        | 克隆产物内 `npm install`（234 包，21s）                                     | ✅        |
| 生产构建          | 克隆产物内 `npm run build`（tsc + vite，exit 0）                            | ✅        |
| 测试通过          | 克隆产物内 `npm test`（55 passed / 2 files）                                | ✅        |
| mooncakes.io 发布 | `moon publish` → `Server status: 200 OK`                                    | ✅ v0.8.0 |
| 发布包在线可查    | `GET /api/v0/manifest/Tino-hue/depsight-wasm-api` → `build_status: success` | ✅        |
| 发布包可安装      | 空消费模块 `moon add Tino-hue/depsight-wasm-api` 解析到 0.8.0 并下载        | ✅        |
| 发布包可使用      | 消费模块 `moon check` 通过；`moon test` 真实调用包内 API 通过               | ✅        |

---

## 6. 安全加固

### 6.1 API 安全

| 措施         | 实现                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| 路径遍历防护 | `api/download/[...path].ts` 包名白名单校验 `^[a-z0-9_-]+/[a-z0-9_-]+$` |
| URL 编码     | 所有用户输入经 `encodeURIComponent` 处理                               |
| CORS 头      | `Access-Control-Allow-Origin: *`（公开 API）                           |
| 输入大小限制 | WASM: context JSON > 8MB / mod 文本 > 1MB 跳过                         |

### 6.2 WASM 桥接安全

| 措施         | 实现                                    |
| ------------ | --------------------------------------- |
| 版本契约门   | `version()` 前缀检查，不符自动禁用 WASM |
| 连续失败熔断 | 3 次失败后自动降级到 JS fallback        |
| 失败可观测   | `getLastWasmError()` 暴露错误原因       |

---

## 7. 已知限制

| 限制                      | 说明                                   | 缓解措施                         |
| ------------------------- | -------------------------------------- | -------------------------------- |
| **mooncakes.io API 依赖** | 模块列表和下载依赖 mooncakes.io 可用性 | 多层缓存（session/localStorage） |
| **Vercel 平台绑定**       | Serverless Functions 仅支持 Vercel     | README 明确标注                  |
| **国内访问**              | 未备案域名 + Vercel 国外节点           | Cloudflare CDN（待 NS 生效）     |
| **AI 诊断**               | 需要用户自备 OpenAI 兼容 API Key       | 内置规则引擎降级                 |
| **单包大小**              | WASM 引擎约 128KB                      | 懒加载 + gzip 压缩               |

---

## 8. 维护指南

### 8.1 版本发布流程

1. **更新版本号**：
   - `package.json`（Web 应用）
   - `moon.mod`（MoonBit 模块）
   - `api/health.ts`（硬编码版本）

2. **运行测试**：

   ```bash
   OFFLINE=1 npm test
   npm run lint
   npm run build
   ```

3. **提交并推送**：

   ```bash
   git add -A
   git commit -m "release: v0.x.x"
   git push
   ```

4. **发布到 mooncakes.io**：
   ```bash
   cd d:\MoonStep\moonbit
   moon publish
   ```

### 8.2 故障排查

| 问题          | 排查步骤                                |
| ------------- | --------------------------------------- |
| WASM 加载失败 | 检查浏览器控制台 `getLastWasmError()`   |
| API 超时      | 检查 Vercel Dashboard 函数日志          |
| 依赖图不渲染  | 确认 WebGL 支持，检查 three.js 分包加载 |
| 分享链接失效  | 确认 URL 完整（含 `#share=` 前缀）      |

---

## 9. 联系方式

| 渠道              | 地址                                            |
| ----------------- | ----------------------------------------------- |
| **GitHub Issues** | https://github.com/Tino-hue/depsight-web/issues |
| **项目主页**      | https://depsight.xruoyu.xyz/（待 NS 生效）      |

---

## 10. 许可证

- **Web 应用**: [MIT License](./LICENSE)
- **MoonBit WASM 引擎**: Apache-2.0（见 `moonbit/moon.mod`）

---

**交付完成日期**: 2026-10-14  
**交付版本**: v0.8.0  
**交付人**: Tino-hue
