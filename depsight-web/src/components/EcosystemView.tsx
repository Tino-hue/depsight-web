// 生态大盘视图：mooncakes.io 真实 API 数据聚合 + Canvas 图表
// 从 js/ecosystem.js 迁移：demo 先渲染，真实数据异步覆盖；支持手动刷新
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchAllModules } from '@/lib/fetcher'
import { loadDemoEcosystem } from '@/lib/demo-data'
import type { EcoTopPackage, EcosystemData, MooncakesModule } from '@/lib/types'
import { useApp } from '@/state/AppContext'

// ===== 从全量模块列表构建生态统计（与旧版 buildEcosystemFromModules 一致）=====
function buildEcosystemFromModules(modules: MooncakesModule[]): EcosystemData {
  const total = modules.length
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000

  // 许可证分布
  const licenseCounts: Record<string, number> = {}
  let unlicensed = 0
  for (const m of modules) {
    const lic = m.license?.trim()
    if (lic) licenseCounts[lic] = (licenseCounts[lic] || 0) + 1
    else unlicensed++
  }

  // 活跃度
  let active30 = 0
  let active90 = 0
  let stale = 0
  for (const m of modules) {
    const days = m.created_at
      ? Math.floor((now - new Date(m.created_at).getTime()) / DAY)
      : null
    if (days === null) stale++
    else if (days <= 30) active30++
    else if (days <= 90) active90++
    else if (days > 365) stale++
  }
  const active = active30 + active90

  // 健康分分布估算
  const scoreDist: Record<string, number> = {
    '90-100': 0,
    '80-89': 0,
    '70-79': 0,
    '60-69': 0,
    '50-59': 0,
    '0-49': 0,
  }
  for (const m of modules) {
    let score = 50
    if (m.license?.trim()) score += 20
    if (m.repository?.trim()) score += 10
    if (m.description?.trim()) score += 5
    if (m.keywords?.length) score += 5
    if (!m.yanked) score += 10

    const days = m.created_at
      ? Math.floor((now - new Date(m.created_at).getTime()) / DAY)
      : 9999
    if (days <= 30) score += 10
    else if (days <= 90) score += 5

    score = Math.min(100, score)
    if (score >= 90) scoreDist['90-100']++
    else if (score >= 80) scoreDist['80-89']++
    else if (score >= 70) scoreDist['70-79']++
    else if (score >= 60) scoreDist['60-69']++
    else if (score >= 50) scoreDist['50-59']++
    else scoreDist['0-49']++
  }

  const scoreVals = Object.entries(scoreDist).flatMap(([range, count]) => {
    const [lo, hi] = range.split('-').map(Number)
    const mid = (lo + hi) / 2
    return Array<number>(count).fill(mid)
  })
  const avgHealth = scoreVals.length
    ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length)
    : 0

  const riskCounts: Record<string, number> = {
    OUTDATED: modules.filter((m) => m.yanked).length,
    LICENSE: unlicensed,
    DEPRECATED: modules.filter((m) => m.yanked && m.yanked_reason).length,
    SIZE: Math.round(total * 0.03),
    ACTIVITY: stale,
  }

  const topPackages: EcoTopPackage[] = [...modules]
    .filter((m) => m.created_at)
    .sort(
      (a, b) =>
        new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime(),
    )
    .slice(0, 10)
    .map((m) => ({
      name: m.name,
      version: m.version,
      license: m.license ?? null,
      days_ago: m.created_at
        ? Math.floor((now - new Date(m.created_at).getTime()) / DAY)
        : null,
      repository: m.repository ?? null,
      description: m.description?.slice(0, 80),
    }))

  return {
    overall_health: avgHealth,
    total_packages: total,
    active_packages: active,
    stale_packages: stale,
    unlicensed_count: unlicensed,
    license_distribution: licenseCounts,
    recently_published: active30,
    top_packages: topPackages,
    risk_type_counts: riskCounts,
    score_distribution: scoreDist,
    isReal: true,
  }
}

// ===== Canvas 图表 =====
function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  deps: unknown[],
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = window.devicePixelRatio || 1
    const w = wrap.clientWidth
    const h = 260
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    draw(ctx, w, h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { canvasRef, wrapRef }
}

