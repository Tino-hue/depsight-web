// AI 智能分析面板
// 通过调用 LLM API 生成诊断解释 + 修复建议
// 你可以配置 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL 环境变量

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// 从 localStorage 读取 API 配置
function getApiConfig() {
  return {
    apiKey: localStorage.getItem('depsight_openai_key') || '',
    baseUrl: localStorage.getItem('depsight_openai_base') || DEFAULT_BASE_URL,
    model: localStorage.getItem('depsight_openai_model') || DEFAULT_MODEL,
  };
}

export function openAiDrawer() {
  document.querySelector('#ai-drawer')?.classList.add('open');
}

export function closeAiDrawer() {
  document.querySelector('#ai-drawer')?.classList.remove('open');
}

// 诊断单个风险项
export async function diagnoseRisk(state, code, nodeId) {
  const drawer = document.querySelector('#ai-drawer');
  const content = document.querySelector('#ai-content');
  if (!drawer || !content) return;

  drawer.classList.add('open');
  content.innerHTML = '<p class="ai-hint">AI 正在分析…</p>';

  // 构造 prompt
  const diag = (state.lastResult?.diagnostics || []).find(d => d.code === code && d.node_id === nodeId);
  const health = (state.lastResult?.health_scores || []).find(h => h.node_id === nodeId);
  const meta = state.lastResult?.node_metas?.[nodeId];
  const rootMod = state.lastRootMod;

  const prompt = buildDiagnosePrompt(code, nodeId, diag, health, meta, rootMod);

  try {
    const response = await callLLM(prompt);
    content.innerHTML = renderAiResponse(code, nodeId, response, diag);
  } catch (e) {
    // LLM 不可用：用规则引擎 fallback
    const fallbackResponse = ruleBasedDiagnosis(code, nodeId, diag, health, meta);
    content.innerHTML = renderAiResponse(code, nodeId, fallbackResponse, diag, true);
  }
}

// 全量诊断
export async function diagnoseAll(state) {
  const drawer = document.querySelector('#ai-drawer');
  const content = document.querySelector('#ai-content');
  if (!drawer || !content) return;

  drawer.classList.add('open');
  content.innerHTML = '<p class="ai-hint">AI 正在生成整体诊断报告…</p>';

  const prompt = buildFullReportPrompt(state);
  try {
    const response = await callLLM(prompt);
    content.innerHTML = renderAiResponse('整体诊断', '全部依赖', response);
  } catch (e) {
    content.innerHTML = `<div class="ai-section"><div class="ai-section-title">AI 不可用</div>
      <div class="ai-section-body">请配置 OpenAI API Key。当前使用规则引擎 fallback：<br><br>${escapeHtml(e.message)}</div></div>`;
  }
}

// 生成修复 PR 描述
export async function generatePrDescription(state) {
  const drawer = document.querySelector('#ai-drawer');
  const content = document.querySelector('#ai-content');
  if (!drawer || !content) return;

  drawer.classList.add('open');
  content.innerHTML = '<p class="ai-hint">AI 正在生成 PR 描述…</p>';

  const prompt = buildPrPrompt(state);
  try {
    const response = await callLLM(prompt);
    content.innerHTML = renderAiResponse('PR 描述', '自动修复建议', response);
  } catch (e) {
    content.innerHTML = `<div class="ai-section"><div class="ai-section-title">AI 不可用</div>
      <div class="ai-section-body">${escapeHtml(e.message)}</div></div>`;
  }
}

