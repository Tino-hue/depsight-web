// JS fallback 分析器：当 WASM 不可用时，用 TS 完整复现 depsight 的分析逻辑
// 输入契约与 WASM API 完全一致：
//   { type: 'mod_text', mod_text: string }
//   { type: 'context',  context: { root, modules, metadata, options? } }
// 输出契约：与 MoonBit WASM（v0.8.0-wasm）的 analyze_from_context_json 一致
//   —— 含 suggestions / yanked / DUP-001 / CYCLE-001 / SPDX 许可证评分（规范化后）
//      / version_resolved / license_source / license_families，双端行为保持一致。
//
// 从 js/js-analyzer.js 迁移，逻辑保持一致

import type {
  AnalysisContext,
  AnalysisResult,
  AnalyzerRequest,
  DepGraph,
  Diagnostic,
  EcosystemStats,
  GraphNode,
  HealthScore,
  NodeMetaInput,
  NodeMetaOutput,
  ParsedMod,
  Severity,
  SizeOffender,
  Suggestion,
} from "./types";

// ===== moon.mod 解析 =====

/** 解析 moon.mod（TOML 简化语法）或 moon.mod.json */
export function parseMod(text: string): ParsedMod {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return parseModJson(trimmed);
  }
  return parseModToml(trimmed);
}

function parseModJson(text: string): ParsedMod {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const name = (obj.name as string) || "unknown";
    const version = (obj.version as string) || "0.0.0";
    const result: ParsedMod = {
      name,
      version,
      license: (obj.license as string) || null,
      deps: normalizeDeps((obj.deps as Record<string, unknown>) || {}),
    };
    // S12：缺 name/version 视为垃圾输入，标记 parse_error 而非静默产出 unknown@0.0.0
    if (name === "unknown" || version === "0.0.0") {
      result.parse_error =
        "moon.mod.json missing required field 'name' or 'version'";
    }
    return result;
  } catch (e) {
    return {
      name: "unknown",
      version: "0.0.0",
      license: null,
      deps: {},
      parse_error: e instanceof Error ? e.message : String(e),
    };
  }
}

function parseModToml(text: string): ParsedMod {
  const result: ParsedMod = {
    name: "unknown",
    version: "0.0.0",
    license: null,
    deps: {},
  };
  const lines = text.split("\n");
  let inImport = false;

  for (const raw of lines) {
    const line = stripTomlComment(raw).trim();
    if (!line) continue;
    // 普通 section 头意味着 import 块已意外收尾，后续带引号的行是别的字段，不当依赖
    if (inImport && line.startsWith("[")) inImport = false;

    // 键名须以空白或 = 结尾，避免 name 误命中 namesuffix、version 误命中 versioning
    const keyEnd = (kw: string) =>
      line.length === kw.length ||
      line[kw.length] === " " ||
      line[kw.length] === "=";
    if (line.startsWith("name") && keyEnd("name") && line.includes("=")) {
      result.name = stripQuotes(tomlValue(line));
    } else if (
      line.startsWith("module") &&
      keyEnd("module") &&
      !line.includes("=")
    ) {
      // 头部行：`module my/app` 或带引号 `module "my/app"`（等价于 name = "my/app"）
      result.name = stripQuotes(line.substring("module".length).trim());
    } else if (
      line.startsWith("version") &&
      keyEnd("version") &&
      line.includes("=")
    ) {
      result.version = stripQuotes(tomlValue(line));
    } else if (
      line.startsWith("license") &&
      keyEnd("license") &&
      line.includes("=")
    ) {
      result.license = stripQuotes(tomlValue(line));
    } else if (line.startsWith("import")) {
      if (line.includes("{")) {
        // 块形式：import { ... }（可能跨多行）
        inImport = true;
        const content = extractBraceContent(line);
        if (content !== null) {
          addImports(result.deps, content);
          inImport = false;
        }
      } else {
        // 旧版单行形式：import "x@1.0"（平台条件 import "x" for "wasm" 跳过）
        inImport = false;
        if (!line.includes(" for ")) {
          const depStr = extractQuoted(line);
          if (depStr !== null) {
            const { name, version } = splitDepName(depStr);
            result.deps[name] = version;
          }
        }
      }
    } else if (inImport && line.includes('"')) {
      // 多行 import 里的字符串（收尾行 `"b@2.0.0" }` 字符串与 } 同行，须先提取再收尾）
      const depStr = extractQuoted(line);
      if (depStr !== null) {
        const { name, version } = splitDepName(depStr);
        result.deps[name] = version;
      }
      if (line.includes("}")) inImport = false;
    } else if (inImport && line.includes("}")) {
      // 多行 import 块的收尾行（无字符串）
      inImport = false;
    }
  }
  // S12：缺 name/version 视为垃圾输入，标记 parse_error 而非静默产出 unknown@0.0.0
  if (result.name === "unknown" || result.version === "0.0.0") {
    result.parse_error = "moon.mod missing required field 'name' or 'version'";
  }
  return result;
}

/**
 * 剥离行内 `#` 注释（引号感知：字符串字面量内的 # 不算注释）。
 * 与 MoonBit mod_parse.mbt strip_toml_comment 一致。
 */
function stripTomlComment(line: string): string {
  let inStr = false;
  let quote = '"';
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (inStr) {
      if (c === "\\" && quote === '"') {
        i += 2;
        continue;
      }
      if (c === quote) inStr = false;
    } else if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
    } else if (c === "#") {
      return line.substring(0, i).trim();
    }
    i += 1;
  }
  return line.trim();
}

/** 取 `key = value` 中 `=` 右侧原文 */
function tomlValue(line: string): string {
  const eq = line.indexOf("=");
  if (eq < 0) return "";
  return line.substring(eq + 1).trim();
}

/** 提取 { ... } 中的内容（未闭合返回 null） */
function extractBraceContent(line: string): string | null {
  const start = line.indexOf("{");
  if (start < 0) return null;
  const end = line.lastIndexOf("}");
  if (end > start) return line.substring(start + 1, end);
  return null;
}

/** 提取 "..." 中的内容（第一个引号到最后一个引号之间） */
function extractQuoted(line: string): string | null {
  const start = line.indexOf('"');
  if (start < 0) return null;
  const end = line.lastIndexOf('"');
  if (end > start) return line.substring(start + 1, end);
  return null;
}

function addImports(deps: Record<string, string>, str: string): void {
  // 形如 "pkg@1.0", "pkg2"
  const re = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const { name, version } = splitDepName(m[1]);
    deps[name] = version;
  }
}