function drawScoreHistogram(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  distribution: Record<string, number>,
) {
  const padding = { top: 20, right: 20, bottom: 40, left: 50 }
  const ranges = Object.keys(distribution)
  const values = Object.values(distribution)
  const maxVal = Math.max(...values, 1)
  const chartW = W - padding.left - padding.right
  const chartH = H - padding.top - padding.bottom
  const barW = chartW / ranges.length

  ranges.forEach((range, i) => {
    const val = distribution[range]
    const barH = (val / maxVal) * chartH
    const x = padding.left + i * barW + 4
    const y = padding.top + chartH - barH

    const [lo, hi] = range.split('-').map(Number)
    const mid = (lo + hi) / 2
    const color =
      mid >= 85 ? '#10b981' : mid >= 70 ? '#6366f1' : mid >= 55 ? '#f59e0b' : '#ef4444'

    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(x, y, barW - 8, barH, 3)
    ctx.fill()

    ctx.fillStyle = '#e2e8f0'
    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(String(val), x + (barW - 8) / 2, y - 5)

    ctx.fillStyle = '#64748b'
    ctx.font = '10px sans-serif'
    ctx.fillText(range, x + (barW - 8) / 2, H - padding.bottom + 16)
  })

  ctx.strokeStyle = '#2a3040'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padding.left, padding.top)
  ctx.lineTo(padding.left, H - padding.bottom)
  ctx.stroke()
}

function drawRiskBar(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  riskCounts: Record<string, number>,
) {
  const padding = { top: 20, right: 80, bottom: 30, left: 20 }
  const types = Object.keys(riskCounts)
  const values = Object.values(riskCounts)
  const maxVal = Math.max(...values, 1)
  const chartW = W - padding.left - padding.right
  const chartH = H - padding.top - padding.bottom
  const barH = chartH / types.length

  const colors: Record<string, string> = {
    OUTDATED: '#f59e0b',
    LICENSE: '#3b82f6',
    DEPRECATED: '#8b5cf6',
    SIZE: '#06b6d4',
    ACTIVITY: '#ef4444',
  }

  types.forEach((type, i) => {
    const val = riskCounts[type]
    const barW = (val / maxVal) * chartW
    const y = padding.top + i * barH + 4
    const color = colors[type] || '#6366f1'

    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(padding.left, y, barW, barH - 8, 3)
    ctx.fill()

    ctx.fillStyle = '#e2e8f0'
    ctx.font = 'bold 12px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(String(val), padding.left + barW + 8, y + (barH - 8) / 2 + 4)

    ctx.fillStyle = '#94a3b8'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(type, padding.left - 8, y + (barH - 8) / 2 + 4)
  })
}

// ===== 视图组件 =====
let realCache: EcosystemData | null = null

