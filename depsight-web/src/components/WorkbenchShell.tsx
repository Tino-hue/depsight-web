// 工作台外壳：固定顶栏 + 左侧图标导航 + 主内容区
// 视觉：暗色玻璃质感 + 绿色辉光 + 细腻层级，与 Hero 落地页呼应
import type { ReactNode } from "react";
import {
  BarChart3,
  Globe2,
  Home,
  LineChart,
  Network,
  Sparkles,
} from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import type { AppView } from "@/lib/types";

interface WorkbenchShellProps {
  view: AppView;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

const NAV_ITEMS: { view: AppView; label: string; icon: typeof Network }[] = [
  { view: "analyze", label: "Analyze", icon: BarChart3 },
  { view: "graph", label: "Graph", icon: Network },
  { view: "trends", label: "Trends", icon: LineChart },
  { view: "ecosystem", label: "Ecosystem", icon: Globe2 },
];

export function WorkbenchShell({
  view,
  title,
  subtitle,
  actions,
  children,
}: WorkbenchShellProps) {
  const { setView, wasmStatus, lastResult, requestAi, theme, toggleTheme } =
    useApp();

  const onAiClick = () => {
    if (!lastResult) return;
    requestAi({ kind: "all" });
  };

  return (
    <div className="workbench-root">
      {/* 顶栏 */}
      <header className="workbench-header">
        <nav className="workbench-header-inner">
          <button
            type="button"
            className="workbench-logo"
            onClick={() => setView("hero")}
          >
            depsight
            <span className="workbench-logo-dot">.</span>
          </button>

          <div className="workbench-header-right">
            {/* WASM 状态 */}
            <div className="workbench-wasm">
              {wasmStatus === "loading" && (
                <Badge variant="secondary" className="animate-pulse">
                  WASM …
                </Badge>
              )}
              {wasmStatus === "loaded" && (
                <Badge variant="success">WASM ✓</Badge>
              )}
              {wasmStatus === "fallback" && (
                <Badge variant="warning">JS Fallback</Badge>
              )}
            </div>

            <AnimatedThemeToggler
              isDark={theme === "dark"}
              onToggle={toggleTheme}
            />
          </div>
        </nav>
      </header>

      {/* 侧边栏 */}
      <aside className="workbench-sidebar">
        <nav className="workbench-sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = view === item.view;
            return (
              <button
                key={item.view}
                type="button"
                onClick={() => setView(item.view)}
                className={cn("workbench-nav-item", active && "is-active")}
                title={item.label}
              >
                <Icon className="h-5 w-5" />
                <span className="workbench-nav-label">{item.label}</span>
              </button>
            );
          })}

          <div className="workbench-sidebar-spacer" />

          <button
            type="button"
            onClick={onAiClick}
            disabled={!lastResult}
            className={cn(
              "workbench-nav-item workbench-nav-ai",
              !lastResult && "is-disabled",
            )}
            title={lastResult ? "AI Diagnosis" : "Run an analysis first"}
          >
            <Sparkles className="h-5 w-5" />
            <span className="workbench-nav-label">AI</span>
          </button>

          <button
            type="button"
            onClick={() => setView("hero")}
            className="workbench-nav-item"
            title="Back to Home"
          >
            <Home className="h-5 w-5" />
            <span className="workbench-nav-label">Home</span>
          </button>
        </nav>
      </aside>

      {/* 主内容区 */}
      <main className="workbench-main">
        {/* 页面标题栏 */}
        <div className="workbench-page-header">
          <div>
            <h1 className="workbench-page-title">{title}</h1>
            {subtitle && <p className="workbench-page-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="workbench-page-actions">{actions}</div>}
        </div>

        {children}
      </main>
    </div>
  );
}
