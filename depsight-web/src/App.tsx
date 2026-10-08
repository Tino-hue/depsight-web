// 应用根组件：导航栏 + 视图切换 + AI 抽屉
import { useEffect } from 'react'

import { AiDrawer } from '@/components/AiDrawer'
import { AnalyzeView } from '@/components/AnalyzeView'
import { EcosystemView } from '@/components/EcosystemView'
import { GraphView } from '@/components/GraphView'
import { Navbar } from '@/components/Navbar'
import { TrendsView } from '@/components/TrendsView'
import { useApp } from '@/state/AppContext'

export default function App() {
  const { view } = useApp()

  // 视图变化时回到顶部
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 pb-12 pt-20 sm:px-6">
        {view === 'analyze' && (
          <div key="analyze" className="animate-fade-up">
            <AnalyzeView />
          </div>
        )}
        {view === 'graph' && (
          <div key="graph" className="animate-fade-in">
            <GraphView />
          </div>
        )}
        {view === 'trends' && (
          <div key="trends" className="animate-fade-up">
            <TrendsView />
          </div>
        )}
        {view === 'ecosystem' && (
          <div key="ecosystem" className="animate-fade-up">
            <EcosystemView />
          </div>
        )}
      </main>
      <AiDrawer />
    </div>
  )
}
