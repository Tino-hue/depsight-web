// JS fallback 分析器：当 WASM 不可用时，用 JS 完整复现 depsight 的分析逻辑
// 输入契约与 WASM API 完全一致：
//   { type: 'mod_text', mod_text: string }
//   { type: 'context',  context: { root, modules, metadata, options? } }
// 输出契约：与 MoonBit WASM 的 analyze_from_context_json 一致

// ===== moon.mod 解析 =====

// 解析 moon.mod（TOML 简化语法）或 moon.mod.json
// fetcher.js 也复用此函数解析从注册中心拉取的模块描述
export function parseMod(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return parseModJson(trimmed);
  }
  return parseModToml(trimmed);
}

function parseModJson(text) {
  try {
    const obj = JSON.parse(text);
    return {
      name: obj.name || "unknown",
      version: obj.version || "0.0.0",
      license: obj.license || null,
      deps: normalizeDeps(obj.deps || {}),
    };
  } catch (e) {
    return {
      name: "unknown",
      version: "0.0.0",
      license: null,
      deps: {},
      parse_error: e.message,
    };
  }
}

function parseModToml(text) {
  const result = { name: "unknown", version: "0.0.0", license: null, deps: {} };
  const lines = text.split("\n");
  let inImport = false;

  for (let raw of lines) {
    let line = raw.trim();
    // 去注释
    const hashIdx = line.indexOf("#");
    if (hashIdx >= 0) line = line.substring(0, hashIdx).trim();
    if (!line) continue;

    if (line.startsWith("name") && line.includes("=")) {
      result.name = stripQuotes(line.split("=")[1].trim());
    } else if (line.startsWith("version") && line.includes("=")) {
      result.version = stripQuotes(line.split("=")[1].trim());
    } else if (line.startsWith("license") && line.includes("=")) {
      result.license = stripQuotes(line.split("=")[1].trim());
    } else if (line.startsWith("import")) {
      inImport = true;
      // 单行：import { "x@1.0" }
      const braceMatch = line.match(/\{([^}]*)\}/);
      if (braceMatch) {
        addImports(result.deps, braceMatch[1]);
        inImport = false;
      }
    } else if (inImport && line.includes('"')) {
      // 多行 import 里的字符串
      const m = line.match(/"([^"]+)"/);
      if (m) {
        const { name, version } = splitDepName(m[1]);
        result.deps[name] = version;
      }
      if (line.includes("}")) inImport = false;
    }
  }
  return result;
}

function addImports(deps, str) {
  // 形如 "pkg@1.0", "pkg2"
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const { name, version } = splitDepName(m[1]);
    deps[name] = version;
  }
}

function splitDepName(s) {
  const at = s.lastIndexOf("@");
  if (at > 0) {
    return { name: s.substring(0, at), version: s.substring(at + 1) };
  }
  return { name: s, version: "latest" };
}

function normalizeDeps(deps) {
  // JSON 里可能是 { "pkg": "1.0" } 或 { "pkg@1.0": "..." }
  const result = {};
  for (const k of Object.keys(deps)) {
    const { name, version } = splitDepName(k);
    result[name] = deps[k] || version;
  }
  return result;
}

function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, "");
}

// ===== 图构建 =====

// BFS 构建依赖图
function buildGraph(rootMod, modules, maxDepth = 10) {
  const nodes = new Map(); // id -> { id, name, version, depth }
  const edges = []; // [{ from, to }]
  const visited = new Set();

  function makeId(name, version) {
    return `${name}@${version}`;
  }

  function addNode(name, version, depth) {
    const id = makeId(name, version);
    if (!nodes.has(id)) {
      nodes.set(id, { id, name, version, depth });
    }
    return id;
  }

  function addEdge(fromId, toId) {
    edges.push({ from: fromId, to: toId });
  }

  function resolveModule(name, version) {
    // 根节点
    if (name === rootMod.name) return rootMod;
    const key = makeId(name, version);
    const content = modules[key];
    if (!content) return null;
    return parseMod(content);
  }

  const rootId = addNode(rootMod.name, rootMod.version, 0);
  visited.add(rootId);

  // BFS
  const queue = [{ name: rootMod.name, version: rootMod.version, depth: 0 }];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.depth >= maxDepth) continue;
    const curId = makeId(cur.name, cur.version);
    const mod = resolveModule(cur.name, cur.version);
    if (!mod) continue;

    for (const [depName, depVersion] of Object.entries(mod.deps)) {
      const depId = addNode(depName, depVersion, cur.depth + 1);
      addEdge(curId, depId);
      if (!visited.has(depId)) {
        visited.add(depId);
        queue.push({
          name: depName,
          version: depVersion,
          depth: cur.depth + 1,
        });
      }
    }
  }

  return {
    root_id: rootId,
    nodes: Array.from(nodes.values()),
    edges,
  };
}

