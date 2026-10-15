///| 健康评分（五维加权）与许可证 SPDX 归一化。

///|
/// 计算单个节点的健康分
fn compute_health_score(node : Node, mod : Module, meta : NodeMeta) -> HealthScore {
  let freshness = score_freshness(mod, meta)
  let compliance = score_compliance(meta)
  let deprecated = score_deprecated(meta)
  let size = score_size(meta)
  let activity = score_activity(meta)

  let w = weights
  let raw_total = (freshness.to_double() * w["freshness"] +
               compliance.to_double() * w["compliance"] +
               deprecated.to_double() * w["deprecated"] +
               size.to_double() * w["size"] +
               activity.to_double() * w["activity"]).round().to_int()
  // 入户口径统一钳制 min(100, max(0,…))：坏数据下总分稳定落在 [0,100]（S11）
  let total = if raw_total > 100 { 100 } else if raw_total < 0 { 0 } else { raw_total }

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
            // gap 饱和到 4：4×15=60 无溢出风险，且各档位与旧行为一致（gap=4 时 80-60=20→钳 30）
            let mut gap = lat.1 - cur.1
            if gap > 4 { gap = 4 }
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
/// 解析非负整数（严格数字校验，失败返回 None；溢出返回 None，防 wrap-around 污染评分）
fn parse_uint(s : StringView) -> Int? {
  let t = s.trim()
  if t.is_empty() { return None }
  let mut n = 0
  for c in t {
    if !(c >= '0' && c <= '9') { return None }
    // n > (max-9)/10 时 n*10+9 必溢出（Int 为 31 位）
    if n > (@int.MAX_VALUE - 9) / 10 { return None }
    n = n * 10 + (c.to_int() - 48)
  }
  Some(n)
}

///|
/// 许可证合规评分：对 SPDX 表达式归一化后取分。
/// OR 表达式取最优分支，AND 表达式取最差分支（合规义务叠加）。
/// 只认 meta.license（root 的 license 已由 build_node_metas 回填进 meta，mod.license 兜底不可达），
/// 故不再接收 mod 参数（P3-M ① 死代码清理）
fn score_compliance(meta : NodeMeta) -> Int {
  let license = match meta.license {
    Some(l) => l
    None => return 40
  }
  license_expr_score(license)
}

///|
/// SPDX 许可证表达式评分：大小写不敏感 + 括号递归解析。
/// 括号平衡 → 自顶向下按 OR / AND 切分（括号块作整体 token）；
/// 不平衡/无连接词 → 保守 fallback 为单个 token（clean_license_token 剥括号），
/// 无法解析的表达式计 50（unknown 中位分）。与 JS licenseExprScore 一致。
fn license_expr_score(expr : String) -> Int {
  license_expr_score_inner(expr.trim().view())
}

fn license_expr_score_inner(v : StringView) -> Int {
  let t0 = v.trim()
  if t0.is_empty() { return 50 }
  // 整体被括号包裹时先剥外层（如 "(MIT OR Apache-2.0)"），内层连接词才能升到顶层拆分
  let t = strip_outer_parens(t0)
  // 括号不平衡 → 保守 fallback 为单个 token
  if !license_paren_balanced(t) { return single_license_score(clean_license_token(t)) }

  // 自顶向下按 OR 拆分（括号保护），首个 OR 命中即递归
  match split_license_top(t, "or") {
    Some(or_parts) => {
      let mut best = 0
      for p in or_parts {
        let s = license_and_score(p.view())
        if s > best { best = s }
      }
      best
    }
    None => license_and_score(t)
  }
}

/// AND 组合：取各分支最差（合规义务叠加）
fn license_and_score(v : StringView) -> Int {
  let t = v.trim()
  match split_license_top(t, "and") {
    Some(and_parts) => {
      let mut worst = 100
      for p in and_parts {
        let s = license_expr_score_inner(p.view())
        if s < worst { worst = s }
      }
      worst
    }
    None => single_license_score(clean_license_token(t))
  }
}

///|
/// 剥掉整体包裹的最外层括号对：仅当首个 '(' 的配对 ')' 之后只剩空白才算整体包裹
///（如 "(MIT OR Apache-2.0)" → "MIT OR Apache-2.0"；"((a))" 循环剥至 "a"）。
/// 配对失败或后面还有内容则原样返回。
fn strip_outer_parens(v : StringView) -> StringView {
  let mut t = v.trim()
  while t.has_prefix("(") {
    let n = t.length()
    let mut depth = 0
    let mut close = -1
    let mut i = 0
    while i < n {
      let c : Char = t[i].unsafe_to_char()
      if c == '(' {
        depth = depth + 1
      } else if c == ')' {
        depth = depth - 1
        if depth == 0 {
          close = i
          break
        }
      }
      i = i + 1
    }
    if close < 0 { break }
    // 配对 ')' 后必须只剩空白，否则不是整体包裹（如 "(a) (b)"）
    if t[close+1:].trim().is_empty() {
      t = t[1:close].trim()
    } else {
      break
    }
  }
  t
}

///|
/// 括号平衡检查
fn license_paren_balanced(v : StringView) -> Bool {
  let mut depth = 0
  for c in v {
    if c == '(' { depth = depth + 1 } else if c == ')' {
      depth = depth - 1
      if depth < 0 { return false }
    }
  }
  depth == 0
}

///|
/// 自顶向下按连接词拆分（跳过括号内部，大小写不敏感，操作数含空白才算连接词）。
/// 返回 None 表示无该连接词。兼容 "MIT/Apache-2.0" 双许可证简写（视作 OR）。
fn split_license_top(v : StringView, conn : String) -> Array[String]? {
  let s = v.trim()
  let parts : Array[String] = []
  let mut cur = StringBuilder()
  let mut depth = 0
  let mut i = 0
  let n = s.length()
  while i < n {
    let c : Char = s[i].unsafe_to_char()
    if c == '(' {
      depth = depth + 1
      cur.write_char('(')
      i = i + 1
    } else if c == ')' {
      depth = depth - 1
      cur.write_char(')')
      i = i + 1
    } else if depth == 0 {
      // 尝试匹配连接词（小写比较）
      let is_conn = license_match_conn(s, i, conn)
      if is_conn {
        // 兼容双许可证简写：以 '/' 结尾的 token 视作 OR 分支，按 '/' 再切
        parts.push(cur.to_string())
        cur = StringBuilder()
        i = i + conn.length()
      } else {
        cur.write_char(c)
        i = i + 1
      }
    } else {
      cur.write_char(c)
      i = i + 1
    }
  }
  if parts.length() == 0 { return None }
  // 末尾操作数
  parts.push(cur.to_string())
  // 兼容 "MIT/Apache-2.0" 双许可证简写：以 '/' 结尾的 token 视作 OR 分支
  if conn == "or" {
    let expanded : Array[String] = []
    for p in parts {
      for seg in p.split("/") {
        expanded.push(seg.trim().to_owned())
      }
    }
    return Some(expanded)
  }
  Some(parts)
}

///|
/// 在 s 的 i 位置尝试匹配小写连接词 conn（前后需为操作数边界：前为空白/起始，后为空白）。
/// 返回匹配长度（0 表示不匹配）。
fn license_match_conn(s : StringView, i : Int, conn : String) -> Bool {
  let clen = conn.length()
  if i + clen > s.length() { return false }
  // 前缀必须为空格或起始，避免 "andromeda"/"andr" 误判
  if i > 0 {
    let prev = s[i - 1].unsafe_to_char()
    if prev != ' ' && prev != '\t' { return false }
  }
  // 逐字符小写比较（| 与 != 优先级歧义，显式加括号）
  for k in 0..<clen {
    let sc = s[i + k].unsafe_to_char()
    let cc = conn[k].unsafe_to_char()
    if (sc.to_int() | 0x20) != cc.to_int() { return false }
  }
  // 后缀必须为空白（连接词后须跟操作数）
  let after = i + clen
  if after >= s.length() { return false }
  let next = s[after].unsafe_to_char()
  next == ' ' || next == '\t'
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
/// 入口先判 proprietary：UNLICENSED/PROPRIETARY/COMMERCIAL/SSPL 必须在 permissive 的
/// "UNLICENSE" 子串之前拦截，否则 UNLICENSED 会被误判 permissive（S10）。
/// 注意顺序：weak-copyleft 列表包含 LGPL，必须先于 strong-copyleft 的 "GPL" 子串判断。
fn license_family(upper : String) -> String {
  if upper.contains("UNLICENSED") ||
    upper.contains("PROPRIETARY") ||
    upper.contains("COMMERCIAL") ||
    upper.contains("SSPL") {
    return "proprietary"
  }
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
  else if size < size_warn_threshold_bytes { 40 }
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
