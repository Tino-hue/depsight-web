///| 传递体积计算与 top 体积包。

///|
/// 计算传递体积（返回 (node_id, self_size, transitive_size)，按传递体积降序）
fn compute_transitive_sizes(graph : Graph, metas : Map[String, NodeMeta]) -> Array[(String, Int, Int)] {
  // 邻接表：parent -> children
  let children_map : Map[String, Array[String]] = Map([])
  for edge in graph.edges {
    if !children_map.contains(edge.from) {
      children_map[edge.from] = []
    }
    children_map[edge.from].push(edge.to)
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