// ===== 健康评分 =====

// 5 维评分：新鲜度(25%) / 许可证(20%) / 废弃API(25%) / 大小(20%) / 活跃度(10%)
// 每维 0-100 分，加权求和

const WEIGHTS = {
  freshness: 0.25,
  compliance: 0.2,
  deprecated: 0.25,
  size: 0.2,
  activity: 0.1,
};

// 每个维度的子评分逻辑

function scoreFreshness(mod, meta) {
  // 看 latest_version：如果与当前版本差异大 → 低分
  if (!meta.latest_version) return 50; // 未知给中间分
  if (mod.version === meta.latest_version) return 100;
  // 比较 major.minor
  const cur = parseVersion(mod.version);
  const latest = parseVersion(meta.latest_version);
  if (!cur || !latest) return 70;
  if (cur.major < latest.major) return 20; // 跨大版本，严重过时
  if (cur.minor < latest.minor) {
    const gap = latest.minor - cur.minor;
    return Math.max(30, 80 - gap * 15);
  }
  return 90;
}

function parseVersion(v) {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return {
    major: parseInt(m[1]),
    minor: parseInt(m[2]),
    patch: parseInt(m[3]),
  };
}

function scoreCompliance(mod, meta) {
  const license = meta.license || mod.license;
  if (!license) return 40; // 无许可证有风险
  const ok = [
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "Unlicense",
    "Zlib",
  ];
  const upper = license.toUpperCase();
  if (ok.some((l) => upper.includes(l.toUpperCase()))) return 100;
  if (upper.includes("GPL") || upper.includes("AGPL") || upper.includes("LGPL"))
    return 30; // copyleft
  if (upper.includes("MPL")) return 60;
  return 50;
}

function scoreDeprecated(meta) {
  const total = meta.total_api_count || 0;
  const depCount = (meta.deprecated_apis || []).length;
  if (total === 0) return 100;
  const ratio = depCount / total;
  return Math.max(0, Math.round(100 - ratio * 500)); // 20% 废弃 → 0 分
}

function scoreSize(meta) {
  const size = meta.self_size || 0;
  if (size === 0) return 80;
  if (size < 100_000) return 100;
  if (size < 500_000) return 80;
  if (size < 1_000_000) return 60;
  if (size < 5_000_000) return 40;
  return 20;
}

function scoreActivity(meta) {
  const days = meta.last_commit_days_ago;
  if (days == null) return 50;
  if (days < 30) return 100;
  if (days < 90) return 90;
  if (days < 180) return 70;
  if (days < 365) return 40;
  return 10;
}

function computeHealthScore(node, mod, meta) {
  const freshness = scoreFreshness(mod, meta);
  const compliance = scoreCompliance(mod, meta);
  const deprecated = scoreDeprecated(meta);
  const size = scoreSize(meta);
  const activity = scoreActivity(meta);

  const total = Math.round(
    freshness * WEIGHTS.freshness +
      compliance * WEIGHTS.compliance +
      deprecated * WEIGHTS.deprecated +
      size * WEIGHTS.size +
      activity * WEIGHTS.activity,
  );

  return {
    node_id: node.id,
    total,
    freshness,
    compliance,
    deprecated_density: deprecated,
    size_reasonableness: size,
    activity,
  };
}

// ===== 诊断 =====

function makeDiagnostic(code, severity, nodeId, msg) {
  return { code, severity, node_id: nodeId, message: msg };
}

