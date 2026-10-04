// 历史趋势图（Canvas 绘制，无依赖）

import { loadDemoTrends } from './demo-data.js';

// 内存存储（localStorage 持久化）
const STORAGE_KEY = 'depsight_trends';

function loadStoredTrends() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredTrends(trends) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trends));
  } catch { /* ignore */ }
}

// 记录一次分析结果
export function recordTrend(state, result) {
  if (!result || !state.lastRootMod) return;

  const trends = loadStoredTrends();
  const name = state.lastRootMod.name;
  const today = new Date().toISOString().slice(0, 10);

  if (!trends[name]) trends[name] = [];
  // 去重：同一天只记一次
  const existing = trends[name].findIndex(p => p.date === today);
  if (existing >= 0) {
    trends[name][existing].score = result.overall_score;
  } else {
    trends[name].push({ date: today, score: result.overall_score });
  }

  saveStoredTrends(trends);
}

export function renderTrends(canvasSelector, selectSelector, statsSelector, state) {
  const canvas = document.querySelector(canvasSelector);
  const select = document.querySelector(selectSelector);
  const stats = document.querySelector(statsSelector);
  if (!canvas || !select) return;

  // 合并 demo 数据 + 本地存储数据
  const demo = loadDemoTrends();
  const stored = loadStoredTrends();
  const allTrends = { ...demo, ...stored };

  // 填充选择器
  const names = Object.keys(allTrends);
  select.innerHTML = '<option value="">选择包…</option>' +
    names.map(n => `<option value="${escapeHtml(n)}" ${select.value === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');

  // 默认选第一个
  const current = select.value || names[0];
  if (!current) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const points = allTrends[current] || [];
  drawTrendChart(canvas, points, current);

  // 统计
  if (stats) {
    if (points.length === 0) {
      stats.innerHTML = '<p class="no-data">暂无历史数据</p>';
    } else {
      const scores = points.map(p => p.score);
      const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      const latest = scores[scores.length - 1];
      const first = scores[0];
      const diff = latest - first;
      const trendColor = diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-muted)';
      const trendIcon = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';

      stats.innerHTML = `
        <div class="trend-stat"><div class="trend-stat-num">${avg}</div><div class="trend-stat-label">平均分</div></div>
        <div class="trend-stat"><div class="trend-stat-num">${max}</div><div class="trend-stat-label">最高分</div></div>
        <div class="trend-stat"><div class="trend-stat-num">${min}</div><div class="trend-stat-label">最低分</div></div>
        <div class="trend-stat">
          <div class="trend-stat-num" style="color:${trendColor}">${trendIcon} ${Math.abs(diff)}</div>
          <div class="trend-stat-label">变化趋势</div>
        </div>
      `;
    }
  }

  // 切换选择时重绘
  select.onchange = () => renderTrends(canvasSelector, selectSelector, statsSelector, state);
}

// 绘制趋势图
function drawTrendChart(canvas, points, title) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const padding = { top: 40, right: 30, bottom: 40, left: 50 };

  ctx.clearRect(0, 0, W, H);

  if (points.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无数据，先运行一次分析', W / 2, H / 2);
    return;
  }

  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const minScore = 0;
  const maxScore = 100;

  // 背景网格
  ctx.strokeStyle = '#2a3040';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (chartH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(W - padding.right, y);
    ctx.stroke();

    // Y 轴标签
    ctx.fillStyle = '#64748b';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(maxScore - (maxScore / 5) * i), padding.left - 8, y + 4);
  }

  // X 轴日期标签（最多显示 6 个）
  const step = Math.max(1, Math.floor(points.length / 6));
  ctx.textAlign = 'center';
  for (let i = 0; i < points.length; i += step) {
    const x = padding.left + (chartW / (points.length - 1 || 1)) * i;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px sans-serif';
    ctx.fillText(points[i].date.slice(5), x, H - padding.bottom + 18);
  }

  // 数据折线
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();

  points.forEach((p, i) => {
    const x = padding.left + (chartW / (points.length - 1 || 1)) * i;
    const y = padding.top + chartH - ((p.score - minScore) / (maxScore - minScore)) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 数据点
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = padding.left + (chartW / (points.length - 1 || 1)) * i;
    const y = padding.top + chartH - ((p.score - minScore) / (maxScore - minScore)) * chartH;

    const color = p.score >= 80 ? '#10b981' : p.score >= 60 ? '#f59e0b' : '#ef4444';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    // 悬停提示（数值）
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(p.score), x, y - 10);
  }

  // 标题
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, padding.left, padding.top - 15);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
