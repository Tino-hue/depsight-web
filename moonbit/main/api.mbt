/// depsight WASM API —— 浏览器可调用的依赖健康分析入口。
///
/// # 调用契约（与 js/js-analyzer.js 完全一致）
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
///       "deprecated_apis": ["api1"]
///     }
///   },
///   "options": { "max_depth": 10 }
/// }
/// ```
///
/// 返回 JSON：overall_score / node_count / diagnostics / health_scores /
///           summary / graph / size_offenders_top5 / node_metas / ecosystem_stats
///
/// # 编译
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
  let size_offenders = compute_size_offenders(graph, metas)
  let stats = compute_ecosystem_stats(graph, health_scores, metas)
  assemble_result(graph, health_scores, diags, size_offenders, stats, metas)
}

///|
/// 版本号（JS 侧做兼容性检查）
#export_name("version")
pub fn version() -> String {
  "0.6.0-wasm"
}

// ========== 数据模型 ==========

///|
/// 解析后的模块（TOML 解析过程需要逐个字段回填，故为 mut）
priv struct Module {
  mut name : String
  mut version : String
  mut license : String?
  deps : Map[String, String]   // name -> version
}

///|
/// 图节点
priv struct Node {
  id : String
  name : String
  version : String
  depth : Int
}

///|
/// 图边
priv struct Edge {
  from : String
  to : String
}

///|
/// 依赖图
priv struct Graph {
  root_id : String
  nodes : Array[Node]
  edges : Array[Edge]
}

///|
/// 节点元数据
priv struct NodeMeta {
  license : String?
  latest_version : String?
  last_commit_days_ago : Int?
  self_size : Int
  total_api_count : Int
  deprecated_apis : Array[String]
}

///|
/// 健康分
priv struct HealthScore {
  node_id : String
  total : Int
  freshness : Int
  compliance : Int
  deprecated_density : Int
  size_reasonableness : Int
  activity : Int
}

///|
/// 诊断
priv struct Diagnostic {
  code : String
  severity : String  // "critical" / "warning" / "info"
  node_id : String
  message : String
}

///|
/// 生态统计
priv struct EcosystemStats {
  total_packages : Int
  direct_dependencies : Int
  max_depth : Int
  total_size_bytes : Int
  total_deprecated_apis : Int
  unique_licenses : Int
  avg_health_score : Int
}

// ========== 常量 ==========

let weights : Map[String, Double] = Map([
  ("freshness", 0.25),
  ("compliance", 0.20),
  ("deprecated", 0.25),
  ("size", 0.20),
  ("activity", 0.10),
])

// ========== moon.mod 解析 ==========

///|
/// 解析 moon.mod（TOML 简化）或 moon.mod.json
fn parse_mod_text(text : String) -> Result[Module, String] {
  let trimmed = text.trim().to_owned()
  if trimmed.has_prefix("{") {
    parse_mod_json(trimmed)
  } else {
    parse_mod_toml(trimmed)
  }
}

///|
/// 解析 moon.mod.json
fn parse_mod_json(text : String) -> Result[Module, String] {
  let json = @json.parse(text) catch { _ => return Err("Invalid JSON in moon.mod.json") }
  guard json is Object(obj) else { return Err("Expected JSON object in moon.mod.json") }

  let name = match obj.get("name") {
    Some(String(s)) => s
    _ => "unknown"
  }
  let version = match obj.get("version") {
    Some(String(s)) => s
    _ => "0.0.0"
  }
  let license = match obj.get("license") {
    Some(String(s)) => Some(s)
    _ => None
  }
  let deps : Map[String, String] = Map([])
  match obj.get("deps") {
    Some(Object(d)) => {
      for pair in d {
        let (k, v) = pair
        guard v is String(ver) else { continue }
        let (dep_name, _) = split_dep_name(k)
        deps[dep_name] = ver
      }
    }
    _ => ()
  }

  Ok(Module::{ name, version, license, deps })
}