function splitDepName(s: string): { name: string; version: string } {
  const at = s.lastIndexOf("@");
  if (at > 0) {
    return { name: s.substring(0, at), version: s.substring(at + 1) };
  }
  return { name: s, version: "latest" };
}

function normalizeDeps(deps: Record<string, unknown>): Record<string, string> {
  // JSON 里可能是 { "pkg": "1.0" } 或 { "pkg@1.0": "..." }
  // path 依赖形如 { "pkg": { "path": "../local" } }，非字符串值跳过（与 MoonBit 一致）
  const result: Record<string, string> = {};
  for (const k of Object.keys(deps)) {
    const v = deps[k];
    if (typeof v !== "string") continue;
    const { name, version } = splitDepName(k);
    result[name] = v || version;
  }
  return result;
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

// ===== 图构建 =====

/** version_resolved 判定：trim + 小写后不等于 "latest"（大小写不敏感，与 serialize.mbt is_resolved_version 一致；P3-M⑤） */
function isResolvedVersion(version: string): boolean {
  return version.trim().toLowerCase() !== "latest";
}

/** BFS 构建依赖图 */
function buildGraph(
  rootMod: ParsedMod,
  modules: Record<string, string>,
  maxDepth = 10,
): DepGraph {
  const nodes = new Map<string, GraphNode>(); // id -> node
  const edges: DepGraph["edges"] = [];
  const visited = new Set<string>();

  function makeId(name: string, version: string): string {
    return `${name}@${version}`;
  }

  function addNode(name: string, version: string, depth: number): string {
    const id = makeId(name, version);
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        name,
        version,
        version_resolved: isResolvedVersion(version),
        depth,
      });
    }
    return id;
  }

  function addEdge(fromId: string, toId: string): void {
    edges.push({ from: fromId, to: toId });
  }

  function resolveModule(name: string, version: string): ParsedMod | null {
    const key = makeId(name, version);
    const content = modules[key];
    if (content !== undefined) {
      const mod = parseMod(content);
      // S12 连带：垃圾模块内容（缺 name/version）视为不可解析，
      // 与 graph.mbt resolve_module 的 Err => None 一致，不产出 unknown@0.0.0 幽灵节点
      return mod.parse_error ? null : mod;
    }
    // modules 未命中才回退根节点，避免同名依赖被嫁接到 root 子树（与 graph.mbt 同步）
    if (name === rootMod.name) return rootMod;
    return null;
  }

  const rootId = addNode(rootMod.name, rootMod.version, 0);
  visited.add(rootId);

  // BFS
  const queue = [{ name: rootMod.name, version: rootMod.version, depth: 0 }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
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

/**
 * 检测依赖图中的循环（DFS 三色标记），返回成环路径列表。
 * 每条路径为节点 id 序列且首尾相同，形如 ["a@1.0.0", "b@2.0.0", "a@1.0.0"]。
 * buildGraph 的 BFS 用 visited 防环但环信息丢失，此处独立重建邻接表检测。
 * 与 MoonBit graph.mbt find_cycles 一致。
 */
function findCycles(graph: DepGraph): string[][] {
  // 邻接表
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.id, []);
  for (const edge of graph.edges) {
    const list = adj.get(edge.from);
    if (list) list.push(edge.to);
  }

  const color = new Map<string, number>(); // 1=gray 在栈，2=black 完成
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const stack: string[] = [];

  // 迭代式 DFS（显式调用栈）：深层依赖图下递归会爆栈，三色标记逻辑与递归版一致（S15）
  function dfsIter(start: string): void {
    const frames: Array<[string, number]> = [[start, 0]]; // (节点, 下一个待处理孩子下标)
    color.set(start, 1);
    stack.push(start);
    while (frames.length > 0) {
      const [id, idx] = frames[frames.length - 1];
      const nexts = adj.get(id) || [];
      if (idx < nexts.length) {
        frames[frames.length - 1] = [id, idx + 1];
        const next = nexts[idx];
        const c = color.get(next);
        if (c === 1) {
          // 回边：从栈中重建环路径（去重后记录）
          let startIdx = 0;
          for (let i = 0; i < stack.length; i++) {
            if (stack[i] === next) startIdx = i;
          }
          const path = stack.slice(startIdx);
          path.push(next);
          const key = path.join("->");
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(path);
          }
        } else if (c === 2) {
          // 已完成，跳过
        } else {
          color.set(next, 1);
          stack.push(next);
          frames.push([next, 0]);
        }
      } else {
        // 孩子处理完毕：弹出帧与栈，标记完成
        frames.pop();
        stack.pop();
        color.set(id, 2);
      }
    }
  }

  // 从所有未访问节点出发（正常情况下 root 可达全部节点）
  for (const node of graph.nodes) {
    if (!color.has(node.id)) dfsIter(node.id);
  }

  return cycles;
}

// ===== 健康评分 =====

// 5 维评分：新鲜度(25%) / 许可证(20%) / 废弃API(25%) / 大小(20%) / 活跃度(10%)
const WEIGHTS = {
  freshness: 0.25,
  compliance: 0.2,
  deprecated: 0.25,
  size: 0.2,
  activity: 0.1,
} as const;

// 与 MoonBit model.mbt 常量一一对齐（S15 / P3-M）
const DEFAULT_MAX_DEPTH = 10;
const MAX_DEPTH_HARD_LIMIT = 64;
const MAX_CONTEXT_BYTES = 16 * 1024 * 1024;
const TOP_OFFENDERS_N = 5;
const SIZE_WARN_THRESHOLD_BYTES = 5_000_000;
const ACTIVITY_STALE_DAYS = 365;
const ACTIVITY_WARN_DAYS = 180;

interface VersionParts {
  major: number;
  minor: number;
  patch: number;
}

/**
 * 解析版本号：容忍 v/V 前缀、两段式（"1.0"）、预发布后缀（"1.0.0-alpha"）
 * 与 build 元数据（"0.1.20260920+7d59c7ec9"）。无法解析返回 null。
 * 与 MoonBit scoring.mbt parse_version 保持一致。
 */
function parseVersion(v: string): VersionParts | null {
  let t = v.trim();
  if (t.startsWith("v") || t.startsWith("V")) t = t.slice(1).trim();
  const dash = t.indexOf("-");
  if (dash >= 0) t = t.slice(0, dash).trim();
  const plus = t.indexOf("+");
  if (plus >= 0) t = t.slice(0, plus).trim();
  if (!t) return null;
  const parts = t.split(".");
  if (parts.length === 0 || parts.length > 3) return null;
  const nums: number[] = [];
  for (const p of parts) {
    const s = p.trim();
    if (!/^\d+$/.test(s)) return null;
    const n = parseInt(s, 10);
    if (!Number.isSafeInteger(n)) return null; // 溢出与 MoonBit parse_uint 的 None 分支对齐
    nums.push(n);
  }
  while (nums.length < 3) nums.push(0);
  return { major: nums[0], minor: nums[1], patch: nums[2] };
}

