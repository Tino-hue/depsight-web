// 生态大盘视图：mooncakes.io 真实 API 数据聚合 + Canvas 图表
// 首屏加载真实数据（sessionStorage 缓存 30 分钟）；失败可重试，不再展示 demo 数据
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShareButton } from "@/components/ShareButton";
import { WorkbenchShell } from "@/components/WorkbenchShell";
import { fetchAllModules } from "@/lib/fetcher";
import type {
  EcoTopPackage,
  EcosystemData,
  MooncakesModule,
} from "@/lib/types";
import { useApp } from "@/state/AppContext";

// ===== 从全量模块列表构建生态统计（与旧版 buildEcosystemFromModules 一致）=====
function buildEcosystemFromModules(modules: MooncakesModule[]): EcosystemData {
  const total = modules.length;
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // 许可证分布
  const licenseCounts: Record<string, number> = {};
  let unlicensed = 0;
  for (const m of modules) {
    const lic = m.license?.trim();
    if (lic) licenseCounts[lic] = (licenseCounts[lic] || 0) + 1;
    else unlicensed++;
  }

  // 活跃度
  let active30 = 0;
  let active90 = 0;
  let stale = 0;
  for (const m of modules) {
    const days = m.created_at
      ? Math.floor((now - new Date(m.created_at).getTime()) / DAY)
      : null;
    if (days === null) stale++;
    else if (days <= 30) active30++;
    else if (days <= 90) active90++;
    else if (days > 365) stale++;
  }
  const active = active30 + active90;

  // 健康分分布估算
  const scoreDist: Record<string, number> = {
    "90-100": 0,
    "80-89": 0,
    "70-79": 0,
    "60-69": 0,
    "50-59": 0,
    "0-49": 0,
  };
  for (const m of modules) {
    let score = 50;
    if (m.license?.trim()) score += 20;
    if (m.repository?.trim()) score += 10;
    if (m.description?.trim()) score += 5;
    if (m.keywords?.length) score += 5;
    if (!m.yanked) score += 10;

    const days = m.created_at
      ? Math.floor((now - new Date(m.created_at).getTime()) / DAY)
      : 9999;
    if (days <= 30) score += 10;
    else if (days <= 90) score += 5;

    score = Math.min(100, score);
    if (score >= 90) scoreDist["90-100"]++;
    else if (score >= 80) scoreDist["80-89"]++;
    else if (score >= 70) scoreDist["70-79"]++;
    else if (score >= 60) scoreDist["60-69"]++;
    else if (score >= 50) scoreDist["50-59"]++;
    else scoreDist["0-49"]++;
  }

  const scoreVals = Object.entries(scoreDist).flatMap(([range, count]) => {
    const [lo, hi] = range.split("-").map(Number);
    const mid = (lo + hi) / 2;
    return Array<number>(count).fill(mid);
  });
  const avgHealth = scoreVals.length
    ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length)
    : 0;

  // 风险分布：仅统计列表中真实可见的信号（体积风险需逐个拉源码，此处不估算）
  const riskCounts: Record<string, number> = {
    OUTDATED: modules.filter((m) => m.yanked).length,
    LICENSE: unlicensed,
    DEPRECATED: modules.filter((m) => m.yanked && m.yanked_reason).length,
    ACTIVITY: stale,
  };

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
    }));

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
  };
}

// ===== Canvas 图表 =====
function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  deps: unknown[],
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const redraw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      if (w === 0) return; // display:none 中，等可见时 ResizeObserver 再触发
      const h = 260;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h);
    };
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { canvasRef, wrapRef };
}

