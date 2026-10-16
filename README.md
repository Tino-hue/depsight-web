# Depsight

MoonBit 依赖健康分析平台 —— 把一份 `moon.mod` 变成健康报告：依赖图、许可证与新鲜度信号、AI 辅助修复，在过期依赖进入生产环境之前发现风险。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./depsight-web/LICENSE)
[![MoonBit](https://img.shields.io/badge/engine-MoonBit%20wasm--gc-orange)](https://www.moonbitlang.com/)
[![mooncakes](https://img.shields.io/badge/mooncakes-Tino--hue%2Fdepsight--wasm--api-blue)](https://mooncakes.io/docs/#/Tino-hue/depsight-wasm-api)
[![Online](https://img.shields.io/badge/live%20demo-depsight.xruoyu.xyz-brightgreen)](https://depsight.xruoyu.xyz/)

**在线体验：[depsight.xruoyu.xyz](https://depsight.xruoyu.xyz/)**

![Depsight 首页](./docs/images/hero.png)

## 功能一览

### 依赖分析与健康评分

粘贴 `moon.mod`、上传文件或输入包名@版本，自动展开完整传递依赖图。0–100 综合评分按五维度加权：新鲜度 25%、许可证合规 20%、废弃 API 密度 25%、包体积 20%、活跃度 10%。风险清单逐条给出诊断编号（OUTDATED / LICENSE / DEPRECATED / SIZE / ACTIVITY / CYCLE / DUP / YANKED）与修复建议。

![分析仪表盘](./docs/images/analyze.png)

### 3D 依赖图

three.js 力导向布局：节点大小映射包体积，颜色映射健康分（绿 → 红），支持按名称搜索聚焦、依赖路径高亮与一键重置。

![3D 依赖图](./docs/images/graph.png)

### 趋势追踪

每次分析自动记录健康分到本地历史，Canvas 手绘折线展示评分随时间的变化，可切换多个根项目对比。

![健康分趋势](./docs/images/trends.png)

### 生态看板

拉取 mooncakes.io 全量包元数据（需能直连），统计生态健康分、活跃/停滞分布、许可证构成与风险类型计数。

![生态看板](./docs/images/ecosystem.png)

### 更多能力

| 能力          | 说明                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------- |
| AI 诊断       | 接入任意 OpenAI 兼容 API：单风险诊断 / 全量报告 / 生成修复 PR；无 API Key 时内置规则引擎降级 |
| 结果分享      | 分析结果压缩编码进 `#share=<payload>` URL，接收方免分析直接还原视图                          |
| 本地历史      | 最近 20 条分析记录持久化于 localStorage，刷新不丢                                            |
| WASM 状态徽章 | 顶栏实时显示引擎状态（WASM ✓ / JS 回退 / 熔断禁用）                                          |

## 架构：双引擎同构

核心分析引擎用 **MoonBit** 编写，编译为 **WASM**（`wasm-gc` 目标 + JS String Builtins）；同时存在一份逐行对齐的 **TypeScript 回退实现**，WASM 加载失败时自动降级，行为完全一致。

```
┌───────────────────────────────────────────┐
│  React 19 + TypeScript + Vite + Tailwind  │
│  three.js — 3D 可视化                     │
├───────────────────────────────────────────┤
│  MoonBit WASM 引擎        TS 回退引擎      │
│  moonbit/main/*.mbt  ↔  src/lib/analyzer.ts│
│  （契约测试逐字段对齐，双端同结果）          │
├───────────────────────────────────────────┤
│  Vercel Serverless: /api/download/*  /api/health│
├───────────────────────────────────────────┤
│  mooncakes.io API（CORS 全开放，浏览器直连）│
└───────────────────────────────────────────┘
```

引擎层的可靠性机制：

- **`version()` 契约门** —— 前端声明版本与 WASM 内建版本不符时自动禁用 WASM；
- **连续失败熔断** —— 引擎调用连续 3 次异常后降级到 TS 实现；
- **超大输入防护** —— 分析上下文 JSON 超过 8 MB 时跳过 WASM 直接用 TS；
- **双端契约测试** —— MoonBit `moon test`（47 用例）与 vitest（77 用例）对同一组输入断言相同输出。

## 仓库结构

```
depsight-web/   # Web 应用（React 19 + TS + Vite + Vercel Serverless）
moonbit/        # MoonBit WASM 分析引擎（发布到 mooncakes.io）
docs/images/    # 产品截图
Makefile        # 编译 WASM 并同步到引擎目录与前端 public/
```

## 快速开始

### 前端

```bash
cd depsight-web
npm install
npm run dev        # 本地开发（默认 5173 端口）
npm run build      # 生产构建
npm test           # 单元测试（vitest）
```

### MoonBit 引擎

```bash
# 需要 MoonBit 工具链：https://www.moonbitlang.com/
make wasm          # 编译 wasm-gc 产物并同步到 moonbit/ 与 depsight-web/public/
cd moonbit && moon test   # 引擎单元测试
```

## 相关链接

- Web 应用详细文档：[depsight-web/README.md](./depsight-web/README.md)
- 交付说明：[depsight-web/DELIVERY.md](./depsight-web/DELIVERY.md)
- MoonBit 包：[Tino-hue/depsight-wasm-api](https://mooncakes.io/docs/#/Tino-hue/depsight-wasm-api)
- 许可证：MIT
