///| 引擎契约级单测：仅经 pub 入口（version / analyze_from_mod_text /
///| analyze_from_context_json）验证 MoonBit 引擎行为——priv 助手函数
///|（parse_version / SPDX 评分 / freshness 分档等）通过 context JSON 的输出
///| 逐维度断言覆盖，与 JS fallback（analyzer.test.ts）形成双端对齐。
///|
///| 注意：String::replace 只替换首个 occurrence，JSON 转义必须用 replace_all。

/// JSON 字符串转义（引号与换行，replace_all 全量替换）
fn json_escape(s : String) -> String {
  s.view()
    .replace_all(old="\"", new="\\\"")
    .replace_all(old="\n", new="\\n")
    .to_owned()
}

/// root 的 moon.mod TOML 文本（JSON 字符串形态，含转义）
fn root_mod_json_escaped(imports : String) -> String {
  json_escape(
    "name = \"demo/app\"\nversion = \"1.0.0\"\nimport { " + imports + " }\n",
  )
}

/// 构造完整 context JSON（root + modules + metadata 原文拼装）
fn context_json(
  root_imports : String,
  modules : String,
  metadata : String,
) -> String {
  "{\"root\":\"" +
  root_mod_json_escaped(root_imports) +
  "\",\"modules\":" +
  modules +
  ",\"metadata\":" +
  metadata +
  "}"
}

test "version：契约版本号" {
  assert_eq(@main.version(), "0.8.0-wasm")
}

test "analyze_from_mod_text：浅分析输出 suggestions 与 node_metas 字段" {
  let out = @main.analyze_from_mod_text(
    "name = \"demo/app\"\nversion = \"1.0.0\"\nimport { \"a@1.0.0\" }\n",
  )
  // 根无 license → LICENSE-001 info + low 建议（command 为空串）
  assert_true(out.contains("\"code\":\"LICENSE-001\""))
  assert_true(out.contains("\"severity\":\"info\""))
  assert_true(out.contains("\"impact\":\"low\""))
  assert_true(out.contains("\"command\":\"\""))
  // node_metas 序列化含 yanked / source_unavailable 字段
  assert_true(out.contains("\"yanked\":false"))
  assert_true(out.contains("\"source_unavailable\":false"))
  // 浅图：root + 直接依赖
  assert_true(out.contains("\"node_count\":2"))
}

test "analyze_from_mod_text：TOML 头部 module 行与 JSON 双格式" {
  let out = @main.analyze_from_mod_text("module my/app\nversion = \"2.0.0\"\n")
  assert_true(out.contains("\"root_id\":\"my/app@2.0.0\""))
  let out2 = @main.analyze_from_mod_text(
    "{\"name\":\"x/y\",\"version\":\"0.1.0\",\"license\":\"MIT\",\"deps\":{\"moonbitlang/core\":\"0.6.0\"}}",
  )
  assert_true(out2.contains("\"root_id\":\"x/y@0.1.0\""))
  // JSON 格式 license 进入 root 的 node_metas（依赖节点无 license 仍会报 LICENSE-001）
  assert_true(out2.contains("\"license\":\"MIT\""))
}

test "yanked 闭环：critical 诊断 + freshness 0 + high 建议" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"MIT\",\"latest_version\":\"1.2.0\"," +
    "\"yanked\":true,\"yanked_reason\":\"broken release\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"code\":\"YANKED-001\""))
  assert_true(out.contains("\"severity\":\"critical\""))
  assert_true(
    out.contains("a@1.0.0 is yanked on mooncakes.io: broken release"),
  )
  // freshness 直接 0 分
  assert_true(out.contains("\"freshness\":0"))
  // latest(1.2.0) != version(1.0.0) → moon add a@1.2.0，impact high
  assert_true(out.contains("\"impact\":\"high\""))
  assert_true(out.contains("\"command\":\"moon add a@1.2.0\""))
  // summary critical >= 1
  assert_true(out.contains("\"summary\":{\"critical\":1"))
}

test "yanked 且 latest==version（连最新版被 yank）→ moon remove" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"MIT\",\"latest_version\":\"1.0.0\",\"yanked\":true}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"command\":\"moon remove a\""))
  // latest == version 不再报 OUTDATED-001
  assert_false(out.contains("OUTDATED-001"))
}

