// 内置示例数据：用于离线演示 / WASM 未加载时的 fallback
// 模拟一个真实的中等规模 MoonBit 项目的依赖图
// 从 js/demo-data.js 迁移

import type { AnalysisContext, EcosystemData, TrendMap } from './types'

interface DemoPackage {
  name: string
  version: string
  license: string | null
  deps: Record<string, string>
  self_size: number
  last_commit: number
  latest: string
  total_api: number
}

export async function loadDemoContext(): Promise<AnalysisContext> {
  const modules: Record<string, string> = {}
  const metadata: AnalysisContext['metadata'] = {}

  // 模拟 12 个包的依赖关系
  const demoPackages: DemoPackage[] = [
    {
      name: 'my/app', version: '1.0.0', license: 'Apache-2.0',
      deps: { 'moonbitlang/core': '0.6.0', 'moonbitlang/x': '0.6.0', 'bobzhang/json': '1.0.0', 'tonyfettes/wave': '0.2.0' },
      self_size: 15000, last_commit: 5, latest: '1.0.0', total_api: 80,
    },
    {
      name: 'moonbitlang/core', version: '0.6.0', license: 'Apache-2.0',
      deps: {},
      self_size: 450000, last_commit: 3, latest: '0.7.0', total_api: 2048,
    },
    {
      name: 'moonbitlang/x', version: '0.6.0', license: 'Apache-2.0',
      deps: { 'moonbitlang/core': '0.6.0' },
      self_size: 280000, last_commit: 15, latest: '0.6.1', total_api: 512,
    },
    {
      name: 'bobzhang/json', version: '1.0.0', license: 'MIT',
      deps: { 'moonbitlang/core': '0.6.0' },
      self_size: 85000, last_commit: 30, latest: '1.2.0', total_api: 64,
    },
    {
      name: 'tonyfettes/wave', version: '0.2.0', license: 'MIT',
      deps: { 'moonbitlang/core': '0.6.0', 'moonbitlang/x': '0.6.0' },
      self_size: 120000, last_commit: 400, latest: '0.3.0', total_api: 96,
    },
    {
      name: 'lijunchen/unix', version: '0.1.0', license: null,
      deps: { 'moonbitlang/core': '0.6.0' },
      self_size: 45000, last_commit: 700, latest: '0.1.0', total_api: 32,
    },
    {
      name: 'peter/parser', version: '2.0.0', license: 'GPL-3.0',
      deps: { 'moonbitlang/core': '0.6.0' },
      self_size: 200000, last_commit: 10, latest: '2.1.0', total_api: 128,
    },
    {
      name: 'alice/ui', version: '0.5.0', license: 'MIT',
      deps: { 'moonbitlang/core': '0.6.0', 'alice/theme': '1.0.0' },
      self_size: 350000, last_commit: 60, latest: '0.5.0', total_api: 256,
    },
    {
      name: 'alice/theme', version: '1.0.0', license: 'MIT',
      deps: { 'moonbitlang/core': '0.6.0' },
      self_size: 80000, last_commit: 90, latest: '1.1.0', total_api: 48,
    },
    {
      name: 'crypto/hash', version: '3.0.0', license: 'Apache-2.0',
      deps: { 'moonbitlang/core': '0.6.0' },
      self_size: 60000, last_commit: 7, latest: '3.0.1', total_api: 40,
    },
    {
      name: 'net/http', version: '0.8.0', license: 'MIT',
      deps: { 'moonbitlang/core': '0.6.0', 'crypto/hash': '3.0.0' },
      self_size: 180000, last_commit: 20, latest: '0.9.0', total_api: 80,
    },
    {
      name: 'data/orm', version: '1.5.0', license: null,
      deps: { 'moonbitlang/core': '0.6.0', 'net/http': '0.8.0' },
      self_size: 220000, last_commit: 550, latest: '1.6.0', total_api: 160,
    },
  ]

  // 给 my/app 加更多传递依赖
  demoPackages[0].deps['lijunchen/unix'] = '0.1.0'
  demoPackages[0].deps['peter/parser'] = '2.0.0'
  demoPackages[0].deps['alice/ui'] = '0.5.0'
  demoPackages[0].deps['data/orm'] = '1.5.0'

  // 构造 modules（moon.mod.json 文本）
  for (const p of demoPackages) {
    if (p.name === 'my/app') continue // root 不放在 modules
    const id = `${p.name}@${p.version}`
    modules[id] = JSON.stringify({
      name: p.name,
      version: p.version,
      license: p.license,
      deps: p.deps,
    })
  }

  // 构造 metadata
  for (const p of demoPackages) {
    const id = `${p.name}@${p.version}`
    metadata[id] = {
      license: p.license,
      latest_version: p.latest,
      last_commit_days_ago: p.last_commit,
      self_size: p.self_size,
      total_api_count: p.total_api,
      deprecated_apis: p.name === 'tonyfettes/wave'
        ? ['old_play_fn', 'legacy_write']
        : p.name === 'data/orm'
          ? ['old_query']
          : [],
    }
  }

  // root 的 moon.mod.json
  const rootMod = demoPackages[0]
  const root = JSON.stringify({
    name: rootMod.name,
    version: rootMod.version,
    license: rootMod.license,
    deps: rootMod.deps,
  })

  return { root, modules, metadata, options: { max_depth: 5 } }
}

// 生成历史趋势 mock 数据
export function loadDemoTrends(): TrendMap {
  // 模拟 my/app 过去 90 天的健康分变化
  const points = []
  const today = new Date()
  for (let i = 89; i >= 0; i -= 7) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000)
    // 模拟分数在 65-85 之间波动
    const score = 65 + Math.round(Math.sin(i / 10) * 10 + Math.random() * 5)
    points.push({ date: d.toISOString().slice(0, 10), score })
  }
  return {
    'my/app': points,
    'moonbitlang/core': points.map((p) => ({ ...p, score: Math.min(100, p.score + 15) })),
    'alice/ui': points.map((p) => ({ ...p, score: Math.max(0, p.score - 8) })),
  }
}

// 生态大盘 mock 数据
export function loadDemoEcosystem(): EcosystemData {
  return {
    overall_health: 76,
    total_packages: 1284,
    active_packages: 892,
    stale_packages: 156,
    top_packages: [
      { name: 'moonbitlang/core', downloads: 152345, health: 92, license: 'Apache-2.0' },
      { name: 'moonbitlang/x', downloads: 89341, health: 85, license: 'Apache-2.0' },
      { name: 'bobzhang/json', downloads: 45213, health: 78, license: 'MIT' },
      { name: 'alice/ui', downloads: 34120, health: 72, license: 'MIT' },
      { name: 'net/http', downloads: 28901, health: 68, license: 'MIT' },
      { name: 'crypto/hash', downloads: 23456, health: 88, license: 'Apache-2.0' },
      { name: 'data/orm', downloads: 19876, health: 45, license: null },
      { name: 'peter/parser', downloads: 15432, health: 38, license: 'GPL-3.0' },
      { name: 'tonyfettes/wave', downloads: 12345, health: 52, license: 'MIT' },
      { name: 'lijunchen/unix', downloads: 9876, health: 28, license: null },
    ],
    risk_type_counts: {
      OUTDATED: 342,
      LICENSE: 89,
      DEPRECATED: 156,
      SIZE: 45,
      ACTIVITY: 234,
    },
    score_distribution: {
      '90-100': 312,
      '80-89': 423,
      '70-79': 287,
      '60-69': 134,
      '50-59': 67,
      '0-49': 61,
    },
  }
}
