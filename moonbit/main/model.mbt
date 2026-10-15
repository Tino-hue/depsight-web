///| 数据模型与全局常量。

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
/// 节点元数据（yanked / source_unavailable 由 fetcher 从 mooncakes manifest 传入）
priv struct NodeMeta {
  license : String?
  license_source : String?  // "manifest" / "mod_text" / "fingerprint" / null
  latest_version : String?
  last_commit_days_ago : Int?
  self_size : Int
  total_api_count : Int
  deprecated_apis : Array[String]
  yanked : Bool
  yanked_reason : String?
  source_unavailable : Bool
}

///|
/// 无元数据时的默认值
fn empty_meta() -> NodeMeta {
  NodeMeta::{
    license: None,
    license_source: None,
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
/// 全局常量统一出处（JS fallback 在 WEIGHTS 旁维护同名常量）
let default_max_depth : Int = 10
let max_depth_hard_limit : Int = 64
let max_context_bytes : Int = 16 * 1024 * 1024
let top_offenders_n : Int = 5
let size_warn_threshold_bytes : Int = 5_000_000
let activity_stale_days : Int = 365
let activity_warn_days : Int = 180

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
/// 修复建议（结构化输出，前端可直接渲染可执行命令）
priv struct Suggestion {
  code : String
  node_id : String
  action : String
  command : String
  impact : String  // "high" / "medium" / "low"
}

///|
/// 建议影响排序权重
fn impact_rank(s : String) -> Int {
  if s == "high" { 0 } else if s == "medium" { 1 } else { 2 }
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
  license_families : Map[String, Int]  // permissive/weak-copyleft/strong-copyleft/proprietary/unknown 恒输出
}

///|
/// 五维权重
let weights : Map[String, Double] = Map([
  ("freshness", 0.25),
  ("compliance", 0.20),
  ("deprecated", 0.25),
  ("size", 0.20),
  ("activity", 0.10),
])
