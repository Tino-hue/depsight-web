// 健康分历史趋势视图：Canvas 折线图（无第三方图表库）
// 用户分析历史（localStorage）+ mooncakes.io 真实发布活跃聚合
import { useEffect, useMemo, useRef, useState } from "react";

import { ShareButton } from "@/components/ShareButton";
import { WorkbenchShell } from "@/components/WorkbenchShell";
import { fetchAllModules } from "@/lib/fetcher";
import type { MooncakesModule, TrendPoint } from "@/lib/types";
import { useApp } from "@/state/AppContext";

function drawTrendChart(
  canvas: HTMLCanvasElement,
  points: TrendPoint[],
  title: string,
  cssW: number,
  cssH: number,
  light: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = cssW;
  const H = cssH;
  const padding = { top: 40, right: 30, bottom: 40, left: 50 };

  // 主题感知配色（浅色底用深字/浅网格，暗色底反之）
  const cGrid = light ? "#d3ddd6" : "#2a3040";
  const cAxis = light ? "#64748b" : "#64748b";
  const cEmpty = light ? "#94a3b8" : "#94a3b8";
  const cValue = light ? "#1c2f23" : "#e2e8f0";
  const cTitle = light ? "#1c2f23" : "#e2e8f0";

  ctx.clearRect(0, 0, W, H);

  if (points.length === 0) {
    ctx.fillStyle = cEmpty;
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No data yet — run an analysis first", W / 2, H / 2);
    return;
  }

  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;

  // 背景网格 + Y 轴标签
  ctx.strokeStyle = cGrid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (chartH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(W - padding.right, y);
    ctx.stroke();

    ctx.fillStyle = cAxis;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(100 - 20 * i), padding.left - 8, y + 4);
  }

  // X 轴日期标签（最多 6 个）
  const step = Math.max(1, Math.floor(points.length / 6));
  ctx.textAlign = "center";
  for (let i = 0; i < points.length; i += step) {
    const x = padding.left + (chartW / (points.length - 1 || 1)) * i;
    ctx.fillStyle = cAxis;
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

    ctx.fillStyle = cValue;
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(p.score), x, y - 10);
  }

  // 标题
  ctx.fillStyle = cTitle;
  ctx.font = "bold 14px Sora, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(title, padding.left, padding.top - 15);
}

/** 近 12 个月新发布模块数（按月聚合） */
interface ActivityBucket {
  label: string;
  count: number;
}

// 发布活跃聚合结果模块级缓存：视图切换重新挂载时立即渲染
let activityCache: ActivityBucket[] | null = null;

// 从模块列表聚合近 12 个月发布数
function aggregateActivity(modules: MooncakesModule[]): ActivityBucket[] {
  const buckets: ActivityBucket[] = [];
  const now = new Date();
  const index = new Map<string, number>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString(undefined, {
      month: "short",
      year: i >= 11 ? "2-digit" : undefined,
    });
    index.set(`${d.getFullYear()}-${d.getMonth()}`, buckets.length);
    buckets.push({ label, count: 0 });
  }
  for (const m of modules) {
    if (!m.created_at) continue;
    const d = new Date(m.created_at);
    const i = index.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i !== undefined) buckets[i].count++;
  }
  return buckets;
}

// 发布活跃柱状图（主题感知）
function drawActivityChart(
  canvas: HTMLCanvasElement,
  buckets: ActivityBucket[],
  cssW: number,
  cssH: number,
  light: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = cssW;
  const H = cssH;
  const padding = { top: 40, right: 20, bottom: 40, left: 50 };

  const cGrid = light ? "#d3ddd6" : "#2a3040";
  const cAxis = light ? "#64748b" : "#64748b";
  const cValue = light ? "#1c2f23" : "#e2e8f0";
  const cTitle = light ? "#1c2f23" : "#e2e8f0";

  ctx.clearRect(0, 0, W, H);

  if (buckets.length === 0) return;

  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const maxVal = Math.max(...buckets.map((b) => b.count), 1);

  // 网格 + Y 轴
  ctx.strokeStyle = cGrid;
  ctx.lineWidth = 1;
  ctx.fillStyle = cAxis;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(W - padding.right, y);
    ctx.stroke();
    ctx.fillText(
      String(Math.round((maxVal * (4 - i)) / 4)),
      padding.left - 8,
      y + 4,
    );
  }

  // 柱
  const barW = chartW / buckets.length;
  buckets.forEach((b, i) => {
    const h = (b.count / maxVal) * chartH;
    const x = padding.left + i * barW + barW * 0.2;
    const y = padding.top + chartH - h;

    ctx.fillStyle = "hsl(210 90% 60%)";
    ctx.beginPath();
    ctx.roundRect(x, y, barW * 0.6, h, 3);
    ctx.fill();

    ctx.fillStyle = cValue;
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    if (b.count > 0) ctx.fillText(String(b.count), x + barW * 0.3, y - 5);

    ctx.fillStyle = cAxis;
    ctx.font = "10px sans-serif";
    ctx.fillText(b.label, x + barW * 0.3, H - padding.bottom + 16);
  });

  ctx.fillStyle = cTitle;
  ctx.font = "bold 14px Sora, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("New packages per month", padding.left, padding.top - 15);
}