test "DUP-001：同名多版本共存，旧节点告警 + 合并建议" {
  // root → a@1.0.0；root → b@2.0.0 → a@2.0.0
  let ctx = context_json(
    "\"a@1.0.0\", \"b@2.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"," +
    "\"b@2.0.0\":\"{\\\"name\\\":\\\"b\\\",\\\"version\\\":\\\"2.0.0\\\",\\\"deps\\\":{\\\"a@2.0.0\\\":\\\"2.0.0\\\"}}\"," +
    "\"a@2.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"2.0.0\\\"}\"}",
    "{}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"code\":\"DUP-001\""))
  assert_true(out.contains("\"severity\":\"warning\""))
  assert_true(
    out.contains(
      "a has multiple versions in the graph (1.0.0, 2.0.0); v1.0.0 is superseded by v2.0.0",
    ),
  )
  assert_true(out.contains("\"command\":\"moon add a@2.0.0\""))
  assert_true(out.contains("\"impact\":\"medium\""))
  // 图共 4 个节点
  assert_true(out.contains("\"node_count\":4"))
}

test "SPDX：OR 取最优（MIT OR Apache → 100）" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"MIT OR Apache-2.0\",\"latest_version\":\"1.1.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  // minor gap=1 → freshness 65；OR 取最优 → compliance 100
  assert_true(out.contains("\"freshness\":65,\"compliance\":100"))
}

test "SPDX：GPL strong copyleft → 30 + LICENSE-002 warning" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"GPL-3.0\",\"latest_version\":\"1.0.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"freshness\":100,\"compliance\":30"))
  assert_true(out.contains("\"code\":\"LICENSE-002\""))
  assert_true(out.contains("\"severity\":\"warning\""))
  assert_true(out.contains("a uses GPL-3.0; beware of copyleft obligations"))
  // 建议：medium，无命令
  assert_true(out.contains("\"impact\":\"medium\""))
}

test "SPDX：LGPL 属 weak copyleft → 60 且不触发 LICENSE-002" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"LGPL-2.1\",\"latest_version\":\"1.0.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"compliance\":60"))
  assert_false(out.contains("LICENSE-002"))
}

test "SPDX：AND 取最差（MIT AND GPL-3.0 → 30）" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"MIT AND GPL-3.0\",\"latest_version\":\"1.0.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"compliance\":30"))
}

test "parse_version 健壮性：两段式 vs 预发布后缀 → 65" {
  let ctx = context_json(
    "\"a@2.0\"",
    "{\"a@2.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"2.0\\\"}\"}",
    "{\"a@2.0\":{\"license\":\"MIT\",\"latest_version\":\"2.1.0-alpha\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"freshness\":65"))
}

test "parse_version 健壮性：v 前缀解析后同版本 → 90" {
  let ctx = context_json(
    "\"a@v1.0.0\"",
    "{\"a@v1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"v1.0.0\\\"}\"}",
    "{\"a@v1.0.0\":{\"license\":\"MIT\",\"latest_version\":\"1.0.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"freshness\":90"))
}

test "parse_version 健壮性：build 元数据后缀字符串相等 → 100" {
  let ctx = context_json(
    "\"a@0.1.20260920+7d59c7ec9\"",
    "{\"a@0.1.20260920+7d59c7ec9\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"0.1.20260920+7d59c7ec9\\\"}\"}",
    "{\"a@0.1.20260920+7d59c7ec9\":{\"license\":\"MIT\"," +
    "\"latest_version\":\"0.1.20260920+7d59c7ec9\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"freshness\":100"))
}

test "parse_version 健壮性：major gap → 20；大 minor gap 触底 30；无法解析 → 70" {
  fn mk(ver : String, latest : String) -> String {
    let id = "a@" + ver
    context_json(
      "\"" + id + "\"",
      "{\"" + id + "\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"" + ver +
      "\\\"}\"}",
      "{\"" + id + "\":{\"license\":\"MIT\",\"latest_version\":\"" + latest +
      "\"}}",
    )
  }
  assert_true(
    @main.analyze_from_context_json(mk("1.0.0", "2.0.0"))
      .contains("\"freshness\":20"),
  )
  // gap<=3 精确线性：80 - gap*15
  assert_true(
    @main.analyze_from_context_json(mk("1.0.0", "1.2.0"))
      .contains("\"freshness\":50"),
  )
  // gap>3 饱和触底 30（S11：极端 minor 号不再溢出回绕）
  assert_true(
    @main.analyze_from_context_json(mk("1.0.0", "1.5.0"))
      .contains("\"freshness\":30"),
  )
  assert_true(
    @main.analyze_from_context_json(mk("1.0.0", "nightly"))
      .contains("\"freshness\":70"),
  )
}

