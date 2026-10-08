// AI 智能诊断抽屉：LLM API（OpenAI 兼容）+ 规则引擎 fallback
// 从 js/ai-panel.js 迁移；API Key 存 localStorage，纯前端
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FileDiff, Settings, Sparkles, Stethoscope, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AnalysisResult, Diagnostic, HealthScore, NodeMetaOutput, ParsedMod } from '@/lib/types'
import { useApp } from '@/state/AppContext'

const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

// ===== API 配置（localStorage）=====
function getApiConfig() {
  return {
    apiKey: localStorage.getItem('depsight_openai_key') || '',
    baseUrl: localStorage.getItem('depsight_openai_base') || DEFAULT_BASE_URL,
    model: localStorage.getItem('depsight_openai_model') || DEFAULT_MODEL,
  }
}

function saveApiConfig(key: string, base: string, model: string) {
  if (key) localStorage.setItem('depsight_openai_key', key)
  else localStorage.removeItem('depsight_openai_key')
  if (base) localStorage.setItem('depsight_openai_base', base)
  else localStorage.removeItem('depsight_openai_base')
  if (model) localStorage.setItem('depsight_openai_model', model)
  else localStorage.removeItem('depsight_openai_model')
}

// ===== LLM 调用 =====
async function callLLM(prompt: string): Promise<string> {
  const config = getApiConfig()
  if (!config.apiKey) {
    throw new Error('未配置 OpenAI API Key，请先在设置中填写')
  }

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content:
            '你是 MoonBit 依赖健康检测专家。用中文回答，提供具体可执行的修复建议。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`LLM API error: ${resp.status} ${err}`)
  }

  const data = await resp.json()
  return data.choices?.[0]?.message?.content || ''
}

// ===== Prompt 构造（与旧版一致）=====
function buildDiagnosePrompt(
  code: string,
  nodeId: string,
  diag: Diagnostic | undefined,
  health: HealthScore | undefined,
  meta: NodeMetaOutput | undefined,
  rootMod: ParsedMod | null,
) {
  return `分析以下 MoonBit 依赖健康风险：

**风险代码**: ${code}
**受影响包**: ${nodeId}
**风险详情**: ${diag?.message || '未知'}
**健康分**: ${health ? health.total + '/100 (新鲜度:' + health.freshness + ' 合规:' + health.compliance + ' 废弃:' + health.deprecated_density + ' 大小:' + health.size_reasonableness + ' 活跃:' + health.activity + ')' : '未知'}
**包元数据**: ${meta ? `许可证=${meta.license || '未声明'}, 最新版本=${meta.latest_version || '未知'}, 体积=${meta.self_size || 0}字节, 最近提交=${meta.last_commit_days_ago || '未知'}天前` : '未知'}
**根项目**: ${rootMod ? `${rootMod.name}@${rootMod.version}` : '未知'}

请提供：
1. 风险原因分析（为什么这是个问题）
2. 影响范围（对项目的具体影响）
3. 修复建议（具体的 moon.mod 修改或代码改动）
4. 替代方案（如果有更好的包推荐）

用中文回答，markdown 格式。`
}

function buildFullReportPrompt(
  result: AnalysisResult,
  rootMod: ParsedMod | null,
) {
  return `为以下 MoonBit 项目生成完整的依赖健康诊断报告：

**项目**: ${rootMod ? `${rootMod.name}@${rootMod.version}` : '未知'}
**健康分**: ${result.overall_score}/100
**节点数**: ${result.node_count}

**健康分详情**:
${JSON.stringify(result.health_scores, null, 2)}

**诊断列表**:
${result.diagnostics.map((d) => `- [${d.severity}] ${d.code}: ${d.message}`).join('\n')}

**生态统计**:
${JSON.stringify(result.ecosystem_stats, null, 2)}

请提供：
1. 整体健康评估（1-2 句话总结）
2. 关键风险排序（Top 3 严重问题）
3. 每个风险的修复建议
4. 长期维护建议（如何保持依赖健康）

用中文回答，markdown 格式。`
}

function buildPrPrompt(result: AnalysisResult, rootMod: ParsedMod | null) {
  const fixes = result.diagnostics.filter(
    (d) => d.severity === 'critical' || d.severity === 'warning',
  )
  return `根据以下 MoonBit 依赖健康检测结果，生成一个 PR（Pull Request）描述：

**项目**: ${rootMod ? `${rootMod.name}@${rootMod.version}` : '未知'}
**需要修复的问题**:
${fixes.map((d) => `- [${d.severity}] ${d.code}: ${d.message}`).join('\n')}

请生成：
1. PR 标题
2. PR 描述（包含问题背景、修复方案、测试结果）
3. 具体的 moon.mod 修改 diff
4. 代码变更建议

用中文回答，markdown 格式。`
}

