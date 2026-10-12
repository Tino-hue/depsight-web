///| 健康评分（五维加权）与许可证 SPDX 归一化。

///|
/// 计算单个节点的健康分
fn compute_health_score(node : Node, mod : Module, meta : NodeMeta) -> HealthScore {
  let freshness = score_freshness(mod, meta)
  let compliance = score_compliance(mod, meta)
  let deprecated = score_deprecated(meta)
  let size = score_size(meta)
  let activity = score_activity(meta)

  let w = weights
  let total = (freshness.to_double() * w["freshness"] +
               compliance.to_double() * w["compliance"] +
               deprecated.to_double() * w["deprecated"] +
               size.to_double() * w["size"] +
               activity.to_double() * w["activity"]).round().to_int()

  HealthScore::{
    node_id: node.id,
    total,
    freshness,
    compliance,
    deprecated_density: deprecated,
    size_reasonableness: size,
    activity,
  }
}

///|
/// 计算所有节点的健康分
fn compute_health_scores(graph : Graph, metas : Map[String, NodeMeta]) -> Array[HealthScore] {
  let scores : Array[HealthScore] = []
  for node in graph.nodes {
    let meta = match metas.get(node.id) {
      Some(m) => m
      None => empty_meta()
    }
    let mod = Module::{ name: node.name, version: node.version, license: None, deps: Map([]) }
    scores.push(compute_health_score(node, mod, meta))
  }
  scores
}

///|
/// 新鲜度评分（yanked 版本直接 0 分）
fn score_freshness(mod : Module, meta : NodeMeta) -> Int {
  if meta.yanked { return 0 }
  match meta.latest_version {
    None => 50
    Some(latest) => {
      if mod.version == latest { return 100 }
      match (parse_version(mod.version), parse_version(latest)) {
        (Some(cur), Some(lat)) => {
          if cur.0 < lat.0 { 20 }
          else if cur.1 < lat.1 {
            let gap = lat.1 - cur.1
            let score = 80 - gap * 15
            if score < 30 { 30 } else { score }
          } else { 90 }
        }
        _ => 70
      }
    }
  }
}

///|
/// 解析版本号：容忍 v/V 前缀、两段式（"1.0"）、预发布后缀（"1.0.0-alpha"）
/// 与 build 元数据（"0.1.20260920+7d59c7ec9"）。无法解析返回 None。
fn parse_version(v : String) -> (Int, Int, Int)? {
  let mut t = v.trim().to_owned()
  if t.has_prefix("v") || t.has_prefix("V") {
    t = t[1:].trim().to_owned()
  }
  // 截掉 pre-release / build metadata
  match t.find("-") {
    Some(i) => t = t[:i].trim().to_owned()
    None => ()
  }
  match t.find("+") {
    Some(i) => t = t[:i].trim().to_owned()
    None => ()
  }
  if t.is_empty() { return None }
  let parts = t.split(".").collect()
  if parts.length() == 0 || parts.length() > 3 { return None }
  let nums : Array[Int] = []
  for p in parts {
    match parse_uint(p) {
      Some(n) => nums.push(n)
      None => return None
    }
  }
  while nums.length() < 3 { nums.push(0) }
  Some((nums[0], nums[1], nums[2]))
}

///|
/// 版本三元组比较
fn version_compare(a : (Int, Int, Int), b : (Int, Int, Int)) -> Int {
  if a.0 != b.0 { a.0 - b.0 } else if a.1 != b.1 { a.1 - b.1 } else { a.2 - b.2 }
}

///|
/// 解析非负整数（严格数字校验，失败返回 None）
fn parse_uint(s : StringView) -> Int? {
  let t = s.trim()
  if t.is_empty() { return None }
  let mut n = 0
  for c in t {
    if !(c >= '0' && c <= '9') { return None }
    n = n * 10 + (c.to_int() - 48)
  }
  Some(n)
}