test "五维评分分档：deprecated / size / activity" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"MIT\",\"latest_version\":\"1.0.0\"," +
    "\"total_api_count\":10,\"deprecated_apis\":[\"x\",\"y\"]," +
    "\"self_size\":2000000,\"last_commit_days_ago\":400}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  // ratio 20% → 100-100 = 0
  assert_true(out.contains("\"deprecated_density\":0"))
  // size == 1_000_000 → 40（< 1_000_000 才是 60）
  assert_true(out.contains("\"size_reasonableness\":40"))
  // 400 天未更新 → 10
  assert_true(out.contains("\"activity\":10"))
  // 2MB < 5MB 新阈值，不再触发 SIZE-001
  assert_false(out.contains("SIZE-001"))
  // 对应诊断：ACTIVITY-001 critical + DEPRECATED-001 info
  assert_true(out.contains("\"code\":\"ACTIVITY-001\""))
  assert_true(out.contains("a contains 2 deprecated APIs"))
  assert_true(
    out.contains("a has not been updated in 400 days and may be unmaintained"),
  )
}

test "OUTDATED 诊断文案与 impact 分档" {
  fn mk(latest : String) -> String {
    context_json(
      "\"a@1.0.0\"",
      "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
      "{\"a@1.0.0\":{\"license\":\"MIT\",\"latest_version\":\"" + latest +
      "\"}}",
    )
  }
  // minor gap → medium + moon add a@1.3.0
  let minor = @main.analyze_from_context_json(mk("1.3.0"))
  assert_true(
    minor.contains("a is at v1.0.0 (latest 1.3.0); consider upgrading"),
  )
  assert_true(minor.contains("\"command\":\"moon add a@1.3.0\""))
  assert_true(minor.contains("\"impact\":\"medium\""))
  // major gap → high
  assert_true(
    @main.analyze_from_context_json(mk("2.0.0")).contains("\"impact\":\"high\""),
  )
}

test "overall_score / avg_health_score 整数除法（截断）" {
  // root 与 b@2.0.0 均无 metadata → 各 67；a 为 90；(67+67+90)/3 = 74.67 → 74
  let ctx = context_json(
    "\"a@1.0.0\", \"b@2.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"," +
    "\"b@2.0.0\":\"{\\\"name\\\":\\\"b\\\",\\\"version\\\":\\\"2.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"LicenseRef-Custom\",\"latest_version\":\"1.0.0\"," +
    "\"self_size\":50000,\"last_commit_days_ago\":10}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"overall_score\":74"))
  assert_true(out.contains("\"avg_health_score\":74"))
}

test "错误路径：非法 JSON 与缺失 root" {
  let out = @main.analyze_from_context_json("not-json")
  assert_true(out.contains("\"error\":\"Invalid JSON in context\""))
  let out2 = @main.analyze_from_context_json("{\"modules\":{}}")
  assert_true(out2.contains("Missing required field 'root'"))
  let out3 = @main.analyze_from_context_json("{\"root\":\"{ broken\"}")
  assert_true(out3.contains("Failed to parse root module"))
}

// ========== v0.8 新特性契约测试 ==========

test "CYCLE-001：成环路径诊断与打破循环建议" {
  // root → a@1.0.0 → b@1.0.0 → a@1.0.0（BFS visited 防环，图含回边）
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\",\\\"deps\\\":{\\\"b@1.0.0\\\":\\\"1.0.0\\\"}}\"," +
    "\"b@1.0.0\":\"{\\\"name\\\":\\\"b\\\",\\\"version\\\":\\\"1.0.0\\\",\\\"deps\\\":{\\\"a@1.0.0\\\":\\\"1.0.0\\\"}}\"}",
    "{}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"code\":\"CYCLE-001\""))
  assert_true(out.contains("\"severity\":\"warning\""))
  assert_true(
    out.contains("dependency cycle detected: a@1.0.0 -> b@1.0.0 -> a@1.0.0"),
  )
  assert_true(
    out.contains("Break the dependency cycle involving a@1.0.0, b@1.0.0"),
  )
  assert_true(out.contains("\"impact\":\"high\""))
  assert_true(out.contains("\"node_count\":3"))
}

