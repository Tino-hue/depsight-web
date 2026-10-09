// 分析视图：工作台布局 + 四种输入方式（粘贴 / 文件 / 包名 / 示例）+ 结果面板
// 视觉：暗色玻璃质感卡片 + 绿色辉光 + 空状态 3D 引导
import { useRef, useState } from "react";
import { FileUp, Package, Play, Sparkles, UploadCloud } from "lucide-react";

import { DashboardCard } from "@/components/Dashboard";
import { HistoryPanel } from "@/components/HistoryPanel";
import { RiskList } from "@/components/RiskList";
import { SizeList } from "@/components/SizeList";
import { WorkbenchShell } from "@/components/WorkbenchShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFetcher } from "@/hooks/useFetcher";
import { loadDemoContext } from "@/lib/demo-data";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";

type InputTab = "text" | "file" | "package" | "demo";

const INPUT_TABS: { value: InputTab; label: string }[] = [
  { value: "text", label: "Paste" },
  { value: "file", label: "Upload" },
  { value: "package", label: "Package" },
  { value: "demo", label: "Demo" },
];

export function AnalyzeView() {
  const {
    analyzeModText,
    analyzeFromContext,
    applyResult,
    lastResult,
    setView,
  } = useApp();
  const fetcher = useFetcher();

  const [tab, setTab] = useState<InputTab>("text");
  const [modText, setModText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [packageName, setPackageName] = useState("");
  const [packageVersion, setPackageVersion] = useState("");
  const [status, setStatus] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const finish = (
    result: ReturnType<typeof analyzeModText>,
    okText: string,
  ) => {
    if (!applyResult(result)) {
      setStatus(`Analysis failed: ${result.error}`);
      return;
    }
    setStatus(okText);
    // 与旧版一致：分析完成后自动切到 graph 视图
    setView("graph");
  };

  const onAnalyze = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      if (tab === "text") {
        const text = modText.trim();
        if (!text) {
          setStatus("Paste your moon.mod content first");
          return;
        }
        setStatus("Analyzing…");
        finish(analyzeModText(text), "");
      } else if (tab === "file") {
        const text = modText.trim();
        if (!text) {
          setStatus("Select a moon.mod file first");
          return;
        }
        setStatus("Analyzing…");
        finish(analyzeModText(text), "");
      } else if (tab === "package") {
        const name = packageName.trim();
        if (!name) {
          setStatus("Enter a package name");
          return;
        }
        setStatus("Fetching dependencies from mooncakes.io…");
        const ctx = await fetcher.fetchContext(
          name,
          packageVersion.trim() || null,
        );
        if (!ctx) {
          setStatus(`Fetch failed: ${fetcher.error ?? "unknown error"}`);
          return;
        }
        // 把拉到的 root mod 回填到文本框，便于用户编辑
        if (ctx.root) setModText(ctx.root);
        setStatus("Analyzing…");
        const result = analyzeFromContext(ctx);
        finish(result, "");
      } else {
        setStatus("Loading demo data…");
        const ctx = await loadDemoContext();
        if (ctx.root) setModText(ctx.root);
        const result = analyzeFromContext(ctx);
        finish(result, "");
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setModText(String(reader.result || ""));
      setFileName(file.name);
      setStatus(`Read file ${file.name} — click "Analyze" to start`);
    };
    reader.onerror = () => setStatus(`Failed to read file: ${file.name}`);
    reader.readAsText(file);
  };

  const running = analyzing || fetcher.loading;

  return (
    <WorkbenchShell
      view="analyze"
      title="Dependency Analysis"
      subtitle="Paste a moon.mod file, upload, or fetch from mooncakes.io to analyze dependency health"
    >
      <div className="workbench-grid">
        {/* 左：输入面板 */}
        <div className="workbench-panel workbench-animate-in">
          {/* Segmented control */}
          <div className="workbench-segmented">
            {INPUT_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={cn(
                  "workbench-segmented-item",
                  tab === t.value && "is-active",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 输入区域 */}
          <div className="workbench-input-area">
            {tab === "text" && (
              <Textarea
                rows={14}
                className="workbench-textarea font-mono text-xs"
                placeholder={
                  'Paste your moon.mod content here…\n\nExample:\nmodule my/app\nversion = "1.0.0"\nlicense = "Apache-2.0"\n\nimport "moonbitlang/core"'
                }
                value={modText}
                onChange={(e) => setModText(e.target.value)}
              />
            )}

            {tab === "file" && (
              <>
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
                  className="workbench-upload-zone"
                >
                  <UploadCloud className="h-8 w-8" />
                  {fileName
                    ? `Loaded: ${fileName}`
                    : "Click to select a moon.mod file"}
                </button>
                {fileName && modText && (
                  <Textarea
                    rows={10}
                    className="workbench-textarea font-mono text-xs"
                    value={modText}
                    onChange={(e) => setModText(e.target.value)}
                  />
                )}
              </>
            )}

            {tab === "package" && (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder="Package name, e.g. moonbitlang/x"
                    value={packageName}
                    onChange={(e) => setPackageName(e.target.value)}
                    className="workbench-input flex-1 font-mono text-xs"
                  />
                  <Input
                    placeholder="Version (optional)"
                    value={packageVersion}
                    onChange={(e) => setPackageVersion(e.target.value)}
                    className="workbench-input sm:w-36 font-mono text-xs"
                  />
                </div>
                <p className="workbench-hint">
                  Fetches the moon.mod from mooncakes.io and expands
                  dependencies recursively (BFS, depth 3)
                </p>
                {fetcher.loading && (
                  <p className="workbench-hint">
                    Fetched {fetcher.fetchedCount} modules…
                  </p>
                )}
              </>
            )}

            {tab === "demo" && (
              <div className="workbench-demo-box">
                <Package className="h-6 w-6 shrink-0" />
                <p>
                  Runs the full analysis flow offline with a built-in sample
                  project (12 mock packages) — no network required.
                </p>
              </div>
            )}
          </div>

          {/* 分析按钮 */}
          <Button
            className="workbench-analyze-btn"
            size="lg"
            onClick={onAnalyze}
            disabled={running}
          >
            <Play className="h-4 w-4" />
            {running ? "Processing…" : "Analyze"}
          </Button>

          {/* 状态提示 */}
          {status && (
            <p
              className={cn(
                "workbench-status",
                (status.startsWith("Analysis failed") ||
                  status.startsWith("Fetch failed") ||
                  status.startsWith("Failed to read file")) &&
                  "is-error",
              )}
            >
              {status}
            </p>
          )}
        </div>

        {/* 右：结果面板（无玻璃底，内部卡片独立） + 分析历史 */}
        <div className="workbench-results workbench-animate-in [animation-delay:100ms]">
          <HistoryPanel />
          {lastResult ? (
            <>
              <DashboardCard result={lastResult} />
              <div className="workbench-card">
                <div className="workbench-card-header">
                  <h3 className="workbench-card-title">Risk List</h3>
                </div>
                <div className="workbench-card-body">
                  <RiskList diagnostics={lastResult.diagnostics} />
                </div>
              </div>
              <div className="workbench-card">
                <div className="workbench-card-header">
                  <h3 className="workbench-card-title">Size TOP 5</h3>
                </div>
                <div className="workbench-card-body">
                  <SizeList offenders={lastResult.size_offenders_top5} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setView("graph")}
                className="workbench-graph-link"
              >
                <Sparkles className="h-4 w-4" />
                View dependency graph in 3D →
              </button>
            </>
          ) : (
            <div className="workbench-empty">
              <div className="workbench-empty-icon">
                <FileUp className="h-10 w-10" />
              </div>
              <h3 className="workbench-empty-title">No analysis yet</h3>
              <p className="workbench-empty-text">
                Paste your moon.mod content or select a package to get started
              </p>
            </div>
          )}
        </div>
      </div>
    </WorkbenchShell>
  );
}
