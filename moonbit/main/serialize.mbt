///| 结果序列化为 JSON（手写 StringBuilder，配合 json_str escape）。

///|
/// 序列化完整结果为 JSON
fn assemble_result(
  graph : Graph,
  health_scores : Array[HealthScore],
  diags : Array[Diagnostic],
  suggestions : Array[Suggestion],
  size_offenders : Array[(String, Int, Int)],
  stats : EcosystemStats,
  metas : Map[String, NodeMeta],
  parse_warnings : Array[String],
) -> String {
  let buf = StringBuilder()

  buf.write_string("{\"overall_score\":")
  let sum = health_scores.fold(init=0, fn(acc, s) { acc + s.total })
  let overall = if health_scores.length() > 0 { sum / health_scores.length() } else { 0 }
  buf.write_string(overall.to_string())
  buf.write_string(",\"node_count\":")
  buf.write_string(graph.nodes.length().to_string())

  // parse_warnings：上下文里被忽略/跳过的异常字段（与 JS assembleResult 同字段同位置）
  buf.write_string(",\"parse_warnings\":[")
  let mut w = 0
  for warning in parse_warnings {
    if w > 0 { buf.write_string(",") }
    buf.write_string(json_str(warning))
    w = w + 1
  }
  buf.write_string("]")

  // diagnostics
  buf.write_string(",\"diagnostics\":[")
  let mut i = 0
  for d in diags {
    if i > 0 { buf.write_string(",") }
    buf.write_string("{\"code\":")
    buf.write_string(json_str(d.code))
    buf.write_string(",\"severity\":")
    buf.write_string(json_str(d.severity))
    buf.write_string(",\"node_id\":")
    buf.write_string(json_str(d.node_id))
    buf.write_string(",\"message\":")
    buf.write_string(json_str(d.message))
    buf.write_string("}")
    i = i + 1
  }
  buf.write_string("]")

  // suggestions
  buf.write_string(",\"suggestions\":")
  buf.write_string(serialize_suggestions(suggestions))

  // health_scores
  buf.write_string(",\"health_scores\":[")
  let mut j = 0
  for s in health_scores {
    if j > 0 { buf.write_string(",") }
    buf.write_string("{\"node_id\":")
    buf.write_string(json_str(s.node_id))
    buf.write_string(",\"total\":")
    buf.write_string(s.total.to_string())
    buf.write_string(",\"freshness\":")
    buf.write_string(s.freshness.to_string())
    buf.write_string(",\"compliance\":")
    buf.write_string(s.compliance.to_string())
    buf.write_string(",\"deprecated_density\":")
    buf.write_string(s.deprecated_density.to_string())
    buf.write_string(",\"size_reasonableness\":")
    buf.write_string(s.size_reasonableness.to_string())
    buf.write_string(",\"activity\":")
    buf.write_string(s.activity.to_string())
    buf.write_string("}")
    j = j + 1
  }
  buf.write_string("]")

  // summary
  let crit = diags.filter(fn(d) { d.severity == "critical" }).length()
  let warn = diags.filter(fn(d) { d.severity == "warning" }).length()
  let info = diags.filter(fn(d) { d.severity == "info" }).length()
  buf.write_string(",\"summary\":{\"critical\":")
  buf.write_string(crit.to_string())
  buf.write_string(",\"warning\":")
  buf.write_string(warn.to_string())
  buf.write_string(",\"info\":")
  buf.write_string(info.to_string())
  buf.write_string("}")

  // graph
  buf.write_string(",\"graph\":")
  buf.write_string(serialize_graph(graph))

  // _root_mod（前端趋势记录 / AI 抽屉 prompt 用）：root 节点 + 其 meta 的 license
  let mut root_name = "unknown"
  let mut root_version = "0.0.0"
  for n in graph.nodes {
    if n.id == graph.root_id {
      root_name = n.name
      root_version = n.version
    }
  }
  let root_license = match metas.get(graph.root_id) {
    Some(m) => m.license
    None => None
  }
  buf.write_string(",\"_root_mod\":{\"name\":")
  buf.write_string(json_str(root_name))
  buf.write_string(",\"version\":")
  buf.write_string(json_str(root_version))
  buf.write_string(",\"license\":")
  match root_license {
    Some(l) => buf.write_string(json_str(l))
    None => buf.write_string("null")
  }
  buf.write_string("}")

  // size_offenders_top5
  buf.write_string(",\"size_offenders_top5\":[")
  let mut k = 0
  for o in size_offenders {
    if k > 0 { buf.write_string(",") }
    buf.write_string("{\"node_id\":")
    buf.write_string(json_str(o.0))
    buf.write_string(",\"self_size\":")
    buf.write_string(o.1.to_string())
    buf.write_string(",\"transitive_size\":")
    buf.write_string(o.2.to_string())
    buf.write_string("}")
    k = k + 1
  }
  buf.write_string("]")

  // node_metas
  buf.write_string(",\"node_metas\":")
  buf.write_string(serialize_node_metas(graph, metas))

  // ecosystem_stats
  buf.write_string(",\"ecosystem_stats\":")
  buf.write_string(serialize_ecosystem_stats(stats))

  buf.write_string("}")
  buf.to_string()
}

