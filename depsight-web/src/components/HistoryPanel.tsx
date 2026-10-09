// 分析历史面板：回看 / 分享 / 删除（数据存 localStorage，AppContext 统一管理）
import { useState } from "react";
import { Link2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";

export function HistoryPanel() {
  const { history, lastGraph, applyResult, removeHistory, copyShareUrl } =
    useApp();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (history.length === 0) return null;

  const isActive = (graph: unknown) => !!lastGraph && lastGraph === graph;

  const onView = (id: string) => {
    const entry = history.find((e) => e.id === id);
    if (!entry) return;
    applyResult(entry.result);
  };

  const onCopy = async (id: string) => {
    const entry = history.find((e) => e.id === id);
    if (!entry) return;
    const ok = await copyShareUrl(entry.result);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    }
  };

  return (
    <div className="workbench-card">
      <div className="workbench-card-header">
        <h3 className="workbench-card-title">Analysis History</h3>
        <span className="text-xs text-muted-foreground">
          {history.length} saved
        </span>
      </div>
      <div className="workbench-card-body !p-2">
        <ul className="flex flex-col gap-1">
          {history.map((e) => {
            const active = isActive(e.result.graph);
            return (
              <li
                key={e.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border/60 hover:bg-muted/30",
                  active && "border-border/60 bg-muted/40",
                )}
              >
                <button
                  type="button"
                  onClick={() => onView(e.id)}
                  className="min-w-0 flex-1 text-left"
                  title="View this analysis"
                >
                  <div className="truncate text-sm font-medium text-foreground">
                    {e.root ?? "unknown"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {new Date(e.ts).toLocaleString()} · score {e.score} ·{" "}
                    {e.nodeCount} nodes
                    {e.summary.critical > 0 &&
                      ` · ${e.summary.critical} critical`}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onCopy(e.id)}
                  title="Copy share link"
                >
                  <Link2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => removeHistory(e.id)}
                  title="Delete from history"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                {copiedId === e.id && (
                  <span className="text-xs text-emerald-500">Copied</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