///|
/// 解析 moon.mod（TOML 简化语法）
fn parse_mod_toml(text : String) -> Result[Module, String] {
  let result = Module::{ name: "unknown", version: "0.0.0", license: None, deps: Map([]) }
  let mut in_import = false

  for raw in text.split("\n") {
    let mut line = raw.trim().to_owned()
    // 去注释
    match line.find("#") {
      Some(idx) => line = line[:idx].trim().to_owned()
      None => ()
    }
    if line.is_empty() { continue }

    if line.has_prefix("name") && line.contains("=") {
      result.name = strip_quotes(toml_value(line))
    } else if line.has_prefix("version") && line.contains("=") {
      result.version = strip_quotes(toml_value(line))
    } else if line.has_prefix("license") && line.contains("=") {
      result.license = Some(strip_quotes(toml_value(line)))
    } else if line.has_prefix("import") {
      in_import = true
      // 单行：import { "x@1.0" }
      match extract_brace_content(line) {
        Some(content) => {
          add_imports(result.deps, content)
          in_import = false
        }
        None => ()
      }
    } else if in_import && line.contains("\"") {
      // 多行 import 里的字符串
      match extract_quoted(line) {
        Some(dep_str) => {
          let (n, v) = split_dep_name(dep_str)
          result.deps[n] = v
        }
        None => ()
      }
      if line.contains("}") { in_import = false }
    }
  }

  Ok(result)
}

///|
/// 取 `key = value` 中 `=` 右侧原文
fn toml_value(line : String) -> String {
  match line.find("=") {
    Some(eq) => line[eq+1:].trim().to_owned()
    None => ""
  }
}

///|
/// 从 "pkg@1.0" 拆分（@ 取最后一个，兼容 scope 名）
fn split_dep_name(s : String) -> (String, String) {
  match s.rev_find("@") {
    Some(at) if at > 0 => (s[:at].to_owned(), s[at+1:].to_owned())
    _ => (s, "latest")
  }
}

///|
/// 去掉首尾引号
fn strip_quotes(s : String) -> String {
  let t = s.trim().to_owned()
  if t.has_prefix("\"") && t.has_suffix("\"") && t.length() >= 2 {
    t[1:t.length()-1].to_owned()
  } else if t.has_prefix("'") && t.has_suffix("'") && t.length() >= 2 {
    t[1:t.length()-1].to_owned()
  } else {
    t
  }
}

///|
/// 提取 { ... } 中的内容
fn extract_brace_content(line : String) -> String? {
  match line.find("{") {
    Some(start) =>
      match line.rev_find("}") {
        Some(end) if end > start =>
          Some(line[start+1:end].to_owned())
        _ => None
      }
    None => None
  }
}

///|
/// 提取 "..." 中的内容（第一个引号到最后一个引号之间）
fn extract_quoted(line : String) -> String? {
  match line.find("\"") {
    Some(start) =>
      match line.rev_find("\"") {
        Some(end) if end > start =>
          Some(line[start+1:end].to_owned())
        _ => None
      }
    None => None
  }
}

///|
/// 把 "pkg@1.0", "pkg2" 加入 deps
fn add_imports(deps : Map[String, String], content : String) -> Unit {
  // 简化：按逗号分割，再分别提取
  let parts = content.split(",")
  for part in parts {
    match extract_quoted(part.trim().to_owned()) {
      Some(s) => {
        let (n, v) = split_dep_name(s)
        deps[n] = v
      }
      None => ()
    }
  }
}

// ========== 图构建 ==========

