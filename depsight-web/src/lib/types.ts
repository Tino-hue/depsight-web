// ===== 全局类型定义 =====
// 与 MoonBit WASM 的 analyze_from_context_json 输入输出契约保持一致

/** 解析后的 moon.mod（TOML 或 JSON 双格式） */
export interface ParsedMod {
  name: string
  version: string
  license: string | null
  deps: Record<string, string>
  parse_error?: string
}

/** 依赖图节点 */
export interface GraphNode {
  id: string
  name: string
  version: string
  depth: number
}

/** 依赖图边 */
export interface GraphEdge {
  from: string
  to: string
}

/** 依赖图 */
export interface DepGraph {
  root_id: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** 五维健康分 */
export interface HealthScore {
  node_id: string
  total: number
  freshness: number
  compliance: number
  deprecated_density: number
  size_reasonableness: number
  activity: number
}

export type Severity = 'critical' | 'warning' | 'info'

/** 诊断项 */
export interface Diagnostic {
  code: string
  severity: Severity
  node_id: string
  message: string
}

/** 体积 TOP 条目 */
export interface SizeOffender {
  node_id: string
  self_size: number
  transitive_size: number
}

/** 生态统计 */
export interface EcosystemStats {
  total_packages: number
  direct_dependencies: number
  max_depth: number
  total_size_bytes: number
  total_deprecated_apis: number
  unique_licenses: number
  avg_health_score: number
}

/** 节点元数据（输入侧，允许附加字段） */
export interface NodeMetaInput {
  license?: string | null
  latest_version?: string | null
  repository?: string | null
  yanked?: boolean
  yanked_reason?: string
  last_commit_days_ago?: number | null
  self_size?: number
  total_api_count?: number
  deprecated_apis?: string[]
  source_unavailable?: boolean
  [key: string]: unknown
}

/** 分析结果中输出的节点元数据 */
export interface NodeMetaOutput {
  license: string | null
  latest_version: string | null
  self_size: number
  last_commit_days_ago: number | null
  total_api_count: number
  deprecated_api_count: number
}

/** 完整分析结果 */
export interface AnalysisResult {
  overall_score: number
  node_count: number
  diagnostics: Diagnostic[]
  health_scores: HealthScore[]
  summary: { critical: number; warning: number; info: number }
  graph: DepGraph
  size_offenders_top5: SizeOffender[]
  node_metas: Record<string, NodeMetaOutput>
  ecosystem_stats: EcosystemStats
  /** 根 moon.mod，供前端使用，不属于 WASM 契约 */
  _root_mod?: ParsedMod
  error?: string
}

/** 分析请求 */
export type AnalyzerRequest =
  | { type: 'mod_text'; mod_text: string }
  | { type: 'context'; context: AnalysisContext }

/** context 输入：root + modules + metadata */
export interface AnalysisContext {
  root: string
  modules: Record<string, string>
  metadata: Record<string, NodeMetaInput>
  options?: { max_depth?: number }
}

/** WASM 加载状态 */
export type WasmStatus = 'loading' | 'loaded' | 'fallback'

export interface WasmInitResult {
  instance: WebAssembly.Instance | null
  useWasm: boolean
  status: 'loaded' | 'fallback'
}

/** mooncakes.io 模块列表条目 */
export interface MooncakesModule {
  name: string
  version?: string
  license?: string | null
  repository?: string | null
  description?: string | null
  keywords?: string[]
  yanked?: boolean
  yanked_reason?: string
  created_at?: string
  [key: string]: unknown
}

/** mooncakes.io manifest */
export interface ModuleManifest {
  latest_version?: string
  repository?: string | null
  yanked?: boolean
  yanked_reason?: string
  metadata?: { created_at?: string }
  [key: string]: unknown
}

/** 趋势数据点 */
export interface TrendPoint {
  date: string
  score: number
}

export type TrendMap = Record<string, TrendPoint[]>

/** 生态大盘数据 */
export interface EcosystemData {
  overall_health: number
  total_packages: number
  active_packages: number
  stale_packages: number
  unlicensed_count?: number
  license_distribution?: Record<string, number>
  recently_published?: number
  top_packages: EcoTopPackage[]
  risk_type_counts: Record<string, number>
  score_distribution: Record<string, number>
  isReal?: boolean
}

export interface EcoTopPackage {
  name: string
  version?: string
  license?: string | null
  days_ago?: number | null
  repository?: string | null
  description?: string
  downloads?: number
  health?: number
}

/** 3D 图选中节点信息 */
export interface SelectedNodeInfo {
  node: GraphNode
  health: number
  meta?: NodeMetaOutput
}

/** 应用视图 */
export type AppView = 'analyze' | 'graph' | 'trends' | 'ecosystem'
