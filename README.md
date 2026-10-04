# depsight Web 平台

基于 MoonBit WASM 的依赖健康检测 Web 应用。

## 项目结构

```
moonbit/          # MoonBit WASM API 源码（编译产物放到 moonbit/depsight.wasm）
js/               # 前端 JS（ES Module）
css/              # 样式
test-data/        # 内置示例数据
index.html        # 入口
Makefile          # 构建 WASM
serve.py          # 本地静态服务器（可选）
```

## 快速开始

### 1. 仅运行前端（无需 MoonBit）

WASM 文件不存在时，前端会自动回退到 JS 分析器（行为一致）。

```bash
# 用 Python 起静态服务器（避免 file:// 跨域问题）
python serve.py
# 或
python -m http.server 8080
```

打开 `http://localhost:8080`，点击「示例数据」→「开始分析」。

### 2. 编译 WASM（需要 MoonBit 工具链）

```bash
# 安装 MoonBit
curl -fsSL https://cli.moonbitlang.com/install.sh | bash

# 安装 wasm-gc 后端
moon toolchain install wasm-gc

# 编译 WASM
make wasm

# 或手动：
moon build --target wasm-gc --release
# 产物：_build/wasm-gc/release/build/main/main.wasm
# 拷贝到 moonbit/depsight.wasm
```

### 3. 拉取真实依赖数据

输入框选「输入包名」，填 `moonbitlang/core`，点「从 mooncakes.io 拉取」。
前端会从 `https://mooncakes.io/api/v1/packages/...` 拉 moon.mod.json，
自动递归 2-3 层依赖。

## 技术要点

- **WASM**：核心分析引擎编译到 wasm-gc，浏览器直接加载
- **fallback**：WASM 不存在时，前端用 JS 完整复现同一套分析逻辑，保证 demo 可跑
- **3D 图**：Three.js 力导向图，节点大小=依赖影响力，颜色=健康分
- **AI**：调用 LLM API（需要你配置 endpoint），生成诊断解释

## API 契约

### 输入（context JSON）

```json
{
  "root": "<moon.mod.json 或 moon.mod TOML 原文>",
  "modules": { "<name@version>": "<moon.mod.json 原文>", ... },
  "metadata": { "<name@version>": { "latest_version", "last_commit_days_ago", ... } },
  "options": { "max_depth": 10 }
}
```

### 输出

```json
{
  "overall_score": 87,
  "node_count": 12,
  "diagnostics": [{ "code", "severity", "node_id", "message" }],
  "health_scores": [{ "node_id", "total", "freshness", "compliance", ... }],
  "summary": { "critical", "warning", "info" },
  "graph": { "root_id", "nodes", "edges" },
  "size_offenders_top5": [...],
  "node_metas": {...},
  "ecosystem_stats": {...}
}
```

完整契约见 `moonbit/api.mbt` 头注释。