test "import 解析健壮性：注释、多行块、旧版单行、空块" {
  let out = @main.analyze_from_mod_text(
    "name = \"demo/app\" # 行尾注释\n" +
    "version = \"1.0.0\"\n" +
    "license = \"Apache-2.0\"  # 根许可证\n" +
    "import { # 多行块开始\n" +
    "  \"a@1.0.0\", # 行内注释\n" +
    "  \"b@2.0.0\"\n" +
    "}\n" +
    "import \"c@3.0.0\" # 旧版单行\n" +
    "import \"ignored\" for \"wasm\" # 平台条件 import 跳过\n" +
    "import {} # 空块不产出依赖\n",
  )
  // root + 3 个直接依赖（平台条件 import 与空块不计）
  assert_true(out.contains("\"node_count\":4"))
  // 根 license 进浅图 metas
  assert_true(out.contains("\"license\":\"Apache-2.0\""))
}

test "import 解析：多行块收尾行与依赖字符串同行（\"b@2.0.0\" }）不丢失" {
  let out = @main.analyze_from_mod_text(
    "name = \"demo/app\"\nversion = \"1.0.0\"\n" +
    "import {\n  \"a@1.0.0\",\n  \"b@2.0.0\" }\n",
  )
  // root + a + b 均入图，收尾行依赖不得被静默丢弃
  assert_true(out.contains("\"node_count\":3"))
}

test "moon.mod.json：path 依赖跳过不崩溃" {
  let out = @main.analyze_from_mod_text(
    "{\"name\":\"demo/app\",\"version\":\"1.0.0\",\"deps\":{\"local/pkg\":{\"path\":\"../local\"},\"a\":\"1.0.0\"}}",
  )
  assert_true(out.contains("\"root_id\":\"demo/app@1.0.0\""))
  // 仅 a@1.0.0 入图（path 依赖被跳过）
  assert_true(out.contains("\"node_count\":2"))
}

test "version_resolved：latest 节点显式未解析标记" {
  let ctx = context_json(
    "\"a@latest\", \"b@2.0.0\"",
    "{\"a@latest\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"latest\\\"}\"," +
    "\"b@2.0.0\":\"{\\\"name\\\":\\\"b\\\",\\\"version\\\":\\\"2.0.0\\\"}\"}",
    "{\"a@latest\":{\"license\":\"MIT\",\"latest_version\":\"1.0.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"version\":\"latest\",\"version_resolved\":false"))
  assert_true(out.contains("\"version\":\"2.0.0\",\"version_resolved\":true"))
}

test "许可证指纹：license_text 识别 MIT，LICENSE-001 消除" {
  // metadata 无 license 字段，仅凭 license_text 指纹
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license_text\":\"MIT License\\n\\nCopyright (c) 2024\\n\\nPermission is hereby granted, free of charge, to any person obtaining a copy\\nof this software and associated documentation files (the \\\\\\\"Software\\\\\\\"), to deal\\nin the Software without restriction, including without limitation the rights\\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\\ncopies of the Software, and to permit persons to whom the Software is\\nfurnished to do so, subject to the following conditions:\\n\\nThe above copyright notice and this permission notice shall be included in all\\ncopies or substantial portions of the Software.\\n\\nTHE SOFTWARE IS PROVIDED \\\\\\\"AS IS\\\\\\\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\\nSOFTWARE.\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  // 指纹命中 → license=MIT + license_source=fingerprint
  assert_true(out.contains("\"license\":\"MIT\",\"license_source\":\"fingerprint\""))
  // a=78.5→79（MIT 后 compliance=100），root=67 → overall=73
  assert_true(out.contains("\"overall_score\":73"))
  // 仅 root（demo/app）无 license 报 LICENSE-001，a 指纹命中不再误报
  assert_true(out.contains("demo/app declares no license"))
  assert_true(out.contains("\"code\":\"LICENSE-001\""))
}

