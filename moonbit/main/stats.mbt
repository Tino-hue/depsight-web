///| 生态统计。

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
  let license_families : Map[String, Int] = Map([
    ("permissive", 0),
    ("weak-copyleft", 0),
    ("strong-copyleft", 0),
    ("proprietary", 0),
    ("unknown", 0),
  ])
  let mut total_size = 0
  let mut total_deprecated = 0
  let mut max_depth = 0

  for node in graph.nodes {
    if node.depth > max_depth { max_depth = node.depth }
    match metas.get(node.id) {
      Some(m) => {
        let mut family = "unknown"
        match m.license {
          Some(l) => {
            // 与评分路径同口径：先经 SPDX 规范化（剥 WITH/去空白/变体映射）再计数/判家族，
            // 避免 "MIT and GPL-3.0" / UNLICENSED 等写法在统计与评分间口径分叉（P3-M ③）
            let normalized = normalize_license_token(l.view()).to_upper()
            unique_licenses[normalized] = true
            family = license_family(normalized)
          }
          None => ()
        }
        license_families[family] = license_families[family] + 1
        // 负值钳制为 0：meta 入口已归一，此处是防御层，坏数据不得扣减 total_size（S11）
        total_size = total_size + (if m.self_size > 0 { m.self_size } else { 0 })
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
    license_families,
  }
}