///|
/// 许可证合规评分：对 SPDX 表达式归一化后取分。
/// OR 表达式取最优分支，AND 表达式取最差分支（合规义务叠加）。
fn score_compliance(mod : Module, meta : NodeMeta) -> Int {
  let license = match meta.license {
    Some(l) => l
    None => match mod.license {
      Some(l) => l
      None => return 40
    }
  }
  license_expr_score(license)
}

///|
/// SPDX 许可证表达式评分
fn license_expr_score(expr : String) -> Int {
  let or_parts = split_license_or(expr)
  let mut best = 0
  for p in or_parts {
    let and_parts = split_license_and(p)
    let mut worst = 100
    for q in and_parts {
      let s = single_license_score(q)
      if s < worst { worst = s }
    }
    if worst > best { best = worst }
  }
  if best == 0 { 50 } else { best }
}

///|
/// OR 分支拆分（同时兼容 "MIT/Apache-2.0" 双许可证简写）
fn split_license_or(expr : String) -> Array[String] {
  let out : Array[String] = []
  for seg in expr.split("/") {
    for part in seg.split(" OR ") {
      out.push(clean_license_token(part))
    }
  }
  out
}

///|
/// AND 分支拆分
fn split_license_and(expr : String) -> Array[String] {
  let out : Array[String] = []
  for part in expr.split(" AND ") {
    out.push(clean_license_token(part))
  }
  out
}

///|
/// 去掉表达式 token 的括号与空白
fn clean_license_token(s : StringView) -> String {
  let mut c = s.trim().to_owned()
  while c.has_prefix("(") {
    c = c[1:].trim().to_owned()
  }
  while !c.is_empty() && c.has_suffix(")") {
    c = c[:c.length()-1].trim().to_owned()
  }
  c
}

///|
/// 许可证家族分类（输入已 upper 化，做子串匹配）。
/// 注意顺序：weak-copyleft 列表包含 LGPL，必须先于 strong-copyleft 的 "GPL" 子串判断。
fn license_family(upper : String) -> String {
  let permissive = ["MIT", "MIT-0", "APACHE", "ASL-2.0", "BSD", "ISC", "UNLICENSE", "ZLIB", "0BSD", "CC0", "WTFPL"]
  for p in permissive {
    if upper.contains(p) { return "permissive" }
  }
  let weak = ["LGPL", "MPL", "EPL", "EUPL", "CDDL", "CPL"]
  for w in weak {
    if upper.contains(w) { return "weak-copyleft" }
  }
  if upper.contains("GPL") || upper.contains("AGPL") { return "strong-copyleft" }
  if upper.contains("PROPRIETARY") || upper.contains("COMMERCIAL") || upper.contains("SSPL") { return "proprietary" }
  "unknown"
}

///|
/// 单个许可证评分（先 SPDX 规范化，再家族分级派生）
fn single_license_score(lic : String) -> Int {
  match license_family(normalize_license_token(lic).to_upper()) {
    "permissive" => 100
    "weak-copyleft" => 60
    "strong-copyleft" => 30
    "proprietary" => 40
    _ => 50
  }
}

///|
/// SPDX token 规范化：剥括号 → 去 WITH 异常子句 → 大写去空白 → 常见变体映射规范 SPDX id。
/// 未命中变体表时返回大写去空白的原 token（供 license_family 子串匹配兜底）。
fn normalize_license_token(s : StringView) -> String {
  let cleaned = clean_license_token(s)
  let upper_all = cleaned.to_upper()
  // WITH 异常子句（如 "Apache-2.0 WITH LLVM-exception"）：取主许可证
  let mut main = upper_all
  match upper_all.find(" WITH ") {
    Some(idx) => main = upper_all[:idx].trim().to_owned()
    None => ()
  }
  // 移除全部空白
  let buf = StringBuilder()
  for c in main {
    if c != ' ' && c != '\t' {
      buf.write_char(c)
    }
  }
  let key = buf.to_string()
  match variant_spdx_id(key) {
    Some(id) => id
    None => key
  }
}