function diagnose(graph, metas) {
  const diags = [];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const node of graph.nodes) {
    const meta = metas[node.id] || {};
    const mod = meta._mod || {
      name: node.name,
      version: node.version,
      deps: {},
    };

    // OUTDATED-001
    if (meta.latest_version && mod.version !== meta.latest_version) {
      diags.push(
        makeDiagnostic(
          "OUTDATED-001",
          "warning",
          node.id,
          `${node.name} 当前 v${mod.version}，最新 ${meta.latest_version}，建议升级`,
        ),
      );
    }

    // LICENSE-001
    const license = meta.license || mod.license;
    if (!license) {
      diags.push(
        makeDiagnostic(
          "LICENSE-001",
          "info",
          node.id,
          `${node.name} 未声明许可证，商业使用存在风险`,
        ),
      );
    } else if (/GPL|AGPL|LGPL/i.test(license)) {
      diags.push(
        makeDiagnostic(
          "LICENSE-002",
          "warning",
          node.id,
          `${node.name} 使用 ${license}，需注意 copyleft 传染性`,
        ),
      );
    }

    // DEPRECATED-001
    const depApiCount = (meta.deprecated_apis || []).length;
    if (depApiCount > 0) {
      diags.push(
        makeDiagnostic(
          "DEPRECATED-001",
          "info",
          node.id,
          `${node.name} 含 ${depApiCount} 个废弃 API`,
        ),
      );
    }

    // SIZE-001
    const size = meta.self_size || 0;
    if (size > 1_000_000) {
      diags.push(
        makeDiagnostic(
          "SIZE-001",
          "warning",
          node.id,
          `${node.name} 体积 ${fmtBytes(size)}，考虑精简`,
        ),
      );
    }

    // ACTIVITY-001
    const days = meta.last_commit_days_ago;
    if (days != null && days > 365) {
      diags.push(
        makeDiagnostic(
          "ACTIVITY-001",
          "critical",
          node.id,
          `${node.name} 已 ${days} 天未更新，可能已停止维护`,
        ),
      );
    } else if (days != null && days > 180) {
      diags.push(
        makeDiagnostic(
          "ACTIVITY-002",
          "info",
          node.id,
          `${node.name} 最近更新在 ${days} 天前`,
        ),
      );
    }
  }

  return diags;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ===== 体积传递计算 =====

function computeTransitiveSize(graph, metas) {
  // 反向邻接：child -> parents
  const childrenMap = new Map();
  for (const e of graph.edges) {
    if (!childrenMap.has(e.from)) childrenMap.set(e.from, []);
    childrenMap.get(e.from).push(e.to);
  }

  const memo = new Map();
  function transitiveSize(id) {
    if (memo.has(id)) return memo.get(id);
    const selfSize = (metas[id] || {}).self_size || 0;
    let total = selfSize;
    const visited = new Set([id]);
    const queue = [...(childrenMap.get(id) || [])];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      total += (metas[cur] || {}).self_size || 0;
      queue.push(...(childrenMap.get(cur) || []));
    }
    memo.set(id, total);
    return total;
  }

  return graph.nodes
    .map((n) => ({
      node_id: n.id,
      self_size: (metas[n.id] || {}).self_size || 0,
      transitive_size: transitiveSize(n.id),
    }))
    .sort((a, b) => b.transitive_size - a.transitive_size);
}

// ===== 生态统计 =====

function computeEcosystemStats(graph, healthScores, metas, rootId) {
  const depthMap = new Map(graph.nodes.map((n) => [n.id, n.depth]));
  const directDeps = graph.edges.filter((e) => e.from === rootId).length;
  const uniqueLicenses = new Set();
  let totalSize = 0;
  let totalDeprecated = 0;

  for (const node of graph.nodes) {
    const meta = metas[node.id] || {};
    if (meta.license) uniqueLicenses.add(meta.license);
    totalSize += meta.self_size || 0;
    totalDeprecated += (meta.deprecated_apis || []).length;
  }

  const avgHealth =
    healthScores.length > 0
      ? Math.round(
          healthScores.reduce((a, b) => a + b.total, 0) / healthScores.length,
        )
      : 0;

  return {
    total_packages: graph.nodes.length,
    direct_dependencies: directDeps,
    max_depth: Math.max(0, ...graph.nodes.map((n) => n.depth)),
    total_size_bytes: totalSize,
    total_deprecated_apis: totalDeprecated,
    unique_licenses: uniqueLicenses.size,
    avg_health_score: avgHealth,
  };
}

// ===== 主入口 =====

export function runJsAnalyzer(request) {
  try {
    if (request.type === "mod_text") {
      return analyzeSingleMod(request.mod_text);
    } else if (request.type === "context") {
      return analyzeContext(request.context);
    }
    return { error: `unknown request type: ${request.type}` };
  } catch (e) {
    return { error: `analyzer exception: ${e.message}` };
  }
}

