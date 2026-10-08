// 应用根组件：Hero 落地首页 + 工作台视图切换 + AI 抽屉
import { useEffect } from "react";

import { AiDrawer } from "@/components/AiDrawer";
import { AnalyzeView } from "@/components/AnalyzeView";
import { EcosystemView } from "@/components/EcosystemView";
import { GraphView } from "@/components/GraphView";
import { HeroView } from "@/components/HeroView";
import { Navbar } from "@/components/Navbar";
import { TrendsView } from "@/components/TrendsView";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";

const VIEW_TITLES: Record<string, string> = {
  hero: "depsight — MoonBit Dependency Health",
  analyze: "Analyze — depsight",
  graph: "Graph — depsight",
  trends: "Trends — depsight",
  ecosystem: "Ecosystem — depsight",
};

export default function App() {
  const { view } = useApp();

  // 按视图更新 document.title
  useEffect(() => {
    document.title = VIEW_TITLES[view] ?? VIEW_TITLES.hero!;
  }, [view]);

  // 视图变化时回到顶部（Hero 本身锁定单帧，无需滚动）
  useEffect(() => {
    if (view !== "hero") window.scrollTo(0, 0);
  }, [view]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {view !== "hero" && <Navbar />}

      {/* Hero：全屏落地页 */}
      {view === "hero" && <HeroView />}

      {/* 工作台：延迟挂载保状态，仅 active 显示，切换无重建成本 */}
      {view !== "hero" && (
        <main className="mx-auto max-w-7xl px-4 pb-12 pt-20 sm:px-6">
          <div
            className={cn(view === "analyze" && "animate-fade-up")}
            hidden={view !== "analyze"}
          >
            <AnalyzeView />
          </div>
          <div
            className={cn(view === "graph" && "animate-fade-in")}
            hidden={view !== "graph"}
          >
            <GraphView />
          </div>
          <div
            className={cn(view === "trends" && "animate-fade-up")}
            hidden={view !== "trends"}
          >
            <TrendsView />
          </div>
          <div
            className={cn(view === "ecosystem" && "animate-fade-up")}
            hidden={view !== "ecosystem"}
          >
            <EcosystemView />
          </div>
        </main>
      )}

      <AiDrawer />
    </div>
  );
}
