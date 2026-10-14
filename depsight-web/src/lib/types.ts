// ===== 全局类型定义 =====
// 与 MoonBit WASM（d:\MoonStep\moonbit，wasm-gc + use-js-builtin-string）的导出契约保持一致：
//   analyze_from_context_json(contextJson: string) -> string   （输入/输出均为 JSON 字符串）
//   analyze_from_mod_text(modText: string) -> string           （输入/输出均为 JSON 字符串）
//   version() -> string                                        （返回 "0.8.0-wasm"）
// WASM 侧由 js-string builtins 映射为 JS string，无需 Bytes/Uint8Array 编解码。
//
// v0.7.0-wasm 契约变更：新增 yanked / source_unavailable 元数据字段、
// 结构化 suggestions 输出、DUP-001 诊断码；许可证评分支持 SPDX 表达式。
// v0.8.0-wasm 契约变更：新增 CYCLE-001 循环依赖诊断、graph nodes 的
// version_resolved 标记、node_metas 的 license_source（manifest/mod_text/fingerprint）、
// ecosystem_stats.license_families 家族分布、metadata.license_text 指纹推断、
// SPDX 表达式规范化（变体映射 + WITH 异常子句剥离）。

/** 解析后的 moon.mod（TOML 或 JSON 双格式） */
export interface ParsedMod {
  name: string;
  version: string;
  license: string | null;
  deps: Record<string, string>;
  parse_error?: string;
}

/** 依赖图节点 */
export interface GraphNode {
  id: string;
  name: string;
  version: string;
  /** v0.8.0-wasm 起：version 为 "latest" 时显式标记未解析 */
  version_resolved: boolean;
  depth: number;
}

/** 依赖图边 */
export interface GraphEdge {
  from: string;
  to: string;
}

/** 依赖图 */
export interface DepGraph {
  root_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** 五维健康分 */
export interface HealthScore {
  node_id: string;
  total: number;
  freshness: number;
  compliance: number;
  deprecated_density: number;
  size_reasonableness: number;
  activity: number;
}

export type Severity = "critical" | "warning" | "info";

/** 诊断项 */
export interface Diagnostic {
  code: string;
  severity: Severity;
  node_id: string;
  message: string;
}

/** 体积 TOP 条目 */
export interface SizeOffender {
  node_id: string;
  self_size: number;
  transitive_size: number;
}

/** 生态统计 */
export interface EcosystemStats {
  total_packages: number;
  direct_dependencies: number;
  max_depth: number;
  total_size_bytes: number;
  total_deprecated_apis: number;
  unique_licenses: number;
  avg_health_score: number;
  /** v0.8.0-wasm 起：许可证家族分布（permissive/weak-copyleft/strong-copyleft/proprietary/unknown 恒输出） */
  license_families: Record<string, number>;
}

/** 节点元数据（输入侧，允许附加字段） */
export interface NodeMetaInput {
  license?: string | null;
  /** v0.8.0-wasm 起：LICENSE 文件原文，metadata.license 缺失时由引擎做文本指纹推断 */
  license_text?: string;
  /** v0.8.0-wasm 起：许可证来源标注（manifest/mod_text/fingerprint），fetcher 侧透传 */
  license_source?: string | null;
  latest_version?: string | null;
  repository?: string | null;
  yanked?: boolean;
  yanked_reason?: string;
  last_commit_days_ago?: number | null;
  self_size?: number;
  total_api_count?: number;
  deprecated_apis?: string[];
  source_unavailable?: boolean;
  [key: string]: unknown;
}

/** 结构化修复建议（WASM v0.7.0-wasm 起输出，按 impact 降序排列） */
export interface Suggestion {
  code: string;
  node_id: string;
  action: string;
  /** 可执行命令；无需命令时为空字符串（如许可证审查类） */
  command: string;
  impact: "high" | "medium" | "low";
}

/** 分析结果中输出的节点元数据 */
export interface NodeMetaOutput {
  license: string | null;
  /** v0.8.0-wasm 起：manifest / mod_text / fingerprint，无许可证时为 null */
  license_source: string | null;
  latest_version: string | null;
  self_size: number;
  last_commit_days_ago: number | null;
  total_api_count: number;
  deprecated_api_count: number;
  yanked: boolean;
  yanked_reason: string | null;
  source_unavailable: boolean;
}

/** 完整分析结果 */
export interface AnalysisResult {
  overall_score: number;
  node_count: number;
  diagnostics: Diagnostic[];
  /** v0.7.0-wasm 起由引擎生成；JS fallback 同步输出 */
  suggestions: Suggestion[];
  health_scores: HealthScore[];
  summary: { critical: number; warning: number; info: number };
  graph: DepGraph;
  size_offenders_top5: SizeOffender[];
  node_metas: Record<string, NodeMetaOutput>;
  ecosystem_stats: EcosystemStats;
  /** 根 moon.mod（WASM 自 v0.6.0-wasm 起随结果返回；JS fallback 亦提供） */
  _root_mod?: ParsedMod;
  error?: string;
}

/** 分析请求 */
export type AnalyzerRequest =
  | { type: "mod_text"; mod_text: string }
  | { type: "context"; context: AnalysisContext };

/** context 输入：root + modules + metadata */
export interface AnalysisContext {
  root: string;
  modules: Record<string, string>;
  metadata: Record<string, NodeMetaInput>;
  options?: { max_depth?: number };
}

/** WASM 加载状态 */
export type WasmStatus = "loading" | "loaded" | "fallback";

export interface WasmInitResult {
  instance: WebAssembly.Instance | null;
  useWasm: boolean;
  status: "loaded" | "fallback";
}

/** mooncakes.io 模块列表条目 */
export interface MooncakesModule {
  name: string;
  version?: string;
  license?: string | null;
  repository?: string | null;
  description?: string | null;
  keywords?: string[];
  yanked?: boolean;
  yanked_reason?: string;
  created_at?: string;
  [key: string]: unknown;
}

/** mooncakes.io manifest */
export interface ModuleManifest {
  latest_version?: string;
  repository?: string | null;
  yanked?: boolean;
  yanked_reason?: string;
  metadata?: { created_at?: string; license?: string | null };
  [key: string]: unknown;
}

/** 趋势数据点 */
export interface TrendPoint {
  date: string;
  score: number;
}

export type TrendMap = Record<string, TrendPoint[]>;

/** 生态大盘数据 */
export interface EcosystemData {
  overall_health: number;
  total_packages: number;
  active_packages: number;
  stale_packages: number;
  unlicensed_count?: number;
  license_distribution?: Record<string, number>;
  recently_published?: number;
  top_packages: EcoTopPackage[];
  risk_type_counts: Record<string, number>;
  score_distribution: Record<string, number>;
  isReal?: boolean;
}

export interface EcoTopPackage {
  name: string;
  version?: string;
  license?: string | null;
  days_ago?: number | null;
  repository?: string | null;
  description?: string;
  downloads?: number;
  health?: number;
}

/** 3D 图选中节点信息 */
export interface SelectedNodeInfo {
  node: GraphNode;
  health: number;
  meta?: NodeMetaOutput;
}

/** 应用视图（hero = 落地首页，其余为工作台视图；"404" 为客户端未匹配视图） */
export type AppView =
  | "hero"
  | "analyze"
  | "graph"
  | "trends"
  | "ecosystem"
  | "404";
