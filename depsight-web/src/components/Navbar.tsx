// 顶部导航栏：fixed 浮动，视图路由 + WASM 状态徽章
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import type { AppView } from "@/lib/types";

const NAV_ITEMS: { view: AppView; label: string }[] = [
  { view: "analyze", label: "Analyze" },
  { view: "graph", label: "Graph" },
  { view: "trends", label: "Trends" },
  { view: "ecosystem", label: "Ecosystem" },
];

export function Navbar() {
  const { view, setView, wasmStatus, lastResult, requestAi } = useApp();

  const onAiClick = () => {
    if (!lastResult) return;
    requestAi({ kind: "all" });
  };

  return (
    <header className="fixed top-0 z-50 w-full border-b border-border/40 bg-background/60 backdrop-blur-md">
      <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <button
          type="button"
          className="font-semibold text-xl tracking-tight hover:opacity-80 transition-opacity"
          onClick={() => setView("analyze")}
        >
          depsight
        </button>

        <div className="hidden items-center gap-6 md:flex">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              type="button"
              onClick={() => setView(item.view)}
              className={cn(
                "text-sm uppercase tracking-widest transition-colors",
                view === item.view
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onAiClick}
            disabled={!lastResult}
            className={cn(
              "inline-flex items-center gap-1.5 text-sm uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground",
              !lastResult &&
                "cursor-not-allowed opacity-40 hover:text-muted-foreground",
            )}
            title={lastResult ? "AI 智能诊断" : "先完成一次分析"}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI
          </button>
        </div>

        {/* 移动端导航 */}
        <div className="flex items-center gap-3 md:hidden">
          <select
            aria-label="切换视图"
            value={view}
            onChange={(e) => setView(e.target.value as AppView)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs uppercase tracking-widest text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {NAV_ITEMS.map((item) => (
              <option key={item.view} value={item.view}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {wasmStatus === "loading" && (
            <Badge variant="secondary" className="animate-pulse">
              WASM …
            </Badge>
          )}
          {wasmStatus === "loaded" && <Badge variant="success">WASM ✓</Badge>}
          {wasmStatus === "fallback" && (
            <Badge variant="warning">WASM 不可用 · JS 回退</Badge>
          )}
        </div>
      </nav>
    </header>
  );
}