// ===== 规则引擎 fallback =====
function ruleBasedDiagnosis(
  code: string,
  nodeId: string,
  diag: Diagnostic | undefined,
  meta: NodeMetaOutput | undefined,
): string {
  const pkg = nodeId.split('@')[0]
  const rules: Record<string, () => string> = {
    'OUTDATED-001': () => {
      const latest = meta?.latest_version || '最新版本'
      const cur = nodeId.split('@')[1] || '当前版本'
      return `## 风险原因
该包当前版本 ${cur} 已过时，最新版本为 ${latest}。

## 影响范围
- 无法获得最新的 bug 修复和安全补丁
- 可能与其他依赖存在版本冲突
- 长期不升级会增加迁移成本

## 修复建议
在 moon.mod 中更新版本号：

\`\`\`toml
import { "${pkg}@${latest}" }
\`\`\`

然后运行 \`moon update\` 更新依赖。

## 替代方案
如果该包已停止维护，考虑寻找社区推荐的替代包。`
    },
    'LICENSE-001': () => `## 风险原因
该包未声明许可证，法律风险较高。

## 影响范围
- 商业使用可能侵权
- 无法确定是否可修改、分发

## 修复建议
联系包作者添加许可证，或选择有明确许可证的替代包。

## 替代方案
搜索 mooncakes.io 上同类别有 MIT/Apache-2.0 许可证的包。`,
    'LICENSE-002': () => `## 风险原因
该包使用 ${meta?.license || 'copyleft'} 许可证，具有传染性。

## 影响范围
- 你的项目可能需要开源
- 商业使用受限

## 修复建议
- 确认你的项目许可证是否兼容
- 考虑联系作者获取商业授权

## 替代方案
寻找使用 MIT/Apache-2.0 的同类包。`,
    'DEPRECATED-001': () => `## 风险原因
该包含 ${meta?.deprecated_api_count || '若干'} 个废弃 API。

## 影响范围
- 未来版本可能移除这些 API
- 代码可维护性下降

## 修复建议
查看包的 changelog，找到新 API 替换废弃 API。

## 替代方案
如果废弃 API 过多，考虑更换包。`,
    'SIZE-001': () => `## 风险原因
该包体积较大（${meta?.self_size || '未知'} 字节），影响编译和分发。

## 影响范围
- 增加编译时间
- 增加产物体积
- 可能影响加载速度

## 修复建议
- 检查是否引入了不必要的功能
- 考虑按需引入子模块

## 替代方案
寻找更轻量的替代包。`,
    'ACTIVITY-001': () => `## 风险原因
该包已 ${meta?.last_commit_days_ago || '很长'} 天未更新，可能已停止维护。

## 影响范围
- 无法获得 bug 修复
- 安全漏洞无人修补
- 与新版 MoonBit 可能不兼容

## 修复建议
**强烈建议**寻找替代包。检查 mooncakes.io 上同类别活跃包。

## 替代方案
如果自己维护成本低，可以 fork 自行维护。`,
    'ACTIVITY-002': () => `## 风险原因
该包最近更新在 ${meta?.last_commit_days_ago || '较长'} 天前，活跃度较低。

## 影响范围
- 响应 issue 较慢
- 新功能开发停滞

## 修复建议
- 观察一段时间，看是否有恢复迹象
- 准备备用方案

## 替代方案
如有需要，可寻找更活跃的同类包。`,
  }

  const rule = rules[code]
  if (rule) return rule()
  return `## 风险详情
${diag?.message || '未知风险'}

## 修复建议
请查看 depsight 文档了解该风险代码的含义。`
}

