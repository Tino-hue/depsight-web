///| 诊断与结构化修复建议。

///|
/// 是否 strong-copyleft（先经 SPDX 规范化——剥 WITH、去空白、变体映射——再判家族，
/// 避免 "g p l v 3" 这类写法绕过检测；LGPL 等 weak copyleft 不会被误伤）。
fn is_strong_copyleft(upper : String) -> Bool {
  license_family(normalize_license_token(upper.view())) == "strong-copyleft"
}

///|
/// 同名节点分组（仅保留多版本组）
fn group_nodes_by_name(graph : Graph) -> Array[(String, Array[Node])] {
  let by_name : Map[String, Array[Node]] = Map([])
  for node in graph.nodes {
    if !by_name.contains(node.name) {
      by_name[node.name] = []
    }
    by_name[node.name].push(node)
  }
  let out : Array[(String, Array[Node])] = []
  for pair in by_name {
    let (name, nodes) = pair
    if nodes.length() > 1 {
      out.push((name, nodes))
    }
  }
  out
}

///|
/// 组内最新版本节点（按 parse_version 比较，无法解析则保持首个）
fn newest_node(nodes : Array[Node]) -> Node {
  let mut newest = nodes[0]
  for n in nodes {
    match (parse_version(newest.version), parse_version(n.version)) {
      (Some(a), Some(b)) =>
        if version_compare(b, a) > 0 { newest = n }
      _ => ()
    }
  }
  newest
}

///|
/// 版本列表拼接（"1.0.0, 2.1.0"）
fn join_versions(nodes : Array[Node]) -> String {
  let mut s = ""
  let mut first = true
  for n in nodes {
    if !first { s = s + ", " }
    s = s + n.version
    first = false
  }
  s
}

///|
/// 生成诊断列表
fn run_diagnostics(graph : Graph, metas : Map[String, NodeMeta]) -> Array[Diagnostic] {
  let diags : Array[Diagnostic] = []

  for node in graph.nodes {
    let meta = match metas.get(node.id) {
      Some(m) => m
      None => empty_meta()
    }

    // YANKED-001
    if meta.yanked {
      let mut msg = node.id + " is yanked on mooncakes.io"
      match meta.yanked_reason {
        Some(r) => if !r.is_empty() { msg = msg + ": " + r }
        None => ()
      }
      diags.push(Diagnostic::{
        code: "YANKED-001",
        severity: "critical",
        node_id: node.id,
        message: msg,
      })
    }

    // OUTDATED-001
    match meta.latest_version {
      Some(latest) => {
        if node.version != latest {
          diags.push(Diagnostic::{
            code: "OUTDATED-001",
            severity: "warning",
            node_id: node.id,
            message: node.name + " is at v" + node.version + " (latest " + latest + "); consider upgrading",
          })
        }
      }
      None => ()
    }

    // LICENSE-001 / LICENSE-002
    match meta.license {
      None => {
        diags.push(Diagnostic::{
          code: "LICENSE-001",
          severity: "info",
          node_id: node.id,
          message: node.name + " declares no license; commercial use carries risk",
        })
      }
      Some(lic) => {
        let upper = lic.to_upper()
        if is_strong_copyleft(upper) {
          diags.push(Diagnostic::{
            code: "LICENSE-002",
            severity: "warning",
            node_id: node.id,
            message: node.name + " uses " + lic + "; beware of copyleft obligations",
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
        message: node.name + " contains " + dep_count.to_string() + " deprecated APIs",
      })
    }

    // SIZE-001
    if meta.self_size > 1_000_000 {
      diags.push(Diagnostic::{
        code: "SIZE-001",
        severity: "warning",
        node_id: node.id,
        message: node.name + " is " + fmt_bytes(meta.self_size) + "; consider slimming it down",
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
            message: node.name + " has not been updated in " + days.to_string() + " days and may be unmaintained",
          })
        } else if days > 180 {
          diags.push(Diagnostic::{
            code: "ACTIVITY-002",
            severity: "info",
            node_id: node.id,
            message: node.name + " was last updated " + days.to_string() + " days ago",
          })
        }
      }
      None => ()
    }
  }

  // DUP-001：同名多版本共存
  for group in group_nodes_by_name(graph) {
    let (name, nodes) = group
    let newest = newest_node(nodes)
    let versions_msg = join_versions(nodes)
    for n in nodes {
      if n.id != newest.id {
        diags.push(Diagnostic::{
          code: "DUP-001",
          severity: "warning",
          node_id: n.id,
          message: name + " has multiple versions in the graph (" + versions_msg + "); v" + n.version + " is superseded by v" + newest.version,
        })
      }
    }
  }

  // CYCLE-001：循环依赖（成环路径已含首尾重复节点）
  for cycle in find_cycles(graph) {
    let target = match cycle.last() {
      Some(t) => t
      None => graph.root_id
    }
    diags.push(Diagnostic::{
      code: "CYCLE-001",
      severity: "warning",
      node_id: target,
      message: "dependency cycle detected: " + cycle.join(" -> "),
    })
  }

  diags
}

