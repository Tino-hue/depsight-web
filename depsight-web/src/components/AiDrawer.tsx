// AI 智能诊断抽屉：LLM API（OpenAI 兼容）+ 规则引擎 fallback
// 从 js/ai-panel.js 迁移；API Key 存 localStorage，纯前端
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FileDiff, Settings, Sparkles, Stethoscope, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  AnalysisResult,
  Diagnostic,
  HealthScore,
  NodeMetaOutput,
  ParsedMod,
} from "@/lib/types";
import { useApp } from "@/state/AppContext";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

// ===== API 配置（localStorage）=====
function getApiConfig() {
  return {
    apiKey: localStorage.getItem("depsight_openai_key") || "",
    baseUrl: localStorage.getItem("depsight_openai_base") || DEFAULT_BASE_URL,
    model: localStorage.getItem("depsight_openai_model") || DEFAULT_MODEL,
  };
}

function saveApiConfig(key: string, base: string, model: string) {
  if (key) localStorage.setItem("depsight_openai_key", key);
  else localStorage.removeItem("depsight_openai_key");
  if (base) localStorage.setItem("depsight_openai_base", base);
  else localStorage.removeItem("depsight_openai_base");
  if (model) localStorage.setItem("depsight_openai_model", model);
  else localStorage.removeItem("depsight_openai_model");
}

// ===== LLM 调用 =====
async function callLLM(prompt: string): Promise<string> {
  const config = getApiConfig();
  if (!config.apiKey) {
    throw new Error(
      "OpenAI API Key is not configured. Fill it in Settings first.",
    );
  }

  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            "You are a MoonBit dependency health expert. Answer in English and provide concrete, actionable fix suggestions.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`LLM API error: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
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
  return `Analyze the following MoonBit dependency health risk:

**Risk code**: ${code}
**Affected package**: ${nodeId}
**Risk details**: ${diag?.message || "Unknown"}
**Health score**: ${health ? health.total + "/100 (freshness:" + health.freshness + " compliance:" + health.compliance + " deprecated:" + health.deprecated_density + " size:" + health.size_reasonableness + " activity:" + health.activity + ")" : "Unknown"}
**Package metadata**: ${meta ? `license=${meta.license || "not declared"}, latest_version=${meta.latest_version || "unknown"}, size=${meta.self_size || 0} bytes, last_commit=${meta.last_commit_days_ago || "unknown"} days ago` : "Unknown"}
**Root project**: ${rootMod ? `${rootMod.name}@${rootMod.version}` : "Unknown"}

Please provide:
1. Root cause analysis (why this is a problem)
2. Impact scope (concrete impact on the project)
3. Fix suggestions (specific moon.mod changes or code edits)
4. Alternatives (better packages if any)

Answer in English, markdown format.`;
}

function buildFullReportPrompt(
  result: AnalysisResult,
  rootMod: ParsedMod | null,
) {
  return `Generate a full dependency health diagnosis report for the following MoonBit project:

**Project**: ${rootMod ? `${rootMod.name}@${rootMod.version}` : "Unknown"}
**Health score**: ${result.overall_score}/100
**Node count**: ${result.node_count}

**Health score details**:
${JSON.stringify(result.health_scores, null, 2)}

**Diagnostics**:
${result.diagnostics.map((d) => `- [${d.severity}] ${d.code}: ${d.message}`).join("\n")}

Please provide:
1. Executive summary (overall health assessment)
2. Key risks ranked by severity (root cause and impact for each)
3. Fix recommendations (specific moon.mod changes or code edits)
4. Alternatives (better packages if any)

Answer in English, markdown format.`;
}

function buildPrPrompt(result: AnalysisResult, rootMod: ParsedMod | null) {
  const fixes = result.diagnostics.filter(
    (d) => d.severity === "critical" || d.severity === "warning",
  );
  return `Based on the following MoonBit dependency health analysis, generate a Pull Request description:

**Project**: ${rootMod ? `${rootMod.name}@${rootMod.version}` : "Unknown"}
**Issues to fix**:
${fixes.map((d) => `- [${d.severity}] ${d.code}: ${d.message}`).join("\n")}

Please generate:
1. PR title
2. PR description (background, fix plan, test results)
3. A concrete moon.mod modification diff
4. Code change suggestions

Answer in English, markdown format.`;
}

