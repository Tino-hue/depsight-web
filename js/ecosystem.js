// 生态大盘渲染

import { loadDemoEcosystem } from './demo-data.js';

export function renderEcosystem(state) {
  // 用 demo 数据 + 最近一次分析的结果
  const demo = loadDemoEcosystem();
  const lastResult = state.lastResult;

  renderEcoCards(demo, lastResult);
  renderScoreHistogram('#eco-score-histogram', demo.score_distribution);
  renderRiskBar('#eco-risk-bar', demo.risk_type_counts);
  renderTopPackages('#eco-top-packages', demo.top_packages);
}

// 顶部卡片
function renderEcoCards(demo, lastResult) {
  const container = document.querySelector('#ecosystem-cards');
  if (!container) return;

  // 合并最近一次分析的数据
  let avgHealth = demo.overall_health;
  let totalPkgs = demo.total_packages;
  if (lastResult?.ecosystem_stats) {
    avgHealth = lastResult.ecosystem_stats.avg_health_score;
    totalPkgs = lastResult.ecosystem_stats.total_packages;
  }

  const cards = [
    { label: '生态整体健康分', value: avgHealth, color: avgHealth >= 80 ? 'text-success' : avgHealth >= 60 ? 'text-warning' : 'text-danger' },
    { label: '总包数', value: totalPkgs, color: 'text-info' },
    { label: '活跃包', value: demo.active_packages, color: 'text-success' },
    { label: '停滞包', value: demo.stale_packages, color: 'text-danger' },
    { label: '已分析依赖', value: lastResult?.node_count || '--', color: 'text-info' },
    { label: '唯一许可证', value: lastResult?.ecosystem_stats?.unique_licenses || '--', color: 'text-warning' },
  ];

  container.innerHTML = cards.map(c => `
    <div class="eco-card">
      <div class="eco-card-num ${c.color}">${c.value}</div>
      <div class="eco-card-label">${c.label}</div>
    </div>
  `).join('');
}

// 健康分分布直方图
function renderScoreHistogram(selector, distribution) {
  const canvas = document.querySelector(selector);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
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
    const [lo, hi] = range.split('-').map(Number);
    const mid = (lo + hi) / 2;
    const color = mid >= 85 ? '#10b981' : mid >= 70 ? '#6366f1' : mid >= 55 ? '#f59e0b' : '#ef4444';

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, barW - 8, barH, 3);
    ctx.fill();

    // 数值
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(val), x + (barW - 8) / 2, y - 5);

    // X 轴标签
    ctx.fillStyle = '#64748b';
    ctx.font = '10px sans-serif';
    ctx.fillText(range, x + (barW - 8) / 2, H - padding.bottom + 16);
  });

  // Y 轴
  ctx.strokeStyle = '#2a3040';
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
  const ctx = canvas.getContext('2d');
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
    'OUTDATED': '#f59e0b',
    'LICENSE': '#3b82f6',
    'DEPRECATED': '#8b5cf6',
    'SIZE': '#06b6d4',
    'ACTIVITY': '#ef4444',
  };

  types.forEach((type, i) => {
    const val = riskCounts[type];
    const barW = (val / maxVal) * chartW;
    const y = padding.top + i * barH + 4;
    const color = colors[type] || '#6366f1';

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(padding.left, y, barW, barH - 8, 3);
    ctx.fill();

    // 数值
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(val), padding.left + barW + 8, y + (barH - 8) / 2 + 4);

    // 类型标签
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(type, padding.left - 8, y + (barH - 8) / 2 + 4);
  });
}

// TOP 包列表
function renderTopPackages(selector, topPackages) {
  const container = document.querySelector(selector);
  if (!container) return;

  container.innerHTML = `
    <h3>最热包 TOP 10</h3>
    <table class="eco-pkg-table">
      <thead>
        <tr><th>#</th><th>包名</th><th>下载量</th><th>健康分</th><th>许可证</th></tr>
      </thead>
      <tbody>
        ${topPackages.map((p, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(p.name)}</td>
            <td>${p.downloads.toLocaleString()}</td>
            <td><span class="eco-pkg-health ${p.health >= 80 ? 'good' : p.health >= 60 ? 'mid' : 'bad'}">${p.health}</span></td>
            <td>${p.license ? escapeHtml(p.license) : '<span style="color:var(--danger)">未声明</span>'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
