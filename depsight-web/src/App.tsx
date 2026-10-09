// 应用根组件：Hero 落地首页 + 工作台视图切换 + AI 抽屉
import { useEffect } from "react";

import { AiDrawer } from "@/components/AiDrawer";
import { AnalyzeView } from "@/components/AnalyzeView";
import { EcosystemView } from "@/components/EcosystemView";
import { GraphView } from "@/components/GraphView";
import { HeroView } from "@/components/HeroView";
import { TrendsView } from "@/components/TrendsView";
import { useApp } from "@/state/AppContext";

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
      {/* Hero：全屏落地页 */}
      {view === "hero" && <HeroView />}

      {/* 工作台：延迟挂载保状态，仅 active 显示；各视图自带 WorkbenchShell 外壳 */}
      {view !== "hero" && (
        <>
          <div hidden={view !== "analyze"}>
            <AnalyzeView />
          </div>
          <div hidden={view !== "graph"}>
            <GraphView />
          </div>
          <div hidden={view !== "trends"}>
            <TrendsView />
          </div>
          <div hidden={view !== "ecosystem"}>
            <EcosystemView />
          </div>
        </>
      )}

      <AiDrawer />
    </div>
  );
}
