// 分析编排 hook：WASM 优先，失败回退 JS 分析器（契约一致）
// 从 js/analyzer.js 迁移编排逻辑

import { useCallback } from "react";

import { runJsAnalyzer } from "@/lib/analyzer";
import type { AnalysisContext, AnalysisResult } from "@/lib/types";
import {
  callWasmAnalyze,
  callWasmAnalyzeModText,
  isWasmAvailable,
} from "@/lib/wasm-loader";

export function useAnalyzer(useWasm: boolean) {
  // 分析 moon.mod 文本（不递归依赖）
  const analyzeModText = useCallback(
    (modText: string): AnalysisResult => {
      // 尝试 WASM：走 analyze_from_mod_text 入口（单 moon.mod 文本，不递归依赖）
      if (useWasm && isWasmAvailable()) {
        const result = callWasmAnalyzeModText(modText);
        if (result) {
          try {
            return JSON.parse(result) as AnalysisResult;
          } catch (e) {
            console.error("[analyzer] WASM returned invalid JSON:", e);
          }
        }
      }
      // fallback
      return runJsAnalyzer({ type: "mod_text", mod_text: modText });
    },
    [useWasm],
  );

  // 分析完整 context（含远程依赖）
  const analyzeFromContext = useCallback(
    (context: AnalysisContext): AnalysisResult => {
      // context 是对象，先 stringify 给 WASM
      if (useWasm && isWasmAvailable()) {
        const ctxJson = JSON.stringify(context);
        const result = callWasmAnalyze(ctxJson);
        if (result) {
          try {
            return JSON.parse(result) as AnalysisResult;
          } catch (e) {
            console.error("[analyzer] WASM returned invalid JSON:", e);
          }
        }
      }
      // fallback
      return runJsAnalyzer({ type: "context", context });
    },
    [useWasm],
  );

  return { analyzeModText, analyzeFromContext };
}
