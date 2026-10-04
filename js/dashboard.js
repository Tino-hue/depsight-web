// 健康分仪表盘渲染

export function renderDashboard(result) {
  renderScoreRing(result.overall_score);
  renderDimensions(result);
  renderSummaryCards(result.summary);
  renderRiskList(result.diagnostics);
  renderSizeList(result.size_offenders_top5);
}

// 总分圆环
function renderScoreRing(score) {
  const fg = document.querySelector('#score-ring-fg');
  const value = document.querySelector('#overall-score');
  if (!fg || !value) return;

  const circumference = 2 * Math.PI * 60; // r=60
  const offset = circumference - (score / 100) * circumference;

  fg.style.strokeDashoffset = offset;
  fg.style.stroke = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  value.textContent = score;
  value.style.color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
}

// 5 维分数
function renderDimensions(result) {
  const container = document.querySelector('#score-dimensions');
  if (!container) return;

  // 取所有节点的平均分
  const scores = result.health_scores || [];
  if (scores.length === 0) {
    container.innerHTML = '<p class="no-data">暂无数据</p>';
    return;
  }

  const avg = (key) => Math.round(scores.reduce((a, b) => a + (b[key] || 0), 0) / scores.length);

  const dims = [
    { label: '新鲜度', key: 'freshness', weight: '25%' },
    { label: '许可证合规', key: 'compliance', weight: '20%' },
    { label: '废弃 API 密度', key: 'deprecated_density', weight: '25%' },
    { label: '包大小', key: 'size_reasonableness', weight: '20%' },
    { label: '活跃度', key: 'activity', weight: '10%' },
  ];

  container.innerHTML = dims.map(d => {
    const val = avg(d.key);
    const color = val >= 80 ? 'var(--success)' : val >= 60 ? 'var(--warning)' : 'var(--danger)';
    return `
      <div class="score-dim">
        <div class="score-dim-label">
          <span>${d.label} <span style="color:var(--text-faint);font-size:10px">${d.weight}</span></span>
          <span style="color:${color};font-weight:600">${val}</span>
        </div>
        <div class="score-dim-bar">
          <div class="score-dim-bar-fill" style="width:${val}%;background:${color}"></div>
        </div>
      </div>
    `;
  }).join('');

  // 触发动画
  requestAnimationFrame(() => {
    container.querySelectorAll('.score-dim-bar-fill').forEach((el, i) => {
      setTimeout(() => { el.style.width = el.style.width; }, i * 100);
    });
  });
}

// 汇总卡片
function renderSummaryCards(summary) {
  const container = document.querySelector('#summary-cards');
  if (!container) return;

  const cards = [
    { label: '严重', value: summary.critical || 0, color: 'var(--danger)' },
    { label: '警告', value: summary.warning || 0, color: 'var(--warning)' },
    { label: '提示', value: summary.info || 0, color: 'var(--info)' },
  ];

  container.innerHTML = cards.map(c => `
    <div class="summary-card">
      <div class="summary-card-num" style="color:${c.color}">${c.value}</div>
      <div class="summary-card-label">${c.label}</div>
    </div>
  `).join('');
}

// 风险列表
function renderRiskList(diagnostics) {
  const container = document.querySelector('#risk-list');
  if (!container) return;

  if (!diagnostics || diagnostics.length === 0) {
    container.innerHTML = '<p class="no-data" style="color:var(--success)">✓ 未发现风险，依赖健康状况良好</p>';
    return;
  }

  // 按 severity 排序：critical > warning > info
  const sevOrder = { critical: 0, warning: 1, info: 2 };
  const sorted = [...diagnostics].sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3));

  container.innerHTML = sorted.map(d => {
    const sevClass = `severity-${d.severity}`;
    const sevLabel = { critical: '🔴 严重', warning: '🟡 警告', info: '🔵 提示' }[d.severity] || d.severity;
    return `
      <div class="risk-item ${sevClass}">
        <div class="risk-item-body">
          <div class="risk-item-title">${sevLabel} · ${escapeHtml(d.code)}</div>
          <div class="risk-item-msg">${escapeHtml(d.message)}</div>
          <div class="risk-item-node">${escapeHtml(d.node_id)}</div>
        </div>
        <button class="risk-ai-btn" onclick="window.__ai_diagnose('${escapeHtml(d.code)}','${escapeHtml(d.node_id)}')">AI 诊断</button>
      </div>
    `;
  }).join('');
}

// 大小 TOP5
function renderSizeList(sizeOffenders) {
  const container = document.querySelector('#size-list');
  if (!container) return;

  if (!sizeOffenders || sizeOffenders.length === 0) {
    container.innerHTML = '<p class="no-data">暂无数据</p>';
    return;
  }

  const max = sizeOffenders[0]?.transitive_size || 1;

  container.innerHTML = sizeOffenders.map(o => {
    const pct = Math.round((o.transitive_size / max) * 100);
    return `
      <div class="size-item">
        <span class="size-item-name">${escapeHtml(o.node_id)}</span>
        <span class="size-item-value">自身 ${formatBytes(o.self_size)}</span>
        <span class="size-item-value">传递 ${formatBytes(o.transitive_size)}</span>
        <div class="size-item-bar-wrap">
          <div class="size-item-bar" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

// 工具函数
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
