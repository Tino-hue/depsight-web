// 生态大盘渲染
// 优先使用 mooncakes.io 官方 v0 API 真实数据，失败时回退 demo 数据

import { loadDemoEcosystem } from "./demo-data.js";
import { fetchAllModules } from "./fetcher.js";

// 真实生态数据缓存（会话级）
let realEcosystemCache = null;
let realEcosystemLoading = null;

export function renderEcosystem(state) {
  // 先用 demo 数据立即渲染，真实数据到了再覆盖
  const demo = loadDemoEcosystem();
  renderAll(demo, state, false);

  // 异步加载真实数据
  loadRealEcosystem().then((real) => {
    if (real) renderAll(real, state, true);
  });
}

// 手动刷新：清除缓存重新拉取
export async function refreshEcosystem(state) {
  realEcosystemCache = null;
  const real = await loadRealEcosystem();
  if (real) {
    renderAll(real, state, true);
    return true;
  }
  return false;
}

function renderAll(eco, state, isReal) {
  const lastResult = state.lastResult;

  renderEcoCards(eco, lastResult, isReal);
  renderScoreHistogram("#eco-score-histogram", eco.score_distribution);
  renderRiskBar("#eco-risk-bar", eco.risk_type_counts);
  renderTopPackages("#eco-top-packages", eco.top_packages);
}

// ===== 从 mooncakes.io v0 API 构建真实生态数据 =====
async function loadRealEcosystem() {
  if (realEcosystemCache) return realEcosystemCache;
  if (realEcosystemLoading) return realEcosystemLoading;

  realEcosystemLoading = (async () => {
    try {
      setStatus("正在拉取 mooncakes.io 生态数据…");
      const modules = await fetchAllModules();
      const eco = buildEcosystemFromModules(modules);
      realEcosystemCache = eco;
      setStatus(
        `真实数据 · ${modules.length} 个包 · ${new Date().toLocaleTimeString()}`,
      );
      return eco;
    } catch (e) {
      console.warn("[ecosystem] 真实数据加载失败，使用 demo 数据:", e.message);
      setStatus("真实数据不可用，显示演示数据");
      return null;
    } finally {
      realEcosystemLoading = null;
    }
  })();

  return realEcosystemLoading;
}

function setStatus(msg) {
  const el = document.querySelector("#eco-data-status");
  if (el) el.textContent = msg;
}

// 从全量模块列表构建生态统计
function buildEcosystemFromModules(modules) {
  const total = modules.length;

  // 许可证分布
  const licenseCounts = {};
  let unlicensed = 0;
  for (const m of modules) {
    const lic = m.license?.trim();
    if (lic) {
      licenseCounts[lic] = (licenseCounts[lic] || 0) + 1;
    } else {
      unlicensed++;
    }
  }

  // 活跃度：按 created_at 距今天数分类
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let active30 = 0,
    active90 = 0,
    active365 = 0,
    stale = 0;
  const recentPackages = [];

  for (const m of modules) {
    const days = m.created_at
      ? Math.floor((now - new Date(m.created_at).getTime()) / DAY)
      : null;

    if (days === null) {
      stale++;
    } else if (days <= 30) {
      active30++;
      recentPackages.push({
        name: m.name,
        version: m.version,
        license: m.license,
        days,
      });
    } else if (days <= 90) {
      active90++;
    } else if (days <= 365) {
      active365++;
    } else {
      stale++;
    }
  }

  const active = active30 + active90;

  // 健康分分布（基于活跃度 + 许可证 简单估算）
  const scoreDist = {
    "90-100": 0,
    "80-89": 0,
    "70-79": 0,
    "60-69": 0,
    "50-59": 0,
    "0-49": 0,
  };
  for (const m of modules) {
    let score = 50;
    // 有许可证 +20
    if (m.license?.trim()) score += 20;
    // 有仓库链接 +10
    if (m.repository?.trim()) score += 10;
    // 有描述 +5
    if (m.description?.trim()) score += 5;
    // 有 keywords +5
    if (m.keywords?.length) score += 5;
    // 未被 yank +10
    if (!m.yanked) score += 10;

    // 活跃度加成
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

  // 平均健康分
  const scoreVals = Object.entries(scoreDist).flatMap(([range, count]) => {
    const [lo, hi] = range.split("-").map(Number);
    const mid = (lo + hi) / 2;
    return Array(count).fill(mid);
  });
  const avgHealth = scoreVals.length
    ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length)
    : 0;

  // 风险类型估算
  const riskCounts = {
    OUTDATED: modules.filter((m) => m.yanked).length,
    LICENSE: unlicensed,
    DEPRECATED: modules.filter((m) => m.yanked && m.yanked_reason).length,
    SIZE: Math.round(total * 0.03),
    ACTIVITY: stale,
  };

  // TOP 包：按最近发布排序
  const topPackages = [...modules]
    .filter((m) => m.created_at)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10)
    .map((m) => ({
      name: m.name,
      version: m.version,
      license: m.license,
      days_ago: m.created_at
        ? Math.floor((now - new Date(m.created_at).getTime()) / DAY)
        : null,
      repository: m.repository,
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

// 顶部卡片
function renderEcoCards(eco, lastResult, isReal) {
  const container = document.querySelector("#ecosystem-cards");
  if (!container) return;

  let avgHealth = eco.overall_health;
  let totalPkgs = eco.total_packages;
  if (lastResult?.ecosystem_stats) {
    avgHealth = lastResult.ecosystem_stats.avg_health_score;
    totalPkgs = lastResult.ecosystem_stats.total_packages;
  }

  const dataBadge = isReal
    ? '<span class="eco-badge real">真实数据</span>'
    : '<span class="eco-badge demo">演示数据</span>';

  const cards = [
    {
      label: "生态整体健康分",
      value: avgHealth,
      color:
        avgHealth >= 80
          ? "text-success"
          : avgHealth >= 60
            ? "text-warning"
            : "text-danger",
      badge: dataBadge,
    },
    { label: "总包数", value: totalPkgs, color: "text-info" },
    {
      label: "活跃包（90天内）",
      value: eco.active_packages,
      color: "text-success",
    },
    {
      label: "停滞包（超1年）",
      value: eco.stale_packages ?? "--",
      color: "text-danger",
    },
    {
      label: "已分析依赖",
      value: lastResult?.node_count || "--",
      color: "text-info",
    },
    {
      label: "未声明许可证",
      value: eco.unlicensed_count ?? "--",
      color: "text-warning",
    },
  ];

  container.innerHTML = cards
    .map(
      (c) => `
    <div class="eco-card">
      <div class="eco-card-num ${c.color}">${c.value}</div>
      <div class="eco-card-label">${c.label}${c.badge || ""}</div>
    </div>
  `,
    )
    .join("");
}

// 健康分分布直方图
function renderScoreHistogram(selector, distribution) {
  const canvas = document.querySelector(selector);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };

  ctx.clearRect(0, 0, W, H);

  const ranges = Object.keys(distribution);
  const values = Object.values(distribution);
  const maxVal = Math.max(...values, 1);

  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const barW = chartW / ranges.length;

  // 柱子
  ranges.forEach((range, i) => {
    const val = distribution[range];
    const barH = (val / maxVal) * chartH;
    const x = padding.left + i * barW + 4;
    const y = padding.top + chartH - barH;

    // 颜色：健康分越高越绿
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

    // 数值
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(val), x + (barW - 8) / 2, y - 5);

    // X 轴标签
    ctx.fillStyle = "#64748b";
    ctx.font = "10px sans-serif";
    ctx.fillText(range, x + (barW - 8) / 2, H - padding.bottom + 16);
  });

  // Y 轴
  ctx.strokeStyle = "#2a3040";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, H - padding.bottom);
  ctx.stroke();
}