///|
/// BFS 构建完整依赖图
fn build_graph(root : Module, modules : Map[String, String], max_depth : Int) -> Graph {
  let nodes : Array[Node] = []
  let edges : Array[Edge] = []
  let node_map : Map[String, Node] = Map([])
  let visited : Map[String, Bool] = Map([])

  fn make_id(name : String, version : String) -> String {
    name + "@" + version
  }

  fn add_node(name : String, version : String, depth : Int) -> String {
    let id = make_id(name, version)
    if !node_map.contains(id) {
      let node = Node::{ id, name, version, depth }
      node_map[id] = node
      nodes.push(node)
    }
    id
  }

  fn add_edge(from : String, to : String) -> Unit {
    edges.push(Edge::{ from, to })
  }

  fn resolve_module(name : String, version : String) -> Module? {
    if name == root.name { return Some(root) }
    let key = make_id(name, version)
    match modules.get(key) {
      Some(content) =>
        match parse_mod_text(content) {
          Ok(m) => Some(m)
          Err(_) => None
        }
      None => None
    }
  }

  let root_id = add_node(root.name, root.version, 0)
  visited[root_id] = true

  // BFS 队列（用 Array 模拟）
  let queue : Array[(String, String, Int)] = [(root.name, root.version, 0)]
  let mut head = 0
  while head < queue.length() {
    let (cur_name, cur_ver, cur_depth) = queue[head]
    head = head + 1
    if cur_depth >= max_depth { continue }

    let cur_id = make_id(cur_name, cur_ver)
    match resolve_module(cur_name, cur_ver) {
      Some(mod) => {
        for pair in mod.deps {
          let (dep_name, dep_ver) = pair
          let dep_id = add_node(dep_name, dep_ver, cur_depth + 1)
          add_edge(cur_id, dep_id)
          if !visited.contains(dep_id) {
            visited[dep_id] = true
            queue.push((dep_name, dep_ver, cur_depth + 1))
          }
        }
      }
      None => ()
    }
  }

  Graph::{ root_id, nodes, edges }
}

///|
/// 仅构建根节点的浅图（root + 直接依赖，不递归）
fn build_shallow_graph(root : Module) -> Graph {
  let nodes : Array[Node] = []
  let edges : Array[Edge] = []
  let node_map : Map[String, Node] = Map([])

  fn make_id(name : String, version : String) -> String {
    name + "@" + version
  }

  let root_id = make_id(root.name, root.version)
  let root_node = Node::{ id: root_id, name: root.name, version: root.version, depth: 0 }
  nodes.push(root_node)
  node_map[root_id] = root_node

  for pair in root.deps {
    let (dep_name, dep_ver) = pair
    let dep_id = make_id(dep_name, dep_ver)
    let dep_node = Node::{ id: dep_id, name: dep_name, version: dep_ver, depth: 1 }
    nodes.push(dep_node)
    node_map[dep_id] = dep_node
    edges.push(Edge::{ from: root_id, to: dep_id })
  }

  Graph::{ root_id, nodes, edges }
}

// ========== NodeMeta 构建 ==========

///|
/// 从 context.metadata 构造 NodeMeta
fn build_node_metas(graph : Graph, root : Module, metadata : Map[String, Json]) -> Map[String, NodeMeta] {
  let metas : Map[String, NodeMeta] = Map([])

  for node in graph.nodes {
    let meta = match metadata.get(node.id) {
      Some(Json::Object(obj)) => parse_node_meta(obj)
      _ => NodeMeta::{
        license: if node.id == graph.root_id { root.license } else { None },
        latest_version: None,
        last_commit_days_ago: None,
        self_size: 0,
        total_api_count: 0,
        deprecated_apis: [],
      }
    }
    metas[node.id] = meta
  }

  // root 节点即使 metadata 缺失，也填 license
  if metas.contains(graph.root_id) {
    let existing = metas[graph.root_id]
    if existing.license is None {
      metas[graph.root_id] = NodeMeta::{
        license: root.license,
        latest_version: existing.latest_version,
        last_commit_days_ago: existing.last_commit_days_ago,
        self_size: existing.self_size,
        total_api_count: existing.total_api_count,
        deprecated_apis: existing.deprecated_apis,
      }
    }
  }

  metas
}

///|
/// 浅图场景的 metas（仅 root 有 license）
fn build_shallow_metas(graph : Graph, root : Module) -> Map[String, NodeMeta] {
  let metas : Map[String, NodeMeta] = Map([])
  for node in graph.nodes {
    if node.id == graph.root_id {
      metas[node.id] = NodeMeta::{
        license: root.license,
        latest_version: None,
        last_commit_days_ago: None,
        self_size: 0,
        total_api_count: 0,
        deprecated_apis: [],
      }
    } else {
      metas[node.id] = NodeMeta::{
        license: None,
        latest_version: None,
        last_commit_days_ago: None,
        self_size: 0,
        total_api_count: 0,
        deprecated_apis: [],
      }
    }
  }
  metas
}