function drawScoreHistogram(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  distribution: Record<string, number>,
  light: boolean,
) {
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const ranges = Object.keys(distribution);
  const values = Object.values(distribution);
  const maxVal = Math.max(...values, 1);
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const barW = chartW / ranges.length;

  // 主题感知配色
  const cValue = light ? "#1c2f23" : "#e2e8f0";
  const cRange = light ? "#64748b" : "#64748b";
  const cAxis = light ? "#cfd9d2" : "#2a3040";

  ranges.forEach((range, i) => {
    const val = distribution[range];
    const barH = (val / maxVal) * chartH;
    const x = padding.left + i * barW + 4;
    const y = padding.top + chartH - barH;

    const [lo, hi] = range.split("-").map(Number);
    const mid = (lo + hi) / 2;
    const color =
      mid >= 85
        ? "#10b981"
        : mid >= 70
          ? "#6366f1"
          : mid >= 55
            ? "#f59e0b"
            : "#ef4444";

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, barW - 8, barH, 3);
    ctx.fill();

    ctx.fillStyle = cValue;
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(val), x + (barW - 8) / 2, y - 5);

    ctx.fillStyle = cRange;
    ctx.font = "10px sans-serif";
    ctx.fillText(range, x + (barW - 8) / 2, H - padding.bottom + 16);
  });

  ctx.strokeStyle = cAxis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, H - padding.bottom);
  ctx.stroke();
}

function drawRiskBar(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  riskCounts: Record<string, number>,
  light: boolean,
) {
  const types = Object.keys(riskCounts);
  const values = Object.values(riskCounts);
  const maxVal = Math.max(...values, 1);

  // 主题感知配色
  const cValue = light ? "#1c2f23" : "#e2e8f0";
  const cType = light ? "#5b6f62" : "#94a3b8";

  // 左 padding 按类型名实测宽度动态计算，避免标签被裁掉
  ctx.font = "11px sans-serif";
  const maxLabel = Math.max(...types.map((t) => ctx.measureText(t).width), 0);
  const padding = {
    top: 20,
    right: 80,
    bottom: 30,
    left: Math.min(maxLabel + 28, W * 0.45),
  };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const barH = chartH / types.length;

  const colors: Record<string, string> = {
    OUTDATED: "#f59e0b",
    LICENSE: "#3b82f6",
    DEPRECATED: "#8b5cf6",
    SIZE: "#06b6d4",
    ACTIVITY: "#ef4444",
  };

  types.forEach((type, i) => {
    const val = riskCounts[type];
    const barW = (val / maxVal) * chartW;
    const y = padding.top + i * barH + 4;
    const color = colors[type] || "#6366f1";

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(padding.left, y, barW, barH - 8, 3);
    ctx.fill();

    ctx.fillStyle = cValue;
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(val), padding.left + barW + 8, y + (barH - 8) / 2 + 4);

    ctx.fillStyle = cType;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(type, padding.left - 8, y + (barH - 8) / 2 + 4);
  });
}

// 许可证分布横向条形图（Top N + Other，左侧标签过长时省略号截断）
function drawLicenseBar(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  dist: Record<string, number>,
  light: boolean,
) {
  const entries = Object.entries(dist);
  if (entries.length === 0) return;

  const cValue = light ? "#1c2f23" : "#e2e8f0";
  const cLabel = light ? "#5b6f62" : "#94a3b8";

  // Labels are right-aligned just left of the bars, so measure them first and
  // size the left padding to fit (capped so the chart keeps at least 55% width).
  const truncate = (text: string, maxW: number): string => {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) {
      t = t.slice(0, -1);
    }
    return `${t}…`;
  };
  ctx.font = "11px sans-serif";
  const labelMax = Math.min(
    Math.max(...entries.map(([k]) => ctx.measureText(k).width), 40) + 14,
    W * 0.45,
  );
  const padding = { top: 16, right: 90, bottom: 16, left: labelMax + 14 };
  const maxVal = Math.max(...entries.map(([, v]) => v), 1);
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const barH = Math.min(28, chartH / entries.length);

  const palette = [
    "#10b981",
    "#6366f1",
    "#f59e0b",
    "#06b6d4",
    "#8b5cf6",
    "#ec4899",
    "#84cc16",
    "#f97316",
  ];

  entries.forEach(([lic, count], i) => {
    const barW = (count / maxVal) * chartW;
    const y = padding.top + i * barH + barH * 0.15;

    ctx.fillStyle = palette[i % palette.length];
    ctx.beginPath();
    ctx.roundRect(padding.left, y, Math.max(barW, 2), barH * 0.7, 3);
    ctx.fill();

    ctx.fillStyle = cValue;
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(count), padding.left + barW + 8, y + barH * 0.5 + 4);

    ctx.fillStyle = cLabel;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(truncate(lic, labelMax), padding.left - 8, y + barH * 0.5 + 4);
  });
}