test "许可证指纹：GPL-3.0 文本触发 LICENSE-002 strong copyleft" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license_text\":\"GNU GENERAL PUBLIC LICENSE\\nVersion 3, 29 June 2007\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"license\":\"GPL-3.0\",\"license_source\":\"fingerprint\""))
  assert_true(out.contains("\"code\":\"LICENSE-002\""))
  assert_true(out.contains("a uses GPL-3.0; beware of copyleft obligations"))
  // a=64.5→65（GPL 后 compliance=30），root=67 → overall=66
  assert_true(out.contains("\"overall_score\":66"))
}

test "SPDX 规范化：变体、WITH 异常剥离、大小写与 AND 组合" {
  fn mk(lic : String) -> String {
    context_json(
      "\"a@1.0.0\"",
      "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
      "{\"a@1.0.0\":{\"license\":\"" + lic + "\",\"latest_version\":\"1.0.0\"}}",
    )
  }
  // 变体归一："apache 2.0" → Apache-2.0 → permissive 100
  assert_true(
    @main.analyze_from_context_json(mk("apache 2.0")).contains("\"compliance\":100"),
  )
  // WITH 异常子句剥离：Apache-2.0 WITH LLVM-exception → 100
  assert_true(
    @main.analyze_from_context_json(mk("Apache-2.0 WITH LLVM-exception"))
      .contains("\"compliance\":100"),
  )
  // 大小写/空白统一 + 变体：g p l v 3 → 规范化后判 strong → 30 + LICENSE-002
  //（诊断 message 展示原始声明串，故只断言 code 与固定文案后缀）
  let gpl = @main.analyze_from_context_json(mk("g p l v 3"))
  assert_true(gpl.contains("\"compliance\":30"))
  assert_true(gpl.contains("\"code\":\"LICENSE-002\""))
  assert_true(gpl.contains("beware of copyleft obligations"))
  // AND 取最差：GPLv3 AND MIT → 30
  assert_true(
    @main.analyze_from_context_json(mk("GPLv3 AND MIT")).contains("\"compliance\":30"),
  )
}

test "license_families：五 key 恒输出 + 家族计数" {
  // a=MIT(permissive) b=GPL-3.0(strong) c=无 license(unknown)；root 无 license
  let ctx = context_json(
    "\"a@1.0.0\", \"b@1.0.0\", \"c@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"," +
    "\"b@1.0.0\":\"{\\\"name\\\":\\\"b\\\",\\\"version\\\":\\\"1.0.0\\\"}\"," +
    "\"c@1.0.0\":\"{\\\"name\\\":\\\"c\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"MIT\"},\"b@1.0.0\":{\"license\":\"GPL-3.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"license_families\":{"))
  assert_true(out.contains("\"permissive\":1"))
  assert_true(out.contains("\"weak-copyleft\":0"))
  assert_true(out.contains("\"strong-copyleft\":1"))
  assert_true(out.contains("\"proprietary\":0"))
  assert_true(out.contains("\"unknown\":2"))
}

// ========== P2 修复契约测试（M-1 ~ M-8，双端与 analyzer.test.ts 对齐） ==========

test "M-1：license_families 统计口径与评分路径一致（变体许可证归一后计数）" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"apache 2.0\",\"latest_version\":\"1.0.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  // 评分路径归一为 Apache-2.0 → permissive 100；统计路径同口径 → permissive:1
  assert_true(out.contains("\"compliance\":100"))
  assert_true(out.contains("\"permissive\":1"))
  // root 自身无 license 亦计入 unknown，故恰为 1（统计口径与评分路径一致）
  assert_true(out.contains("\"unknown\":1"))
}

test "M-2/M-7：namesuffix 不污染 name，module 带引号头部剥离引号" {
  let out = @main.analyze_from_mod_text(
    "module \"q/r\"\nversion = \"2.0.0\"\nnamesuffix = \"extra\"\n",
  )
  // name 未被 namesuffix 覆盖，引号已剥离
  assert_true(out.contains("\"root_id\":\"q/r@2.0.0\""))
}