// ===== 规则引擎 fallback =====
function ruleBasedDiagnosis(
  code: string,
  nodeId: string,
  diag: Diagnostic | undefined,
  meta: NodeMetaOutput | undefined,
): string {
  const pkg = nodeId.split("@")[0];
  const rules: Record<string, () => string> = {
    "OUTDATED-001": () => {
      const latest = meta?.latest_version || "the latest version";
      const cur = nodeId.split("@")[1] || "the current version";
      return `## Root Cause
The package is pinned at ${cur}, which is outdated; the latest version is ${latest}.

## Impact
- Missing the latest bug fixes and security patches
- Potential version conflicts with other dependencies
- Migration cost grows the longer it is postponed

## Fix
Update the version in moon.mod:

\`\`\`toml
import { "${pkg}@${latest}" }
\`\`\`

Then run \`moon update\` to refresh dependencies.

## Alternatives
If the package is unmaintained, look for a community-recommended replacement.`;
    },
    "LICENSE-001": () => `## Root Cause
This package declares no license, which carries high legal risk.

## Impact
- Commercial use may infringe copyright
- Unclear whether modification and redistribution are allowed

## Fix
Ask the package author to add a license, or switch to an alternative with a clear license.

## Alternatives
Search mooncakes.io for packages in the same category with an MIT/Apache-2.0 license.`,
    "LICENSE-002": () => `## Root Cause
This package uses the ${meta?.license || "copyleft"} license, which is contagious.

## Impact
- Your project may be required to open source
- Commercial use is restricted

## Fix
- Verify that your project license is compatible
- Consider contacting the author for a commercial license

## Alternatives
Look for similar packages under MIT/Apache-2.0.`,
    "DEPRECATED-001": () => `## Root Cause
This package contains ${meta?.deprecated_api_count || "several"} deprecated APIs.

## Impact
- These APIs may be removed in future versions
- Code maintainability declines

## Fix
Check the package changelog and migrate to the replacement APIs.

## Alternatives
If too many APIs are deprecated, consider switching packages.`,
    "SIZE-001": () => `## Root Cause
This package is large (${meta?.self_size || "unknown"} bytes), affecting compile and distribution.

## Impact
- Longer compile times
- Larger build artifacts
- Possibly slower loading

## Fix
- Check whether unnecessary features are included
- Consider importing submodules on demand

## Alternatives
Look for a lighter-weight alternative.`,
    "ACTIVITY-001": () => `## Root Cause
This package has not been updated for ${meta?.last_commit_days_ago || "a very long"} days and may be unmaintained.

## Impact
- No bug fixes
- Security vulnerabilities go unpatched
- May be incompatible with newer MoonBit versions

## Fix
**Strongly recommended:** find a replacement. Check active packages in the same category on mooncakes.io.

## Alternatives
If maintenance cost is low, fork it and maintain it yourself.`,
    "ACTIVITY-002": () => `## Root Cause
This package was last updated ${meta?.last_commit_days_ago || "quite a while"} days ago; activity is low.

## Impact
- Slow issue response
- Stalled feature development

## Fix
- Watch for a while to see if activity recovers
- Prepare a backup plan

## Alternatives
If needed, look for a more active package in the same category.`,
  };

  const rule = rules[code];
  if (rule) return rule();
  return `## Risk Details
${diag?.message || "Unknown risk"}

## Fix
Check the depsight documentation for the meaning of this risk code.`;
}

