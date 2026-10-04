// 分析器：调用 WASM API，失败则回退到 JS 实现（契约一致）
// 输入：moon.mod 文本 或 context JSON
// 输出：完整分析结果 JSON（含 graph、health_scores、diagnostics、size_offenders、ecosystem_stats）

import { callWasmAnalyze, isWasmAvailable } from './wasm-loader.js';
import { runJsAnalyzer } from './js-analyzer.js';

// 分析 moon.mod 文本（不递归依赖）
export function analyzeModText(state, modText) {
  // 尝试 WASM
  if (state.useWasm && isWasmAvailable()) {
    const result = callWasmAnalyzeForMod(state, modText);
    if (result) return result;
  }
  // fallback
  return runJsAnalyzer({ type: 'mod_text', mod_text: modText });
}

// 分析完整 context（含远程依赖）
export function analyzeFromContext(state, context) {
  // context 是对象，先 stringify 给 WASM
  if (state.useWasm && isWasmAvailable()) {
    const ctxJson = JSON.stringify(context);
    const result = callWasmAnalyze(ctxJson);
    if (result) {
      try {
        return JSON.parse(result);
      } catch (e) {
        console.error('[analyzer] WASM returned invalid JSON:', e);
      }
    }
  }
  // fallback
  return runJsAnalyzer({ type: 'context', context });
}

// 调 WASM 分析 moon.mod 文本
function callWasmAnalyzeForMod(state, modText) {
  // 走 context 入口：构造一个只含 root 的 context
  const ctx = { root: modText, modules: {}, metadata: {} };
  const result = callWasmAnalyze(JSON.stringify(ctx));
  if (result) {
    try {
      return JSON.parse(result);
    } catch (e) {
      console.error('[analyzer] WASM returned invalid JSON:', e);
    }
  }
  return null;
}
