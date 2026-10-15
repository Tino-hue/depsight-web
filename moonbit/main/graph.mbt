///| 依赖图构建（BFS）。

///|
/// BFS 构建完整依赖图
fn build_graph(root : Module, modules : Map[String, String], max_depth : Int) -> Graph {
  let nodes : Array[Node] = []
  let edges : Array[Edge] = []
  // 仅作去重集合用（节点实体由 nodes 数组持有），故存 Bool 不存 Node
  let node_ids : Map[String, Bool] = Map([])
  let visited : Map[String, Bool] = Map([])

  fn make_id(name : String, version : String) -> String {
    name + "@" + version
  }

  fn add_node(name : String, version : String, depth : Int) -> String {
    let id = make_id(name, version)
    if !node_ids.contains(id) {
      node_ids[id] = true
      nodes.push(Node::{ id, name, version, depth })
    }
    id
  }

  fn add_edge(from : String, to : String) -> Unit {
    edges.push(Edge::{ from, to })
  }

  fn resolve_module(name : String, version : String) -> Module? {
    let key = make_id(name, version)
    match modules.get(key) {
      Some(content) =>
        match parse_mod_text(content) {
          Ok(m) => Some(m)
          Err(_) => None
        }
      None =>
        // modules 未命中才回退根节点，避免同名依赖被嫁接到 root 子树
        if name == root.name { Some(root) } else { None }
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
/// 检测依赖图中的循环（DFS 三色标记），返回成环路径列表。
/// 每条路径为节点 id 序列且首尾相同，形如 ["a@1.0.0", "b@2.0.0", "a@1.0.0"]。
/// build_graph 的 BFS 用 visited 防环但环信息丢失，此处独立重建邻接表检测。
fn find_cycles(graph : Graph) -> Array[Array[String]] {
  // 邻接表
  let adj : Map[String, Array[String]] = Map([])
  for node in graph.nodes {
    adj[node.id] = []
  }
  for edge in graph.edges {
    match adj.get(edge.from) {
      Some(list) => list.push(edge.to)
      None => ()
    }
  }

  let color : Map[String, Int] = Map([]) // 1=gray 在栈，2=black 完成
  let cycles : Array[Array[String]] = []
  let seen : Map[String, Bool] = Map([])
  let stack : Array[String] = []

  // 迭代式 DFS（显式调用栈）：深层依赖图下递归会爆栈，三色标记逻辑与递归版一致（S15）
  fn dfs_iter(start : String) -> Unit {
    let frames : Array[(String, Int)] = [(start, 0)] // (节点, 下一个待处理孩子下标)
    color[start] = 1
    stack.push(start)
    while frames.length() > 0 {
      let (id, idx) = frames[frames.length() - 1]
      let nexts = match adj.get(id) {
        Some(list) => list
        None => []
      }
      if idx < nexts.length() {
        frames[frames.length() - 1] = (id, idx + 1)
        let next = nexts[idx]
        match color.get(next) {
          Some(1) => {
            // 回边：从栈中重建环路径（去重后记录）
            let mut start_idx = 0
            for i in 0..<stack.length() {
              if stack[i] == next { start_idx = i }
            }
            let path : Array[String] = []
            for i in start_idx..<stack.length() {
              path.push(stack[i])
            }
            path.push(next)
            let key = path.join("->")
            if !seen.contains(key) {
              seen[key] = true
              cycles.push(path)
            }
          }
          Some(2) => ()
          _ => {
            color[next] = 1
            stack.push(next)
            frames.push((next, 0))
          }
        }
      } else {
        // 孩子处理完毕：弹出帧与栈，标记完成
        let _ = frames.pop()
        let _ = stack.pop()
        color[id] = 2
      }
    }
  }

  // 从所有未访问节点出发（正常情况下 root 可达全部节点）
  for node in graph.nodes {
    if !color.contains(node.id) {
      dfs_iter(node.id)
    }
  }

  cycles
}

///|
/// 仅构建根节点的浅图（root + 直接依赖，不递归）
fn build_shallow_graph(root : Module) -> Graph {
  let nodes : Array[Node] = []
  let edges : Array[Edge] = []

  let root_id = root.name + "@" + root.version
  nodes.push(Node::{ id: root_id, name: root.name, version: root.version, depth: 0 })

  for pair in root.deps {
    let (dep_name, dep_ver) = pair
    let dep_id = dep_name + "@" + dep_ver
    nodes.push(Node::{ id: dep_id, name: dep_name, version: dep_ver, depth: 1 })
    edges.push(Edge::{ from: root_id, to: dep_id })
  }

  Graph::{ root_id, nodes, edges }
}