function analyzeSingleMod(modText) {
  const rootMod = parseMod(modText);
  if (rootMod.parse_error) {
    return { error: `parse failed: ${rootMod.parse_error}` };
  }
  const graph = buildGraph(rootMod, {}, 1);
  const metas = {};
  // 根节点 meta
  metas[graph.root_id] = {
    license: rootMod.license,
    deprecated_apis: [],
    total_api_count: 0,
    self_size: 0,
    _mod: rootMod,
  };
  // 其他节点无 meta
  for (const n of graph.nodes) {
    if (n.id !== graph.root_id && !metas[n.id]) metas[n.id] = {};
  }

  const healthScores = graph.nodes.map((n) =>
    computeHealthScore(n, metas[n.id]._mod || {}, metas[n.id]),
  );
  const diags = diagnose(graph, metas);
  const sizeOffenders = computeTransitiveSize(graph, metas).slice(0, 5);
  const stats = computeEcosystemStats(
    graph,
    healthScores,
    metas,
    graph.root_id,
  );

  return assembleResult(
    graph,
    rootMod,
    healthScores,
    diags,
    sizeOffenders,
    stats,
    metas,
  );
}

function analyzeContext(ctx) {
  if (!ctx.root) return { error: "missing required field 'root'" };
  const rootMod = parseMod(ctx.root);
  if (rootMod.parse_error) {
    return { error: `failed to parse root module: ${rootMod.parse_error}` };
  }

  const modules = ctx.modules || {};
  const metadata = ctx.metadata || {};
  const maxDepth = (ctx.options && ctx.options.max_depth) || 10;

  const graph = buildGraph(rootMod, modules, maxDepth);

  // 构建 metas
  const metas = {};
  for (const n of graph.nodes) {
    const meta = metadata[n.id] || {};
    // 给每个节点附加 _mod 用于诊断
    let mod;
    if (n.id === graph.root_id) {
      mod = rootMod;
    } else {
      const content = modules[n.id];
      mod = content
        ? parseMod(content)
        : { name: n.name, version: n.version, deps: {} };
    }
    metas[n.id] = { ...meta, _mod: mod };
  }

  const healthScores = graph.nodes.map((n) =>
    computeHealthScore(n, metas[n.id]._mod || {}, metas[n.id]),
  );
  const diags = diagnose(graph, metas);
  const sizeOffenders = computeTransitiveSize(graph, metas).slice(0, 5);
  const stats = computeEcosystemStats(
    graph,
    healthScores,
    metas,
    graph.root_id,
  );

  return assembleResult(
    graph,
    rootMod,
    healthScores,
    diags,
    sizeOffenders,
    stats,
    metas,
  );
}

function assembleResult(
  graph,
  rootMod,
  healthScores,
  diags,
  sizeOffenders,
  stats,
  metas,
) {
  const crit = diags.filter((d) => d.severity === "critical").length;
  const warn = diags.filter((d) => d.severity === "warning").length;
  const info = diags.filter((d) => d.severity === "info").length;

  const overallScore =
    healthScores.length > 0
      ? Math.round(
          healthScores.reduce((a, b) => a + b.total, 0) / healthScores.length,
        )
      : 0;

  // 序列化 metas（去掉 _mod）
  const cleanMetas = {};
  for (const [id, meta] of Object.entries(metas)) {
    cleanMetas[id] = {
      license: meta.license || null,
      latest_version: meta.latest_version || null,
      self_size: meta.self_size || 0,
      last_commit_days_ago:
        meta.last_commit_days_ago != null ? meta.last_commit_days_ago : null,
      total_api_count: meta.total_api_count || 0,
      deprecated_api_count: (meta.deprecated_apis || []).length,
    };
  }

  return {
    overall_score: overallScore,
    node_count: graph.nodes.length,
    diagnostics: diags,
    health_scores: healthScores,
    summary: { critical: crit, warning: warn, info: info },
    graph: {
      root_id: graph.root_id,
      nodes: graph.nodes,
      edges: graph.edges,
    },
    size_offenders_top5: sizeOffenders,
    node_metas: cleanMetas,
    ecosystem_stats: stats,
    _root_mod: rootMod, // 供前端使用，不属于 WASM 契约
  };
}
