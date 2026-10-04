// 冒烟测试：验证 js-analyzer + demo-data 核心逻辑
// 契约与前端一致：overall_score / summary / diagnostics / health_scores(flat 5维) / graph(root_id=name@version) / node_metas
import { runJsAnalyzer } from "../js/js-analyzer.js";
import {
  loadDemoContext,
  loadDemoTrends,
  loadDemoEcosystem,
} from "../js/demo-data.js";

let pass = 0,
  fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log("  PASS:", msg);
  } else {
    fail++;
    console.log("  FAIL:", msg);
  }
}

const DIM_KEYS = [
  "freshness",
  "compliance",
  "deprecated_density",
  "size_reasonableness",
  "activity",
];

// 1. TOML 解析 + 分析
console.log("--- Test 1: TOML mod_text ---");
const modText = `module my/app

name = "my/app"
version = "1.0.0"
license = "Apache-2.0"

import {
  "moonbitlang/core"
  "moonbitlang/x"
}
`;
const r1 = runJsAnalyzer({ type: "mod_text", mod_text: modText });
assert(r1 && typeof r1 === "object", "returns object");
assert(r1.graph?.root_id === "my/app@1.0.0", `root_id = ${r1.graph?.root_id}`);
assert(Array.isArray(r1.graph?.nodes), "has graph.nodes array");
assert(Array.isArray(r1.diagnostics), "has diagnostics array");
assert(typeof r1.overall_score === "number", "has overall_score");
console.log(
  "  nodes:",
  r1.graph?.nodes?.length,
  "edges:",
  r1.graph?.edges?.length,
  "diagnostics:",
  r1.diagnostics?.length,
  "score:",
  r1.overall_score,
);

// 2. demo context 完整分析
console.log("--- Test 2: demo context ---");
const ctx = await loadDemoContext();
const r2 = runJsAnalyzer({ type: "context", context: ctx });
const ctxRootName = JSON.parse(ctx.root).name;
assert(
  r2.graph.root_id === `${ctxRootName}@1.0.0`,
  `root_id = ${r2.graph.root_id}`,
);
assert(r2.graph.nodes.length > 5, `nodes = ${r2.graph.nodes.length}`);
assert(r2.graph.edges.length > 5, `edges = ${r2.graph.edges.length}`);
assert(r2.diagnostics.length > 0, `diagnostics = ${r2.diagnostics.length}`);
assert(
  r2.ecosystem_stats && typeof r2.ecosystem_stats.total_packages === "number",
  "has ecosystem_stats",
);
assert(Array.isArray(r2.size_offenders_top5), "has size_offenders_top5");
const validDiag = r2.diagnostics.every(
  (d) => d.code && d.message && d.severity,
);
assert(validDiag, "all diagnostics have code/message/severity");
assert(
  r2.overall_score >= 0 && r2.overall_score <= 100,
  `score in range: ${r2.overall_score}`,
);
const hs = r2.health_scores;
assert(Array.isArray(hs) && hs.length > 0, "has health_scores");
const missingDims = DIM_KEYS.filter((k) => typeof hs[0][k] !== "number");
assert(
  missingDims.length === 0,
  `5 flat dim fields present (missing: ${missingDims.join(",") || "none"})`,
);
console.log(
  "  overall:",
  r2.overall_score,
  "sample dims:",
  DIM_KEYS.map((k) => `${k}=${hs[0][k]}`).join(", "),
);

// 3. demo trends / ecosystem
console.log("--- Test 3: demo trends & ecosystem ---");
const trends = loadDemoTrends();
assert(
  trends && Array.isArray(trends["my/app"]) && trends["my/app"].length > 0,
  `trends['my/app'] points: ${trends?.["my/app"]?.length}`,
);
const eco = loadDemoEcosystem();
assert(eco && Array.isArray(eco.top_packages), "ecosystem top_packages");

// 4. JSON 格式 mod
console.log("--- Test 4: JSON mod ---");
const r4 = runJsAnalyzer({
  type: "mod_text",
  mod_text: JSON.stringify({
    name: "x/y",
    version: "0.1.0",
    deps: { "moonbitlang/core": "0.6.0" },
  }),
});
assert(
  r4.graph?.root_id === "x/y@0.1.0",
  `json mod root = ${r4.graph?.root_id}`,
);

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail > 0 ? 1 : 0);