// ===== 视图组件 =====
// 模块级缓存：视图切换重新挂载时立即渲染上次聚合结果（数据源本身有 sessionStorage 缓存）
let realCache: EcosystemData | null = null;

export function EcosystemView() {
  const { lastResult, theme } = useApp();
  const [eco, setEco] = useState<EcosystemData | null>(() => realCache);
  const [status, setStatus] = useState(() =>
    realCache
      ? `Real data · ${realCache.total_packages} packages · cached`
      : "Fetching mooncakes.io ecosystem data…",
  );
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadReal = useCallback(async (force = false): Promise<boolean> => {
    if (!force && realCache) {
      setEco(realCache);
      setStatus(`Real data · ${realCache.total_packages} packages · cached`);
      return true;
    }
    if (!realCache) setStatus("Fetching mooncakes.io ecosystem data…");
    try {
      const modules = await fetchAllModules();
      const real = buildEcosystemFromModules(modules);
      realCache = real;
      setEco(real);
      setFailed(false);
      setStatus(
        `Real data · ${modules.length} packages · ${new Date().toLocaleTimeString()}`,
      );
      return true;
    } catch (e) {
      console.warn("[ecosystem] live data load failed:", e);
      setFailed(true);
      return false;
    }
  }, []);

  // 首屏即真实数据：加载中 / 失败重试，不再渲染 demo
  useEffect(() => {
    void loadReal();
  }, [loadReal]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadReal(true);
    setRefreshing(false);
  };

  // 顶部卡片（lastResult 优先，与旧版一致）
  const cards = useMemo(() => {
    if (!eco) return [];
    let avgHealth = eco.overall_health;
    let totalPkgs = eco.total_packages;
    if (lastResult?.ecosystem_stats) {
      avgHealth = lastResult.ecosystem_stats.avg_health_score;
      totalPkgs = lastResult.ecosystem_stats.total_packages;
    }
    const healthColor =
      avgHealth >= 80
        ? "score-good"
        : avgHealth >= 60
          ? "score-mid"
          : "score-bad";
    return [
      {
        label: "Ecosystem Health",
        value: String(avgHealth),
        color: healthColor,
      },
      {
        label: "Total Packages",
        value: String(totalPkgs),
        color: "text-sky-400",
      },
      {
        label: "Active (90d)",
        value: String(eco.active_packages),
        color: "score-good",
      },
      {
        label: "Stale (>1y)",
        value: String(eco.stale_packages ?? "--"),
        color: "score-bad",
      },
      {
        label: "Analyzed Deps",
        value: String(lastResult?.node_count ?? "--"),
        color: "text-sky-400",
      },
      {
        label: "Unlicensed",
        value: String(eco.unlicensed_count ?? "--"),
        color: "text-amber-500",
      },
    ];
  }, [eco, lastResult]);

  // 许可证分布：Top 8 + Other，供图表渲染
  const licenseDist = useMemo(() => {
    const d = eco?.license_distribution ?? {};
    const entries = Object.entries(d).sort((a, b) => b[1] - a[1]);
    const top = entries.slice(0, 8);
    const rest = entries.slice(8).reduce((s, [, c]) => s + c, 0);
    const out: Record<string, number> = {};
    for (const [k, v] of top) out[k] = v;
    if (rest > 0) out["Other"] = rest;
    return out;
  }, [eco]);

  const hist = useCanvas(
    (ctx, w, h) =>
      drawScoreHistogram(
        ctx,
        w,
        h,
        eco?.score_distribution ?? {},
        theme === "light",
      ),
    [eco, theme],
  );
  const risk = useCanvas(
    (ctx, w, h) =>
      drawRiskBar(ctx, w, h, eco?.risk_type_counts ?? {}, theme === "light"),
    [eco, theme],
  );
  const lic = useCanvas(
    (ctx, w, h) => drawLicenseBar(ctx, w, h, licenseDist, theme === "light"),
    [licenseDist, theme],
  );

  // 加载中 / 加载失败（无缓存可展示时）
  if (!eco) {
    return (
      <WorkbenchShell
        view="ecosystem"
        title="Ecosystem Dashboard"
        subtitle="MoonBit package ecosystem health overview from mooncakes.io"
        actions={<ShareButton />}
      >
        <div className="workbench-card workbench-animate-in">
          <div className="workbench-card-body flex flex-col items-center justify-center gap-3 py-20 text-sm text-muted-foreground">
            {failed ? (
              <>
                <AlertTriangle className="h-6 w-6 text-amber-500" />
                <p>Failed to load live data from mooncakes.io.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRefresh}
                  disabled={refreshing}
                  className="workbench-refresh-btn"
                >
                  <RefreshCw
                    className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"}
                  />
                  Retry
                </Button>
              </>
            ) : (
              <>
                <RefreshCw className="h-6 w-6 animate-spin" />
                <p>{status}</p>
              </>
            )}
          </div>
        </div>
      </WorkbenchShell>
    );
  }

  return (
    <WorkbenchShell
      view="ecosystem"
      title="Ecosystem Dashboard"
      subtitle="MoonBit package ecosystem health overview from mooncakes.io"
      actions={<ShareButton />}
    >
      <div className="space-y-4">
        {/* 数据状态 + 刷新 */}
        <div className="workbench-eco-status workbench-animate-in">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {status}
            <Badge variant="success">Live · mooncakes.io</Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            className="workbench-refresh-btn"
          >
            <RefreshCw
              className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            />
            Refresh
          </Button>
        </div>

        {/* 指标卡片 */}
        <div className="workbench-eco-grid workbench-animate-in [animation-delay:50ms]">
          {cards.map((c) => (
            <div
              key={c.label}
              className="workbench-stat-card workbench-eco-card"
            >
              <div className={`workbench-stat-value ${c.color}`}>{c.value}</div>
              <div className="workbench-stat-label">{c.label}</div>
            </div>
          ))}
        </div>

        {/* 图表 */}
        <div className="workbench-charts-grid workbench-animate-in [animation-delay:100ms]">
          <div className="workbench-card workbench-chart-card">
            <div className="workbench-card-header">
              <h3 className="workbench-card-title">
                Health Score Distribution
              </h3>
            </div>
            <div className="workbench-card-body">
              <div ref={hist.wrapRef} className="w-full">
                <canvas ref={hist.canvasRef} className="block w-full" />
              </div>
            </div>
          </div>
          <div className="workbench-card workbench-chart-card">
            <div className="workbench-card-header">
              <h3 className="workbench-card-title">Risk Type Distribution</h3>
            </div>
            <div className="workbench-card-body">
              <div ref={risk.wrapRef} className="w-full">
                <canvas ref={risk.canvasRef} className="block w-full" />
              </div>
            </div>
          </div>
        </div>

        {/* 许可证分布（全宽） */}
        <div className="workbench-card workbench-animate-in [animation-delay:125ms]">
          <div className="workbench-card-header">
            <h3 className="workbench-card-title">License Distribution</h3>
            <span className="text-xs text-muted-foreground">
              Top {Object.keys(licenseDist).length} licenses
              {licenseDist["Other"]
                ? ` · ${eco.unlicensed_count ?? 0} unlicensed`
                : ""}
            </span>
          </div>
          <div className="workbench-card-body">
            <div ref={lic.wrapRef} className="w-full">
              <canvas ref={lic.canvasRef} className="block w-full" />
            </div>
          </div>
        </div>

        {/* TOP 包 */}
        <div className="workbench-card workbench-animate-in [animation-delay:150ms]">
          <div className="workbench-card-header">
            <h3 className="workbench-card-title">Recently Published TOP 10</h3>
          </div>
          <div className="workbench-card-body workbench-eco-table-wrap">
            <table className="workbench-eco-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Version</th>
                  <th>License</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {eco.top_packages.map((p, i) => (
                  <tr key={`${p.name}-${i}`}>
                    <td className="workbench-eco-rank">{i + 1}</td>
                    <td
                      className="workbench-eco-name"
                      title={p.description || p.name}
                    >
                      {p.name}
                    </td>
                    <td className="workbench-eco-mono">{p.version ?? "—"}</td>
                    <td>
                      {p.license ? (
                        p.license
                      ) : (
                        <span className="text-destructive">Not declared</span>
                      )}
                    </td>
                    <td className="workbench-eco-num">
                      {p.days_ago != null ? `${p.days_ago}d ago` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkbenchShell>
  );
}