// 调用 LLM
async function callLLM(prompt) {
  const config = getApiConfig();
  if (!config.apiKey) {
    throw new Error('未配置 OpenAI API Key，请在浏览器 localStorage 设置 depsight_openai_key');
  }

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: '你是 MoonBit 依赖健康检测专家。用中文回答，提供具体可执行的修复建议。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`LLM API error: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// 构造诊断 prompt
function buildDiagnosePrompt(code, nodeId, diag, health, meta, rootMod) {
  return `分析以下 MoonBit 依赖健康风险：

**风险代码**: ${code}
**受影响包**: ${nodeId}
**风险详情**: ${diag?.message || '未知'}
**健康分**: ${health ? health.total + '/100 (新鲜度:' + health.freshness + ' 合规:' + health.compliance + ' 废弃:' + health.deprecated_density + ' 大小:' + health.size_reasonableness + ' 活跃:' + health.activity + ')' : '未知'}
**包元数据**: ${meta ? `许可证=${meta.license || '未声明'}, 最新版本=${meta.latest_version || '未知'}, 体积=${meta.self_size || 0}字节, 最近提交=${meta.last_commit_days_ago || '未知'}天前` : '未知'}
**根项目**: ${rootMod ? `${rootMod.name}@${rootMod.version}` : '未知'}

请提供：
1. 风险原因分析（为什么这是个问题）
2. 影响范围（对项目的具体影响）
3. 修复建议（具体的 moon.mod 修改或代码改动）
4. 替代方案（如果有更好的包推荐）

用中文回答，markdown 格式。`;
}

// 构造全量报告 prompt
function buildFullReportPrompt(state) {
  const r = state.lastResult;
  if (!r) return '暂无分析数据';
  return `为以下 MoonBit 项目生成完整的依赖健康诊断报告：

**项目**: ${state.lastRootMod?.name}@${state.lastRootMod?.version}
**健康分**: ${r.overall_score}/100
**节点数**: ${r.node_count}

**健康分详情**:
${JSON.stringify(r.health_scores, null, 2)}

**诊断列表**:
${r.diagnostics.map(d => `- [${d.severity}] ${d.code}: ${d.message}`).join('\n')}

**生态统计**:
${JSON.stringify(r.ecosystem_stats, null, 2)}

请提供：
1. 整体健康评估（1-2 句话总结）
2. 关键风险排序（Top 3 严重问题）
3. 每个风险的修复建议
4. 长期维护建议（如何保持依赖健康）

用中文回答，markdown 格式。`;
}

// 构造 PR prompt
function buildPrPrompt(state) {
  const r = state.lastResult;
  if (!r) return '暂无分析数据';
  const fixes = r.diagnostics.filter(d => d.severity === 'critical' || d.severity === 'warning');
  return `根据以下 MoonBit 依赖健康检测结果，生成一个 PR（Pull Request）描述：

**项目**: ${state.lastRootMod?.name}@${state.lastRootMod?.version}
**需要修复的问题**:
${fixes.map(d => `- [${d.severity}] ${d.code}: ${d.message}`).join('\n')}

请生成：
1. PR 标题
2. PR 描述（包含问题背景、修复方案、测试结果）
3. 具体的 moon.mod 修改 diff
4. 代码变更建议

用中文回答，markdown 格式。`;
}

// 规则引擎 fallback（LLM 不可用时）
function ruleBasedDiagnosis(code, nodeId, diag, health, meta) {
  const rules = {
    'OUTDATED-001': () => {
      const latest = meta?.latest_version || '最新版本';
      const cur = nodeId.split('@')[1] || '当前版本';
      return `## 风险原因
该包当前版本 ${cur} 已过时，最新版本为 ${latest}。

## 影响范围
- 无法获得最新的 bug 修复和安全补丁
- 可能与其他依赖存在版本冲突
- 长期不升级会增加迁移成本

## 修复建议
在 moon.mod 中更新版本号：
\`\`\`toml
import { "${nodeId.split('@')[0]}@${latest}" }
\`\`\`

然后运行 \`moon update\` 更新依赖。

## 替代方案
如果该包已停止维护，考虑寻找社区推荐的替代包。`;
    },
    'LICENSE-001': () => `## 风险原因
该包未声明许可证，法律风险较高。

## 影响范围
- 商业使用可能侵权
- 无法确定是否可修改、分发

## 修复建议
联系包作者添加许可证，或选择有明确许可证的替代包。

## 替代方案
搜索 mooncakes.io 上同类别有 MIT/Apache-2.0 许可证的包。`,
    'LICENSE-002': () => `## 风险原因
该包使用 ${meta?.license || 'copyleft'} 许可证，具有传染性。

## 影响范围
- 你的项目可能需要开源
- 商业使用受限

## 修复建议
- 确认你的项目许可证是否兼容
- 考虑联系作者获取商业授权

## 替代方案
寻找使用 MIT/Apache-2.0 的同类包。`,
    'DEPRECATED-001': () => `## 风险原因
该包含 ${meta?.deprecated_api_count || '若干'} 个废弃 API。

## 影响范围
- 未来版本可能移除这些 API
- 代码可维护性下降

## 修复建议
查看包的 changelog，找到新 API 替换废弃 API。

## 替代方案
如果废弃 API 过多，考虑更换包。`,
    'SIZE-001': () => `## 风险原因
该包体积较大（${meta?.self_size || '未知'} 字节），影响编译和分发。

## 影响范围
- 增加编译时间
- 增加产物体积
- 可能影响加载速度

## 修复建议
- 检查是否引入了不必要的功能
- 考虑按需引入子模块

## 替代方案
寻找更轻量的替代包。`,
    'ACTIVITY-001': () => `## 风险原因
该包已 ${meta?.last_commit_days_ago || '很长'} 天未更新，可能已停止维护。

## 影响范围
- 无法获得 bug 修复
- 安全漏洞无人修补
- 与新版 MoonBit 可能不兼容

## 修复建议
**强烈建议**寻找替代包。检查 mooncakes.io 上同类别活跃包。

## 替代方案
如果自己维护成本低，可以 fork 自行维护。`,
    'ACTIVITY-002': () => `## 风险原因
该包最近更新在 ${meta?.last_commit_days_ago || '较长'} 天前，活跃度较低。

## 影响范围
- 响应 issue 较慢
- 新功能开发停滞

## 修复建议
- 观察一段时间，看是否有恢复迹象
- 准备备用方案

## 替代方案
如有需要，可寻找更活跃的同类包。`,
  };

  const rule = rules[code];
  if (rule) return rule();
  return `## 风险详情
${diag?.message || '未知风险'}

## 修复建议
请查看 depsight 文档了解该风险代码的含义。`;
}

// 渲染 AI 响应
function renderAiResponse(code, nodeId, response, diag, isFallback = false) {
  const formatted = formatMarkdownLite(response);
  return `
    ${isFallback ? '<div class="ai-section"><div class="ai-section-title">⚠️ LLM 不可用 · 规则引擎 fallback</div></div>' : ''}
    <div class="ai-section">
      <div class="ai-section-title">诊断对象</div>
      <div class="ai-section-body">
        <strong>${escapeHtml(code)}</strong> · ${escapeHtml(nodeId)}
      </div>
    </div>
    <div class="ai-section">
      <div class="ai-section-title">AI 分析</div>
      <div class="ai-section-body">${formatted}</div>
    </div>
    ${diag ? `<div class="ai-section">
      <div class="ai-section-title">原始诊断</div>
      <div class="ai-section-body" style="color:var(--text-muted);font-size:12px">${escapeHtml(diag.message)}</div>
    </div>` : ''}
  `;
}

// 轻量 markdown 格式化（不引入第三方库）
function formatMarkdownLite(md) {
  if (!md) return '';
  return escapeHtml(md)
    // 代码块
    .replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
      return `<div class="ai-code-block">${code.trim()}</div>`;
    })
    // 行内代码
    .replace(/`([^`\n]+)`/g, '<code style="background:var(--bg-panel-2);padding:2px 6px;border-radius:3px;font-family:monospace;font-size:12px">$1</code>')
    // 标题
    .replace(/^### (.+)$/gm, '<strong style="color:var(--accent);display:block;margin-top:12px">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="color:var(--accent);display:block;margin-top:14px;font-size:14px">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="color:var(--accent);display:block;margin-top:16px;font-size:15px">$1</strong>')
    // 列表
    .replace(/^\- (.+)$/gm, '<div style="padding-left:16px">• $1</div>')
    // 加粗
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 换行
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// 绑定到 window 供 dashboard 的 onclick 调用
window.__ai_diagnose = (code, nodeId) => {
  // 延迟 import 避免循环依赖
  import('./main.js').then(m => {
    diagnoseRisk(m.state, code, nodeId);
  });
};
