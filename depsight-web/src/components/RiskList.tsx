// 风险列表：按 severity 排序，支持单项 AI 诊断
// 从 js/dashboard.js renderRiskList 迁移
import { AlertTriangle, Info, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApp } from "@/state/AppContext";
import type { Diagnostic, Severity } from "@/lib/types";

const SEV_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const SEV_META: Record<
  Severity,
  { label: string; icon: typeof XCircle; className: string }
> = {
  critical: { label: "Critical", icon: XCircle, className: "text-red-500" },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    className: "text-amber-500",
  },
  info: { label: "Info", icon: Info, className: "text-sky-400" },
};

export function RiskList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const { requestAi, lastResult } = useApp();

  if (!diagnostics || diagnostics.length === 0) {
    return (
      <p className="text-sm text-primary">
        ✓ No risks found — dependency health looks good
      </p>
    );
  }

  const sorted = [...diagnostics].sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3),
  );

  return (
    <ul className="space-y-2">
      {sorted.map((d, i) => {
        const meta = SEV_META[d.severity] ?? SEV_META.info;
        const Icon = meta.icon;
        return (
          <li
            key={`${d.code}-${d.node_id}-${i}`}
            className="flex items-start justify-between gap-3 rounded-md border border-border bg-secondary/30 p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs">
                <Icon className={`h-3.5 w-3.5 shrink-0 ${meta.className}`} />
                <span className={`font-semibold ${meta.className}`}>
                  {meta.label}
                </span>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {d.code}
                </Badge>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed">{d.message}</p>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {d.node_id}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={!lastResult}
              onClick={() =>
                requestAi({ kind: "risk", code: d.code, nodeId: d.node_id })
              }
            >
              AI Diagnose
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