function scoreFreshness(mod: ParsedMod, meta: NodeMetaInput): number {
  // yanked 版本直接 0 分（与 MoonBit score_freshness 一致）
  if (meta.yanked) return 0;
  // 看 latest_version：如果与当前版本差异大 → 低分
  if (!meta.latest_version) return 50; // 未知给中间分
  if (mod.version === meta.latest_version) return 100;
  const cur = parseVersion(mod.version);
  const latest = parseVersion(meta.latest_version);
  if (!cur || !latest) return 70;
  if (cur.major < latest.major) return 20; // 跨大版本，严重过时
  if (cur.minor < latest.minor) {
    // gap 饱和到 4：4×15=60 无溢出风险，且各档位与旧行为一致（gap=4 时 80-60=20→钳 30）
    const gap = Math.min(4, latest.minor - cur.minor);
    return Math.max(30, 80 - gap * 15);
  }
  return 90;
}

// ===== 许可证 SPDX 表达式评分 =====

/**
 * 许可证家族分类（输入已 upper 化，做子串匹配）。
 * 注意顺序：weak-copyleft 列表包含 LGPL，必须先于 strong-copyleft 的 "GPL" 子串判断。
 * 与 MoonBit scoring.mbt license_family 一致。
 */
function licenseFamily(upper: string): string {
  // 入口先判 proprietary：UNLICENSED/PROPRIETARY/COMMERCIAL/SSPL 必须在 permissive 的
  // "UNLICENSE" 子串之前拦截，否则 UNLICENSED 会被误判 permissive（S10）
  if (
    upper.includes("UNLICENSED") ||
    upper.includes("PROPRIETARY") ||
    upper.includes("COMMERCIAL") ||
    upper.includes("SSPL")
  )
    return "proprietary";
  const permissive = [
    "MIT",
    "MIT-0",
    "APACHE",
    "ASL-2.0",
    "BSD",
    "ISC",
    "UNLICENSE",
    "ZLIB",
    "0BSD",
    "CC0",
    "WTFPL",
  ];
  if (permissive.some((p) => upper.includes(p))) return "permissive";
  const weak = ["LGPL", "MPL", "EPL", "EUPL", "CDDL", "CPL"];
  if (weak.some((w) => upper.includes(w))) return "weak-copyleft";
  if (upper.includes("GPL") || upper.includes("AGPL")) return "strong-copyleft";
  return "unknown";
}

/** 单个许可证评分（先 SPDX 规范化，再家族分级派生；与 MoonBit single_license_score 一致） */
function singleLicenseScore(lic: string): number {
  switch (licenseFamily(normalizeLicenseToken(lic).toUpperCase())) {
    case "permissive":
      return 100;
    case "weak-copyleft":
      return 60;
    case "strong-copyleft":
      return 30;
    case "proprietary":
      return 40;
    default:
      return 50;
  }
}

/**
 * SPDX token 规范化：剥括号 → 去 WITH 异常子句 → 大写去空白 → 常见变体映射规范 SPDX id。
 * 未命中变体表时返回大写去空白的原 token（供 license_family 子串匹配兜底）。
 * 与 MoonBit scoring.mbt normalize_license_token 一致。
 */
function normalizeLicenseToken(s: string): string {
  const cleaned = cleanLicenseToken(s).toUpperCase();
  // WITH 异常子句（如 "Apache-2.0 WITH LLVM-exception"）：取主许可证
  const withIdx = cleaned.indexOf(" WITH ");
  const main = withIdx >= 0 ? cleaned.substring(0, withIdx).trim() : cleaned;
  // 移除全部空白
  const key = main.replace(/[ \t]/g, "");
  return variantSpdxId(key) ?? key;
}

/** 常见非规范写法 → 规范 SPDX id（输入已 upper + 去全部空白，精确匹配） */
function variantSpdxId(key: string): string | null {
  switch (key) {
    case "APACHE":
    case "APACHE2":
    case "APACHE2.0":
    case "APACHE-2.0":
    case "APACHELICENSE":
    case "APACHELICENSE2":
    case "APACHELICENSE2.0":
    case "ASL2.0":
    case "ASL-2.0":
      return "Apache-2.0";
    case "APACHE1.1":
    case "APACHE-1.1":
    case "APACHELICENSE1.1":
      return "Apache-1.1";
    case "MIT":
    case "MITLICENSE":
    case "THEMITLICENSE":
      return "MIT";
    case "MIT-0":
    case "MIT0":
      return "MIT-0";
    case "BSD":
    case "BSD3":
    case "BSD-3":
    case "BSD3CLAUSE":
    case "BSD-3-CLAUSE":
    case "BSD3-CLAUSE":
      return "BSD-3-Clause";
    case "BSD2":
    case "BSD-2":
    case "BSD2CLAUSE":
    case "BSD-2-CLAUSE":
    case "BSD2-CLAUSE":
      return "BSD-2-Clause";
    case "GPL":
    case "GPL2":
    case "GPLV2":
    case "GPL2.0":
    case "GPL-2.0":
    case "GPL-2":
    case "GPLV2.0":
      return "GPL-2.0";
    case "GPL3":
    case "GPLV3":
    case "GPL3.0":
    case "GPL-3.0":
    case "GPL-3":
    case "GPLV3.0":
      return "GPL-3.0";
    case "AGPL":
    case "AGPL3":
    case "AGPLV3":
    case "AGPL3.0":
    case "AGPL-3.0":
    case "AGPLV3.0":
      return "AGPL-3.0";
    case "LGPL":
    case "LGPL2":
    case "LGPLV2":
    case "LGPL2.1":
    case "LGPL-2.1":
    case "LGPLV2.1":
      return "LGPL-2.1";
    case "LGPL3":
    case "LGPLV3":
    case "LGPL3.0":
    case "LGPL-3.0":
    case "LGPLV3.0":
      return "LGPL-3.0";
    case "MPL":
    case "MPL2":
    case "MPL2.0":
    case "MPL-2.0":
      return "MPL-2.0";
    case "EPL":
    case "EPL2":
    case "EPL2.0":
    case "EPL-2.0":
      return "EPL-2.0";
    case "EPL1":
    case "EPL1.0":
    case "EPL-1.0":
      return "EPL-1.0";
    case "ISC":
      return "ISC";
    case "WTFPL":
      return "WTFPL";
    case "ZLIB":
      return "Zlib";
    case "0BSD":
      return "0BSD";
    case "CC0":
    case "CC01":
    case "CC01.0":
    case "CC0-1.0":
      return "CC0-1.0";
    case "UNLICENSE":
    case "THEUNLICENSE":
      return "Unlicense";
    case "SSPL":
    case "SSPL1.0":
    case "SSPL-1.0":
      return "SSPL-1.0";
    default:
      return null;
  }
}