// ===== 轻量 markdown 渲染（React 版 formatMarkdownLite）=====
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // 顺序处理 **bold** 与 `code`
  const nodes: ReactNode[] = [];
  let rest = text;
  let k = 0;
  const re = /(\*\*[^*]+\*\*|`[^`\n]+`)/;
  while (rest.length > 0) {
    const m = rest.match(re);
    if (!m || m.index === undefined) {
      nodes.push(rest);
      break;
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-b${k++}`}>{tok.slice(2, -2)}</strong>,
      );
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-c${k++}`}
          className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px]"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    }
    rest = rest.slice(m.index + tok.length);
  }
  return nodes;
}

function MarkdownLite({ text }: { text: string }) {
  const blocks = text.split(/\n/);
  const out: ReactNode[] = [];
  let i = 0;
  let listBuf: string[] = [];
  let codeBuf: string[] | null = null;

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
      );
      listBuf = [];
    }
  };

  for (const line of blocks) {
    i++;
    if (codeBuf !== null) {
      if (line.trimEnd().endsWith("```")) {
        codeBuf.push(line.slice(0, line.lastIndexOf("```")));
        out.push(
          <pre
            key={`code${i}`}
            className="my-2 overflow-x-auto rounded-md border border-border bg-secondary/50 p-3 font-mono text-xs leading-relaxed"
          >
            {codeBuf.join("\n").trim()}
          </pre>,
        );
        codeBuf = null;
      } else {
        codeBuf.push(line);
      }
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      flushList();
      codeBuf = [];
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      listBuf.push(line.replace(/^\s*-\s+/, ""));
      continue;
    }
    flushList();
    if (line.startsWith("### ")) {
      out.push(
        <strong key={`h3${i}`} className="mt-3 block text-primary">
          {renderInline(line.slice(4), `h3${i}`)}
        </strong>,
      );
    } else if (line.startsWith("## ")) {
      out.push(
        <strong key={`h2${i}`} className="mt-3 block text-sm text-primary">
          {renderInline(line.slice(3), `h2${i}`)}
        </strong>,
      );
    } else if (line.startsWith("# ")) {
      out.push(
        <strong key={`h1${i}`} className="mt-3 block text-base text-primary">
          {renderInline(line.slice(2), `h1${i}`)}
        </strong>,
      );
    } else if (line.trim() === "") {
      out.push(<div key={`br${i}`} className="h-2" />);
    } else {
      out.push(
        <p key={`p${i}`} className="leading-relaxed">
          {renderInline(line, `p${i}`)}
        </p>,
      );
    }
  }
  flushList();
  if (codeBuf !== null && codeBuf.length > 0) {
    out.push(
      <pre
        key="code-end"
        className="my-2 overflow-x-auto rounded-md border border-border bg-secondary/50 p-3 font-mono text-xs"
      >
        {codeBuf.join("\n").trim()}
      </pre>,
    );
  }
  return <div className="text-sm">{out}</div>;
}

// ===== 抽屉组件 =====
type Content =
  | { kind: "idle" }
  | { kind: "loading"; title: string }
  | {
      kind: "result";
      title: string;
      subtitle: string;
      body: string;
      isFallback: boolean;
    };

