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
import {
  decodeSharePayload,
  encodeSharePayload,
  loadHistory,
  makeEntry,
  removeHistoryEntry,
  saveHistory,
  type HistoryEntry,
} from "@/lib/history";
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

/** 从 #hash 解析初始视图（默认 hero 落地首页；#share= 视为 analyze） */
function viewFromHash(): AppView {
  if (typeof window === "undefined") return "hero";
  const h = window.location.hash.replace("#", "");
  if (h.startsWith("share=")) return "analyze";
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
  // 分析历史（localStorage 持久化）
  history: HistoryEntry[];
  removeHistory: (id: string) => void;
  // 分享
  createShareUrl: (result?: AnalysisResult) => Promise<string>;
  copyShareUrl: (result?: AnalysisResult) => Promise<boolean>;
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

  // 首次渲染即捕获初始 hash（早于一切 effect；#share= 解码依赖它，
  // 否则下方 hash 同步 effect 会先把它替换成 #analyze）
  const [initialHash] = useState(() => window.location.hash);

  // 视图 ⇄ #hash 双向同步：可分享、可后退、刷新不丢
  // #share= 属于外部输入，同步后清除（避免覆盖历史 hash 状态）
  useEffect(() => {
    if (window.location.hash.startsWith("#share=")) {
      window.history.replaceState(null, "", "#analyze");
    }
    const target = view === "hero" ? "#hero" : `#${view}`;
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
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
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  // 启动时恢复最近一次分析（刷新不丢）；#share= 优先（外部分享链接）
  useEffect(() => {
    let cancelled = false;
    const hash = initialHash;
    if (hash.startsWith("#share=")) {
      decodeSharePayload(hash.slice("#share=".length)).then((result) => {
        if (cancelled || !result) return;
        setLastResult(result);
        setLastGraph(result.graph ?? null);
        setLastRootMod(result._root_mod ?? null);
      });
      return;
    }
    const entries = loadHistory();
    const latest = entries[0];
    if (latest) {
      setLastResult(latest.result);
      setLastGraph(latest.result.graph ?? null);
      setLastRootMod(latest.result._root_mod ?? null);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const applyResult = useCallback((result: AnalysisResult): boolean => {
    if (result.error) return false;
    setLastResult(result);
    setLastGraph(result.graph);
    setLastRootMod(result._root_mod ?? null);

    // 持久化分析历史（localStorage）
    const entry = makeEntry(result, "analysis");
    setHistory((prev) => {
      const next = [entry, ...prev];
      saveHistory(next);
      return next;
    });

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

  const removeHistory = useCallback((id: string) => {
    setHistory(removeHistoryEntry(id));
  }, []);

  // 生成可分享链接：结果 JSON → deflate → base64url → #share=<payload>
  const createShareUrl = useCallback(
    async (result?: AnalysisResult) => {
      const target = result ?? lastResult;
      if (!target) return window.location.href;
      const payload = await encodeSharePayload(target);
      return `${window.location.origin}${window.location.pathname}#share=${payload}`;
    },
    [lastResult],
  );

  const copyShareUrl = useCallback(
    async (result?: AnalysisResult) => {
      const url = await createShareUrl(result);
      try {
        await navigator.clipboard.writeText(url);
        return true;
      } catch {
        return false;
      }
    },
    [createShareUrl],
  );

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
      history,
      removeHistory,
      createShareUrl,
      copyShareUrl,
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
      history,
      removeHistory,
      createShareUrl,
      copyShareUrl,
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
