// 冒烟测试：从 test/smoke.mjs 迁移的 18 条断言（Vitest 版）
// 契约与 WASM API 一致：overall_score / summary / diagnostics / health_scores(flat 5维) / graph(root_id=name@version) / node_metas
import { describe, expect, it } from 'vitest'
import { runJsAnalyzer } from './analyzer'
import { loadDemoContext, loadDemoEcosystem, loadDemoTrends } from './demo-data'

const DIM_KEYS = [
  'freshness',
  'compliance',
  'deprecated_density',
  'size_reasonableness',
  'activity',
] as const

const modText = `module my/app

name = "my/app"
version = "1.0.0"
license = "Apache-2.0"

import {
  "moonbitlang/core"
  "moonbitlang/x"
}
`

describe('analyzer smoke（迁移自 test/smoke.mjs）', () => {
  // 原 Test 1：TOML 解析 + 分析（5 条断言）
  it('TOML mod_text 解析 + 分析', () => {
    const r1 = runJsAnalyzer({ type: 'mod_text', mod_text: modText })
    expect(r1 && typeof r1 === 'object').toBe(true)
    expect(r1.graph?.root_id).toBe('my/app@1.0.0')
    expect(Array.isArray(r1.graph?.nodes)).toBe(true)
    expect(Array.isArray(r1.diagnostics)).toBe(true)
    expect(typeof r1.overall_score).toBe('number')
  })

  // 原 Test 2：demo context 完整分析（10 条断言）
  it('demo context 完整分析', async () => {
    const ctx = await loadDemoContext()
    const r2 = runJsAnalyzer({ type: 'context', context: ctx })
    const ctxRootName = (JSON.parse(ctx.root) as { name: string }).name
    expect(r2.graph.root_id).toBe(`${ctxRootName}@1.0.0`)
    expect(r2.graph.nodes.length).toBeGreaterThan(5)
    expect(r2.graph.edges.length).toBeGreaterThan(5)
    expect(r2.diagnostics.length).toBeGreaterThan(0)
    expect(typeof r2.ecosystem_stats.total_packages).toBe('number')
    expect(Array.isArray(r2.size_offenders_top5)).toBe(true)
    expect(r2.diagnostics.every((d) => d.code && d.message && d.severity)).toBe(true)
    expect(r2.overall_score).toBeGreaterThanOrEqual(0)
    expect(r2.overall_score).toBeLessThanOrEqual(100)
    expect(Array.isArray(r2.health_scores) && r2.health_scores.length > 0).toBe(true)
    for (const k of DIM_KEYS) {
      expect(typeof r2.health_scores[0][k]).toBe('number')
    }
  })

  // 原 Test 3：demo trends / ecosystem（2 条断言）
  it('demo trends & ecosystem', () => {
    const trends = loadDemoTrends()
    expect(Array.isArray(trends['my/app']) && trends['my/app'].length > 0).toBe(true)
    const eco = loadDemoEcosystem()
    expect(eco && Array.isArray(eco.top_packages)).toBe(true)
  })

  // 原 Test 4：JSON 格式 mod（1 条断言）
  it('JSON 格式 mod', () => {
    const r4 = runJsAnalyzer({
      type: 'mod_text',
      mod_text: JSON.stringify({
        name: 'x/y',
        version: '0.1.0',
        deps: { 'moonbitlang/core': '0.6.0' },
      }),
    })
    expect(r4.graph?.root_id).toBe('x/y@0.1.0')
  })
})