export function AiDrawer() {
  const { aiOpen, setAiOpen, aiTask, lastResult, lastRootMod } = useApp();
  const [content, setContent] = useState<Content>({ kind: "idle" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [savedTip, setSavedTip] = useState(false);
  const runningRef = useRef(false);

  // 设置回填
  const openSettings = () => {
    if (!settingsOpen) {
      const cfg = getApiConfig();
      setApiKey(cfg.apiKey);
      setBaseUrl(cfg.baseUrl === DEFAULT_BASE_URL ? "" : cfg.baseUrl);
      setModel(cfg.model === DEFAULT_MODEL ? "" : cfg.model);
    }
    setSettingsOpen(!settingsOpen);
  };

  const onSaveSettings = () => {
    saveApiConfig(apiKey.trim(), baseUrl.trim(), model.trim());
    setSavedTip(true);
    setTimeout(() => setSavedTip(false), 2000);
  };

  const runDiagnose = useCallback(
    async (code: string, nodeId: string) => {
      if (!lastResult || runningRef.current) return;
      runningRef.current = true;
      setContent({ kind: "loading", title: `AI is analyzing ${code}…` });
      try {
        const diag = (lastResult.diagnostics || []).find(
          (d) => d.code === code && d.node_id === nodeId,
        );
        const health = (lastResult.health_scores || []).find(
          (h) => h.node_id === nodeId,
        );
        const meta = lastResult.node_metas?.[nodeId];
        const prompt = buildDiagnosePrompt(
          code,
          nodeId,
          diag,
          health,
          meta,
          lastRootMod,
        );
        let body: string;
        let isFallback = false;
        try {
          body = await callLLM(prompt);
        } catch (e) {
          console.warn("[ai] LLM 不可用，使用规则引擎 fallback:", e);
          body = ruleBasedDiagnosis(code, nodeId, diag, meta);
          isFallback = true;
        }
        setContent({
          kind: "result",
          title: code,
          subtitle: nodeId,
          body,
          isFallback,
        });
      } finally {
        runningRef.current = false;
      }
    },
    [lastResult, lastRootMod],
  );

  const runAll = useCallback(async () => {
    if (!lastResult || runningRef.current) return;
    runningRef.current = true;
    setContent({
      kind: "loading",
      title: "AI is generating the full diagnosis report…",
    });
    try {
      const prompt = buildFullReportPrompt(lastResult, lastRootMod);
      try {
        const body = await callLLM(prompt);
        setContent({
          kind: "result",
          title: "Full Diagnosis",
          subtitle: "All dependencies",
          body,
          isFallback: false,
        });
      } catch (e) {
        setContent({
          kind: "result",
          title: "AI Unavailable",
          subtitle: "Full Diagnosis",
          body: `Configure an OpenAI API Key to enable LLM diagnosis. Falling back to the rule engine:\n\n${e instanceof Error ? e.message : String(e)}`,
          isFallback: true,
        });
      }
    } finally {
      runningRef.current = false;
    }
  }, [lastResult, lastRootMod]);

  const runPr = useCallback(async () => {
    if (!lastResult || runningRef.current) return;
    runningRef.current = true;
    setContent({
      kind: "loading",
      title: "AI is generating a PR description…",
    });
    try {
      const prompt = buildPrPrompt(lastResult, lastRootMod);
      try {
        const body = await callLLM(prompt);
        setContent({
          kind: "result",
          title: "PR Description",
          subtitle: "Auto-fix suggestions",
          body,
          isFallback: false,
        });
      } catch (e) {
        setContent({
          kind: "result",
          title: "AI Unavailable",
          subtitle: "PR Description",
          body: e instanceof Error ? e.message : String(e),
          isFallback: true,
        });
      }
    } finally {
      runningRef.current = false;
    }
  }, [lastResult, lastRootMod]);

  // 响应全局 AI 任务
  const lastTaskIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!aiTask || aiTask.id === lastTaskIdRef.current) return;
    lastTaskIdRef.current = aiTask.id;
    if (aiTask.kind === "risk" && aiTask.code && aiTask.nodeId) {
      void runDiagnose(aiTask.code, aiTask.nodeId);
    } else if (aiTask.kind === "all") {
      void runAll();
    } else if (aiTask.kind === "pr") {
      void runPr();
    }
  }, [aiTask, runDiagnose, runAll, runPr]);

  if (!aiOpen) return null;

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
            AI Diagnosis
          </h2>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setAiOpen(false)}
            aria-label="Close"
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
            Full Diagnosis
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runPr()}
            disabled={!lastResult}
          >
            <FileDiff className="h-4 w-4" />
            Generate Fix PR
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
              placeholder={`Base URL (default ${DEFAULT_BASE_URL})`}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="font-mono text-xs"
            />
            <Input
              placeholder={`Model (default ${DEFAULT_MODEL})`}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={onSaveSettings}>
                Save
              </Button>
              {savedTip && <span className="text-xs text-primary">Saved</span>}
            </div>
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {content.kind === "idle" && (
            <p className="text-sm text-muted-foreground">
              {lastResult
                ? 'Click "Full Diagnosis" for a complete report, or click "AI Diagnose" on a risk in the risk list to analyze a single item.'
                : "Run a dependency analysis first, then use AI diagnosis."}
            </p>
          )}
          {content.kind === "loading" && (
            <p className="animate-pulse text-sm text-muted-foreground">
              {content.title}
            </p>
          )}
          {content.kind === "result" && (
            <div className="space-y-3">
              {content.isFallback && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                  ⚠️ LLM Unavailable · Rule Engine Fallback
                </div>
              )}
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Subject
                </div>
                <div className="mt-1 text-sm">
                  <strong className="font-mono">{content.title}</strong>
                  <span className="text-muted-foreground"> · </span>
                  <span className="font-mono text-xs">{content.subtitle}</span>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
                  AI Analysis
                </div>
                <MarkdownLite text={content.body} />
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
