///| NodeMeta 构建（从 context.metadata JSON 回填）。

///|
/// 无元数据时的默认值统一走 empty_meta()（model.mbt），
/// 带 root license 的场景用 with_license 在默认 meta 上回填，避免 3 处手写重复。
fn with_license(root : Module) -> NodeMeta {
  NodeMeta::{
    license: root.license,
    license_source: if root.license is Some(_) { Some("mod_text") } else { None },
    latest_version: None,
    last_commit_days_ago: None,
    self_size: 0,
    total_api_count: 0,
    deprecated_apis: [],
    yanked: false,
    yanked_reason: None,
    source_unavailable: false,
  }
}

///|
/// 从 context.metadata 构造 NodeMeta
fn build_node_metas(graph : Graph, root : Module, metadata : Map[String, Json]) -> Map[String, NodeMeta] {
  let metas : Map[String, NodeMeta] = Map([])

  for node in graph.nodes {
    let meta = match metadata.get(node.id) {
      Some(Json::Object(obj)) => parse_node_meta(obj)
      _ => if node.id == graph.root_id { with_license(root) } else { empty_meta() }
    }
    metas[node.id] = meta
  }

  // root 节点即使 metadata 缺失，也回填 mod 文本里的 license
  if metas.contains(graph.root_id) {
    let existing = metas[graph.root_id]
    if existing.license is None && root.license is Some(_) {
      metas[graph.root_id] = NodeMeta::{
        license: root.license,
        license_source: Some("mod_text"),
        latest_version: existing.latest_version,
        last_commit_days_ago: existing.last_commit_days_ago,
        self_size: existing.self_size,
        total_api_count: existing.total_api_count,
        deprecated_apis: existing.deprecated_apis,
        yanked: existing.yanked,
        yanked_reason: existing.yanked_reason,
        source_unavailable: existing.source_unavailable,
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
      metas[node.id] = with_license(root)
    } else {
      metas[node.id] = empty_meta()
    }
  }
  metas
}

///|
/// 从 JSON Object 解析 NodeMeta。
/// license 优先级：metadata.license 显式给定（含 license_source 透传）→ license_text 指纹推断。
fn parse_node_meta(obj : Map[String, Json]) -> NodeMeta {
  let mut license = match obj.get("license") {
    Some(Json::String(s)) => Some(s)
    _ => None
  }
  let mut license_source = match obj.get("license_source") {
    Some(Json::String(s)) => Some(s)
    _ => None
  }
  if license is None {
    match obj.get("license_text") {
      Some(Json::String(text)) =>
        match detect_license_from_text(text) {
          Some(id) => {
            license = Some(id)
            license_source = Some("fingerprint")
          }
          None => ()
        }
      _ => ()
    }
  }
  let latest_version = match obj.get("latest_version") {
    Some(Json::String(s)) => Some(s)
    _ => None
  }
  // 负值 metadata 归一：上游坏数据不得让总分 >100 或扣减 total_size（S11）
  let last_commit_days_ago = match obj.get("last_commit_days_ago") {
    Some(Json::Number(n, ..)) => {
      let d = n.to_int()
      if d < 0 { None } else { Some(d) }
    }
    _ => None
  }
  let self_size = match obj.get("self_size") {
    Some(Json::Number(n, ..)) => {
      let s = n.to_int()
      if s < 0 { 0 } else { s }
    }
    _ => 0
  }
  let total_api_count = match obj.get("total_api_count") {
    Some(Json::Number(n, ..)) => {
      let t = n.to_int()
      if t < 0 { 0 } else { t }
    }
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
  let yanked = match obj.get("yanked") {
    Some(Json::True) => true
    _ => false
  }
  let yanked_reason = match obj.get("yanked_reason") {
    Some(Json::String(s)) => Some(s)
    _ => None
  }
  let source_unavailable = match obj.get("source_unavailable") {
    Some(Json::True) => true
    _ => false
  }

  NodeMeta::{
    license,
    license_source,
    latest_version,
    last_commit_days_ago,
    self_size,
    total_api_count,
    deprecated_apis,
    yanked,
    yanked_reason,
    source_unavailable,
  }
}