test "M-3：import 块未闭合遇 section 头重置，后续引号行不产生幽灵依赖" {
  let out = @main.analyze_from_mod_text(
    "name = \"demo/app\"\nversion = \"1.0.0\"\n" +
    "import {\n  \"a@1.0.0\"\n[profile.release]\nkey = \"ghost/pkg@9.9.9\"\n",
  )
  // root + a@1.0.0；ghost/pkg 不得入图
  assert_true(out.contains("\"node_count\":2"))
  assert_false(out.contains("ghost/pkg"))
}

test "M-4：溢出版本号解析失败 → freshness 70 而非回绕乱分" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"MIT\",\"latest_version\":\"99999999999999999999.0.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  // 无法解析（而非 Int 回绕成奇怪值参与比较）→ 70
  assert_true(out.contains("\"freshness\":70"))
}

test "M-5：传递体积菱形去重（共享子孙只计一次）" {
  // root → b、c；b、c → d；d 的 self_size 在 root 传递体积中只计一次
  let ctx = context_json(
    "\"b@1.0.0\", \"c@1.0.0\"",
    "{\"b@1.0.0\":\"{\\\"name\\\":\\\"b\\\",\\\"version\\\":\\\"1.0.0\\\",\\\"deps\\\":{\\\"d@1.0.0\\\":\\\"1.0.0\\\"}}\"," +
    "\"c@1.0.0\":\"{\\\"name\\\":\\\"c\\\",\\\"version\\\":\\\"1.0.0\\\",\\\"deps\\\":{\\\"d@1.0.0\\\":\\\"1.0.0\\\"}}\"," +
    "\"d@1.0.0\":\"{\\\"name\\\":\\\"d\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"d@1.0.0\":{\"license\":\"MIT\",\"latest_version\":\"1.0.0\",\"self_size\":1000}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  // root 传递体积 = b0 + c0 + d1000 = 1000；d 不得重复计为 2000
  assert_true(
    out.contains(
      "\"node_id\":\"demo/app@1.0.0\",\"self_size\":0,\"transitive_size\":1000",
    ),
  )
}

test "M-6：SIZE-001 阈值与 size 分档对齐（4MB 静默，5MB 边界告警）" {
  fn mk(size : Int) -> String {
    context_json(
      "\"a@1.0.0\"",
      "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
      "{\"a@1.0.0\":{\"license\":\"MIT\",\"latest_version\":\"1.0.0\",\"self_size\":" +
      size.to_string() + "}}",
    )
  }
  // 4MB：低于 5MB 阈值，无 SIZE-001
  assert_false(@main.analyze_from_context_json(mk(4_000_000)).contains("SIZE-001"))
  // 5MB：边界触发诊断与建议
  let big = @main.analyze_from_context_json(mk(5_000_000))
  assert_true(big.contains("\"code\":\"SIZE-001\""))
  assert_true(big.contains("consider slimming it down"))
  assert_true(big.contains("Find a lighter alternative to a"))
}

test "M-8：同名依赖优先用 modules 内容，不回退 root 嫁接子树" {
  // root demo/app@1.0.0 依赖 demo/app@0.9.0（同名旧版，modules 中有独立内容 → x@1.0.0）
  let ctx = context_json(
    "\"demo/app@0.9.0\"",
    "{\"demo/app@0.9.0\":\"{\\\"name\\\":\\\"demo/app\\\",\\\"version\\\":\\\"0.9.0\\\",\\\"deps\\\":{\\\"x@1.0.0\\\":\\\"1.0.0\\\"}}\"}",
    "{}",
  )
  let out = @main.analyze_from_context_json(ctx)
  // root + demo/app@0.9.0 + x@1.0.0；若嫁接 root，x 不会出现（node_count:2）
  assert_true(out.contains("\"node_count\":3"))
  assert_true(out.contains("x@1.0.0"))
}

// ========== P1 批次3（S10-S15）+ P3-M 契约测试（双端与 analyzer.test.ts 对齐） ==========

test "S10：UNLICENSED 计 proprietary（40 分）而非 permissive" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"UNLICENSED\",\"latest_version\":\"1.0.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  // 入口先判 proprietary：避免被 permissive 的 "UNLICENSE" 子串误判
  assert_true(out.contains("\"compliance\":40"))
  assert_true(out.contains("\"proprietary\":1"))
}