///|
/// 常见非规范写法 → 规范 SPDX id（输入已 upper + 去全部空白，精确匹配）
fn variant_spdx_id(key : String) -> String? {
  match key {
    "APACHE"
    | "APACHE2"
    | "APACHE2.0"
    | "APACHE-2.0"
    | "APACHELICENSE"
    | "APACHELICENSE2"
    | "APACHELICENSE2.0"
    | "ASL2.0"
    | "ASL-2.0" => Some("Apache-2.0")
    "APACHE1.1" | "APACHE-1.1" | "APACHELICENSE1.1" => Some("Apache-1.1")
    "MIT" | "MITLICENSE" | "THEMITLICENSE" => Some("MIT")
    "MIT-0" | "MIT0" => Some("MIT-0")
    "BSD" | "BSD3" | "BSD-3" | "BSD3CLAUSE" | "BSD-3-CLAUSE" | "BSD3-CLAUSE" =>
      Some("BSD-3-Clause")
    "BSD2" | "BSD-2" | "BSD2CLAUSE" | "BSD-2-CLAUSE" | "BSD2-CLAUSE" =>
      Some("BSD-2-Clause")
    "GPL" | "GPL2" | "GPLV2" | "GPL2.0" | "GPL-2.0" | "GPL-2" | "GPLV2.0" =>
      Some("GPL-2.0")
    "GPL3" | "GPLV3" | "GPL3.0" | "GPL-3.0" | "GPL-3" | "GPLV3.0" => Some("GPL-3.0")
    "AGPL" | "AGPL3" | "AGPLV3" | "AGPL3.0" | "AGPL-3.0" | "AGPLV3.0" =>
      Some("AGPL-3.0")
    "LGPL" | "LGPL2" | "LGPLV2" | "LGPL2.1" | "LGPL-2.1" | "LGPLV2.1" =>
      Some("LGPL-2.1")
    "LGPL3" | "LGPLV3" | "LGPL3.0" | "LGPL-3.0" | "LGPLV3.0" => Some("LGPL-3.0")
    "MPL" | "MPL2" | "MPL2.0" | "MPL-2.0" => Some("MPL-2.0")
    "EPL" | "EPL2" | "EPL2.0" | "EPL-2.0" => Some("EPL-2.0")
    "EPL1" | "EPL1.0" | "EPL-1.0" => Some("EPL-1.0")
    "ISC" => Some("ISC")
    "WTFPL" => Some("WTFPL")
    "ZLIB" => Some("Zlib")
    "0BSD" => Some("0BSD")
    "CC0" | "CC01" | "CC01.0" | "CC0-1.0" => Some("CC0-1.0")
    "UNLICENSE" | "THEUNLICENSE" => Some("Unlicense")
    "SSPL" | "SSPL1.0" | "SSPL-1.0" => Some("SSPL-1.0")
    _ => None
  }
}

///|
/// 废弃 API 密度评分
fn score_deprecated(meta : NodeMeta) -> Int {
  let total = meta.total_api_count
  if total == 0 { return 100 }
  let ratio = meta.deprecated_apis.length().to_double() / total.to_double()
  let score = 100.0 - ratio * 500.0
  if score < 0.0 { 0 } else { score.round().to_int() }
}

///|
/// 大小评分
fn score_size(meta : NodeMeta) -> Int {
  let size = meta.self_size
  if size == 0 { 80 }
  else if size < 100_000 { 100 }
  else if size < 500_000 { 80 }
  else if size < 1_000_000 { 60 }
  else if size < 5_000_000 { 40 }
  else { 20 }
}

///|
/// 活跃度评分
fn score_activity(meta : NodeMeta) -> Int {
  match meta.last_commit_days_ago {
    None => 50
    Some(days) => {
      if days < 30 { 100 }
      else if days < 90 { 90 }
      else if days < 180 { 70 }
      else if days < 365 { 40 }
      else { 10 }
    }
  }
}