///|
/// 生成结构化修复建议（按 impact 排序：high → medium → low）
fn build_suggestions(graph : Graph, metas : Map[String, NodeMeta]) -> Array[Suggestion] {
  let sugs : Array[Suggestion] = []

  for node in graph.nodes {
    let meta = match metas.get(node.id) {
      Some(m) => m
      None => empty_meta()
    }

    // YANKED-001（high）
    if meta.yanked {
      // latest 与当前版本相同（连最新版都被 yank）→ 只能移除
      let cmd = match meta.latest_version {
        Some(latest) =>
          if latest == node.version {
            "moon remove " + node.name
          } else {
            "moon add " + node.name + "@" + latest
          }
        None => "moon remove " + node.name
      }
      sugs.push(Suggestion::{
        code: "YANKED-001",
        node_id: node.id,
        action: "Replace yanked " + node.id,
        command: cmd,
        impact: "high",
      })
    }

    // OUTDATED-001（major→high / minor→medium / 其余→low）
    match meta.latest_version {
      Some(latest) => {
        if node.version != latest {
          let impact = match (parse_version(node.version), parse_version(latest)) {
            (Some(cur), Some(lat)) => {
              if cur.0 < lat.0 { "high" }
              else if cur.1 < lat.1 { "medium" }
              else { "low" }
            }
            _ => "low"
          }
          sugs.push(Suggestion::{
            code: "OUTDATED-001",
            node_id: node.id,
            action: "Upgrade " + node.name + " to v" + latest,
            command: "moon add " + node.name + "@" + latest,
            impact,
          })
        }
      }
      None => ()
    }

    // LICENSE-002 / LICENSE-001
    match meta.license {
      Some(lic) => {
        let upper = lic.to_upper()
        if is_strong_copyleft(upper) {
          sugs.push(Suggestion::{
            code: "LICENSE-002",
            node_id: node.id,
            action: "Review copyleft obligations of " + node.name + " (" + lic + ") or find an alternative",
            command: "",
            impact: "medium",
          })
        }
      }
      None =>
        sugs.push(Suggestion::{
          code: "LICENSE-001",
          node_id: node.id,
          action: "Add a license declaration to " + node.name,
          command: "",
          impact: "low",
        })
    }

    // ACTIVITY-001
    match meta.last_commit_days_ago {
      Some(days) =>
        if days > 365 {
          sugs.push(Suggestion::{
            code: "ACTIVITY-001",
            node_id: node.id,
            action: "Consider replacing unmaintained " + node.name + " (last update " + days.to_string() + " days ago)",
            command: "",
            impact: "medium",
          })
        }
      None => ()
    }

    // DEPRECATED-001
    if meta.deprecated_apis.length() > 0 {
      sugs.push(Suggestion::{
        code: "DEPRECATED-001",
        node_id: node.id,
        action: "Migrate off " + meta.deprecated_apis.length().to_string() + " deprecated APIs in " + node.name,
        command: "",
        impact: "low",
      })
    }

    // SIZE-001
    if meta.self_size > 1_000_000 {
      sugs.push(Suggestion::{
        code: "SIZE-001",
        node_id: node.id,
        action: "Find a lighter alternative to " + node.name + " (" + fmt_bytes(meta.self_size) + ")",
        command: "",
        impact: "low",
      })
    }
  }

  // DUP-001：合并多版本
  for group in group_nodes_by_name(graph) {
    let (name, nodes) = group
    let newest = newest_node(nodes)
    for n in nodes {
      if n.id != newest.id {
        sugs.push(Suggestion::{
          code: "DUP-001",
          node_id: n.id,
          action: "Consolidate " + name + " to a single version (newest v" + newest.version + ")",
          command: "moon add " + name + "@" + newest.version,
          impact: "medium",
        })
      }
    }
  }

  // CYCLE-001（high）：打破循环依赖
  for cycle in find_cycles(graph) {
    // 路径首尾重复，展示时去掉最后一个
    let members = if cycle.length() > 1 { cycle[:cycle.length()-1] } else { cycle }
    let target = match cycle.last() {
      Some(t) => t
      None => graph.root_id
    }
    sugs.push(Suggestion::{
      code: "CYCLE-001",
      node_id: target,
      action: "Break the dependency cycle involving " + members.join(", "),
      command: "",
      impact: "high",
    })
  }

  sugs.sort_by(fn(a, b) { impact_rank(a.impact) - impact_rank(b.impact) })
  sugs
}
