# Depsight 项目代码审计与架构评审报告

> 审计日期：2026-10-14 · 版本基线：v0.8.0
> 审计范围：`depsight-web/`（React 前端 + Vercel Serverless）+ `moonbit/`（MoonBit WASM 引擎）
> 审计方式：三线并行逐文件静态精读（前端 28 源文件 / MoonBit 12 个 .mbt / 后端 3 个 API），交叉验证双端契约一致性

---

## 总体结论

工程质量在同类项目中属**上乘**：缓存分层（localStorage/sessionStorage/TTL/负缓存/quota 降级）、WASM 版本契约门 + 熔断 + 尺寸防护、模块级 in-flight 去重（manifest）、手写 ZIP 解析的 EOCD 防御、自研 Markdown 渲染规避 `dangerouslySetInnerHTML`、权重加和=1.0、BFS visited 防环、序列化转义完整——这些都做对了。

但存在**3 个 P0 致命缺陷**和一批 P1 高优问题，集中在四类根因：

1. **个别校验写错一个字**（`typeof null === "object"`、CSS `min-height` 压 inline height、TOML 分支顺序）
2. **渲染生命周期与可见性脱钩**（隐藏视图 rAF/interval 空烧、无在飞去重、远平面固定值）
3. **UI 侧重复实现引擎逻辑导致口径漂移**（活跃度分档、license 家族判定）
4. **后端代理的"默认即危险"**（MIME 混淆、无超时、全量缓冲、无鉴权无限流无缓存）

以下按严重程度分级，每条含位置 / 根因 / 危害 / 改进建议。

---

## P0 — 致命（核心功能不可用 / 启动崩溃 / 分析结果静默错误）

### P0-1 3D 依赖图：节点 ≥ ~67 时整个场景消失（黑屏无报错）