/**
 * 从 LICENSE 文本推断 SPDX 许可证 id（识别失败返回 null）。
 * 判定基于 SPDX 标准许可证全文的关键特征串；匹配顺序保证 AGPL/LGPL 先于 GPL。
 * 注意 "UNLICENSED"（未授权）不等于 Unlicense，显式排除。
 * 与 MoonBit license_detect.mbt detect_license_from_text 一致。
 */
export function detectLicenseFromText(text: string): string | null {
  const upper = text.toUpperCase();

  // strong copyleft 家族（先长后短）
  if (upper.includes("GNU AFFERO GENERAL PUBLIC LICENSE")) {
    return upper.includes("VERSION 3") ? "AGPL-3.0" : "AGPL-1.0";
  }
  if (
    upper.includes("GNU LESSER GENERAL PUBLIC LICENSE") ||
    upper.includes("GNU LIBRARY GENERAL PUBLIC LICENSE")
  ) {
    return upper.includes("VERSION 3") ? "LGPL-3.0" : "LGPL-2.1";
  }
  if (upper.includes("GNU GENERAL PUBLIC LICENSE")) {
    return upper.includes("VERSION 3") ? "GPL-3.0" : "GPL-2.0";
  }
  if (upper.includes("SERVER SIDE PUBLIC LICENSE")) return "SSPL-1.0";

  // weak copyleft 家族
  if (upper.includes("MOZILLA PUBLIC LICENSE")) {
    return upper.includes("2.0") ? "MPL-2.0" : "MPL-1.1";
  }
  if (upper.includes("ECLIPSE PUBLIC LICENSE")) {
    return upper.includes("2.0") ? "EPL-2.0" : "EPL-1.0";
  }
  if (upper.includes("EUROPEAN UNION PUBLIC LICEN")) return "EUPL-1.2";
  if (upper.includes("COMMON DEVELOPMENT AND DISTRIBUTION LICENSE"))
    return "CDDL-1.0";

  // permissive 家族
  if (upper.includes("APACHE LICENSE") || upper.includes("APACHE-2.0"))
    return "Apache-2.0";
  if (
    upper.includes("MIT LICENSE") ||
    upper.includes("PERMISSION IS HEREBY GRANTED") ||
    upper.includes("THE MIT LICENSE (MIT)")
  )
    return "MIT";
  if (
    upper.includes("BSD 3-CLAUSE") ||
    (upper.includes("REDISTRIBUTION AND USE") &&
      upper.includes("NEITHER THE NAME"))
  )
    return "BSD-3-Clause";
  if (upper.includes("REDISTRIBUTION AND USE")) return "BSD-2-Clause";
  if (upper.includes("ISC LICENSE") || upper.includes("THE ISC LICENSE"))
    return "ISC";
  if (
    upper.includes("CREATIVE COMMONS ZERO") ||
    (upper.includes("CC0") && upper.includes("PUBLIC DOMAIN"))
  )
    return "CC0-1.0";
  if (upper.includes("WTFPL")) return "WTFPL";
  if (
    upper.includes("THE UNLICENSE") ||
    (upper.includes("UNLICENSE") && !upper.includes("UNLICENSED"))
  )
    return "Unlicense";
  if (upper.includes("ZLIB")) return "Zlib";

  return null;
}

/** 去掉表达式 token 的括号与空白 */
function cleanLicenseToken(s: string): string {
  let c = s.trim();
  while (c.startsWith("(")) c = c.slice(1).trim();
  while (c.length > 0 && c.endsWith(")")) c = c.slice(0, -1).trim();
  return c;
}

/** 括号平衡检查（与 MoonBit license_paren_balanced 一致） */
function licenseParenBalanced(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * 剥掉整体包裹的最外层括号对：仅当首个 '(' 的配对 ')' 之后只剩空白才算整体包裹
 *（如 "(MIT OR Apache-2.0)" → "MIT OR Apache-2.0"；"((a))" 循环剥至 "a"）。
 * 配对失败或后面还有内容则原样返回。与 MoonBit strip_outer_parens 一致。
 */
function stripOuterParens(s: string): string {
  let t = s.trim();
  while (t.startsWith("(")) {
    const n = t.length;
    let depth = 0;
    let close = -1;
    for (let i = 0; i < n; i++) {
      const c = t[i];
      if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) break;
    // 配对 ')' 后必须只剩空白，否则不是整体包裹（如 "(a) (b)"）
    if (t.slice(close + 1).trim() === "") {
      t = t.slice(1, close).trim();
    } else {
      break;
    }
  }
  return t;
}

/**
 * 在 s 的 i 位置尝试匹配小写连接词 conn（前后需为操作数边界：前为空白/起始，后为空白）。
 * 避免 "andromeda"/"andr" 误判。与 MoonBit license_match_conn 一致。
 */
function licenseMatchConn(s: string, i: number, conn: string): boolean {
  const clen = conn.length;
  if (i + clen > s.length) return false;
  // 前缀必须为空格或起始
  if (i > 0) {
    const prev = s[i - 1];
    if (prev !== " " && prev !== "\t") return false;
  }
  // 逐字符小写比较
  for (let k = 0; k < clen; k++) {
    if (s[i + k].toLowerCase() !== conn[k]) return false;
  }
  // 后缀必须为空白（连接词后须跟操作数）
  const after = i + clen;
  if (after >= s.length) return false;
  const next = s[after];
  return next === " " || next === "\t";
}

/**
 * 自顶向下按连接词拆分（跳过括号内部，大小写不敏感，操作数含空白才算连接词）。
 * 返回 null 表示无该连接词。兼容 "MIT/Apache-2.0" 双许可证简写（视作 OR）。
 * 与 MoonBit split_license_top 一致。
 */
function splitLicenseTop(expr: string, conn: "or" | "and"): string[] | null {
  const s = expr.trim();
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "(") {
      depth += 1;
      cur += "(";
      i += 1;
    } else if (c === ")") {
      depth -= 1;
      cur += ")";
      i += 1;
    } else if (depth === 0 && licenseMatchConn(s, i, conn)) {
      parts.push(cur);
      cur = "";
      i += conn.length;
    } else {
      cur += c;
      i += 1;
    }
  }
  if (parts.length === 0) return null;
  // 末尾操作数
  parts.push(cur);
  // 兼容 "MIT/Apache-2.0" 双许可证简写：OR 分支按 "/" 再切
  if (conn === "or") {
    const expanded: string[] = [];
    for (const p of parts) {
      for (const seg of p.split("/")) {
        expanded.push(seg.trim());
      }
    }
    return expanded;
  }
  return parts;
}

