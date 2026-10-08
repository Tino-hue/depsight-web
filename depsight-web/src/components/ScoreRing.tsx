// 总分圆环：SVG 描边动画（r=60，与旧版 dashboard.js 一致）
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

function scoreColor(score: number): string {
  return score >= 80 ? 'hsl(var(--primary))' : score >= 60 ? 'hsl(36 90% 55%)' : 'hsl(var(--destructive))'
}

interface ScoreRingProps {
  score: number
  size?: number
  className?: string
}

export function ScoreRing({ score, size = 160, className }: ScoreRingProps) {
  const [animatedScore, setAnimatedScore] = useState(0)

  useEffect(() => {
    // 入场动画：从 0 缓动到目标分
    const start = performance.now()
    const duration = 800
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setAnimatedScore(Math.round(eased * score))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [score])

  const r = 60
  const circumference = 2 * Math.PI * r
  const offset = circumference - (animatedScore / 100) * circumference
  const color = scoreColor(score)

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 140 140" className="-rotate-90">
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="10"
        />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.1s linear, stroke 0.3s' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold tabular-nums" style={{ color }}>
          {animatedScore}
        </span>
        <span className="text-xs uppercase tracking-widest text-muted-foreground mt-1">
          Health
        </span>
      </div>
    </div>
  )
}
