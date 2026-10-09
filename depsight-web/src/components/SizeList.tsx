// 体积 TOP5 列表：传递体积占比条形图
// 从 js/dashboard.js renderSizeList 迁移
import { fmtBytes } from "@/lib/analyzer";
import type { SizeOffender } from "@/lib/types";

export function SizeList({ offenders }: { offenders: SizeOffender[] }) {
  if (!offenders || offenders.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet</p>;
  }

  const max = offenders[0]?.transitive_size || 1;

  return (
    <ul className="space-y-3">
      {offenders.map((o, i) => {
        const pct = Math.round((o.transitive_size / max) * 100);
        return (
          <li key={`${o.node_id}-${i}`} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-mono" title={o.node_id}>
                {o.node_id}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                self {fmtBytes(o.self_size)} · transitive{" "}
                {fmtBytes(o.transitive_size)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70 transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