export function EcosystemView() {
  const { lastResult } = useApp()
  const [eco, setEco] = useState<EcosystemData>(() => loadDemoEcosystem())
  const [status, setStatus] = useState('演示数据')
  const [refreshing, setRefreshing] = useState(false)

  const loadReal = useCallback(async (force = false): Promise<boolean> => {
    if (!force && realCache) {
      setEco(realCache)
      setStatus('真实数据（缓存）')
      return true
    }
    try {
      setStatus('正在拉取 mooncakes.io 生态数据…')
      const modules = await fetchAllModules()
      const real = buildEcosystemFromModules(modules)
      realCache = real
      setEco(real)
      setStatus(
        `真实数据 · ${modules.length} 个包 · ${new Date().toLocaleTimeString()}`,
      )
      return true
    } catch (e) {
      console.warn('[ecosystem] 真实数据加载失败:', e)
      setStatus('真实数据不可用，显示演示数据')
      return false
    }
  }, [])

  // 首屏：demo 立即渲染，真实数据异步覆盖
  useEffect(() => {
    void loadReal()
  }, [loadReal])

  const onRefresh = async () => {
    setRefreshing(true)
    await loadReal(true)
    setRefreshing(false)
  }

  // 顶部卡片（lastResult 优先，与旧版一致）
  const cards = useMemo(() => {
    let avgHealth = eco.overall_health
    let totalPkgs = eco.total_packages
    if (lastResult?.ecosystem_stats) {
      avgHealth = lastResult.ecosystem_stats.avg_health_score
      totalPkgs = lastResult.ecosystem_stats.total_packages
    }
    const healthColor =
      avgHealth >= 80 ? 'score-good' : avgHealth >= 60 ? 'score-mid' : 'score-bad'
    return [
      { label: '生态整体健康分', value: String(avgHealth), color: healthColor },
      { label: '总包数', value: String(totalPkgs), color: 'text-sky-400' },
      { label: '活跃包（90天内）', value: String(eco.active_packages), color: 'score-good' },
      { label: '停滞包（超1年）', value: String(eco.stale_packages ?? '--'), color: 'score-bad' },
      { label: '已分析依赖', value: String(lastResult?.node_count ?? '--'), color: 'text-sky-400' },
      { label: '未声明许可证', value: String(eco.unlicensed_count ?? '--'), color: 'text-amber-500' },
    ]
  }, [eco, lastResult])

  const hist = useCanvas(
    (ctx, w, h) => drawScoreHistogram(ctx, w, h, eco.score_distribution),
    [eco],
  )
  const risk = useCanvas(
    (ctx, w, h) => drawRiskBar(ctx, w, h, eco.risk_type_counts),
    [eco],
  )

  const isRealFormat = eco.top_packages[0] && 'days_ago' in eco.top_packages[0]

  return (
    <div className="space-y-4">
      {/* 数据状态 + 刷新 */}
      <div className="flex animate-fade-up items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {status}
          {eco.isReal ? (
            <Badge variant="success">真实数据</Badge>
          ) : (
            <Badge variant="warning">演示数据</Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          刷新
        </Button>
      </div>

      {/* 指标卡片 */}
      <div className="grid animate-fade-up grid-cols-2 gap-3 [animation-delay:50ms] sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-md border border-border bg-secondary/40 p-4 text-center"
          >
            <div className={`text-2xl font-bold tabular-nums ${c.color}`}>
              {c.value}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      {/* 图表 */}
      <div className="grid animate-fade-up grid-cols-1 gap-4 [animation-delay:100ms] lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">健康分分布</CardTitle>
          </CardHeader>
          <CardContent>
            <div ref={hist.wrapRef} className="w-full">
              <canvas ref={hist.canvasRef} className="block w-full" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">风险类型分布</CardTitle>
          </CardHeader>
          <CardContent>
            <div ref={risk.wrapRef} className="w-full">
              <canvas ref={risk.canvasRef} className="block w-full" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* TOP 包 */}
      <Card className="animate-fade-up [animation-delay:150ms]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {isRealFormat ? '最近发布 TOP 10' : '最热包 TOP 10'}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0 sm:p-6 sm:pt-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3 sm:px-0">#</th>
                <th className="px-4 py-3 sm:px-0">包名</th>
                {isRealFormat ? (
                  <>
                    <th className="px-4 py-3 sm:px-0">版本</th>
                    <th className="px-4 py-3 sm:px-0">许可证</th>
                    <th className="px-4 py-3 sm:px-0">发布于</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-3 sm:px-0">下载量</th>
                    <th className="px-4 py-3 sm:px-0">健康分</th>
                    <th className="px-4 py-3 sm:px-0">许可证</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {eco.top_packages.map((p, i) => (
                <tr
                  key={`${p.name}-${i}`}
                  className="border-b border-border/50 last:border-0"
                >
                  <td className="px-4 py-2.5 text-muted-foreground sm:px-0">{i + 1}</td>
                  <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-xs sm:px-0" title={p.description || p.name}>
                    {p.name}
                  </td>
                  {isRealFormat ? (
                    <>
                      <td className="px-4 py-2.5 font-mono text-xs sm:px-0">{p.version ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs sm:px-0">
                        {p.license ? (
                          p.license
                        ) : (
                          <span className="text-destructive">未声明</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs tabular-nums sm:px-0">
                        {p.days_ago != null ? `${p.days_ago} 天前` : '—'}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 text-xs tabular-nums sm:px-0">
                        {(p.downloads ?? 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-xs sm:px-0">
                        <span
                          className={
                            (p.health ?? 0) >= 80
                              ? 'score-good font-semibold'
                              : (p.health ?? 0) >= 60
                                ? 'score-mid font-semibold'
                                : 'score-bad font-semibold'
                          }
                        >
                          {p.health ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs sm:px-0">
                        {p.license ? (
                          p.license
                        ) : (
                          <span className="text-destructive">未声明</span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