// ===== 轻量 markdown 渲染（React 版 formatMarkdownLite）=====
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // 顺序处理 **bold** 与 `code`
  const nodes: ReactNode[] = []
  let rest = text
  let k = 0
  const re = /(\*\*[^*]+\*\*|`[^`\n]+`)/
  while (rest.length > 0) {
    const m = rest.match(re)
    if (!m || m.index === undefined) {
      nodes.push(rest)
      break
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b${k++}`}>{tok.slice(2, -2)}</strong>,
      )
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-c${k++}`}
          className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px]"
        >
          {tok.slice(1, -1)}
        </code>,
      )
    }
    rest = rest.slice(m.index + tok.length)
  }
  return nodes
}

function MarkdownLite({ text }: { text: string }) {
  const blocks = text.split(/\n/)
  const out: ReactNode[] = []
  let i = 0
  let listBuf: string[] = []
  let codeBuf: string[] | null = null

  const flushList = () => {
    if (listBuf.length > 0) {
      out.push(
        <div key={`l${i}`} className="my-1 space-y-0.5 pl-4">
          {listBuf.map((item, j) => (
            <div key={j} className="flex gap-2">
              <span className="text-primary">•</span>
              <span>{renderInline(item, `li${j}`)}</span>
            </div>
          ))}
        </div>,
      )
      listBuf = []
    }
  }

  for (const line of blocks) {
    i++
    if (codeBuf !== null) {
      if (line.trimEnd().endsWith('```')) {
        codeBuf.push(line.slice(0, line.lastIndexOf('```')))
        out.push(
          <pre
            key={`code${i}`}
            className="my-2 overflow-x-auto rounded-md border border-border bg-secondary/50 p-3 font-mono text-xs leading-relaxed"
          >
            {codeBuf.join('\n').trim()}
          </pre>,
        )
        codeBuf = null
      } else {
        codeBuf.push(line)
      }
      continue
    }
    if (line.trimStart().startsWith('```')) {
      flushList()
      codeBuf = []
      continue
    }
    if (/^\s*-\s+/.test(line)) {
      listBuf.push(line.replace(/^\s*-\s+/, ''))
      continue
    }
    flushList()
    if (line.startsWith('### ')) {
      out.push(
        <strong key={`h3${i}`} className="mt-3 block text-primary">
          {renderInline(line.slice(4), `h3${i}`)}
        </strong>,
      )
    } else if (line.startsWith('## ')) {
      out.push(
        <strong key={`h2${i}`} className="mt-3 block text-sm text-primary">
          {renderInline(line.slice(3), `h2${i}`)}
        </strong>,
      )
    } else if (line.startsWith('# ')) {
      out.push(
        <strong key={`h1${i}`} className="mt-3 block text-base text-primary">
          {renderInline(line.slice(2), `h1${i}`)}
        </strong>,
      )
    } else if (line.trim() === '') {
      out.push(<div key={`br${i}`} className="h-2" />)
    } else {
      out.push(
        <p key={`p${i}`} className="leading-relaxed">
          {renderInline(line, `p${i}`)}
        </p>,
      )
    }
  }
  flushList()
  if (codeBuf !== null && codeBuf.length > 0) {
    out.push(
      <pre
        key="code-end"
        className="my-2 overflow-x-auto rounded-md border border-border bg-secondary/50 p-3 font-mono text-xs"
      >
        {codeBuf.join('\n').trim()}
      </pre>,
    )
  }
  return <div className="text-sm">{out}</div>
}

// ===== 抽屉组件 =====
type Content =
  | { kind: 'idle' }
  | { kind: 'loading'; title: string }
  | { kind: 'result'; title: string; subtitle: string; body: string; isFallback: boolean }

