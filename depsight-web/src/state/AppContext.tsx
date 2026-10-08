// 全局状态管理：WASM 状态 / 最近分析结果 / 图数据 / 趋势历史 / 视图路由 / AI 抽屉
// 从 js/main.js 的全局 state 迁移
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useAnalyzer } from "@/hooks/useAnalyzer";
import { useWasm as useWasmHook } from "@/hooks/useWasm";
import type {
  AnalysisContext,
  AnalysisResult,
  AppView,
  DepGraph,
  ParsedMod,
  TrendMap,
  TrendPoint,
  WasmStatus,
} from "@/lib/types";

const TRENDS_STORAGE_KEY = "depsight_trends";

function loadStoredTrends(): TrendMap {
  try {
    const raw = localStorage.getItem(TRENDS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TrendMap) : {};
  } catch {
    return {};
  }
}

function saveStoredTrends(trends: TrendMap): void {
  try {
    localStorage.setItem(TRENDS_STORAGE_KEY, JSON.stringify(trends));
  } catch {
    /* ignore */
  }
}

/** AI 抽屉任务：risk = 单项诊断；all = 整体诊断；pr = 生成修复 PR */
export interface AiTask {
  id: number;
  kind: "risk" | "all" | "pr";
  code?: string;
  nodeId?: string;
}

interface AppContextValue {
  // WASM
  wasmStatus: WasmStatus;
  useWasm: boolean;
  // 分析
  analyzeModText: (modText: string) => AnalysisResult;
  analyzeFromContext: (context: AnalysisContext) => AnalysisResult;
  /** 应用分析结果（写全局状态 + 记录趋势），返回是否成功 */
  applyResult: (result: AnalysisResult) => boolean;
  // 全局数据
  lastResult: AnalysisResult | null;
  lastGraph: DepGraph | null;
  lastRootMod: ParsedMod | null;
  trends: TrendMap;
  // 路由
  view: AppView;
  setView: (view: AppView) => void;
  // AI 抽屉
  aiOpen: boolean;
  setAiOpen: (open: boolean) => void;
  aiTask: AiTask | null;
  requestAi: (task: Omit<AiTask, "id">) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { status: wasmStatus, useWasm } = useWasmHook();
  const { analyzeModText, analyzeFromContext } = useAnalyzer(useWasm);

  const [view, setView] = useState<AppView>("analyze");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTask, setAiTask] = useState<AiTask | null>(null);

  const [lastResult, setLastResult] = useState<AnalysisResult | null>(null);
  const [lastGraph, setLastGraph] = useState<DepGraph | null>(null);
  const [lastRootMod, setLastRootMod] = useState<ParsedMod | null>(null);
  const [trends, setTrends] = useState<TrendMap>(loadStoredTrends);

  const applyResult = useCallback((result: AnalysisResult): boolean => {
    if (result.error) return false;
    setLastResult(result);
    setLastGraph(result.graph);
    setLastRootMod(result._root_mod ?? null);

    // 记录趋势：同一天去重（与 js/trends.js recordTrend 一致）
    const root = result._root_mod;
    if (root && root.name) {
      setTrends((prev) => {
        const next: TrendMap = { ...prev };
        const arr: TrendPoint[] = [...(next[root.name] ?? [])];
        const today = new Date().toISOString().slice(0, 10);
        const idx = arr.findIndex((p) => p.date === today);
        if (idx >= 0) {
          arr[idx] = { ...arr[idx], score: result.overall_score };
        } else {
          arr.push({ date: today, score: result.overall_score });
        }
        next[root.name] = arr;
        saveStoredTrends(next);
        return next;
      });
    }
    return true;
  }, []);

  const requestAi = useCallback((task: Omit<AiTask, "id">) => {
    setAiTask({ ...task, id: Date.now() });
    setAiOpen(true);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      wasmStatus,
      useWasm,
      analyzeModText,
      analyzeFromContext,
      applyResult,
      lastResult,
      lastGraph,
      lastRootMod,
      trends,
      view,
      setView,
      aiOpen,
      setAiOpen,
      aiTask,
      requestAi,
    }),
    [
      wasmStatus,
      useWasm,
      analyzeModText,
      analyzeFromContext,
      applyResult,
      lastResult,
      lastGraph,
      lastRootMod,
      trends,
      view,
      aiOpen,
      aiTask,
      requestAi,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within <AppProvider>");
  return ctx;
}
