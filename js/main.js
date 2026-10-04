// depsight Web 平台入口：路由 + 全局状态
import { initWasm } from './wasm-loader.js';
import { analyzeModText, analyzeFromContext } from './analyzer.js';
import { renderDashboard } from './dashboard.js';
import { initGraph3D, updateGraphData, focusNode, clearHighlights } from './graph3d.js';
import { renderTrends } from './trends.js';
import { renderEcosystem } from './ecosystem.js';
import { openAiDrawer } from './ai-panel.js';
import { loadDemoContext } from './demo-data.js';
import { fetchPackageContext } from './fetcher.js';

// ===== 全局状态 =====
export const state = {
  wasm: null,                // WASM 实例（或 null 走 fallback）
  useWasm: false,
  lastResult: null,          // 最近一次分析结果 JSON
  lastGraph: null,           // 最近一次图数据 { nodes, edges, root_id }
  lastRootMod: null,         // 最近一次根 moon.mod
  wasmStatus: 'loading',
};

// ===== DOM =====
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ===== 初始化 =====
async function boot() {
  // 初始化 WASM（失败走 fallback）
  const wasmResult = await initWasm();
  state.wasm = wasmResult.instance;
  state.useWasm = wasmResult.useWasm;
  state.wasmStatus = wasmResult.status;

  const wasmStatusEl = $('#wasm-status');
  if (state.useWasm) {
    wasmStatusEl.textContent = 'WASM ✓';
    wasmStatusEl.classList.add('loaded');
  } else {
    wasmStatusEl.textContent = 'WASM 不可用 · JS 回退';
    wasmStatusEl.classList.add('fallback');
  }

  // 路由
  bindNav();
  bindInputTabs();
  bindButtons();

  // 初始化 3D 图（先空跑）
  initGraph3D('#graph3d-container');

  // 初始视图
  switchView('analyze');
}

// ===== 路由 =====
function bindNav() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function switchView(view) {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));

  if (view === 'graph' && state.lastGraph) {
    updateGraphData(state.lastGraph, state.lastResult);
  } else if (view === 'trends') {
    renderTrends('#trend-chart', '#trend-package-selector', '#trend-stats', state);
  } else if (view === 'ecosystem') {
    renderEcosystem(state);
  }
}

// ===== 输入 Tab =====
function bindInputTabs() {
  $$('.input-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.input-tab').forEach(t => t.classList.toggle('active', t === tab));
      $$('.input-pane').forEach(p => p.classList.toggle('active', p.id === `input-${tab.dataset.input}`));
    });
  });
}

// ===== 按钮绑定 =====
function bindButtons() {
  $('#analyze-btn').addEventListener('click', onAnalyze);
  $('#analyze-offline-btn').addEventListener('click', onAnalyzeOffline);
  $('#load-demo-btn').addEventListener('click', onLoadDemo);
  $('#load-package-btn').addEventListener('click', onLoadPackage);
  $('#ai-close').addEventListener('click', () => $('#ai-drawer').classList.remove('open'));
  $('#ai-toggle').addEventListener('click', () => {
    if (state.lastResult) $('#ai-drawer').classList.add('open');
  });
  $('#graph-reset-view').addEventListener('click', () => {
    // 由 graph3d 模块导出
    clearHighlights();
    focusNode(null);
  });
}

// ===== 分析入口 =====
async function onAnalyze() {
  const statusEl = $('#analyze-status');
  const analyzeBtn = $('#analyze-btn');
  analyzeBtn.disabled = true;
  statusEl.textContent = '分析中…';

  try {
    // 判断当前 tab
    const activeTab = document.querySelector('.input-tab.active').dataset.input;
    let result = null;

    if (activeTab === 'text') {
      const modText = $('#moon-mod-input').value.trim();
      if (!modText) { statusEl.textContent = '请先粘贴 moon.mod 内容'; return; }
      result = analyzeModText(state, modText);
    } else if (activeTab === 'package') {
      statusEl.textContent = '正在从 mooncakes.io 拉取依赖…';
      const name = $('#package-name').value.trim();
      const version = $('#package-version').value.trim() || null;
      if (!name) { statusEl.textContent = '请输入包名'; return; }
      const ctx = await fetchPackageContext(name, version);
      result = analyzeFromContext(state, ctx);
    } else if (activeTab === 'demo') {
      const ctx = await loadDemoContext();
      result = analyzeFromContext(state, ctx);
    }

    if (!result) {
      statusEl.textContent = '分析失败：未得到结果';
      return;
    }

    if (result.error) {
      statusEl.textContent = `分析失败：${result.error}`;
      return;
    }

    state.lastResult = result;
    state.lastGraph = result.graph;
    state.lastRootMod = result._root_mod;

    renderDashboard(result);
    $('#result-panel').classList.remove('hidden');
    statusEl.textContent = `分析完成：${result.node_count} 个节点`;
    $('#ai-toggle').classList.remove('hidden');

    // 自动切到 graph 视图展示
    switchView('graph');
  } finally {
    analyzeBtn.disabled = false;
  }
}

async function onAnalyzeOffline() {
  const statusEl = $('#analyze-status');
  statusEl.textContent = '离线模式分析中…';
  const ctx = await loadDemoContext();
  const result = analyzeFromContext(state, ctx);
  if (result.error) {
    statusEl.textContent = `分析失败：${result.error}`;
    return;
  }
  state.lastResult = result;
  state.lastGraph = result.graph;
  state.lastRootMod = result._root_mod;
  renderDashboard(result);
  $('#result-panel').classList.remove('hidden');
  statusEl.textContent = `离线分析完成（示例数据）`;
  $('#ai-toggle').classList.remove('hidden');
  switchView('graph');
}

async function onLoadDemo() {
  const statusEl = $('#analyze-status');
  statusEl.textContent = '加载示例数据…';
  const ctx = await loadDemoContext();
  const result = analyzeFromContext(state, ctx);
  state.lastResult = result;
  state.lastGraph = result.graph;
  state.lastRootMod = result._root_mod;
  renderDashboard(result);
  $('#result-panel').classList.remove('hidden');
  statusEl.textContent = '示例数据已加载';
  $('#ai-toggle').classList.remove('hidden');
  switchView('graph');
}

async function onLoadPackage() {
  const statusEl = $('#package-load-status');
  const name = $('#package-name').value.trim();
  const version = $('#package-version').value.trim() || null;
  if (!name) {
    statusEl.textContent = '请输入包名';
    statusEl.className = 'load-status err';
    return;
  }
  statusEl.textContent = `拉取 ${name}…`;
  statusEl.className = 'load-status';
  try {
    const ctx = await fetchPackageContext(name, version);
    statusEl.textContent = `已拉取 ${Object.keys(ctx.modules || {}).length + 1} 个模块`;
    statusEl.className = 'load-status ok';
    // 把拉到的 root mod 显示到 text 输入框，便于用户编辑
    if (ctx.root) {
      $('#moon-mod-input').value = ctx.root;
    }
  } catch (e) {
    statusEl.textContent = `拉取失败：${e.message}`;
    statusEl.className = 'load-status err';
  }
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', boot);