export function AiDrawer() {
  const { aiOpen, setAiOpen, aiTask, lastResult, lastRootMod } = useApp()
  const [content, setContent] = useState<Content>({ kind: 'idle' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [savedTip, setSavedTip] = useState(false)
  const runningRef = useRef(false)

  // 设置回填
  const openSettings = () => {
    if (!settingsOpen) {
      const cfg = getApiConfig()
      setApiKey(cfg.apiKey)
      setBaseUrl(cfg.baseUrl === DEFAULT_BASE_URL ? '' : cfg.baseUrl)
      setModel(cfg.model === DEFAULT_MODEL ? '' : cfg.model)
    }
    setSettingsOpen(!settingsOpen)
  }

  const onSaveSettings = () => {
    saveApiConfig(apiKey.trim(), baseUrl.trim(), model.trim())
    setSavedTip(true)
    setTimeout(() => setSavedTip(false), 2000)
  }

  const runDiagnose = useCallback(
    async (code: string, nodeId: string) => {
      if (!lastResult || runningRef.current) return
      runningRef.current = true
      setContent({ kind: 'loading', title: `AI 正在分析 ${code}…` })
      try {
        const diag = (lastResult.diagnostics || []).find(
          (d) => d.code === code && d.node_id === nodeId,
        )
        const health = (lastResult.health_scores || []).find(
          (h) => h.node_id === nodeId,
        )
        const meta = lastResult.node_metas?.[nodeId]
        const prompt = buildDiagnosePrompt(code, nodeId, diag, health, meta, lastRootMod)
        let body: string
        let isFallback = false
        try {
          body = await callLLM(prompt)
        } catch (e) {
          console.warn('[ai] LLM 不可用，使用规则引擎 fallback:', e)
          body = ruleBasedDiagnosis(code, nodeId, diag, meta)
          isFallback = true
        }
        setContent({
          kind: 'result',
          title: code,
          subtitle: nodeId,
          body,
          isFallback,
        })
      } finally {
        runningRef.current = false
      }
    },
    [lastResult, lastRootMod],
  )

  const runAll = useCallback(async () => {
    if (!lastResult || runningRef.current) return
    runningRef.current = true
    setContent({ kind: 'loading', title: 'AI 正在生成整体诊断报告…' })
    try {
      const prompt = buildFullReportPrompt(lastResult, lastRootMod)
      try {
        const body = await callLLM(prompt)
        setContent({
          kind: 'result',
          title: '整体诊断',
          subtitle: '全部依赖',
          body,
          isFallback: false,
        })
      } catch (e) {
        setContent({
          kind: 'result',
          title: 'AI 不可用',
          subtitle: '整体诊断',
          body: `请配置 OpenAI API Key。当前使用规则引擎 fallback：\n\n${e instanceof Error ? e.message : String(e)}`,
          isFallback: true,
        })
      }
    } finally {
      runningRef.current = false
    }
  }, [lastResult, lastRootMod])

  const runPr = useCallback(async () => {
    if (!lastResult || runningRef.current) return
    runningRef.current = true
    setContent({ kind: 'loading', title: 'AI 正在生成 PR 描述…' })
    try {
      const prompt = buildPrPrompt(lastResult, lastRootMod)
      try {
        const body = await callLLM(prompt)
        setContent({
          kind: 'result',
          title: 'PR 描述',
          subtitle: '自动修复建议',
          body,
          isFallback: false,
        })
      } catch (e) {
        setContent({
          kind: 'result',
          title: 'AI 不可用',
          subtitle: 'PR 描述',
          body: e instanceof Error ? e.message : String(e),
          isFallback: true,
        })
      }
    } finally {
      runningRef.current = false
    }
  }, [lastResult, lastRootMod])

  // 响应全局 AI 任务
  const lastTaskIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!aiTask || aiTask.id === lastTaskIdRef.current) return
    lastTaskIdRef.current = aiTask.id
    if (aiTask.kind === 'risk' && aiTask.code && aiTask.nodeId) {
      void runDiagnose(aiTask.code, aiTask.nodeId)
    } else if (aiTask.kind === 'all') {
      void runAll()
    } else if (aiTask.kind === 'pr') {
      void runPr()
    }
  }, [aiTask, runDiagnose, runAll, runPr])

  if (!aiOpen) return null

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-[60] bg-black/50 animate-fade-in"
        onClick={() => setAiOpen(false)}
      />
      {/* 抽屉 */}
      <aside className="fixed right-0 top-0 z-[61] flex h-full w-full max-w-md animate-fade-in flex-col border-l border-border bg-background/95 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest">
            <Sparkles className="h-4 w-4 text-primary" />
            AI 智能诊断
          </h2>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setAiOpen(false)}
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 操作区 */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runAll()}
            disabled={!lastResult}
          >
            <Stethoscope className="h-4 w-4" />
            整体诊断
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runPr()}
            disabled={!lastResult}
          >
            <FileDiff className="h-4 w-4" />
            生成修复 PR
          </Button>
          <Button variant="ghost" size="sm" onClick={openSettings}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        {/* 设置面板 */}
        {settingsOpen && (
          <div className="space-y-2 border-b border-border px-4 py-3 animate-fade-in">
            <Input
              type="password"
              placeholder="OpenAI API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono text-xs"
            />
            <Input
              placeholder={`Base URL（默认 ${DEFAULT_BASE_URL}）`}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="font-mono text-xs"
            />
            <Input
              placeholder={`模型（默认 ${DEFAULT_MODEL}）`}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={onSaveSettings}>
                保存
              </Button>
              {savedTip && (
                <span className="text-xs text-primary">已保存</span>
              )}
            </div>
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {content.kind === 'idle' && (
            <p className="text-sm text-muted-foreground">
              {lastResult
                ? '点击「整体诊断」生成完整报告，或在风险列表中点击「AI 诊断」分析单项风险。'
                : '请先完成一次依赖分析，再使用 AI 诊断。'}
            </p>
          )}
          {content.kind === 'loading' && (
            <p className="animate-pulse text-sm text-muted-foreground">
              {content.title}
            </p>
          )}
          {content.kind === 'result' && (
            <div className="space-y-3">
              {content.isFallback && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                  ⚠️ LLM 不可用 · 规则引擎 fallback
                </div>
              )}
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  诊断对象
                </div>
                <div className="mt-1 text-sm">
                  <strong className="font-mono">{content.title}</strong>
                  <span className="text-muted-foreground"> · </span>
                  <span className="font-mono text-xs">{content.subtitle}</span>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
                  AI 分析
                </div>
                <MarkdownLite text={content.body} />
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
