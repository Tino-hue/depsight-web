// 健康分历史趋势视图：Canvas 折线图（无第三方图表库）
// 从 js/trends.js 迁移：demo 数据 + localStorage 数据合并
import { useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadDemoTrends } from "@/lib/demo-data";
import type { TrendPoint } from "@/lib/types";
import { useApp } from "@/state/AppContext";

function drawTrendChart(
  canvas: HTMLCanvasElement,
  points: TrendPoint[],
  title: string,
  cssW: number,
  cssH: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = cssW;
  const H = cssH;
  const padding = { top: 40, right: 30, bottom: 40, left: 50 };

  ctx.clearRect(0, 0, W, H);

  if (points.length === 0) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("暂无数据，先运行一次分析", W / 2, H / 2);
    return;
  }

  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;

  // 背景网格 + Y 轴标签
  ctx.strokeStyle = "#2a3040";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (chartH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(W - padding.right, y);
    ctx.stroke();

    ctx.fillStyle = "#64748b";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(100 - 20 * i), padding.left - 8, y + 4);
  }

  // X 轴日期标签（最多 6 个）
  const step = Math.max(1, Math.floor(points.length / 6));
  ctx.textAlign = "center";
  for (let i = 0; i < points.length; i += step) {
    const x = padding.left + (chartW / (points.length - 1 || 1)) * i;
    ctx.fillStyle = "#64748b";
    ctx.font = "10px sans-serif";
    ctx.fillText(points[i].date.slice(5), x, H - padding.bottom + 18);
  }

  // 折线
  ctx.strokeStyle = "hsl(210 90% 60%)";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = padding.left + (chartW / (points.length - 1 || 1)) * i;
    const y = padding.top + chartH - (p.score / 100) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 数据点 + 数值
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = padding.left + (chartW / (points.length - 1 || 1)) * i;
    const y = padding.top + chartH - (p.score / 100) * chartH;

    const color =
      p.score >= 80 ? "#10b981" : p.score >= 60 ? "#f59e0b" : "#ef4444";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(p.score), x, y - 10);
  }

  // 标题
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 14px Sora, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, padding.left, padding.top - 15);
}

export function TrendsView() {
  const { trends } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string>("");

  // 合并 demo + 存储数据（与旧版一致）
  const allTrends = useMemo(
    () => ({ ...loadDemoTrends(), ...trends }),
    [trends],
  );
  const names = Object.keys(allTrends);
  const current =
    selected && names.includes(selected) ? selected : (names[0] ?? "");
  const points = current ? (allTrends[current] ?? []) : [];

  // 重绘
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = 340;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTrendChart(canvas, points, current || "", w, h);
  }, [points, current]);

  // 统计
  const stats = useMemo(() => {
    if (points.length === 0) return null;
    const scores = points.map((p) => p.score);
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const latest = scores[scores.length - 1];
    const first = scores[0];
    const diff = latest - first;
    return { avg, min, max, diff };
  }, [points]);

  return (
    <div className="space-y-4">
      <Card className="animate-fade-up">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">健康分历史趋势</CardTitle>
            <select
              aria-label="选择包"
              value={current}
              onChange={(e) => setSelected(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <div ref={wrapRef} className="w-full">
            <canvas ref={canvasRef} className="block w-full" />
          </div>
        </CardContent>
      </Card>

      {stats && (
        <div className="grid animate-fade-up grid-cols-2 gap-3 [animation-delay:100ms] sm:grid-cols-4">
          <div className="rounded-md border border-border bg-secondary/40 p-4 text-center">
            <div className="text-2xl font-bold tabular-nums">{stats.avg}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">平均分</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/40 p-4 text-center">
            <div className="text-2xl font-bold tabular-nums">{stats.max}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">最高分</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/40 p-4 text-center">
            <div className="text-2xl font-bold tabular-nums">{stats.min}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">最低分</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/40 p-4 text-center">
            <div
              className={
                stats.diff > 0
                  ? "score-good text-2xl font-bold tabular-nums"
                  : stats.diff < 0
                    ? "score-bad text-2xl font-bold tabular-nums"
                    : "text-2xl font-bold tabular-nums text-muted-foreground"
              }
            >
              {stats.diff > 0 ? "↑" : stats.diff < 0 ? "↓" : "→"}{" "}
              {Math.abs(stats.diff)}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">变化趋势</div>
          </div>
        </div>
      )}
    </div>
  );
}