test "S11：负值 metadata 归一（不扣减体积 / 不失真评分）" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"MIT\",\"latest_version\":\"1.0.0\",\"self_size\":-500,\"last_commit_days_ago\":-10,\"total_api_count\":-5}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  // self_size 钳 0 → 体积不扣减；days 负 → None → activity 中位 50；api_count 钳 0 → deprecated 100
  assert_true(out.contains("\"total_size_bytes\":0"))
  assert_true(out.contains("\"activity\":50"))
  assert_true(out.contains("\"deprecated_density\":100"))
}

test "S12：缺 name/version 的 mod 文本视为垃圾输入报错" {
  // TOML 分支：有 name 无 version
  let toml_out = @main.analyze_from_mod_text("name = \"a/b\"\n")
  assert_true(
    toml_out.contains("moon.mod missing required field 'name' or 'version'"),
  )
  // JSON 分支：有 name 无 version
  let json_out = @main.analyze_from_mod_text("{\"name\":\"x/y\"}")
  assert_true(
    json_out.contains("moon.mod.json missing required field 'name' or 'version'"),
  )
}

test "S12 连带：垃圾模块内容不产生 unknown@0.0.0 幽灵节点" {
  // context 中模块内容为垃圾文本 → resolve_module Err => None，节点不落地
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"not a mod at all\"}",
    "{}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_false(out.contains("unknown@0.0.0"))
}

test "S13：领先版本不告警不建议升级（freshness 90）" {
  // 节点版本以 root import 声明为准，故 import/modules key/内容 version 均须为 2.0.0
  let ctx = context_json(
    "\"a@2.0.0\"",
    "{\"a@2.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"2.0.0\\\"}\"}",
    "{\"a@2.0.0\":{\"license\":\"MIT\",\"latest_version\":\"1.0.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  // cur(2.0.0) >= latest(1.0.0) → 90 分、无 OUTDATED-001（防 "降级式升级" 误导）
  assert_true(out.contains("\"freshness\":90"))
  assert_false(out.contains("OUTDATED-001"))
}

test "S14：SPDX 表达式合规分（AND 取最差 / 括号递归 / 小写连接词）" {
  fn score_of(license : String) -> String {
    let ctx = context_json(
      "\"a@1.0.0\"",
      "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
      "{\"a@1.0.0\":{\"license\":\"" +
      license +
      "\",\"latest_version\":\"1.0.0\"}}",
    )
    @main.analyze_from_context_json(ctx)
  }
  // AND 取最差：min(100, 30) = 30
  assert_true(score_of("MIT and GPL-3.0").contains("\"compliance\":30"))
  // 括号递归：AND 拆出 (MIT OR Apache-2.0)，剥外层后 OR 拆分 → min(30, max(100,100)) = 30
  assert_true(
    score_of("GPL-3.0 AND (MIT OR Apache-2.0)").contains("\"compliance\":30"),
  )
  // 小写连接词 + 变体：max(100, 30) = 100
  assert_true(score_of("mit or gplv3").contains("\"compliance\":100"))
  // 悬挂括号 → 不平衡保守 fallback：single(GPL-3.0) = 30
  assert_true(score_of("(GPL-3.0").contains("\"compliance\":30"))
}

test "S15：options.max_depth 钳制 [1,64]" {
  fn chain_ctx(max_depth_json : String) -> String {
    "{\"root\":\"" +
    root_mod_json_escaped("\"a@1.0.0\"") +
    "\",\"modules\":{" +
    "\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\",\\\"deps\\\":{\\\"b@1.0.0\\\":\\\"1.0.0\\\"}}\"," +
    "\"b@1.0.0\":\"{\\\"name\\\":\\\"b\\\",\\\"version\\\":\\\"1.0.0\\\",\\\"deps\\\":{\\\"c@1.0.0\\\":\\\"1.0.0\\\"}}\"," +
    "\"c@1.0.0\":\"{\\\"name\\\":\\\"c\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}," +
    "\"metadata\":{},\"options\":{\"max_depth\":" +
    max_depth_json +
    "}}"
  }
  // root→a→b→c 共 4 节点；max_depth=1 只展开到深度 1（root+a）
  assert_true(
    @main.analyze_from_context_json(chain_ctx("1")).contains("\"node_count\":2"),
  )
  // 0 钳到 1，同样 2 节点
  assert_true(
    @main.analyze_from_context_json(chain_ctx("0")).contains("\"node_count\":2"),
  )
  // 999999 钳到 64，链长 3 不受影响 → 4 节点
  assert_true(
    @main.analyze_from_context_json(chain_ctx("999999")).contains(
      "\"node_count\":4",
    ),
  )
}

test "S15：context JSON 超 16MB 硬上限直接报错" {
  let sb = StringBuilder()
  sb.write_string("{\"root\":\"")
  let mut chunk = "a"
  while chunk.length() < 1024 * 1024 {
    chunk = chunk + chunk
  }
  // 1MB chunk × 17 = 17MB > 16MB 上限，步骤 0 直接拒绝
  for _ in 0..<17 {
    sb.write_string(chunk)
  }
  sb.write_string("\",\"modules\":{},\"metadata\":{}}")
  let out = @main.analyze_from_context_json(sb.to_string())
  assert_true(out.contains("context JSON exceeds 16MB size limit"))
}

test "S15：自环依赖检出 CYCLE-001（迭代 DFS 与递归版同语义）" {
  let ctx = context_json(
    "\"a@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\",\\\"deps\\\":{\\\"a@1.0.0\\\":\\\"1.0.0\\\"}}\"}",
    "{}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"node_count\":2"))
  assert_true(out.contains("\"code\":\"CYCLE-001\""))
  assert_true(
    out.contains("dependency cycle detected: a@1.0.0 -> a@1.0.0"),
  )
}

