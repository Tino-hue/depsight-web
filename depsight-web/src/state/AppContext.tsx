// 全局状态管理：WASM 状态 / 最近分析结果 / 图数据 / 趋势历史 / 视图路由 / AI 抽屉
// 从 js/main.js 的全局 state 迁移
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
const THEME_STORAGE_KEY = "depsight_theme";

export type Theme = "dark" | "light";

const VALID_VIEWS: AppView[] = [
  "hero",
  "analyze",
  "graph",
  "trends",
  "ecosystem",
];

/** 从 #hash 解析初始视图（默认 hero 落地首页） */
function viewFromHash(): AppView {
  if (typeof window === "undefined") return "hero";
  const h = window.location.hash.replace("#", "");
  return (VALID_VIEWS as string[]).includes(h) ? (h as AppView) : "hero";
}

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

/** 从 localStorage 读取主题偏好（默认 dark） */
function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" ? "light" : "dark";
  } catch {
    return "dark";
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
  // 主题
  theme: Theme;
  toggleTheme: () => void;
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

  const [view, setViewState] = useState<AppView>(viewFromHash);
  const [aiOpen, setAiOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);

  // 主题切换：写 localStorage + 切换根元素 class
  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
    } else {
      root.classList.remove("light");
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  // 视图 ⇄ #hash 双向同步：可分享、可后退、刷新不丢
  useEffect(() => {
    const target = view === "hero" ? "#hero" : `#${view}`;
    if (window.location.hash !== target) {
      history.replaceState(null, "", target);
    }
  }, [view]);

  useEffect(() => {
    const onHash = () => setViewState(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const setView = useCallback((v: AppView) => setViewState(v), []);
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
      theme,
      toggleTheme,
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
      theme,
      toggleTheme,
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
