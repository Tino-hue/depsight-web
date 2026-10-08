// 分析视图：四种输入方式（粘贴 / 文件 / 包名 / 示例）+ 结果面板
// 桌面端左右布局，移动端上下堆叠
import { useRef, useState } from 'react'
import { FileUp, Package, Play, Sparkles } from 'lucide-react'

import { DashboardCard } from '@/components/Dashboard'
import { RiskList } from '@/components/RiskList'
import { SizeList } from '@/components/SizeList'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useFetcher } from '@/hooks/useFetcher'
import { loadDemoContext } from '@/lib/demo-data'
import { useApp } from '@/state/AppContext'

type InputTab = 'text' | 'file' | 'package' | 'demo'

export function AnalyzeView() {
  const {
    analyzeModText,
    analyzeFromContext,
    applyResult,
    lastResult,
    setView,
  } = useApp()
  const fetcher = useFetcher()

  const [tab, setTab] = useState<InputTab>('text')
  const [modText, setModText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [packageName, setPackageName] = useState('')
  const [packageVersion, setPackageVersion] = useState('')
  const [status, setStatus] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const finish = (result: ReturnType<typeof analyzeModText>, okText: string) => {
    if (!applyResult(result)) {
      setStatus(`分析失败：${result.error}`)
      return
    }
    setStatus(okText)
    // 与旧版一致：分析完成后自动切到 graph 视图
    setView('graph')
  }

  const onAnalyze = async () => {
    if (analyzing) return
    setAnalyzing(true)
    try {
      if (tab === 'text') {
        const text = modText.trim()
        if (!text) {
          setStatus('请先粘贴 moon.mod 内容')
          return
        }
        setStatus('分析中…')
        finish(analyzeModText(text), '')
      } else if (tab === 'file') {
        const text = modText.trim()
        if (!text) {
          setStatus('请先选择 moon.mod 文件')
          return
        }
        setStatus('分析中…')
        finish(analyzeModText(text), '')
      } else if (tab === 'package') {
        const name = packageName.trim()
        if (!name) {
          setStatus('请输入包名')
          return
        }
        setStatus('正在从 mooncakes.io 拉取依赖…')
        const ctx = await fetcher.fetchContext(
          name,
          packageVersion.trim() || null,
        )
        if (!ctx) {
          setStatus(`拉取失败：${fetcher.error ?? '未知错误'}`)
          return
        }
        // 把拉到的 root mod 回填到文本框，便于用户编辑
        if (ctx.root) setModText(ctx.root)
        setStatus('分析中…')
        const result = analyzeFromContext(ctx)
        finish(result, '')
      } else {
        setStatus('加载示例数据…')
        const ctx = await loadDemoContext()
        if (ctx.root) setModText(ctx.root)
        const result = analyzeFromContext(ctx)
        finish(result, '')
      }
    } finally {
      setAnalyzing(false)
    }
  }

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setModText(String(reader.result || ''))
      setFileName(file.name)
      setStatus(`已读取文件 ${file.name}，点击「开始分析」`)
    }
    reader.onerror = () => setStatus(`读取文件失败：${file.name}`)
    reader.readAsText(file)
  }

  const running = analyzing || fetcher.loading

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* 左：输入面板 */}
      <Card className="animate-fade-up h-fit">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">输入依赖信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as InputTab)}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="text">粘贴</TabsTrigger>
              <TabsTrigger value="file">文件</TabsTrigger>
              <TabsTrigger value="package">包名</TabsTrigger>
              <TabsTrigger value="demo">示例</TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="space-y-3">
              <Textarea
                rows={12}
                className="resize-y font-mono text-xs"
                placeholder={'在此粘贴 moon.mod 内容…\n\n例如：\nmodule my/app\nversion = "1.0.0"\nlicense = "Apache-2.0"\n\nimport "moonbitlang/core"'}
                value={modText}
                onChange={(e) => setModText(e.target.value)}
              />
            </TabsContent>

            <TabsContent value="file" className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".mod,.toml,.json,.txt"
                className="hidden"
                onChange={onFileSelected}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-input py-10 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                <FileUp className="h-6 w-6" />
                {fileName ? `已加载：${fileName}` : '点击选择 moon.mod 文件'}
              </button>
              {fileName && modText && (
                <Textarea
                  rows={8}
                  className="resize-y font-mono text-xs"
                  value={modText}
                  onChange={(e) => setModText(e.target.value)}
                />
              )}
            </TabsContent>

            <TabsContent value="package" className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="包名，如 moonbitlang/x"
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                  className="flex-1 font-mono text-xs"
                />
                <Input
                  placeholder="版本（可选）"
                  value={packageVersion}
                  onChange={(e) => setPackageVersion(e.target.value)}
                  className="sm:w-36 font-mono text-xs"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                从 mooncakes.io 拉取 moon.mod 并递归展开依赖（BFS，深度 3）
              </p>
              {fetcher.loading && (
                <p className="text-xs text-muted-foreground">
                  已拉取 {fetcher.fetchedCount} 个模块…
                </p>
              )}
            </TabsContent>

            <TabsContent value="demo" className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
                <Package className="h-5 w-5 shrink-0" />
                使用内置示例项目（12 个模拟包）离线演示完整分析流程，无需网络。
              </div>
            </TabsContent>
          </Tabs>

          <Button
            className="w-full"
            size="lg"
            onClick={onAnalyze}
            disabled={running}
          >
            <Play className="h-4 w-4" />
            {running ? '处理中…' : '开始分析'}
          </Button>

          {status && (
            <p
              className={
                status.startsWith('分析失败') || status.startsWith('拉取失败') || status.startsWith('读取失败')
                  ? 'text-xs text-destructive'
                  : 'text-xs text-muted-foreground'
              }
            >
              {status}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 右：结果面板 */}
      <div className="animate-fade-up space-y-4 [animation-delay:100ms]">
        {lastResult ? (
          <>
            <DashboardCard result={lastResult} />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">风险列表</CardTitle>
              </CardHeader>
              <CardContent>
                <RiskList diagnostics={lastResult.diagnostics} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">体积 TOP 5</CardTitle>
              </CardHeader>
              <CardContent>
                <SizeList offenders={lastResult.size_offenders_top5} />
              </CardContent>
            </Card>
            <button
              type="button"
              onClick={() => setView('graph')}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Sparkles className="h-4 w-4" />
              在 3D 图中查看依赖关系 →
            </button>
          </>
        ) : (
          <Card className="flex min-h-[320px] items-center justify-center">
            <CardContent className="text-center text-sm text-muted-foreground">
              暂无分析结果
              <br />
              在左侧输入 moon.mod 内容或包名，点击「开始分析」
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