/**
 * SPDX 许可证表达式评分：大小写不敏感 + 括号递归解析。
 * 括号平衡 → 自顶向下按 OR / AND 切分（括号块作整体 token）；
 * 不平衡/无连接词 → 保守 fallback 为单个 token（cleanLicenseToken 剥括号），
 * 无法解析的表达式计 50（unknown 中位分）。与 MoonBit license_expr_score 一致。
 */
function licenseExprScore(expr: string): number {
  return licenseExprScoreInner(expr.trim());
}

function licenseExprScoreInner(expr: string): number {
  const t0 = expr.trim();
  if (t0 === "") return 50;
  // 整体被括号包裹时先剥外层（如 "(MIT OR Apache-2.0)"），内层连接词才能升到顶层拆分
  const t = stripOuterParens(t0);
  // 括号不平衡 → 保守 fallback 为单个 token
  if (!licenseParenBalanced(t)) return singleLicenseScore(cleanLicenseToken(t));

  // 自顶向下按 OR 拆分（括号保护），OR 命中则各分支取最优
  const orParts = splitLicenseTop(t, "or");
  if (orParts) {
    let best = 0;
    for (const p of orParts) {
      const s = licenseAndScore(p);
      if (s > best) best = s;
    }
    return best;
  }
  return licenseAndScore(t);
}

/** AND 组合：取各分支最差（合规义务叠加），与 MoonBit license_and_score 一致 */
function licenseAndScore(expr: string): number {
  const andParts = splitLicenseTop(expr.trim(), "and");
  if (andParts) {
    let worst = 100;
    for (const p of andParts) {
      const s = licenseExprScoreInner(p);
      if (s < worst) worst = s;
    }
    return worst;
  }
  return singleLicenseScore(cleanLicenseToken(expr.trim()));
}

function scoreCompliance(meta: NodeMetaInput): number {
  // 与 WASM 一致：评分只认 meta.license（root 的 license 已由引擎回填进 meta），
  // 不回退模块文本里的 license；无许可证 → 40 分
  const license = meta.license;
  if (!license) return 40;
  return licenseExprScore(license);
}

function scoreDeprecated(meta: NodeMetaInput): number {
  const total = meta.total_api_count || 0;
  const depCount = (meta.deprecated_apis || []).length;
  if (total === 0) return 100;
  const ratio = depCount / total;
  return Math.max(0, Math.round(100 - ratio * 500)); // 20% 废弃 → 0 分
}

function scoreSize(meta: NodeMetaInput): number {
  const size = meta.self_size || 0;
  if (size === 0) return 80;
  if (size < 100_000) return 100;
  if (size < 500_000) return 80;
  if (size < 1_000_000) return 60;
  if (size < 5_000_000) return 40;
  return 20;
}

function scoreActivity(meta: NodeMetaInput): number {
  const days = meta.last_commit_days_ago;
  if (days == null) return 50;
  if (days < 30) return 100;
  if (days < 90) return 90;
  if (days < 180) return 70;
  if (days < 365) return 40;
  return 10;
}

function computeHealthScore(node: GraphNode, meta: NodeMetaInput): HealthScore {
  // 与 WASM compute_health_scores 一致：用节点自身 name/version 构造 Module
  const mod: ParsedMod = {
    name: node.name,
    version: node.version,
    license: null,
    deps: {},
  };
  const freshness = scoreFreshness(mod, meta);
  const compliance = scoreCompliance(meta);
  const deprecated = scoreDeprecated(meta);
  const size = scoreSize(meta);
  const activity = scoreActivity(meta);

  const rawTotal = Math.round(
    freshness * WEIGHTS.freshness +
      compliance * WEIGHTS.compliance +
      deprecated * WEIGHTS.deprecated +
      size * WEIGHTS.size +
      activity * WEIGHTS.activity,
  );
  // 入户口径统一钳制：坏数据下总分稳定落在 [0,100]（S11，镜像 scoring.mbt）
  const total = Math.max(0, Math.min(100, rawTotal));

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

function makeDiagnostic(
  code: string,
  severity: Severity,
  nodeId: string,
  msg: string,
): Diagnostic {
  return { code, severity, node_id: nodeId, message: msg };
}

/**
 * 是否 strong-copyleft（先经 SPDX 规范化再判家族，"g p l v 3" 之类变体也能识别）。
 * 与 MoonBit diagnose.mbt is_strong_copyleft 一致。
 */
function isStrongCopyleft(upper: string): boolean {
  return licenseFamily(normalizeLicenseToken(upper)) === "strong-copyleft";
}

/** 同名节点分组（仅保留多版本组，按图节点顺序） */
function groupNodesByName(
  graph: DepGraph,
): Array<{ name: string; nodes: GraphNode[] }> {
  const byName = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const arr = byName.get(node.name);
    if (arr) arr.push(node);
    else byName.set(node.name, [node]);
  }
  const out: Array<{ name: string; nodes: GraphNode[] }> = [];
  for (const [name, nodes] of byName) {
    if (nodes.length > 1) out.push({ name, nodes });
  }
  return out;
}

/** 组内最新版本节点（按 parseVersion 比较，无法解析则保持首个） */
function newestNode(nodes: GraphNode[]): GraphNode {
  let newest = nodes[0];
  for (const n of nodes) {
    const a = parseVersion(newest.version);
    const b = parseVersion(n.version);
    if (a && b) {
      const cmp =
        b.major !== a.major
          ? b.major - a.major
          : b.minor !== a.minor
            ? b.minor - a.minor
            : b.patch - a.patch;
      if (cmp > 0) newest = n;
    }
  }
  return newest;
}

/// 版本三元组比较（镜像 MoonBit version_compare）
function versionCompare(a: VersionParts, b: VersionParts): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * 判向 outdated 检查（S13）：仅当两版本均可解析且 cur < latest 才算落后。
 * 领先版本（cur >= latest）不告警、不建议升级，避免 "降级式升级" 误导。
 */
function isOutdated(current: string, latest: string): boolean {
  const cur = parseVersion(current);
  const lat = parseVersion(latest);
  if (!cur || !lat) return false;
  return versionCompare(cur, lat) < 0;
}

