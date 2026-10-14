# depsight

基于 MoonBit WASM 的依赖健康分析平台 —— 在过期依赖进入生产环境前，帮你发现风险。

## 仓库结构

```
depsight-web/   # 前端 Web 应用（React 19 + TypeScript + Vite）
moonbit/        # MoonBit WASM 分析引擎（发布到 mooncakes.io）
Makefile        # 编译 WASM 产物并同步到前端
```

## 快速开始

### 前端

```bash
cd depsight-web
npm install
npm run dev        # 本地开发
npm run build      # 生产构建
npm test           # 单元测试
```

### WASM 引擎

```bash
# 需要 MoonBit 工具链：https://www.moonbitlang.cn/
make wasm          # 编译并拷贝到 moonbit/depsight.wasm 与 depsight-web/public/depsight.wasm
moon test          # 引擎单元测试
```

## 相关链接

- 前端应用详见 [depsight-web/README.md](./depsight-web/README.md)
- 交付说明详见 [depsight-web/DELIVERY.md](./depsight-web/DELIVERY.md)
- MoonBit 包：[Tino-hue/depsight-wasm-api](https://mooncakes.io/docs/#/Tino-hue/depsight-wasm-api)
- 许可证：MIT
