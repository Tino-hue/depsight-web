// 健康分仪表盘：总分环 + 五维评分 + 汇总卡片
// 从 js/dashboard.js 迁移
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AnalysisResult } from '@/lib/types'

import { ScoreRing } from './ScoreRing'

const DIMS: { label: string; key: keyof DimensionKey; weight: string }[] = [
  { label: '新鲜度', key: 'freshness', weight: '25%' },
  { label: '许可证合规', key: 'compliance', weight: '20%' },
  { label: '废弃 API 密度', key: 'deprecated_density', weight: '25%' },
  { label: '包大小', key: 'size_reasonableness', weight: '20%' },
  { label: '活跃度', key: 'activity', weight: '10%' },
]

type DimensionKey = Pick<
  AnalysisResult['health_scores'][number],
  'freshness' | 'compliance' | 'deprecated_density' | 'size_reasonableness' | 'activity'
>

function dimColor(val: number): string {
  return val >= 80
    ? 'hsl(var(--primary))'
    : val >= 60
      ? 'hsl(36 90% 55%)'
      : 'hsl(var(--destructive))'
}

export function Dashboard({ result }: { result: AnalysisResult }) {
  const scores = result.health_scores ?? []
  const avg = (key: keyof DimensionKey): number =>
    scores.length === 0
      ? 0
      : Math.round(
          scores.reduce((a, b) => a + (b[key] || 0), 0) / scores.length,
        )

  const summaryCards = [
    { label: '严重', value: result.summary?.critical || 0, color: 'hsl(var(--destructive))' },
    { label: '警告', value: result.summary?.warning || 0, color: 'hsl(36 90% 55%)' },
    { label: '提示', value: result.summary?.info || 0, color: 'hsl(210 90% 60%)' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <ScoreRing score={result.overall_score} />

        {/* 五维评分 */}
        <div className="w-full flex-1 space-y-3">
          {scores.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无数据</p>
          ) : (
            DIMS.map((d) => {
              const val = avg(d.key)
              const color = dimColor(val)
              return (
                <div key={d.key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {d.label}{' '}
                      <span className="text-[10px] opacity-60">{d.weight}</span>
                    </span>
                    <span className="font-semibold tabular-nums" style={{ color }}>
                      {val}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${val}%`, background: color }}
                    />
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-3 gap-3">
        {summaryCards.map((c) => (
          <div
            key={c.label}
            className="rounded-md border border-border bg-secondary/40 p-3 text-center"
          >
            <div className="text-2xl font-bold tabular-nums" style={{ color: c.color }}>
              {c.value}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DashboardCard({ result }: { result: AnalysisResult }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          健康分仪表盘
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {result.node_count} 个节点
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Dashboard result={result} />
      </CardContent>
    </Card>
  )
}