- **位置**：[GraphView.tsx L71](file:///d:/MoonStep/depsight-web/src/components/GraphView.tsx#L71)（`far=1000`）、[L320-L325](file:///d:/MoonStep/depsight-web/src/components/GraphView.tsx#L320-L325)
- **根因**：相机远平面固定 1000，而 `fitCamera` 把相机置于 `(0.6d, 0.4d, d)`，`d = max(80, nodeCount*12)`。相机到原点距离 `≈ 1.233d`，当 `1.233d > 1000`（即 `nodeCount ≥ 67`）时**连原点都在远平面外**，全场景被裁剪。
- **危害**：3D 依赖图是招牌功能。一个中等规模 MoonBit 项目（70+ 传递依赖非常常见）打开 Graph 视图就是一块黑 canvas，无任何错误提示。
- **修复**：远平面随图规模动态计算：`camera.far = Math.max(2000, dist * 4); camera.updateProjectionMatrix()`。

### P0-2 历史记录校验漏洞：`result: null` 通过校验 → 启动即白屏

- **位置**：[history.ts L44-L63（L57）](file:///d:/MoonStep/depsight-web/src/lib/history.ts#L44-L63)、[AppContext.tsx L210-L216](file:///d:/MoonStep/depsight-web/src/state/AppContext.tsx#L210-L216)
- **根因**：类型守卫用 `typeof (v as HistoryEntry).result === "object"`，而 `typeof null === "object"`，`{"id":"x","result":null}` 通过过滤。启动恢复时执行 `latest.result.graph` 抛 `TypeError`，发生在 effect 且无 Error Boundary，React 卸载整棵树。
- **危害**：localStorage 被写坏一条（崩溃中断写入 / 用户手工编辑 / 旧版本残留）即整站白屏，普通用户无恢复手段。
- **修复**：守卫改为 `typeof v.result === "object" && v.result !== null`，补 `graph`/`overall_score` 字段存在性校验；`applyResult` 入口加空值早退；根组件包 Error Boundary。

### P0-3 MoonBit 引擎：多行 import 块收尾行含依赖字符串时被静默丢弃

- **位置**：[mod_parse.mbt L91-L104](file:///d:/MoonStep/moonbit/main/mod_parse.mbt#L91-L104)
- **根因**：分支顺序错误。`else if in_import && line.contains("}")`（L91）排在 `else if in_import && line.contains("\"")`（L94）**之前**。当多行 import 块最后一行同时含字符串和右花括号（极常见）：
  ```toml
  import {
    "a@1.0.0",
    "b@2.0.0" }
  ```
  `"b@2.0.0" }` 命中第一个分支，仅置 `in_import = false`，**字符串提取被跳过**，`"b@2.0.0"` 永远不进 deps。现有测试只覆盖 `}` 单独成行，恰好绕过该分支。
- **危害**：分析结果**静默错误**——漏节点、漏边、漏环、node_count 偏小，无任何报错。这是"线上分析结果错误"的直接来源。**JS fallback `analyzer.ts` 逐行同构复现，须双端同步改**。
- **修复**：调换分支顺序（先提取引号内容，再判断收尾），补 `"b@2.0.0" }` 同行的契约测试。

---

## P1 — 高（严重功能/安全/性能/计费缺陷）

### P1-1 后端 MIME 混淆：`/api/modules` 把上游 JSON 以 `text/html` 下发（原点 XSS sink）

- **位置**：[modules.ts L34-L36](file:///d:/MoonStep/depsight-web/api/modules.ts#L34-L36)
- **根因**：`res.send(string)` 在未设 Content-Type 时默认 `text/html`。上游 modules JSON 中模块名/描述/repository 是发布者可控字符串，未经 HTML 转义。
- **危害**：攻击者向 mooncakes 发布含 HTML/JS 的元数据后，诱导用户访问 `/api/modules/<evil>`，脚本在你的源下执行，可读取本站 localStorage、以用户身份操作本站。持久型存储 XSS + 原点沦陷，且该端点 CORS `*`、无鉴权。
- **修复**：透传上游 Content-Type + 加 `X-Content-Type-Options: nosniff`。

### P1-2 后端 fetch 无超时 → 函数悬挂直接烧计费

- **位置**：[modules.ts L34](file:///d:/MoonStep/depsight-web/api/modules.ts#L34)、[download L53](file:///d:/MoonStep/depsight-web/api/download/%5B...path%5D.ts#L53)
- **根因**：裸 `fetch(url)`，undici 无默认超时；`vercel.json` 未配 `maxDuration`。前端浏览器侧都有超时，服务端代理反而没有。
- **危害**：上游慢连接/丢包时每次请求挂到平台超时才被杀，每次悬挂按满额 GB·s 计费；故障期间并发堆积 = 计费乘以放大。
- **修复**：统一 `fetchWithTimeout`（AbortController + 12s），`vercel.json` 显式声明 `maxDuration: 15, memory: 512`。

### P1-3 后端 `/api/download` 全量内存缓冲、无大小上限、无流式/背压

- **位置**：[download L54-L57](file:///d:/MoonStep/depsight-web/api/download/%5B...path%5D.ts#L54-L57)
- **根因**：`Buffer.from(await resp.arrayBuffer())` 把整个 zip 读进内存再一次性 send；不看 content-length，无上限。
- **危害**：并发拉若干大 zip 即可把实例内存（默认 1024MB）打穿导致崩溃循环；所有请求双倍缓冲、延迟高。
- **修复**：content-length 预检 + `pipeline(Readable.fromWeb(resp.body), res)` 流式转发 + 中途计数上限（64MB）+ `req.on("close")` 取消上游。

### P1-4 后端无鉴权、无限流、无服务端缓存的公开中继 → 计费放大 DoS

- **位置**：[modules.ts L16-L39](file:///d:/MoonStep/depsight-web/api/modules.ts#L16-L39)、[download L16-L60](file:///d:/MoonStep/depsight-web/api/download/%5B...path%5D.ts#L16-L60)、[vercel.json L3-L12](file:///d:/MoonStep/depsight-web/vercel.json#L3-L12)
- **根因**：三端点全公开；`vercel.json` 对 `/api/*` 强制 `no-store`，函数侧无任何缓存——每次请求全额穿透上游并双倍出站流量。
- **危害**：攻击者零成本循环请求即可消耗函数调用次数、GB·s 与出站带宽（Hobby 100GB/月很快击穿），实现"拖垮计费"。
- **修复**：① `/api/modules` 加 60s 服务端缓存 + `s-maxage=60`；② zip 按 `name@version` 不可变，应 `max-age=31536000, immutable`，撤掉一刀切 no-store；③ 加限流（Vercel Firewall / Cloudflare WAF / Upstash Ratelimit）。

### P1-5 MoonBit `UNLICENSED` 被误判为 permissive 100 分

- **位置**：[scoring.mbt L187-L199](file:///d:/MoonStep/moonbit/main/scoring.mbt#L187-L199)
- **根因**：permissive 列表含 `"UNLICENSE"`，用 `upper.contains(p)` 子串匹配。"UNLICENSED" 包含子串 "UNLICENSE" → 命中 permissive → 100。`license_detect.mbt` 的指纹路径专门排除了这个陷阱，但 `license_family` 没有。
- **危害**：合规维度给出 100 满分，商业合规风险被完全掩盖，方向性错误。
- **修复**：`license_family` 入口先显式判 `UNLICENSED / PROPRIETARY / COMMERCIAL / SSPL` 为 proprietary。

### P1-6 MoonBit 健康分无上限钳制：JS 传负值产生 >100 的误导性高分

- **位置**：[scoring.mbt L283-L316](file:///d:/MoonStep/moonbit/main/scoring.mbt#L283-L316)、[meta.mbt L108-L118](file:///d:/MoonStep/moonbit/main/meta.mbt#L108-L118)
- **根因**：`score_deprecated` 负 `total_api_count` → ratio 为负 → `100 - ratio*500 > 100` 无上限 clamp；`score_size` 负 `self_size` → 100；`score_activity` 负 `last_commit_days_ago` → 100；total 直接加权求和传导。
- **危害**：JS 侧坏数据不崩溃，而是**静默产出虚高健康分**，`total_size_bytes` 被负值污染。
- **修复**：入户口径统一钳制，各维度返回值统一 `min(100, max(0, …))`。

### P1-7 MoonBit 当前版本领先 latest 时被反向惩罚 + 给出降级命令

- **位置**：[scoring.mbt L53-L61](file:///d:/MoonStep/moonbit/main/scoring.mbt#L53-L61)、[diagnose.mbt L84-L96 / L232-L253](file:///d:/MoonStep/moonbit/main/diagnose.mbt#L84-L96)
- **根因**：字符串不等进入比较分支后只处理"落后"，`cur.0 > lat.0`（本地版本更新，常见于 metadata 滞后或内部 fork）落入 minor gap 罚分，且生成 `moon add a@1.9.0` **降级命令**。
- **危害**：真实场景下给出方向完全错误的诊断与可执行命令，用户照做会降级。
- **修复**：比较前先判方向，领先不罚、不建议。

### P1-8 MoonBit SPDX 表达式：小写 `and/or` 绕过 + AND/OR 混合优先级拍平错误

- **位置**：[scoring.mbt L134-L169](file:///d:/MoonStep/moonbit/main/scoring.mbt#L134-L169)
- **根因**：拆分只认大写 `" OR "` / `" AND "`。`"MIT and GPL-3.0"` 作为一个 token → `"MITANDGPL-3.0"` → 子串命中 "MIT" → permissive 100，GPL 被小写 and 完全洗白。拍平式求值无视括号：`GPL-3.0 AND (MIT OR Apache-2.0)` 先按 OR 拆 → 取 max → 100。
- **危害**：合规评分可被常见写法或合法 SPDX 括号表达式绕过，copyleft 包拿满分。
- **修复**：大小写不敏感拆分；括号引入递归子表达式求值（AND 优先），无法解析时返回保守分。

### P1-9 manifest 瞬时网络失败被负缓存 24 小时

- **位置**：[fetcher.ts L247-L274](file:///d:/MoonStep/depsight-web/src/lib/fetcher.ts#L247-L274)
- **根因**：catch 分支（超时/断网）最终 `result = null`，循环外 `writeManifestCache(name, result)` 不区分"404 不存在"与"瞬时故障"，一律写 24h 负缓存。
- **危害**：用户网络抖动一次，接下来 24 小时该模块元数据被当作"不存在"，健康评分持续错误且无提示。
- **修复**：catch 路径直接 `return null` 不写缓存（或写 5 分钟短 TTL）。

### P1-10 隐藏视图持续空跑渲染循环（GraphView rAF + HeroView 粒子/字符矩阵）

- **位置**：[App.tsx](file:///d:/MoonStep/depsight-web/src/App.tsx)、[GraphView.tsx L327-L345](file:///d:/MoonStep/depsight-web/src/components/GraphView.tsx#L327-L345)、[ParticleText.tsx L271-L278](file:///d:/MoonStep/depsight-web/src/components/ui/ParticleText.tsx#L271)、[HeroView.tsx L159-L167](file:///d:/MoonStep/depsight-web/src/components/HeroView.tsx#L159-L167)
- **根因**：`display:none` 不停止 rAF/setInterval。GraphView 隐藏时仍每帧 `controls.update() + renderer.render`；HeroView 隐藏时 ParticleText 双 canvas（最多 5200 粒子 + shadowBlur）和 GlyphMatrix 仍在跑。
- **危害**：低配设备主线程持续被占，输入卡顿、耗电。
- **修复**：`document.visibilityState` + IntersectionObserver，不可见时 `cancelAnimationFrame`/clearInterval。

### P1-11 `fetchAllModules` 无在飞去重，首屏各拉 ~1MB

- **位置**：[fetcher.ts L191-L220](file:///d:/MoonStep/depsight-web/src/lib/fetcher.ts#L191-L220)、[EcosystemView.tsx L417-L420](file:///d:/MoonStep/depsight-web/src/components/EcosystemView.tsx#L417-L420)、[TrendsView.tsx L269-L282](file:///d:/MoonStep/depsight-web/src/components/TrendsView.tsx#L269-L282)
- **根因**：App 全部视图挂载 + hidden 切换，EcosystemView/TrendsView 的 effect 在应用启动时（即使从未点开）就各调 `fetchAllModules()`；模块级缓存只缓存已完成值，两个并发调用同时 miss → 并发两个 ~1MB 请求 + 各自 JSON.parse。
- **修复**：给 `fetchAllModules` 加 in-flight promise 去重（同 manifest 做法）；视图 effect 等首次可见再拉。

### P1-12 ParticleText `min-height: 240px` 压垮 Hero 标题布局

- **位置**：[ParticleText.css L1-L10](file:///d:/MoonStep/depsight-web/src/components/ui/ParticleText.css#L1-L10)（`min-height: 240px`）
- **根因**：组件级 CSS 写死 `min-height: 240px`，HeroView 传的 inline `height` 最大值只有 86/150px，min-height 与 height 取较大者生效 → 两行标题实际各占 240px，总高 ≥ 480px。
- **危害**：落地页首屏被撑高一倍以上，lede/按钮/统计栏全部掉出首屏。
- **修复**：删 CSS 的 `min-height: 240px`（或降为 `1em`），最小高度决策交给使用方 inline style。

### P1-13 API Key 明文存 localStorage + baseUrl 可配致 key 可被发往任意域名

- **位置**：[AiDrawer.tsx L27-L42](file:///d:/MoonStep/depsight-web/src/components/AiDrawer.tsx#L27-L42)、[L52-L71](file:///d:/MoonStep/depsight-web/src/components/AiDrawer.tsx#L52-L71)
- **根因**：key 明文存 localStorage（任何 XSS 都能窃取）；baseUrl 无协议/域名校验，用户填错或被诱导填攻击者域名，Bearer key 立即被发送过去。
- **修复**：baseUrl 仅允许 `https:` + 警告条；"记住 key"开关默认关闭，会话级内存保存；settings 加 key 掩码显示。

### P1-14 useFetcher 无取消机制，并发/切换场景状态错乱

- **位置**：[useFetcher.ts](file:///d:/MoonStep/depsight-web/src/hooks/useFetcher.ts)
- **根因**：发多个请求但无 AbortController / stale 标记。组件卸载或依赖变化后，in-flight promise 仍 setState；连续触发两次分析时先慢后快响应覆盖后一次正确结果（竞态）。
- **修复**：effect 内创建 AbortController，清理函数 abort；给每次分析一个 runId 回调比对。

### P1-15 MoonBit 垃圾 TOML 永不报错：root 退化为 `unknown@0.0.0` 仍"成功"

- **位置**：[mod_parse.mbt L50-L108](file:///d:/MoonStep/moonbit/main/mod_parse.mbt#L50-L108)
- **根因**：`parse_mod_toml` 无条件 `Ok(result)`——缺失 name/version 用 `"unknown"/"0.0.0"` 兜底，Err 分支实际不可达。
- **危害**：收到完全乱写的 root TOML 时返回 200 式正常 JSON，score/graph 全是对 `unknown@0.0.0` 的分析。
- **修复**：结束时校验，name 仍为 `"unknown"` 且文本中既无 `name =` 也无 `module` 头则返回 Err。

### P1-16 MoonBit `find_cycles` 与 `@json.parse` 递归深度不受控（WASM 栈溢出陷阱）

- **位置**：[graph.mbt L95-L127](file:///d:/MoonStep/moonbit/main/graph.mbt#L95-L127)、[api.mbt L109](file:///d:/MoonStep/moonbit/main/api.mbt#L109)
- **根因**：DFS 递归深度 = 最长简单路径；JSON 解析器为递归下降。深度均由 JS 输入决定，wasm-gc 栈溢出以 `WebAssembly.RuntimeError` 陷阱抛出，实例进入不可预期的失败态。
- **修复**：`max_depth` 设硬上限（min(requested, 64)）；`dfs` 改显式栈迭代；context JSON 解析前限制输入长度（≤16MB）。

---

## P2 — 中（不阻塞上线，下一迭代处理）

| #    | 问题                                                                                    | 位置                                                                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-1  | 在 setState updater 内执行持久化副作用（违反 React 纯函数契约，StrictMode 双调用）      | [AppContext.tsx L231-L253](file:///d:/MoonStep/depsight-web/src/state/AppContext.tsx#L231-L253)                                                                                                                                                        |
| F-2  | `clearGraph` 泄漏 CanvasTexture（Sprite 标签贴图未 dispose）                            | [GraphView.tsx L292-L303](file:///d:/MoonStep/depsight-web/src/components/GraphView.tsx#L292-L303)                                                                                                                                                     |
| F-3  | mousemove 每次事件新建数组 + 全量 raycast                                               | [GraphView.tsx L365-L372](file:///d:/MoonStep/depsight-web/src/components/GraphView.tsx#L365-L372)                                                                                                                                                     |
| F-4  | zip 下载/解压均无体积上限（zip bomb 面）                                                | [fetcher.ts](file:///d:/MoonStep/depsight-web/src/lib/fetcher.ts) + [zip.ts](file:///d:/MoonStep/depsight-web/src/lib/zip.ts)                                                                                                                          |
| F-5  | `fetchSourceStats` 主线程逐个解压全部 .mbt（长任务阻塞）                                | [fetcher.ts](file:///d:/MoonStep/depsight-web/src/lib/fetcher.ts)                                                                                                                                                                                      |
| F-6  | EcosystemView 活跃度分档与引擎评分口径不一致                                            | [EcosystemView.tsx L60-L67](file:///d:/MoonStep/depsight-web/src/components/EcosystemView.tsx#L60-L67) vs [analyzer.ts](file:///d:/MoonStep/depsight-web/src/lib/analyzer.ts)                                                                          |
| F-7  | LLM 请求无超时/无 Abort                                                                 | [AiDrawer.tsx L52-L71](file:///d:/MoonStep/depsight-web/src/components/AiDrawer.tsx#L52-L71)                                                                                                                                                           |
| F-8  | `getApiConfig`/`saveApiConfig` 直读 localStorage 无 try/catch（隐私模式 SecurityError） | [AiDrawer.tsx L27-L42](file:///d:/MoonStep/depsight-web/src/components/AiDrawer.tsx#L27-L42)                                                                                                                                                           |
| F-9  | ParticleText `touch-action: none` 大面积阻断移动端滚动                                  | [ParticleText.css L8](file:///d:/MoonStep/depsight-web/src/components/ui/ParticleText.css#L8)                                                                                                                                                          |
| F-10 | 分享 payload 解码无大小限制 + 无结构校验                                                | [history.ts L151-L168](file:///d:/MoonStep/depsight-web/src/lib/history.ts#L151-L168)                                                                                                                                                                  |
| F-11 | TrendsView 对 localStorage 脏分数无 NaN 防护                                            | [TrendsView.tsx](file:///d:/MoonStep/depsight-web/src/components/TrendsView.tsx)                                                                                                                                                                       |
| M-1  | `license_families` 统计与评分路径的规范化口径不一致                                     | [stats.mbt L30-L37](file:///d:/MoonStep/moonbit/main/stats.mbt#L30-L37)                                                                                                                                                                                |
| M-2  | 键名前缀匹配污染（`name` 命中 `namesuffix`、`version` 命中 `versioning`）               | [mod_parse.mbt L58-L66](file:///d:/MoonStep/moonbit/main/mod_parse.mbt#L58-L66)                                                                                                                                                                        |
| M-3  | import 块未闭合时，后续带引号的普通行被当成依赖（幽灵依赖）                             | [mod_parse.mbt L91-L104](file:///d:/MoonStep/moonbit/main/mod_parse.mbt#L91-L104)                                                                                                                                                                      |
| M-4  | 版本号整数溢出（wrap-around）导致评分乱码                                               | [scoring.mbt L107-L116](file:///d:/MoonStep/moonbit/main/scoring.mbt#L107-L116)                                                                                                                                                                        |
| M-5  | `compute_transitive_sizes` 每节点独立 BFS，O(N·E) 热点                                  | [size.mbt L5-L65](file:///d:/MoonStep/moonbit/main/size.mbt#L5-L65)                                                                                                                                                                                    |
| M-6  | SIZE-001 诊断阈值与 size 分档边界不一致                                                 | [diagnose.mbt L133](file:///d:/MoonStep/moonbit/main/diagnose.mbt#L133) vs [scoring.mbt L298-L299](file:///d:/MoonStep/moonbit/main/scoring.mbt#L298-L299)                                                                                             |
| M-7  | `module "x/y"` 带引号头部保留引号 → root_id 污染、自名匹配失效                          | [mod_parse.mbt L60-L62](file:///d:/MoonStep/moonbit/main/mod_parse.mbt#L60-L62)（JS fallback 同病）                                                                                                                                                    |
| M-8  | 同名依赖解析优先级：先匹配 root.name 再查 modules，子树被错误嫁接                       | [graph.mbt L29-L40](file:///d:/MoonStep/moonbit/main/graph.mbt#L29-L40)                                                                                                                                                                                |
| B-1  | 健康检查永远不探测上游（假健康）                                                        | [health.ts L20-L25](file:///d:/MoonStep/depsight-web/api/health.ts#L20-L25)                                                                                                                                                                            |
| B-2  | 上游错误响应被原样中继（状态+body+Content-Type）                                        | [download L55-L57](file:///d:/MoonStep/depsight-web/api/download/%5B...path%5D.ts#L55-L57)、[modules L36](file:///d:/MoonStep/depsight-web/api/modules.ts#L36)                                                                                         |
| B-3  | 客户端断开不中止上游拉取                                                                | [download L53-L57](file:///d:/MoonStep/depsight-web/api/download/%5B...path%5D.ts#L53-L57)、[modules L34-L36](file:///d:/MoonStep/depsight-web/api/modules.ts#L34-L36)                                                                                 |
| B-4  | 未校验 HTTP 方法，非 GET 也被代理/返回 200                                              | [modules.ts L22-L25](file:///d:/MoonStep/depsight-web/api/modules.ts#L22-L25)、[download L22-L25](file:///d:/MoonStep/depsight-web/api/download/%5B...path%5D.ts#L22-L25)、[health.ts L15-L18](file:///d:/MoonStep/depsight-web/api/health.ts#L15-L18) |

---

## P3 — 低（技术债，可排期）

**前端**：WebGL 上下文未 `forceContextLoss`；布局用 `Math.random()` 不可复现；3 处 `setTimeout` 未清理；ShareButton 复制失败静默；`requestAi` 用 `Date.now()` 作 id 同毫秒冲突；启动时 `loadHistory()` 调两次；`writeSourceStatsCache` 淘汰遍历不按 `fetchedAt` 排序；AnalyzeView 上传无大小限制 + 分析成功强制跳 graph；WASM 熔断不更新 Navbar 徽章；`makeSphereTexture` 深浅主题死代码；SizeList 对 NaN 无防护。

**MoonBit**：死代码（`if best == 0 { 50 }` 永不可达、`mod.license` 兜底不可达、`node_map` 写入未读）；NodeMeta 默认值在 3 处手写重复；`unique_licenses` 按原始字符串计数；`sort_by` 减法溢出；`version_resolved` 启发式不严谨；错误吞噬（非 Object 静默忽略）；测试覆盖盲点（P0-1 收尾同行、垃圾 TOML、领先版本、小写 and/or、负值 metadata、自环、引号头部等）；魔法数字无统一出处。

**后端**：502 回显内部错误细节；CORS 代码与 vercel.json 重复配置；`/api/modules` 已部署但前端不使用（无端点消费者的公开代理 = 纯攻击面）；零日志零指标；download 手工解析 `req.url` 脆弱 + version 无校验；`health.ts` version 硬编码必然漂移；`_routes.json` 暗示 Vercel/CF 双轨混淆。

---

## 上线前必须修复清单（P0 + P1）

| 序  | 问题                                | 文件                                          | 工作量               |
| --- | ----------------------------------- | --------------------------------------------- | -------------------- |
| 1   | 3D 图 far=1000 致 ≥67 节点黑屏      | GraphView.tsx L71 + L320                      | 一行                 |
| 2   | `result:null` 过校验 → 启动白屏     | history.ts L57 + AppContext.tsx L210          | 一行 + ErrorBoundary |
| 3   | MoonBit import 块收尾行丢依赖       | mod_parse.mbt L91-L104 + analyzer.ts 同步     | 分支调换 + 测试      |
| 4   | 后端 MIME 混淆 → 原点 XSS           | modules.ts L34                                | 两行                 |
| 5   | 后端 fetch 无超时 → 计费放大        | modules.ts L34 + download L53 + vercel.json   | 共享 helper          |
| 6   | 后端全量缓冲无上限 → 内存打穿       | download L54-L57                              | 流式改写             |
| 7   | 后端无鉴权无限流无缓存 → DoS        | modules.ts + download + vercel.json           | 缓存 + 限流          |
| 8   | MoonBit UNLICENSED → permissive 100 | scoring.mbt L187-L199                         | 几行                 |
| 9   | MoonBit 负值 → 总分 >100            | scoring.mbt + meta.mbt                        | 钳制                 |
| 10  | MoonBit 垃圾 TOML 静默成功          | mod_parse.mbt L50-L108                        | Err 分支             |
| 11  | MoonBit 领先版本被惩罚 + 降级命令   | scoring.mbt + diagnose.mbt                    | 判向                 |
| 12  | MoonBit SPDX 小写 and/or + 括号绕过 | scoring.mbt L134-L169                         | 拆分 + 递归          |
| 13  | MoonBit DFS/JSON 递归深度不受控     | graph.mbt + api.mbt                           | 迭代 + 上限          |
| 14  | manifest 瞬时失败负缓存 24h         | fetcher.ts L265-L273                          | 一行                 |
| 15  | 隐藏视图 rAF/interval 空烧          | App.tsx + GraphView + ParticleText + HeroView | 可见性接线           |
| 16  | fetchAllModules 无去重首屏双倍 1MB  | fetcher.ts + EcosystemView + TrendsView       | in-flight Map        |
| 17  | ParticleText min-height 撑爆 Hero   | ParticleText.css L6                           | 删一行               |
| 18  | API key 明文 + baseUrl 可外送       | AiDrawer.tsx L27-L71                          | 校验 + 默认关        |
| 19  | useFetcher 无取消竞态               | useFetcher.ts                                 | AbortController      |

**关键提醒**：MoonBit 引擎的 P0-3、P1-7、P1-8、P2-7 在 JS fallback `analyzer.ts` 中**逐行同构复现**，修复时必须**双端同步改**，否则违背"双端行为保持一致"的声明。

## 修复顺序建议

1. **第一批（半天，全是单行级但影响"能不能用"）**：#1 #2 #3 #17
2. **第二批（后端安全，1 天）**：#4 #5 #6 #7
3. **第三批（MoonBit 引擎，1-2 天，须 moon test 验证）**：#8 #9 #10 #11 #12 #13
4. **第四批（前端体验，1 天）**：#14 #16 #18 #19
5. **第五批（渲染生命周期，改动面最大）**：#15

---

## 专项补充：事务 / N+1 / SQL 注入 / 接口鉴权 四维审查

> 审查前必须先明确本项目的**技术形态**：depsight 是**纯静态前端（React + WASM 本地分析）+ 无状态 Vercel Serverless 代理**。
>
> - **无数据库、无 ORM、无任何 SQL**（全仓 grep `sql/sqlite/prisma/orm/query/insert/update` 仅命中 HistoryPanel 注释里的 "Delete"）。
> - 持久化只用浏览器 `localStorage / sessionStorage`。
> - **无登录 / 会话 / 服务端账号体系**；唯一"凭证"是用户自填、只存在自己浏览器里的 OpenAI-compatible API key。

因此这四个维度的结论分两类：**真正命中且需修复的风险**与**该维度在本架构下不构成风险、无需处理的结论**。

---

### 一、事务（Transactions）— 该维度在本架构下不适用，无事务类缺陷

- **服务端**：3 个 Serverless 函数（`api/modules.ts`、`api/download/[...path].ts`、`api/health.ts`）均为**单次请求 = 单次上游 fetch** 的无状态代理，**不存在多步写操作，因此不存在需要事务保证原子性的场景**。当前实现正确——不应引入分布式事务。
- **客户端存储**：localStorage 读-改-写（如 `saveHistory` 的"读全量→过滤→写回"）非原子，但仅单浏览器单标签页使用，风险极低，已有 `quota` 兜底。唯一需注意的是 `loadHistory` 的类型守卫漏洞（见 P0-2）。

**结论**：无事务缺陷，无需整改。

---

### 二、N+1 查询 — 无 SQL 环境，不存在经典 N+1；但存在 **HTTP 层等价的"请求放大"**

经典 ORM N+1 不存在（无数据库）。但前端数据装配存在同构的请求放大问题，应在本轮一并整改：

#### [P2] N+1-HTTP-1 `useAnalyzer` 装配依赖上下文为**串行逐依赖请求**，无并发 / 去重 / 取消

- **位置**：[useAnalyzer.ts](file:///d:/MoonStep/depsight-web/src/hooks/useAnalyzer.ts)（装配 `modules` / `metadata` 的 effect 逻辑）
- **根因**：为构建一个依赖图上下文，对每个依赖逐个 `await fetchModuleModText()` + `fetchModuleManifest()` + `fetchSourceStats()`，三者**顺序串行**；且对同一 `name@version` 的重复传递依赖**未在调用层去重**（仅靠底层单条缓存兜住已取过的）。无 AbortController，组件卸载 / 重新分析后仍在飞的旧请求会把结果写回已被重置的 state（竞态）。
- **危害**：一个 80 依赖项目会产生 3×80=240 次**串行** round-trip；任一依赖慢会拖住整个分析（木桶效应）；重复依赖白白重复拉取；卸载后 setState 报错 / 状态错乱。
- **改进建议**：
  1. **先收集去重**：`const uniq = [...new Set(deps.map(d => `${d.name}@${d.version}`))]`，只对唯一键发起请求。
  2. **并发 + 限制**：`Promise.allSettled(uniq.map(...))` 或 `p-limit(≈6)` 并发，替代串行 `await`。
  3. **可取消**：effect 内创建 `AbortController`，cleanup `abort()`；每次分析生成 `runId`，回调里比对丢弃过期结果。
  4. 组装 `metadata` 所需字段与 `mod_text` 并行而非顺序。

#### [P3] N+1-HTTP-2 真实生态统计逐模块串行拉取源码 zip

- **位置**：[fetcher.ts](file:///d:/MoonStep/depsight-web/src/lib/fetcher.ts) `fetchSourceStats`（约 L454 起）
- **根因**：对生态大盘 / 趋势的每个模块逐个下载 zip 并逐个 `DecompressionStream` 解压，**无并发、无总数上限**。
- **危害**：大生态下首屏长时间主线程长任务，页面假死；叠加 P1-2 隐藏视图空烧更明显。
- **改进建议**：Web Worker 化；或 `p-limit(≈4)` 分批 `await` 让出事件循环（`scheduler.yield`）。

---

### 三、SQL 注入 — 该维度在本架构下不构成风险

- **无 SQL**：全仓无数据库访问层、无字符串拼接 SQL、无 ORM raw 调用。前端请求参数（包名 / 版本）**仅作为 URL path/query 拼进 `encodeURIComponent` 的 HTTP 请求**，最终由 mooncakes.io 服务端处理，不存在本项目代码内的 SQL 注入面。
- **真正要防的是 HTTP 层的注入**（已在主报告覆盖）：
  - `api/download` 手工解析 `req.url` + 仅前次修复的 name 正则，仍偏脆弱（P3-5）。
  - 更系统的做法：改用框架级 catch-all `req.query.path` 数组 + version 白名单，避免自己 `replace/lastIndexOf` 解析 URL。

**结论**：无 SQL 注入风险；HTTP 参数解析的健壮性按 P3-5 排期即可。

---

### 四、接口鉴权（Interface Authentication）— 存在**未授权访问 + 凭证外泄**双重风险

本项目无登录体系，但"接口鉴权"维度仍命中两类真实风险：

#### [P1] AUTH-1 三个 Serverless 端点全部**无鉴权 + 无限流 + 无服务端缓存**，构成计费放大 DoS

- **位置**：[modules.ts L16-L39](file:///d:/MoonStep/depsight-web/api/modules.ts#L16-L39)、[download L16-L60](file:///d:/MoonStep/depsight-web/api/download/%5B...path%5D.ts#L16-L60)、[health.ts L9-L25](file:///d:/MoonStep/depsight-web/api/health.ts#L9-L25)
- **根因**：端点公开、无 API key / 签名 / IP 限流，且 `vercel.json` 对 `/api/*` 强制 `no-store`、函数侧无缓存——每次请求全额穿透上游并双倍出站流量（modules ~1MB、zip 可达数十 MB）。
- **危害**：攻击者零成本循环请求即可耗尽 Hobby 套餐 100GB/月出站与函数调用次数，实现"拖垮计费"的可用性攻击。平台层 DDoS 防护挡不住这种"合法请求"滥用。
- **改进建议**（与主报告 P1-4 一致，此处按"鉴权"维度重申）：
  1. 加限流：Vercel Firewall（Pro）/ Cloudflare WAF / Upstash Ratelimit 按 IP 桶。
  2. 恢复可缓存性：zip 按 `name@version` 不可变 → `Cache-Control: public, max-age=31536000, immutable`；modules 列表 60s `s-maxage`；撤掉 `/api/*` 一刀切 no-store。
  3. 下线无消费者的 `/api/modules`（前端直连 mooncakes.io），消除纯攻击面。

#### [P1] AUTH-2 用户 OpenAI API key **明文存 localStorage + baseUrl 无校验可被发往任意域名**

- **位置**：[AiDrawer.tsx L27-L42](file:///d:/MoonStep/depsight-web/src/components/AiDrawer.tsx#L27-L42)（`depsight_openai_key` 明文读写）、[L52-L71](file:///d:/MoonStep/depsight-web/src/components/AiDrawer.tsx#L52-L71)（`Authorization: Bearer ${key}` 直发 `${baseUrl}/chat/completions`）
- **根因**：key 以明文存 localStorage（任何 XSS 都可窃取）；baseUrl 无协议 / 域名白名单，用户填错或被诱导填攻击者域名，Bearer key 立即被外送。
- **危害**：(a) 站内任一注入点即丢 key；(b) 诱导配置恶意 baseUrl = 主动送 key；(c) 共享设备 key 持久残留。
- **改进建议**（与主报告 P1-13 一致，按"鉴权/凭证"维度重申）：
  1. baseUrl 仅允许 `https:`，配置第三方域名时弹警告条"key 将发送至第三方"。
  2. "记住 key"开关**默认关闭**，默认仅会话内存保存；开启时才落 localStorage。
  3. settings 面板 key 掩码显示（已 `type="password"`，补充可见性切换）。
  4. 共享设备场景提示不勾选"记住"。

---

### 四维审查汇总

| 维度     | 是否适用                 | 命中问题                                                                     | 最高严重度 | 整改批次       |
| -------- | ------------------------ | ---------------------------------------------------------------------------- | ---------- | -------------- |
| 事务     | 否（无数据库，无多步写） | 无                                                                           | —          | 无需整改       |
| N+1      | 是（HTTP 等价）          | N+1-HTTP-1（串行+无去重+无取消）、N+1-HTTP-2（源码 zip 串行）                | P2         | 并入第四批     |
| SQL 注入 | 否（无 SQL）             | 仅 HTTP 参数解析健壮性（P3-5）                                               | P3         | 排期即可       |
| 接口鉴权 | 是                       | AUTH-1（无鉴权/限流/缓存 → 计费 DoS）、AUTH-2（API key 明文 + baseUrl 外送） | **P1**     | **并入第二批** |

---

---

# 第二部分：风险整改完整分析报告

> 本部分覆盖风险整改所需的五个核心模块：**风险定位与根因 → 解决方案（步骤/优先级/预期效果）→ 连带问题预测 → 风险规避建议 → 验证标准**。
> 风险定位与根因已在第一部分 P0/P1/P2/P3 及四维专项中详列，此处直接引用编号，不再重复展开。

---

## 一、风险定位与根因汇总（索引）

按严重度与整改批次归并，作为后续整改的追踪基线：

| 批次 | 风险编号   | 一句话根因                                       | 严重度 |
| ---- | ---------- | ------------------------------------------------ | ------ |
| 1    | P0-1       | 3D 相机远平面固定 1000，被大图相机距离超过       | P0     |
| 1    | P0-2       | `typeof null === "object"` 守卫失效 → 启动白屏   | P0     |
| 1    | P0-3       | MoonBit import 块分支顺序致收尾行依赖丢失        | P0     |
| 1    | P1-12      | ParticleText `min-height:240px` 压 inline height | P1     |
| 2    | P1-1       | 上游 JSON 以 text/html 下发（MIME 混淆 XSS）     | P1     |
| 2    | P1-2       | 后端 fetch 无超时                                | P1     |
| 2    | P1-3       | 后端全量内存缓冲无上限                           | P1     |
| 2    | P1-4       | 后端无鉴权/限流/缓存 → 计费 DoS                  | P1     |
| 2    | AUTH-1     | 同上（鉴权维度重申）                             | P1     |
| 2    | AUTH-2     | API key 明文 + baseUrl 可外送                    | P1     |
| 3    | P1-5       | UNLICENSED 子串误判 permissive                   | P1     |
| 3    | P1-6       | 评分无上限钳制 → 负值产出 >100                   | P1     |
| 3    | P1-15      | 垃圾 TOML 静默成功                               | P1     |
| 3    | P1-7       | 领先版本被惩罚 + 降级命令                        | P1     |
| 3    | P1-8       | SPDX 小写 and/or + 括号绕过                      | P1     |
| 3    | P1-16      | DFS/JSON 递归深度不受控                          | P1     |
| 4    | P1-9       | manifest 瞬时失败负缓存 24h                      | P1     |
| 4    | P1-11      | fetchAllModules 无在飞去重                       | P1     |
| 4    | P1-13      | API key 明文 + baseUrl（同 AUTH-2）              | P1     |
| 4    | P1-14      | useFetcher 无取消竞态                            | P1     |
| 4    | N+1-HTTP-1 | useAnalyzer 串行逐依赖、无并发/去重/取消         | P2     |
| 5    | P1-10      | 隐藏视图 rAF/interval 空烧                       | P1     |

---

## 二、解决方案（操作步骤 / 优先级 / 预期效果）

### 批次 1：可用性硬伤（最高优先级，半天）

**S1 — 修复 3D 远平面（P0-1）**

- 步骤：`GraphView.tsx` 中 `fitCamera` 计算完 `dist` 后，加 `camera.far = Math.max(2000, dist * 4); camera.updateProjectionMatrix();`。
- 优先级：P0 最高。
- 预期效果：任意规模依赖图不再黑屏；≥67 节点场景可正常渲染。

**S2 — 修复历史校验守卫（P0-2）**

- 步骤：① `history.ts` 守卫改 `typeof v.result === "object" && v.result !== null`；② 补 `graph`/`overall_score` 字段存在性校验；③ `applyResult` 入口空值早退；④ 根组件包 Error Boundary。
- 优先级：P0 最高。
- 预期效果：即使 localStorage 被写坏一条也不会白屏，降级为忽略该条。

**S3 — 修复 MoonBit import 分支顺序（P0-3）**

- 步骤：① `mod_parse.mbt` 调整为先提取引号串再判 `}` 收尾；② **同步改 JS fallback `analyzer.ts`**；③ `moonbit/main/engine_test.mbt` 补 `"b@2.0.0" }` 同行契约测试。
- 优先级：P0 最高。
- 预期效果：多行 import 块不再丢依赖，双端行为一致。

**S4 — 删除 ParticleText 最小高度（P1-12）**

- 步骤：删 `ParticleText.css` 的 `min-height: 240px`（或降为 `1em`）。
- 优先级：P1，一行。
- 预期效果：Hero 两行标题按 inline height 贴合，首屏恢复正常。

### 批次 2：后端安全（高优先级，1 天）

**S5 — 修复 MIME 混淆（P1-1）**

- 步骤：`modules.ts` 透传上游 `Content-Type`，并统一加 `X-Content-Type-Options: nosniff`。
- 优先级：P1。
- 预期效果：消除原点 XSS sink。

**S6 — 加超时（P1-2）**

- 步骤：抽 `fetchWithTimeout`（AbortController + 12s），两代理共用；`vercel.json` 加 `functions.maxDuration=15, memory=512`。
- 优先级：P1。
- 预期效果：上游慢/挂时不再悬挂烧计费。

**S7 — 改流式 + 上限（P1-3）**

- 步骤：`download` 改 `pipeline(Readable.fromWeb(resp.body), res)`；content-length 预检 + 64MB 上限；`req.on("close")` 取消上游。
- 优先级：P1。
- 预期效果：内存不再被打穿，支持边下边传。

**S8 — 鉴权/限流/缓存（P1-4 / AUTH-1）**

- 步骤：① zip 响应 `Cache-Control: public, max-age=31536000, immutable`，撤 `/api/*` 一刀切 no-store；② modules 列表 60s 服务端缓存 + `s-maxage=60`；③ 接 Vercel Firewall / Cloudflare WAF / Upstash 限流；④ 下线无消费者的 `/api/modules`。
- 优先级：P1。
- 预期效果：阻断计费放大 DoS，降低出站成本。

**S9 — 凭证防护（AUTH-2 / P1-13）**

- 步骤：① baseUrl 仅允许 `https:` + 第三方域名警告条；② "记住 key"默认关（默认会话内存）；③ key 掩码显示。
- 优先级：P1。
- 预期效果：key 不再明文常驻、不再被诱导外送。

### 批次 3：MoonBit 引擎（高优先级，1-2 天，须 `moon test`）

**S10 — license 家族判向（P1-5）**：`license_family` 入口先判 `UNLICENSED/PROPRIETARY/COMMERCIAL/SSPL` 为 proprietary。
**S11 — 评分钳制（P1-6）**：入户口径统一 `min(100, max(0,…))`，负值 metadata 归一。
**S12 — 垃圾 TOML 报错（P1-15）**：缺 name/version 时返回 `Err`。
**S13 — 领先版本判向（P1-7）**：`version_compare > 0` 不罚、不建议升级/降级。
**S14 — SPDX 规范化（P1-8）**：大小写不敏感拆分 + 括号递归/保守 fallback。
**S15 — 递归上限（P1-16）**：`max_depth` 硬上限 64；DFS 改迭代；context JSON ≤16MB。

- 每条均需 **JS fallback `analyzer.ts` 同步改**，并在 `engine_test.mbt` 补对应契约测试。
- 优先级：P1，引擎正确性直接影响分析结果可信度。
- 预期效果：评分体系在坏数据/边界输入下稳定、方向正确、不崩溃。

### 批次 4：前端体验（中优先级，1 天）

**S16 — manifest 负缓存语义（P1-9）**：catch 路径不写 24h 缓存（或 5min 短 TTL）。
**S17 — fetchAllModules 去重（P1-11）**：加 in-flight promise Map；视图首次可见再拉。
**S18 — useAnalyzer 并发化（N+1-HTTP-1）**：Set 去重 + `p-limit(6)` 并发 + AbortController + runId。
**S19 — useFetcher 取消（P1-14）**：AbortController + cancelled 标记。

### 批次 5：渲染生命周期（中优先级，改动面最大）

**S20 — 可见性接线（P1-10）**：GraphView/ParticleText/GlyphMatrix 接 `document.visibilityState` + IntersectionObserver，不可见时停 rAF/interval。

---

## 三、连带问题预测（主风险触发的衍生 bug）

> 修复某主风险时，若不一并处理以下关联点，会引入或暴露新问题。

| 主风险           | 连带问题                                                                                  | 触发条件 / 场景             |
| ---------------- | ----------------------------------------------------------------------------------------- | --------------------------- |
| P0-1 远平面      | 超大图（>500 节点）即使 far 放大也可能因 `nodeCount*12` 布局过散而性能骤降                | 仅放大 far 不优化布局密度时 |
| P0-2 守卫        | 修复后历史里仍可能有 `result.graph` 缺失的旧条目，需字段级校验兜底                        | 旧版本残留数据              |
| P0-3 import 分支 | JS fallback 同步改后，`analyzer.test.ts` 里若有用例依赖旧的"丢依赖"行为会失败             | 双端测试基线未同步          |
| P1-1 MIME        | 改透传 Content-Type 后，若上游返回非 JSON（如 502 HTML），前端 `resp.json()` 会抛         | 上游错误体未被短路          |
| P1-2 超时        | AbortController 触发后，`catch` 需区分"超时 abort"与"网络错误"，避免误报                  | 统一 catch 吞掉 abort 原因  |
| P1-3 流式        | `pipeline` 中途客户端断开，需 `req.on("close")` 取消上游，否则上游继续下载                | 浏览器取消下载              |
| P1-4 缓存        | zip 用 immutable 缓存后，若 mooncakes 允许同 version 重传（应不可变但需确认），会缓存脏包 | registry 行为变更           |
| AUTH-2 凭证      | "记住 key"默认关后，用户每次刷新重输，可能诱导其开启明文存储——需在产品上平衡              | 用户体验 vs 安全            |
| P1-5 UNLICENSED  | 误判修正后，原本得 100 分的 UNLICENSED 包分会骤降，趋势/历史分数会与历史不一致            | 评分口径变更                |
| P1-6 钳制        | 钳制后若 `total_size_bytes` 已被历史负值污染，历史统计需清洗                              | 存量数据迁移                |
| P1-7 领先版本    | 不罚分后，OUTDATED-001 诊断数减少，`suggestions` 列表长度变化可能影响 UI 布局             | 诊断面板空态                |
| P1-8 SPDX        | 递归解析括号后，含复杂表达式的包分降低，生态大盘 license 家族分布会变化                   | 统计口径变更                |
| P1-9 负缓存      | 不写负缓存后，离线/弱网用户每次分析都重新拉 manifest，请求量增加                          | 弱网环境                    |
| P1-11 去重       | 视图改为可见才拉后，首次点开生态/趋势会有可见延迟                                         | 首点体验                    |
| N+1-1 并发化     | 并发 + p-limit 后，底层缓存命中逻辑需保证并发安全，避免重复写缓存                         | 并发写 localStorage         |
| P1-10 可见性     | 暂停 rAF 后，切回视图需正确重建/恢复相机与控制器状态                                      | 视图切换                    |

---

## 四、风险规避建议（防同类/关联问题复现）

1. **契约测试常态化**：MoonBit 引擎每个 P0/P1 修复都必须在 `engine_test.mbt` 补契约用例，并在 JS fallback `analyzer.ts` 保持逐行同构——**建立"双端行为一致性"自动化比对测试**（同输入跑两端，断言输出相等），杜绝"改一端漏一端"。
2. **守卫规范化**：所有 localStorage / 外部输入的类型守卫统一走一个带 `null` 特判 + 字段存在性校验的 `isXxx()` 工具函数，禁止散写 `typeof x === "object"`。
3. **后端代理默认安全模板**：为 Serverless 代理抽一个公共中间件，默认带超时、大小上限、Content-Type 固定、nosniff、非 GET 拒绝、上游错误短路——新端点强制复用，避免"默认即危险"。
4. **凭证处理规范**：任何第三方 key 一律默认会话内存、落盘需显式开关、外发域名白名单——写成可复用 hook/store，禁止裸 `localStorage.getItem`。
5. **可见性驱动的渲染纪律**：所有 rAF/setInterval/3D 循环必须在组件内注册 IntersectionObserver/visibility 监听，随可见性启停——纳入 Code Review checklist。
6. **评分口径单一来源**：引擎评分逻辑只应在 MoonBit/WASM 一处实现，前端 UI 禁止重复实现分档逻辑（复用导出函数），从根上消除口径漂移。

---

## 五、验证标准（整改完成判定）

每个批次完成后，须全部满足以下对应标准方可视为整改完成：

### 批次 1 验证

- [ ] 构造 80、120、200 节点依赖图，3D 视图均正常渲染、无黑屏。
- [ ] 向 localStorage 手动写入 `{"id":"x","result":null}`，刷新页面不白屏、自动忽略该条。
- [ ] `moon test` 通过含 `"b@2.0.0" }` 收尾行的用例；JS fallback `npm test` 同用例通过。
- [ ] Hero 两行标题间距 ≈ 20px，首屏不再被撑高。

### 批次 2 验证

- [ ] `curl -i /api/modules` 返回 `Content-Type: application/json`（非 text/html）且带 `nosniff`。
- [ ] 模拟上游慢响应，函数 12s 内 abort，不悬挂；`vercel.json` maxDuration 生效。
- [ ] 并发下载 10 个 50MB zip，实例内存平稳、无 OOM；客户端中途取消，上游下载停止。
- [ ] 循环请求 `/api/download` 触发限流（429）；zip 响应带 immutable 缓存头。
- [ ] 默认（不勾选"记住"）刷新后 API key 不再持久化；baseUrl 填 http/恶意域名被拦截或警告。

### 批次 3 验证

- [ ] `moon test` 全绿（含新增 UNLICENSED/负值/垃圾 TOML/领先版本/SPDX 小写/括号/深度上限用例）。
- [ ] 构造负值 metadata，总分稳定 ≤100；垃圾 TOML 返回 error JSON 而非 200。
- [ ] 领先 latest 的包不扣分、诊断不出现降级 `moon add` 命令。
- [ ] `"MIT and GPL-3.0"` 与 `"GPL-3.0 AND (MIT OR Apache-2.0)"` 得分符合 SPDX 语义。
- [ ] 深度 200 的依赖图不再 trap（返回受控 error 或在上限内完成）。
- [ ] JS fallback `analyzer.test.ts` 与引擎双端同输入输出一致。

### 批次 4 验证

- [ ] 断网一次后恢复，manifest 能重新拉取（不被 24h 负缓存挡住）。
- [ ] 首屏只发一个 `/modules` 请求；并发分析不再串行等待、无竞态覆盖。
- [ ] 组件卸载后无 setState 警告/报错。

### 批次 5 验证

- [ ] 切到 Analyze 视图停留 10s，Chrome Performance 中 GraphView/HeroView 的 rAF 不再占用主线程。
- [ ] 切回 Graph 视图，相机/控制器状态正确恢复。

### 回归与防复现

- [ ] `npm run build`、`npm test`、`moon test`、`moon build --target wasm-gc --release` 全部通过。
- [ ] 上述契约测试纳入 CI，任一双端不一致即失败。
- [ ] Code Review checklist 新增：守卫 null 特判、后端代理安全模板、凭证默认不落盘、渲染可见性。

---

报告完。五个核心模块已完整覆盖。需要我开始按批次落地修复（建议从批次 1 开始），或对某条连带预测做代码级复核？