function diagnose(
  graph: DepGraph,
  metas: Record<string, NodeMetaInput>,
): Diagnostic[] {
  const diags: Diagnostic[] = [];

  for (const node of graph.nodes) {
    const meta = metas[node.id] || {};

    // YANKED-001（critical）
    if (meta.yanked) {
      let msg = node.id + " is yanked on mooncakes.io";
      if (meta.yanked_reason) msg = msg + ": " + meta.yanked_reason;
      diags.push(makeDiagnostic("YANKED-001", "critical", node.id, msg));
    }

    // OUTDATED-001（S13：仅落后才告警，领先/持平不告警）
    if (meta.latest_version && isOutdated(node.version, meta.latest_version)) {
      diags.push(
        makeDiagnostic(
          "OUTDATED-001",
          "warning",
          node.id,
          `${node.name} is at v${node.version} (latest ${meta.latest_version}); consider upgrading`,
        ),
      );
    }

    // LICENSE-001 / LICENSE-002（license 只认 meta，root 已由调用方回填）
    if (!meta.license) {
      diags.push(
        makeDiagnostic(
          "LICENSE-001",
          "info",
          node.id,
          `${node.name} declares no license; commercial use carries risk`,
        ),
      );
    } else if (isStrongCopyleft(meta.license.toUpperCase())) {
      diags.push(
        makeDiagnostic(
          "LICENSE-002",
          "warning",
          node.id,
          `${node.name} uses ${meta.license}; beware of copyleft obligations`,
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
          `${node.name} contains ${depApiCount} deprecated APIs`,
        ),
      );
    }

    // SIZE-001
    const size = meta.self_size || 0;
    if (size >= SIZE_WARN_THRESHOLD_BYTES) {
      diags.push(
        makeDiagnostic(
          "SIZE-001",
          "warning",
          node.id,
          `${node.name} is ${fmtBytes(size)}; consider slimming it down`,
        ),
      );
    }

    // ACTIVITY-001 / ACTIVITY-002
    const days = meta.last_commit_days_ago;
    if (days != null && days > ACTIVITY_STALE_DAYS) {
      diags.push(
        makeDiagnostic(
          "ACTIVITY-001",
          "critical",
          node.id,
          `${node.name} has not been updated in ${days} days and may be unmaintained`,
        ),
      );
    } else if (days != null && days > ACTIVITY_WARN_DAYS) {
      diags.push(
        makeDiagnostic(
          "ACTIVITY-002",
          "info",
          node.id,
          `${node.name} was last updated ${days} days ago`,
        ),
      );
    }
  }

  // DUP-001：同名多版本共存（非 newest 的节点告警）
  for (const group of groupNodesByName(graph)) {
    const newest = newestNode(group.nodes);
    const versionsMsg = group.nodes.map((n) => n.version).join(", ");
    for (const n of group.nodes) {
      if (n.id !== newest.id) {
        diags.push(
          makeDiagnostic(
            "DUP-001",
            "warning",
            n.id,
            `${group.name} has multiple versions in the graph (${versionsMsg}); v${n.version} is superseded by v${newest.version}`,
          ),
        );
      }
    }
  }

  // CYCLE-001：循环依赖（成环路径已含首尾重复节点）
  for (const cycle of findCycles(graph)) {
    const target = cycle.length > 0 ? cycle[cycle.length - 1] : graph.root_id;
    diags.push(
      makeDiagnostic(
        "CYCLE-001",
        "warning",
        target,
        "dependency cycle detected: " + cycle.join(" -> "),
      ),
    );
  }

  return diags;
}

// ===== 结构化修复建议（与 MoonBit build_suggestions 一致） =====

function impactRank(s: string): number {
  if (s === "high") return 0;
  if (s === "medium") return 1;
  return 2;
}

function buildSuggestions(
  graph: DepGraph,
  metas: Record<string, NodeMetaInput>,
): Suggestion[] {
  const sugs: Suggestion[] = [];

  for (const node of graph.nodes) {
    const meta = metas[node.id] || {};

    // YANKED-001（high）
    if (meta.yanked) {
      // latest 与当前版本相同（连最新版都被 yank）→ 只能移除
      let cmd: string;
      if (meta.latest_version) {
        cmd =
          meta.latest_version === node.version
            ? "moon remove " + node.name
            : "moon add " + node.name + "@" + meta.latest_version;
      } else {
        cmd = "moon remove " + node.name;
      }
      sugs.push({
        code: "YANKED-001",
        node_id: node.id,
        action: "Replace yanked " + node.id,
        command: cmd,
        impact: "high",
      });
    }

    // OUTDATED-001（major→high / minor→medium / 其余→low；S13：仅落后才建议升级）
    if (meta.latest_version && isOutdated(node.version, meta.latest_version)) {
      const cur = parseVersion(node.version);
      const latest = parseVersion(meta.latest_version);
      let impact: Suggestion["impact"];
      if (cur && latest) {
        if (cur.major < latest.major) impact = "high";
        else if (cur.minor < latest.minor) impact = "medium";
        else impact = "low";
      } else {
        impact = "low";
      }
      sugs.push({
        code: "OUTDATED-001",
        node_id: node.id,
        action: "Upgrade " + node.name + " to v" + meta.latest_version,
        command: "moon add " + node.name + "@" + meta.latest_version,
        impact,
      });
    }

    // LICENSE-002 / LICENSE-001
    if (meta.license) {
      if (isStrongCopyleft(meta.license.toUpperCase())) {
        sugs.push({
          code: "LICENSE-002",
          node_id: node.id,
          action:
            "Review copyleft obligations of " +
            node.name +
            " (" +
            meta.license +
            ") or find an alternative",
          command: "",
          impact: "medium",
        });
      }
    } else {
      sugs.push({
        code: "LICENSE-001",
        node_id: node.id,
        action: "Add a license declaration to " + node.name,
        command: "",
        impact: "low",
      });
    }

    // ACTIVITY-001
    if (
      meta.last_commit_days_ago != null &&
      meta.last_commit_days_ago > ACTIVITY_STALE_DAYS
    ) {
      sugs.push({
        code: "ACTIVITY-001",
        node_id: node.id,
        action:
          "Consider replacing unmaintained " +
          node.name +
          " (last update " +
          meta.last_commit_days_ago +
          " days ago)",
        command: "",
        impact: "medium",
      });
    }

    // DEPRECATED-001
    const depCount = (meta.deprecated_apis || []).length;
    if (depCount > 0) {
      sugs.push({
        code: "DEPRECATED-001",
        node_id: node.id,
        action: "Migrate off " + depCount + " deprecated APIs in " + node.name,
        command: "",
        impact: "low",
      });
    }

    // SIZE-001
    if ((meta.self_size || 0) >= SIZE_WARN_THRESHOLD_BYTES) {
      sugs.push({
        code: "SIZE-001",
        node_id: node.id,
        action:
          "Find a lighter alternative to " +
          node.name +
          " (" +
          fmtBytes(meta.self_size || 0) +
          ")",
        command: "",
        impact: "low",
      });
    }
  }

  // DUP-001：合并多版本
  for (const group of groupNodesByName(graph)) {
    const newest = newestNode(group.nodes);
    for (const n of group.nodes) {
      if (n.id !== newest.id) {
        sugs.push({
          code: "DUP-001",
          node_id: n.id,
          action:
            "Consolidate " +
            group.name +
            " to a single version (newest v" +
            newest.version +
            ")",
          command: "moon add " + group.name + "@" + newest.version,
          impact: "medium",
        });
      }
    }
  }

  // CYCLE-001（high）：打破循环依赖
  for (const cycle of findCycles(graph)) {
    // 路径首尾重复，展示时去掉最后一个
    const members = cycle.length > 1 ? cycle.slice(0, cycle.length - 1) : cycle;
    const target = cycle.length > 0 ? cycle[cycle.length - 1] : graph.root_id;
    sugs.push({
      code: "CYCLE-001",
      node_id: target,
      action: "Break the dependency cycle involving " + members.join(", "),
      command: "",
      impact: "high",
    });
  }

  sugs.sort((a, b) => impactRank(a.impact) - impactRank(b.impact));
  return sugs;
}