///|
/// 序列化修复建议
fn serialize_suggestions(sugs : Array[Suggestion]) -> String {
  let buf = StringBuilder()
  buf.write_string("[")
  let mut i = 0
  for s in sugs {
    if i > 0 { buf.write_string(",") }
    buf.write_string("{\"code\":")
    buf.write_string(json_str(s.code))
    buf.write_string(",\"node_id\":")
    buf.write_string(json_str(s.node_id))
    buf.write_string(",\"action\":")
    buf.write_string(json_str(s.action))
    buf.write_string(",\"command\":")
    buf.write_string(json_str(s.command))
    buf.write_string(",\"impact\":")
    buf.write_string(json_str(s.impact))
    buf.write_string("}")
    i = i + 1
  }
  buf.write_string("]")
  buf.to_string()
}

///|
/// 序列化依赖图
fn serialize_graph(graph : Graph) -> String {
  let buf = StringBuilder()
  buf.write_string("{\"root_id\":")
  buf.write_string(json_str(graph.root_id))

  buf.write_string(",\"nodes\":[")
  let mut i = 0
  for node in graph.nodes {
    if i > 0 { buf.write_string(",") }
    buf.write_string("{\"id\":")
    buf.write_string(json_str(node.id))
    buf.write_string(",\"name\":")
    buf.write_string(json_str(node.name))
    buf.write_string(",\"version\":")
    buf.write_string(json_str(node.version))
    buf.write_string(",\"version_resolved\":")
    buf.write_string(if is_resolved_version(node.version) { "true" } else { "false" })
    buf.write_string(",\"depth\":")
    buf.write_string(node.depth.to_string())
    buf.write_string("}")
    i = i + 1
  }
  buf.write_string("]")

  buf.write_string(",\"edges\":[")
  let mut j = 0
  for edge in graph.edges {
    if j > 0 { buf.write_string(",") }
    buf.write_string("{\"from\":")
    buf.write_string(json_str(edge.from))
    buf.write_string(",\"to\":")
    buf.write_string(json_str(edge.to))
    buf.write_string("}")
    j = j + 1
  }
  buf.write_string("]")

  buf.write_string("}")
  buf.to_string()
}

///|
/// 序列化 NodeMeta
fn serialize_node_metas(graph : Graph, metas : Map[String, NodeMeta]) -> String {
  let buf = StringBuilder()
  buf.write_string("{")
  let mut first = true
  for node in graph.nodes {
    if first { first = false } else { buf.write_string(",") }
    buf.write_string(json_str(node.id))
    buf.write_string(":")
    match metas.get(node.id) {
      Some(meta) => {
        buf.write_string("{\"license\":")
        match meta.license {
          Some(s) => buf.write_string(json_str(s))
          None => buf.write_string("null")
        }
        buf.write_string(",\"license_source\":")
        match meta.license_source {
          Some(s) => buf.write_string(json_str(s))
          None => buf.write_string("null")
        }
        buf.write_string(",\"latest_version\":")
        match meta.latest_version {
          Some(s) => buf.write_string(json_str(s))
          None => buf.write_string("null")
        }
        buf.write_string(",\"self_size\":")
        buf.write_string(meta.self_size.to_string())
        buf.write_string(",\"last_commit_days_ago\":")
        match meta.last_commit_days_ago {
          Some(n) => buf.write_string(n.to_string())
          None => buf.write_string("null")
        }
        buf.write_string(",\"total_api_count\":")
        buf.write_string(meta.total_api_count.to_string())
        buf.write_string(",\"deprecated_api_count\":")
        buf.write_string(meta.deprecated_apis.length().to_string())
        buf.write_string(",\"yanked\":")
        buf.write_string(if meta.yanked { "true" } else { "false" })
        buf.write_string(",\"yanked_reason\":")
        match meta.yanked_reason {
          Some(s) => buf.write_string(json_str(s))
          None => buf.write_string("null")
        }
        buf.write_string(",\"source_unavailable\":")
        buf.write_string(if meta.source_unavailable { "true" } else { "false" })
        buf.write_string("}")
      }
      None => buf.write_string("null")
    }
  }
  buf.write_string("}")
  buf.to_string()
}