export function TrendsView() {
  const { trends, theme } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activityCanvasRef = useRef<HTMLCanvasElement>(null);
  const activityWrapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string>("");
  const [activity, setActivity] = useState<ActivityBucket[] | null>(
    () => activityCache,
  );
  const [activityStatus, setActivityStatus] = useState<
    "loading" | "ok" | "error"
  >(() => (activityCache ? "ok" : "loading"));

  // 用户真实分析历史（localStorage 持久化，AppContext 管理），不再混入 demo
  const allTrends = useMemo(() => trends, [trends]);
  const names = Object.keys(allTrends);
  const current =
    selected && names.includes(selected) ? selected : (names[0] ?? "");
  const points = current ? (allTrends[current] ?? []) : [];

  // 重绘（ResizeObserver：视图从 hidden 切回可见时 wrap 宽度 0→实际值，需补绘）
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      if (w === 0) return; // display:none 中，等可见时 ResizeObserver 再触发
      const h = 340;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawTrendChart(canvas, points, current || "", w, h, theme === "light");
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [points, current, theme]);

  // 发布活跃：基于 fetchAllModules 真实聚合（sessionStorage 缓存 30 分钟）
  useEffect(() => {
    if (activityCache) return;
    let cancelled = false;
    (async () => {
      try {
        const modules = await fetchAllModules();
        if (cancelled) return;
        const buckets = aggregateActivity(modules);
        activityCache = buckets;
        setActivity(buckets);
        setActivityStatus("ok");
      } catch (e) {
        if (cancelled) return;
        console.warn("[trends] ecosystem activity load failed:", e);
        setActivityStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 发布活跃图重绘（主题感知）
  useEffect(() => {
    const canvas = activityCanvasRef.current;
    const wrap = activityWrapRef.current;
    if (!canvas || !wrap || !activity) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      if (w === 0) return;
      const h = 300;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawActivityChart(canvas, activity, w, h, theme === "light");
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [activity, theme]);

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
    <WorkbenchShell
      view="trends"
      title="Health Score Trends"
      subtitle="Track dependency health scores over time"
      actions={<ShareButton />}
    >
      <div className="space-y-4">
        {/* 图表卡片（暗底保持暗色 Canvas 配色；浅色主题切亮底 + 深色 Canvas 配色） */}
        <div className="workbench-card workbench-chart-card workbench-animate-in">
          <div className="workbench-card-header workbench-trends-header">
            <h3 className="workbench-card-title">Health Score History</h3>
            <select
              aria-label="Select package"
              value={current}
              onChange={(e) => setSelected(e.target.value)}
              className="workbench-select font-mono text-xs"
            >
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="workbench-card-body">
            <div ref={wrapRef} className="w-full">
              <canvas ref={canvasRef} className="block w-full" />
            </div>
          </div>
        </div>

        {/* 生态发布活跃（mooncakes.io 真实聚合） */}
        <div className="workbench-card workbench-chart-card workbench-animate-in [animation-delay:50ms]">
          <div className="workbench-card-header workbench-trends-header">
            <h3 className="workbench-card-title">
              Ecosystem Publishing Activity
            </h3>
            <span className="text-xs text-muted-foreground">
              {activityStatus === "loading"
                ? "Loading from mooncakes.io…"
                : activityStatus === "error"
                  ? "Live data unavailable"
                  : `Last 12 months · source: mooncakes.io`}
            </span>
          </div>
          <div className="workbench-card-body">
            <div ref={activityWrapRef} className="w-full">
              {activity ? (
                <canvas ref={activityCanvasRef} className="block w-full" />
              ) : (
                <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                  {activityStatus === "error"
                    ? "Failed to load ecosystem activity."
                    : "Loading ecosystem data…"}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 统计卡片 */}
        {stats && (
          <div className="workbench-stats-grid workbench-animate-in [animation-delay:100ms]">
            <div className="workbench-stat-card">
              <div className="workbench-stat-value">{stats.avg}</div>
              <div className="workbench-stat-label">Average</div>
            </div>
            <div className="workbench-stat-card">
              <div className="workbench-stat-value">{stats.max}</div>
              <div className="workbench-stat-label">Highest</div>
            </div>
            <div className="workbench-stat-card">
              <div className="workbench-stat-value">{stats.min}</div>
              <div className="workbench-stat-label">Lowest</div>
            </div>
            <div className="workbench-stat-card">
              <div
                className={
                  stats.diff > 0
                    ? "workbench-stat-value score-good"
                    : stats.diff < 0
                      ? "workbench-stat-value score-bad"
                      : "workbench-stat-value"
                }
              >
                {stats.diff > 0 ? "↑" : stats.diff < 0 ? "↓" : "→"}{" "}
                {Math.abs(stats.diff)}
              </div>
              <div className="workbench-stat-label">Change</div>
            </div>
          </div>
        )}
      </div>
    </WorkbenchShell>
  );
}
