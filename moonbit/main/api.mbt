/// depsight WASM API —— 浏览器可调用的依赖健康分析入口。
///
/// # 调用契约（与 src/lib/analyzer.ts JS fallback 完全一致）
///
/// 本模块以 wasm-gc 后端编译，并在 moon.pkg 中开启 `use-js-builtin-string`：
/// 导出的 `String` 参数/返回值通过 `wasm:js-string` 内建直接映射为 JS string，
/// JS 侧可直接 `exports.analyze_from_context_json(jsonString)`，无需任何编解码。
///
/// JS 侧加载方式：
///
/// ```js
/// const { instance } = await WebAssembly.instantiateStreaming(
///   fetch("./depsight.wasm"),
///   {},
///   { builtins: ["js-string"], importedStringConstants: "_" },
/// );
/// ```
///
/// JS 侧组装一个 JSON 字符串传给 `analyze_from_context_json`：
///
/// ```json
/// {
///   "root": "<moon.mod.json 或 moon.mod TOML 原文>",
///   "modules": { "<name@version>": "<moon.mod.json 原文>" },
///   "metadata": {
///     "<name@version>": {
///       "license": "MIT",
///       "latest_version": "1.2.3",
///       "last_commit_days_ago": 45,
///       "self_size": 12345,
///       "total_api_count": 256,
///       "deprecated_apis": ["api1"],
///       "yanked": false,
///       "yanked_reason": null,
///       "source_unavailable": false
///     }
///   },
///   "options": { "max_depth": 10 }
/// }
/// ```
///
/// 返回 JSON：overall_score / node_count / diagnostics / suggestions /
///           health_scores / summary / graph / _root_mod /
///           size_offenders_top5 / node_metas / ecosystem_stats
///
/// 诊断码：YANKED-001 / OUTDATED-001 / LICENSE-001 / LICENSE-002 /
///         DEPRECATED-001 / SIZE-001 / ACTIVITY-001 / ACTIVITY-002 / DUP-001 /
///         CYCLE-001
///
/// 0.8.x 新增：CYCLE-001 循环依赖诊断、graph nodes 的 version_resolved 标记、
/// node_metas 的 license_source（manifest/mod_text/fingerprint）、
/// ecosystem_stats.license_families 家族分布、metadata.license_text 指纹推断、
/// SPDX 表达式规范化（变体映射 + WITH 异常子句剥离）。
///
/// # 编译
///
/// moon.pkg 需开启 `"use-js-builtin-string": true`（wasm-gc link 选项），
/// 否则 String 会编译为 wasm-gc 私有数组类型，JS 无法直接传参/取值。
///
/// ```bash
/// moon build --target wasm-gc --release
/// cp _build/wasm-gc/release/build/main/main.wasm moonbit/depsight.wasm
/// ```

// ========== 入口 ==========

///|
/// 主入口：从完整上下文运行分析，返回 JSON 字符串。
#export_name("analyze_from_context_json")
pub fn analyze_from_context_json(context_json : String) -> String {
  match run_analysis(context_json) {
    Ok(json) => json
    Err(msg) => make_error_json(msg)
  }
}

///|
/// 便捷入口：仅分析单个 moon.mod / moon.mod.json，不递归依赖。
#export_name("analyze_from_mod_text")
pub fn analyze_from_mod_text(mod_text : String) -> String {
  let root = match parse_mod_text(mod_text) {
    Ok(m) => m
    Err(msg) => return make_error_json(msg)
  }
  let graph = build_shallow_graph(root)
  let metas = build_shallow_metas(graph, root)
  let health_scores = compute_health_scores(graph, metas)
  let diags = run_diagnostics(graph, metas)
  let suggestions = build_suggestions(graph, metas)
  let size_offenders = compute_size_offenders(graph, metas)
  let stats = compute_ecosystem_stats(graph, health_scores, metas)
  assemble_result(graph, health_scores, diags, suggestions, size_offenders, stats, metas)
}

///|
/// 版本号（JS 侧做兼容性检查；0.8.x 引入 CYCLE-001 / version_resolved /
/// license_source / license_families / license_text 指纹 / SPDX 规范化）
#export_name("version")
pub fn version() -> String {
  "0.8.0-wasm"
}

// ========== 主分析流程 ==========

///|
/// 完整分析流程
fn run_analysis(context_json : String) -> Result[String, String] {
  // 1. 解析外层 JSON
  let ctx = @json.parse(context_json) catch { _ => return Err("Invalid JSON in context") }
  guard ctx is Object(ctx_obj) else { return Err("Expected JSON object at context root") }

  // 2. 读 root
  let root_text = match ctx_obj.get("root") {
    Some(String(s)) => s
    _ => return Err("Missing required field 'root'")
  }
  let root = match parse_mod_text(root_text) {
    Ok(m) => m
    Err(e) => return Err("Failed to parse root module: " + e)
  }

  // 3. 读 modules
  let modules : Map[String, String] = Map([])
  match ctx_obj.get("modules") {
    Some(Object(mods)) => {
      for pair in mods {
        let (key, value) = pair
        guard value is String(content) else { continue }
        modules[key] = content
      }
    }
    _ => ()
  }

  // 4. 读 metadata
  let metadata : Map[String, Json] = Map([])
  match ctx_obj.get("metadata") {
    Some(Object(metas)) => {
      for pair in metas {
        let (key, value) = pair
        metadata[key] = value
      }
    }
    _ => ()
  }

  // 5. 读 options
  let mut max_depth = 10
  match ctx_obj.get("options") {
    Some(Object(opts)) =>
      match opts.get("max_depth") {
        Some(Number(n, ..)) => max_depth = n.to_int()
        _ => ()
      }
    _ => ()
  }

  // 6. 构建图
  let graph = build_graph(root, modules, max_depth)

  // 7. 构建 metas
  let metas = build_node_metas(graph, root, metadata)

  // 8. 计算健康分
  let health_scores = compute_health_scores(graph, metas)

  // 9. 诊断
  let diags = run_diagnostics(graph, metas)

  // 10. 修复建议
  let suggestions = build_suggestions(graph, metas)

  // 11. 体积
  let size_offenders = compute_size_offenders(graph, metas)

  // 12. 生态统计
  let stats = compute_ecosystem_stats(graph, health_scores, metas)

  // 13. 序列化
  Ok(assemble_result(graph, health_scores, diags, suggestions, size_offenders, stats, metas))
}