// 风险类型柱状图
function renderRiskBar(selector, riskCounts) {
  const canvas = document.querySelector(selector);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const padding = { top: 20, right: 80, bottom: 30, left: 20 };

  ctx.clearRect(0, 0, W, H);

  const types = Object.keys(riskCounts);
  const values = Object.values(riskCounts);
  const maxVal = Math.max(...values, 1);

  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const barH = chartH / types.length;

  const colors = {
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

    // 数值
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(val), padding.left + barW + 8, y + (barH - 8) / 2 + 4);

    // 类型标签
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(type, padding.left - 8, y + (barH - 8) / 2 + 4);
  });
}

// TOP 包列表
function renderTopPackages(selector, topPackages) {
  const container = document.querySelector(selector);
  if (!container) return;

  // 真实数据格式：{ name, version, license, days_ago, repository, description }
  // demo 数据格式：{ name, downloads, health, license }
  const isReal = topPackages[0] && "days_ago" in topPackages[0];

  if (isReal) {
    container.innerHTML = `
      <h3>最近发布 TOP 10</h3>
      <table class="eco-pkg-table">
        <thead>
          <tr><th>#</th><th>包名</th><th>版本</th><th>许可证</th><th>发布于</th></tr>
        </thead>
        <tbody>
          ${topPackages
            .map(
              (p, i) => `
            <tr>
              <td>${i + 1}</td>
              <td title="${escapeHtml(p.description || "")}">${escapeHtml(p.name)}</td>
              <td>${escapeHtml(p.version)}</td>
              <td>${p.license ? escapeHtml(p.license) : '<span style="color:var(--danger)">未声明</span>'}</td>
              <td>${p.days_ago != null ? p.days_ago + " 天前" : "—"}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  } else {
    container.innerHTML = `
      <h3>最热包 TOP 10</h3>
      <table class="eco-pkg-table">
        <thead>
          <tr><th>#</th><th>包名</th><th>下载量</th><th>健康分</th><th>许可证</th></tr>
        </thead>
        <tbody>
          ${topPackages
            .map(
              (p, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(p.name)}</td>
              <td>${p.downloads.toLocaleString()}</td>
              <td><span class="eco-pkg-health ${p.health >= 80 ? "good" : p.health >= 60 ? "mid" : "bad"}">${p.health}</span></td>
              <td>${p.license ? escapeHtml(p.license) : '<span style="color:var(--danger)">未声明</span>'}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    `;
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