///|
/// 从 JSON Object 解析 NodeMeta
fn parse_node_meta(obj : Map[String, Json]) -> NodeMeta {
  let license = match obj.get("license") {
    Some(Json::String(s)) => Some(s)
    _ => None
  }
  let latest_version = match obj.get("latest_version") {
    Some(Json::String(s)) => Some(s)
    _ => None
  }
  let last_commit_days_ago = match obj.get("last_commit_days_ago") {
    Some(Json::Number(n, ..)) => Some(n.to_int())
    _ => None
  }
  let self_size = match obj.get("self_size") {
    Some(Json::Number(n, ..)) => n.to_int()
    _ => 0
  }
  let total_api_count = match obj.get("total_api_count") {
    Some(Json::Number(n, ..)) => n.to_int()
    _ => 0
  }
  let deprecated_apis : Array[String] = []
  match obj.get("deprecated_apis") {
    Some(Json::Array(arr)) => {
      for item in arr {
        guard item is String(s) else { continue }
        deprecated_apis.push(s)
      }
    }
    _ => ()
  }

  NodeMeta::{ license, latest_version, last_commit_days_ago, self_size, total_api_count, deprecated_apis }
}

// ========== 健康评分 ==========

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
/// 新鲜度评分
fn score_freshness(mod : Module, meta : NodeMeta) -> Int {
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
/// 解析 "x.y.z"
fn parse_version(v : String) -> (Int, Int, Int)? {
  let parts = v.split(".").collect()
  if parts.length() < 3 { return None }
  let a = match parse_uint(parts[0]) {
    Some(x) => x
    None => return None
  }
  let b = match parse_uint(parts[1]) {
    Some(x) => x
    None => return None
  }
  let c = match parse_uint(parts[2]) {
    Some(x) => x
    None => return None
  }
  Some((a, b, c))
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
/// 许可证合规评分
fn score_compliance(mod : Module, meta : NodeMeta) -> Int {
  let license = match meta.license {
    Some(l) => l
    None => match mod.license {
      Some(l) => l
      None => return 40
    }
  }
  let upper = license.to_upper()
  let ok = ["MIT", "APACHE-2.0", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "ISC", "UNLICENSE", "ZLIB"]
  for l in ok {
    if upper.contains(l) { return 100 }
  }
  if upper.contains("GPL") || upper.contains("AGPL") || upper.contains("LGPL") { 30 }
  else if upper.contains("MPL") { 60 }
  else { 50 }
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

///|
/// 计算所有节点的健康分
fn compute_health_scores(graph : Graph, metas : Map[String, NodeMeta]) -> Array[HealthScore] {
  let scores : Array[HealthScore] = []
  for node in graph.nodes {
    let meta = match metas.get(node.id) {
      Some(m) => m
      None => NodeMeta::{ license: None, latest_version: None, last_commit_days_ago: None, self_size: 0, total_api_count: 0, deprecated_apis: [] }
    }
    let mod = Module::{ name: node.name, version: node.version, license: None, deps: Map([]) }
    scores.push(compute_health_score(node, mod, meta))
  }
  scores
}

// ========== 诊断 ==========

///|
/// 生成诊断列表
fn run_diagnostics(graph : Graph, metas : Map[String, NodeMeta]) -> Array[Diagnostic] {
  let diags : Array[Diagnostic] = []

  for node in graph.nodes {
    let meta = match metas.get(node.id) {
      Some(m) => m
      None => NodeMeta::{ license: None, latest_version: None, last_commit_days_ago: None, self_size: 0, total_api_count: 0, deprecated_apis: [] }
    }
    let mod_license = meta.license

    // OUTDATED-001
    match meta.latest_version {
      Some(latest) => {
        if node.version != latest {
          diags.push(Diagnostic::{
            code: "OUTDATED-001",
            severity: "warning",
            node_id: node.id,
            message: node.name + " 当前 v" + node.version + "，最新 " + latest + "，建议升级",
          })
        }
      }
      None => ()
    }

    // LICENSE-001 / LICENSE-002
    match mod_license {
      None => {
        diags.push(Diagnostic::{
          code: "LICENSE-001",
          severity: "info",
          node_id: node.id,
          message: node.name + " 未声明许可证，商业使用存在风险",
        })
      }
      Some(lic) => {
        let upper = lic.to_upper()
        if upper.contains("GPL") || upper.contains("AGPL") || upper.contains("LGPL") {
          diags.push(Diagnostic::{
            code: "LICENSE-002",
            severity: "warning",
            node_id: node.id,
            message: node.name + " 使用 " + lic + "，需注意 copyleft 传染性",
          })
        }
      }
    }

    // DEPRECATED-001
    let dep_count = meta.deprecated_apis.length()
    if dep_count > 0 {
      diags.push(Diagnostic::{
        code: "DEPRECATED-001",
        severity: "info",
        node_id: node.id,
        message: node.name + " 含 " + dep_count.to_string() + " 个废弃 API",
      })
    }

    // SIZE-001
    if meta.self_size > 1_000_000 {
      diags.push(Diagnostic::{
        code: "SIZE-001",
        severity: "warning",
        node_id: node.id,
        message: node.name + " 体积 " + fmt_bytes(meta.self_size) + "，考虑精简",
      })
    }

    // ACTIVITY-001 / ACTIVITY-002
    match meta.last_commit_days_ago {
      Some(days) => {
        if days > 365 {
          diags.push(Diagnostic::{
            code: "ACTIVITY-001",
            severity: "critical",
            node_id: node.id,
            message: node.name + " 已 " + days.to_string() + " 天未更新，可能已停止维护",
          })
        } else if days > 180 {
          diags.push(Diagnostic::{
            code: "ACTIVITY-002",
            severity: "info",
            node_id: node.id,
            message: node.name + " 最近更新在 " + days.to_string() + " 天前",
          })
        }
      }
      None => ()
    }
  }

  diags
}

// ========== 体积计算 ==========

///|
/// 计算传递体积
fn compute_transitive_sizes(graph : Graph, metas : Map[String, NodeMeta]) -> Array[(String, Int, Int)] {
  // 邻接表：parent -> children
  let children_map : Map[String, Array[String]] = Map([])
  for edge in graph.edges {
    if !children_map.contains(edge.from) {
      children_map[edge.from] = []
    }
    children_map[edge.from].push(edge.to)
  }

  // 反向邻接：child -> parents（用于反向遍历）
  let parents_map : Map[String, Array[String]] = Map([])
  for edge in graph.edges {
    if !parents_map.contains(edge.to) {
      parents_map[edge.to] = []
    }
    parents_map[edge.to].push(edge.from)
  }

  let memo : Map[String, Int] = Map([])

  fn transitive_size(id : String) -> Int {
    if memo.contains(id) { return memo[id] }
    let self_size = match metas.get(id) {
      Some(m) => m.self_size
      None => 0
    }
    let mut total = self_size
    let visited : Map[String, Bool] = Map([])
    visited[id] = true
    let queue : Array[String] = match children_map.get(id) {
      Some(children) => children
      None => []
    }
    let mut head = 0
    while head < queue.length() {
      let cur = queue[head]
      head = head + 1
      if visited.contains(cur) { continue }
      visited[cur] = true
      total = total + (match metas.get(cur) {
        Some(m) => m.self_size
        None => 0
      })
      match children_map.get(cur) {
        Some(children) => {
          for c in children {
            queue.push(c)
          }
        }
        None => ()
      }
    }
    memo[id] = total
    total
  }

  let result : Array[(String, Int, Int)] = []
  for node in graph.nodes {
    let self_size = match metas.get(node.id) {
      Some(m) => m.self_size
      None => 0
    }
    result.push((node.id, self_size, transitive_size(node.id)))
  }

  // 按传递体积降序
  result.sort_by(fn(a, b) { b.2 - a.2 })
  result
}

///|
/// 取 top 5 体积包
fn compute_size_offenders(graph : Graph, metas : Map[String, NodeMeta]) -> Array[(String, Int, Int)] {
  let all = compute_transitive_sizes(graph, metas)
  let top : Array[(String, Int, Int)] = []
  let mut i = 0
  while i < all.length() && i < 5 {
    top.push(all[i])
    i = i + 1
  }
  top
}

// ========== 生态统计 ==========

///|
/// 计算生态统计
fn compute_ecosystem_stats(
  graph : Graph,
  health_scores : Array[HealthScore],
  metas : Map[String, NodeMeta],
) -> EcosystemStats {
  let root_id = graph.root_id
  let direct_deps = graph.edges.filter(fn(e) { e.from == root_id }).length()

  let unique_licenses : Map[String, Bool] = Map([])
  let mut total_size = 0
  let mut total_deprecated = 0
  let mut max_depth = 0

  for node in graph.nodes {
    if node.depth > max_depth { max_depth = node.depth }
    match metas.get(node.id) {
      Some(m) => {
        match m.license {
          Some(l) => unique_licenses[l] = true
          None => ()
        }
        total_size = total_size + m.self_size
        total_deprecated = total_deprecated + m.deprecated_apis.length()
      }
      None => ()
    }
  }

  let avg_health = if health_scores.length() > 0 {
    let sum = health_scores.fold(init=0, fn(acc, s) { acc + s.total })
    sum / health_scores.length()
  } else { 0 }

  EcosystemStats::{
    total_packages: graph.nodes.length(),
    direct_dependencies: direct_deps,
    max_depth,
    total_size_bytes: total_size,
    total_deprecated_apis: total_deprecated,
    unique_licenses: unique_licenses.length(),
    avg_health_score: avg_health,
  }
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

  // 10. 体积
  let size_offenders = compute_size_offenders(graph, metas)

  // 11. 生态统计
  let stats = compute_ecosystem_stats(graph, health_scores, metas)

  // 12. 序列化
  Ok(assemble_result(graph, health_scores, diags, size_offenders, stats, metas))
}

// ========== 序列化 ==========

///|
/// 序列化完整结果为 JSON
fn assemble_result(
  graph : Graph,
  health_scores : Array[HealthScore],
  diags : Array[Diagnostic],
  size_offenders : Array[(String, Int, Int)],
  stats : EcosystemStats,
  metas : Map[String, NodeMeta],
) -> String {
  let buf = StringBuilder()

  buf.write_string("{\"overall_score\":")
  let sum = health_scores.fold(init=0, fn(acc, s) { acc + s.total })
  let overall = if health_scores.length() > 0 { sum / health_scores.length() } else { 0 }
  buf.write_string(overall.to_string())
  buf.write_string(",\"node_count\":")
  buf.write_string(graph.nodes.length().to_string())

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
  buf.write_string("}")
  buf.to_string()
}

// ========== 工具函数 ==========

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

// ========== Bytes ABI 辅助（JS 侧用 Uint8Array 传递） ==========

///|
/// Bytes -> String（UTF-8 解码，逐字节构建）
fn bytes_to_string(b : Bytes) -> String {
  let len = b.length()
  let buf = StringBuilder()
  let mut i = 0
  while i < len {
    let byte = b[i].to_int()
    if byte < 0x80 {
      // ASCII 单字节
      buf.write_char(byte.unsafe_to_char())
      i = i + 1
    } else if byte < 0xE0 {
      // 2 字节 UTF-8
      if i + 1 < len {
        let b1 = b[i + 1].to_int()
        let code = ((byte & 0x1F) << 6) | (b1 & 0x3F)
        buf.write_char(code.unsafe_to_char())
        i = i + 2
      } else {
        i = i + 1
      }
    } else if byte < 0xF0 {
      // 3 字节 UTF-8
      if i + 2 < len {
        let b1 = b[i + 1].to_int()
        let b2 = b[i + 2].to_int()
        let code = ((byte & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F)
        buf.write_char(code.unsafe_to_char())
        i = i + 3
      } else {
        i = i + 1
      }
    } else {
      // 4 字节 UTF-8
      if i + 3 < len {
        let b1 = b[i + 1].to_int()
        let b2 = b[i + 2].to_int()
        let b3 = b[i + 3].to_int()
        let code = ((byte & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F)
        buf.write_char(code.unsafe_to_char())
        i = i + 4
      } else {
        i = i + 1
      }
    }
  }
  buf.to_string()
}

///|
/// Int -> Byte（截断到低 8 位）
fn int_to_byte(n : Int) -> Byte {
  // 通过 FixedArray[Byte] 构造
  let arr : FixedArray[Byte] = FixedArray::make(1, b'\x00')
  // 用 unsafe cast via Int -> Byte
  arr[0] = (n & 0xFF).to_byte()
  arr[0]
}

///|
/// String -> Bytes（UTF-8 编码）
fn string_to_bytes(s : String) -> Bytes {
  let mut total = 0
  // 先计算 UTF-8 字节数
  for c in s {
    let code = c.to_int()
    if code < 0x80 {
      total = total + 1
    } else if code < 0x800 {
      total = total + 2
    } else if code < 0x10000 {
      total = total + 3
    } else {
      total = total + 4
    }
  }
  // 填充字节
  let buf = FixedArray::make(total, b'\x00')
  let mut pos = 0
  for c in s {
    let code = c.to_int()
    if code < 0x80 {
      buf[pos] = int_to_byte(code)
      pos = pos + 1
    } else if code < 0x800 {
      buf[pos] = int_to_byte(0xC0 | (code >> 6))
      buf[pos + 1] = int_to_byte(0x80 | (code & 0x3F))
      pos = pos + 2
    } else if code < 0x10000 {
      buf[pos] = int_to_byte(0xE0 | (code >> 12))
      buf[pos + 1] = int_to_byte(0x80 | ((code >> 6) & 0x3F))
      buf[pos + 2] = int_to_byte(0x80 | (code & 0x3F))
      pos = pos + 3
    } else {
      buf[pos] = int_to_byte(0xF0 | (code >> 18))
      buf[pos + 1] = int_to_byte(0x80 | ((code >> 12) & 0x3F))
      buf[pos + 2] = int_to_byte(0x80 | ((code >> 6) & 0x3F))
      buf[pos + 3] = int_to_byte(0x80 | (code & 0x3F))
      pos = pos + 4
    }
  }
  Bytes::from_array(buf)
}

///|
/// 主入口（Bytes 版）：从完整上下文运行分析，返回 JSON 的 UTF-8 字节。
#export_name("analyze_from_context_json_bytes")
pub fn analyze_from_context_json_bytes(context_json : Bytes) -> Bytes {
  let input = bytes_to_string(context_json)
  let output = match run_analysis(input) {
    Ok(json) => json
    Err(msg) => make_error_json(msg)
  }
  string_to_bytes(output)
}

///|
/// 便捷入口（Bytes 版）：仅分析单个 moon.mod / moon.mod.json。
#export_name("analyze_from_mod_text_bytes")
pub fn analyze_from_mod_text_bytes(mod_text : Bytes) -> Bytes {
  let input = bytes_to_string(mod_text)
  let output = match parse_mod_text(input) {
    Ok(root) => {
      let graph = build_shallow_graph(root)
      let metas = build_shallow_metas(graph, root)
      let health_scores = compute_health_scores(graph, metas)
      let diags = run_diagnostics(graph, metas)
      let size_offenders = compute_size_offenders(graph, metas)
      let stats = compute_ecosystem_stats(graph, health_scores, metas)
      assemble_result(graph, health_scores, diags, size_offenders, stats, metas)
    }
    Err(msg) => make_error_json(msg)
  }
  string_to_bytes(output)
}

///|
/// 版本号（Bytes 版）
#export_name("version_bytes")
pub fn version_bytes() -> Bytes {
  string_to_bytes("0.6.0-wasm")
}