///|
/// 序列化生态统计
fn serialize_ecosystem_stats(stats : EcosystemStats) -> String {
  let buf = StringBuilder()
  buf.write_string("{\"total_packages\":")
  buf.write_string(stats.total_packages.to_string())
  buf.write_string(",\"direct_dependencies\":")
  buf.write_string(stats.direct_dependencies.to_string())
  buf.write_string(",\"max_depth\":")
  buf.write_string(stats.max_depth.to_string())
  buf.write_string(",\"total_size_bytes\":")
  buf.write_string(stats.total_size_bytes.to_string())
  buf.write_string(",\"total_deprecated_apis\":")
  buf.write_string(stats.total_deprecated_apis.to_string())
  buf.write_string(",\"unique_licenses\":")
  buf.write_string(stats.unique_licenses.to_string())
  buf.write_string(",\"avg_health_score\":")
  buf.write_string(stats.avg_health_score.to_string())

  // 许可证家族分布（五个 key 恒输出）
  buf.write_string(",\"license_families\":{")
  let fam_keys = ["permissive", "weak-copyleft", "strong-copyleft", "proprietary", "unknown"]
  for i in 0..<fam_keys.length() {
    if i > 0 { buf.write_string(",") }
    buf.write_string(json_str(fam_keys[i]))
    buf.write_string(":")
    buf.write_string(stats.license_families[fam_keys[i]].to_string())
  }
  buf.write_string("}")

  buf.write_string("}")
  buf.to_string()
}

// ========== 工具函数 ==========

///|
/// version_resolved 判定：trim + 小写后与 "latest" 比较（与 JS isResolvedVersion 一致）
fn is_resolved_version(version : String) -> Bool {
  version.trim().to_lower() != "latest"
}

///|
/// JSON string escape（按码点迭代，正确处理多字节字符）
fn json_str(s : String) -> String {
  let buf = StringBuilder()
  buf.write_char('"')
  for c in s {
    if c == '"' {
      buf.write_string("\\\"")
    } else if c == '\\' {
      buf.write_string("\\\\")
    } else if c == '\n' {
      buf.write_string("\\n")
    } else if c == '\r' {
      buf.write_string("\\r")
    } else if c == '\t' {
      buf.write_string("\\t")
    } else if c.to_int() < 0x20 {
      buf.write_string("\\u00")
      buf.write_string(hex2(c.to_int()))
    } else {
      buf.write_char(c)
    }
  }
  buf.write_char('"')
  buf.to_string()
}

///|
/// 两位十六进制
fn hex2(code : Int) -> String {
  let digits = "0123456789abcdef"
  let hi = (code / 16) % 16
  let lo = code % 16
  let buf = StringBuilder()
  buf.write_char(digits[hi].to_int().unsafe_to_char())
  buf.write_char(digits[lo].to_int().unsafe_to_char())
  buf.to_string()
}

///|
/// 字节格式化
fn fmt_bytes(n : Int) -> String {
  if n < 1024 {
    n.to_string() + " B"
  } else if n < 1024 * 1024 {
    let kb = n.to_double() / 1024.0
    format_double_1(kb) + " KB"
  } else {
    let mb = n.to_double() / (1024.0 * 1024.0)
    format_double_2(mb) + " MB"
  }
}

///|
/// 保留 1 位小数
fn format_double_1(d : Double) -> String {
  let rounded = (d * 10.0).round() / 10.0
  rounded.to_string()
}

///|
/// 保留 2 位小数
fn format_double_2(d : Double) -> String {
  let rounded = (d * 100.0).round() / 100.0
  rounded.to_string()
}

///|
/// 构造错误响应
fn make_error_json(msg : String) -> String {
  "{\"error\":" + json_str(msg) + "}"
}