test "parse_warnings：异常字段类型收集 warning 而非静默吞噬" {
  let ctx = "{\"root\":\"" +
    root_mod_json_escaped("\"a@1.0.0\"") +
    "\",\"modules\":[],\"metadata\":\"oops\",\"options\":\"oops\"}"
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("context.modules is not an object; ignored"))
  assert_true(out.contains("context.metadata is not an object; ignored"))
  assert_true(out.contains("context.options is not an object; ignored"))
}

test "parse_warnings：modules 非字符串值跳过并告警；max_depth 非数字回退默认" {
  let ctx = "{\"root\":\"" +
    root_mod_json_escaped("\"a@1.0.0\"") +
    "\",\"modules\":{\"a@1.0.0\":123},\"metadata\":{},\"options\":{\"max_depth\":\"x\"}}"
  let out = @main.analyze_from_context_json(ctx)
  // 序列化后 warning 内引号被转义为 \"，故字面量需匹配反斜杠+引号
  assert_true(
    out.contains("modules[\\\"a@1.0.0\\\"] is not a string; skipped"),
  )
  assert_true(
    out.contains("options.max_depth is not a number; using default"),
  )
}

test "P3-M③：统计口径与评分一致（变体许可证归一后去重计数）" {
  let ctx = context_json(
    "\"a@1.0.0\", \"b@1.0.0\"",
    "{\"a@1.0.0\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"1.0.0\\\"}\"," +
    "\"b@1.0.0\":\"{\\\"name\\\":\\\"b\\\",\\\"version\\\":\\\"1.0.0\\\"}\"}",
    "{\"a@1.0.0\":{\"license\":\"apache 2.0\",\"latest_version\":\"1.0.0\"}," +
    "\"b@1.0.0\":{\"license\":\"Apache-2.0\",\"latest_version\":\"1.0.0\"}}",
  )
  let out = @main.analyze_from_context_json(ctx)
  // 两种写法归一后同为 APACHE-2.0 → unique 只计 1；家族统计 permissive 2（root 另计 unknown）
  assert_true(out.contains("\"unique_licenses\":1"))
  assert_true(out.contains("\"permissive\":2"))
}

test "P3-M⑤：version_resolved 判定大小写不敏感（Latest 视为未解析）" {
  let ctx = context_json(
    "\"a@latest\"",
    "{\"a@latest\":\"{\\\"name\\\":\\\"a\\\",\\\"version\\\":\\\"Latest\\\"}\"}",
    "{}",
  )
  let out = @main.analyze_from_context_json(ctx)
  assert_true(out.contains("\"version_resolved\":false"))
}