export function fmtBytes(n: number): string {
  // S11 防御：非有限值/负值一律按 0 展示，避免 NaN/负数体积文本
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ===== 体积传递计算 =====

function computeTransitiveSize(
  graph: DepGraph,
  metas: Record<string, NodeMetaInput>,
): SizeOffender[] {
  // 反向邻接：child -> parents
  const childrenMap = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!childrenMap.has(e.from)) childrenMap.set(e.from, []);
    childrenMap.get(e.from)!.push(e.to);
  }

  const memo = new Map<string, number>();
  function transitiveSize(id: string): number {
    if (memo.has(id)) return memo.get(id)!;
    const selfSize = (metas[id] || {}).self_size || 0;
    let total = selfSize;
    const visited = new Set([id]);
    const queue = [...(childrenMap.get(id) || [])];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      total += (metas[cur] || {}).self_size || 0;
      queue.push(...(childrenMap.get(cur) || []));
    }
    memo.set(id, total);
    return total;
  }

  return (
    graph.nodes
      .map((n) => ({
        node_id: n.id,
        self_size: (metas[n.id] || {}).self_size || 0,
        transitive_size: transitiveSize(n.id),
      }))
      // 三向比较降序（与 size.mbt sort_by 一致，避免减法比较歧义）
      .sort((a, b) =>
        a.transitive_size > b.transitive_size
          ? -1
          : a.transitive_size < b.transitive_size
            ? 1
            : 0,
      )
  );
}

// ===== 生态统计 =====

function computeEcosystemStats(
  graph: DepGraph,
  healthScores: HealthScore[],
  metas: Record<string, NodeMetaInput>,
  rootId: string,
): EcosystemStats {
  const directDeps = graph.edges.filter((e) => e.from === rootId).length;
  const uniqueLicenses = new Set<string>();
  const licenseFamilies: Record<string, number> = {
    permissive: 0,
    "weak-copyleft": 0,
    "strong-copyleft": 0,
    proprietary: 0,
    unknown: 0,
  };
  let totalSize = 0;
  let totalDeprecated = 0;

  for (const node of graph.nodes) {
    const meta = metas[node.id] || {};
    let family = "unknown";
    if (meta.license) {
      // P3-M③：先归一化 token 再计数，"MIT"/" mit " 不重复计入 unique_licenses
      const normalized = normalizeLicenseToken(meta.license).toUpperCase();
      uniqueLicenses.add(normalized);
      family = licenseFamily(normalized);
    }
    licenseFamilies[family] += 1;
    // S11 防御层：负值/缺失 self_size 按 0 计入总量（镜像 stats.mbt）
    totalSize += meta.self_size != null && meta.self_size > 0 ? meta.self_size : 0;
    totalDeprecated += (meta.deprecated_apis || []).length;
  }

  // 与 WASM 一致：整数除法（截断）而非四舍五入
  const avgHealth =
    healthScores.length > 0
      ? Math.floor(
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
    license_families: licenseFamilies,
  };
}

// ===== 主入口 =====

export function runJsAnalyzer(request: AnalyzerRequest): AnalysisResult {
  try {
    if (request.type === "mod_text") {
      return analyzeSingleMod(request.mod_text);
    } else if (request.type === "context") {
      return analyzeContext(request.context);
    }
    return {
      error: `unknown request type: ${(request as { type: string }).type}`,
    } as AnalysisResult;
  } catch (e) {
    return {
      error: `analyzer exception: ${e instanceof Error ? e.message : String(e)}`,
    } as AnalysisResult;
  }
}

function analyzeSingleMod(modText: string): AnalysisResult {
  const rootMod = parseMod(modText);
  if (rootMod.parse_error) {
    return { error: `parse failed: ${rootMod.parse_error}` } as AnalysisResult;
  }
  const graph = buildGraph(rootMod, {}, 1);
  // 与 WASM build_shallow_metas 一致：仅 root 有 license，其余为空 meta
  const metas: Record<string, NodeMetaInput> = {};
  for (const n of graph.nodes) {
    metas[n.id] =
      n.id === graph.root_id
        ? {
            license: rootMod.license,
            license_source: rootMod.license ? "mod_text" : null,
            deprecated_apis: [],
            total_api_count: 0,
            self_size: 0,
          }
        : {};
  }

  const healthScores = graph.nodes.map((n) =>
    computeHealthScore(n, metas[n.id]),
  );
  const diags = diagnose(graph, metas);
  const suggestions = buildSuggestions(graph, metas);
  const sizeOffenders = computeTransitiveSize(graph, metas).slice(
    0,
    TOP_OFFENDERS_N,
  );
  const stats = computeEcosystemStats(
    graph,
    healthScores,
    metas,
    graph.root_id,
  );

  // analyzeSingleMod 无上下文解析阶段：parse_warnings 恒为空数组（镜像 api.mbt）
  return assembleResult(
    graph,
    rootMod,
    healthScores,
    diags,
    suggestions,
    sizeOffenders,
    stats,
    metas,
    [],
  );
}

/**
 * S11：归一负值 metadata（镜像 meta.mbt parse_node_meta）。
 * last_commit_days_ago 负值视为未知（null）；self_size/total_api_count 负值按 0。
 */
function normalizeMetaInput(meta: NodeMetaInput): NodeMetaInput {
  const out: NodeMetaInput = { ...meta };
  if (out.last_commit_days_ago != null && out.last_commit_days_ago < 0) {
    out.last_commit_days_ago = null;
  }
  if (out.self_size != null && out.self_size < 0) {
    out.self_size = 0;
  }
  if (out.total_api_count != null && out.total_api_count < 0) {
    out.total_api_count = 0;
  }
  return out;
}

function analyzeContext(ctx: AnalysisContext): AnalysisResult {
  // S15 步骤 0：context JSON 16MB 硬上限（与 WASM api.mbt 步骤 0 一致）
  if (JSON.stringify(ctx).length > MAX_CONTEXT_BYTES) {
    return {
      error: "context JSON exceeds 16MB size limit",
    } as AnalysisResult;
  }
  if (!ctx.root)
    return { error: "missing required field 'root'" } as AnalysisResult;
  const rootMod = parseMod(ctx.root);
  if (rootMod.parse_error) {
    return {
      error: `failed to parse root module: ${rootMod.parse_error}`,
    } as AnalysisResult;
  }

  // S15：类型不符的 modules/metadata/options 字段收集为 parse_warnings
  // （与 WASM api.mbt 逐字一致），不中断分析；max_depth 取整后钳制到 [1,64]
  const parseWarnings: string[] = [];

  const rawModules = ctx.modules;
  const modules: Record<string, string> = {};
  if (rawModules != null) {
    if (typeof rawModules === "object" && !Array.isArray(rawModules)) {
      for (const [key, value] of Object.entries(rawModules)) {
        if (typeof value === "string") {
          modules[key] = value;
        } else {
          parseWarnings.push(`modules["${key}"] is not a string; skipped`);
        }
      }
    } else {
      parseWarnings.push("context.modules is not an object; ignored");
    }
  }

  const rawMetadata = ctx.metadata;
  const metadata: Record<string, NodeMetaInput> = {};
  if (rawMetadata != null) {
    if (typeof rawMetadata === "object" && !Array.isArray(rawMetadata)) {
      Object.assign(metadata, rawMetadata);
    } else {
      parseWarnings.push("context.metadata is not an object; ignored");
    }
  }

  let maxDepth = DEFAULT_MAX_DEPTH;
  const rawOptions = ctx.options;
  if (rawOptions != null) {
    if (typeof rawOptions === "object" && !Array.isArray(rawOptions)) {
      const md = rawOptions.max_depth;
      if (md != null) {
        if (typeof md === "number" && Number.isFinite(md)) {
          maxDepth = Math.max(
            1,
            Math.min(MAX_DEPTH_HARD_LIMIT, Math.trunc(md)),
          );
        } else {
          parseWarnings.push(
            "options.max_depth is not a number; using default",
          );
        }
      }
    } else {
      parseWarnings.push("context.options is not an object; ignored");
    }
  }

  const graph = buildGraph(rootMod, modules, maxDepth);

  // 构建 metas（与 WASM build_node_metas 一致：metadata 仅认对象（其余按空 meta），
  // 先经 normalizeMetaInput 归一负值；license 缺失时回落 license_text 指纹推断；
  // root 即使 metadata 缺失也回填 root mod 的 license；不回退模块文本 license）
  const metas: Record<string, NodeMetaInput> = {};
  for (const n of graph.nodes) {
    const raw = metadata[n.id];
    const base =
      raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    // S11：归一负值 metadata（镜像 parse_node_meta），再进下游评分
    const meta: NodeMetaInput = normalizeMetaInput({ ...base });
    // LICENSE 文本指纹：metadata 未显式声明 license 时，从 LICENSE 原文推断
    if (!meta.license && meta.license_text) {
      const detected = detectLicenseFromText(meta.license_text);
      if (detected) {
        meta.license = detected;
        meta.license_source = "fingerprint";
      }
    }
    metas[n.id] = meta;
  }
  const rootMeta = metas[graph.root_id];
  if (rootMeta && !rootMeta.license && rootMod.license) {
    rootMeta.license = rootMod.license;
    rootMeta.license_source = "mod_text";
  }

  const healthScores = graph.nodes.map((n) =>
    computeHealthScore(n, metas[n.id]),
  );
  const diags = diagnose(graph, metas);
  const suggestions = buildSuggestions(graph, metas);
  const sizeOffenders = computeTransitiveSize(graph, metas).slice(
    0,
    TOP_OFFENDERS_N,
  );
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
    suggestions,
    sizeOffenders,
    stats,
    metas,
    parseWarnings,
  );
}

function assembleResult(
  graph: DepGraph,
  rootMod: ParsedMod,
  healthScores: HealthScore[],
  diags: Diagnostic[],
  suggestions: Suggestion[],
  sizeOffenders: SizeOffender[],
  stats: EcosystemStats,
  metas: Record<string, NodeMetaInput>,
  parseWarnings: string[],
): AnalysisResult {
  const crit = diags.filter((d) => d.severity === "critical").length;
  const warn = diags.filter((d) => d.severity === "warning").length;
  const info = diags.filter((d) => d.severity === "info").length;

  // 与 WASM 一致：整数除法（截断）而非四舍五入
  const overallScore =
    healthScores.length > 0
      ? Math.floor(
          healthScores.reduce((a, b) => a + b.total, 0) / healthScores.length,
        )
      : 0;

  // 序列化 metas（与 WASM serialize_node_metas 字段一致）
  const cleanMetas: Record<string, NodeMetaOutput> = {};
  for (const n of graph.nodes) {
    const meta = metas[n.id] || {};
    cleanMetas[n.id] = {
      license: meta.license || null,
      license_source: meta.license_source ?? null,
      latest_version: meta.latest_version || null,
      self_size: meta.self_size || 0,
      last_commit_days_ago:
        meta.last_commit_days_ago != null ? meta.last_commit_days_ago : null,
      total_api_count: meta.total_api_count || 0,
      deprecated_api_count: (meta.deprecated_apis || []).length,
      yanked: meta.yanked === true,
      yanked_reason: meta.yanked_reason ?? null,
      source_unavailable: meta.source_unavailable === true,
    };
  }

  return {
    overall_score: overallScore,
    node_count: graph.nodes.length,
    // v0.8.0-wasm 起：上下文解析告警（与 WASM 同字段同位置，node_count 之后）
    parse_warnings: parseWarnings,
    diagnostics: diags,
    suggestions,
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
