// 冒烟测试：从 test/smoke.mjs 迁移的 18 条断言（Vitest 版）
// 契约与 WASM API 一致：overall_score / summary / diagnostics / health_scores(flat 5维) / graph(root_id=name@version) / node_metas
import { describe, expect, it } from "vitest";
import { runJsAnalyzer } from "./analyzer";
import {
  loadDemoContext,
  loadDemoEcosystem,
  loadDemoTrends,
} from "./demo-data";
import type { NodeMetaInput } from "./types";

const DIM_KEYS = [
  "freshness",
  "compliance",
  "deprecated_density",
  "size_reasonableness",
  "activity",
] as const;

const modText = `module my/app

name = "my/app"
version = "1.0.0"
license = "Apache-2.0"

import {
  "moonbitlang/core"
  "moonbitlang/x"
}
`;

describe("analyzer smoke（迁移自 test/smoke.mjs）", () => {
  // 原 Test 1：TOML 解析 + 分析（5 条断言）
  it("TOML mod_text 解析 + 分析", () => {
    const r1 = runJsAnalyzer({ type: "mod_text", mod_text: modText });
    expect(r1 && typeof r1 === "object").toBe(true);
    expect(r1.graph?.root_id).toBe("my/app@1.0.0");
    expect(Array.isArray(r1.graph?.nodes)).toBe(true);
    expect(Array.isArray(r1.diagnostics)).toBe(true);
    expect(typeof r1.overall_score).toBe("number");
  });

  // 原 Test 2：demo context 完整分析（10 条断言）
  it("demo context 完整分析", async () => {
    const ctx = await loadDemoContext();
    const r2 = runJsAnalyzer({ type: "context", context: ctx });
    const ctxRootName = (JSON.parse(ctx.root) as { name: string }).name;
    expect(r2.graph.root_id).toBe(`${ctxRootName}@1.0.0`);
    expect(r2.graph.nodes.length).toBeGreaterThan(5);
    expect(r2.graph.edges.length).toBeGreaterThan(5);
    expect(r2.diagnostics.length).toBeGreaterThan(0);
    expect(typeof r2.ecosystem_stats.total_packages).toBe("number");
    expect(Array.isArray(r2.size_offenders_top5)).toBe(true);
    expect(r2.diagnostics.every((d) => d.code && d.message && d.severity)).toBe(
      true,
    );
    expect(r2.overall_score).toBeGreaterThanOrEqual(0);
    expect(r2.overall_score).toBeLessThanOrEqual(100);
    expect(Array.isArray(r2.health_scores) && r2.health_scores.length > 0).toBe(
      true,
    );
    for (const k of DIM_KEYS) {
      expect(typeof r2.health_scores[0][k]).toBe("number");
    }
  });

  // 原 Test 3：demo trends / ecosystem（2 条断言）
  it("demo trends & ecosystem", () => {
    const trends = loadDemoTrends();
    expect(Array.isArray(trends["my/app"]) && trends["my/app"].length > 0).toBe(
      true,
    );
    const eco = loadDemoEcosystem();
    expect(eco && Array.isArray(eco.top_packages)).toBe(true);
  });

  // 原 Test 4：JSON 格式 mod（1 条断言）
  it("JSON 格式 mod", () => {
    const r4 = runJsAnalyzer({
      type: "mod_text",
      mod_text: JSON.stringify({
        name: "x/y",
        version: "0.1.0",
        deps: { "moonbitlang/core": "0.6.0" },
      }),
    });
    expect(r4.graph?.root_id).toBe("x/y@0.1.0");
  });
});

// ===== v0.7.0-wasm 新特性（与 MoonBit 引擎契约对齐） =====

/** 构造 root 依赖 a@1.0.0 / b@2.0.0 的 context */
function makeCtx(
  modules: Record<string, string>,
  metadata: Record<string, NodeMetaInput> = {},
) {
  const root = [
    'name = "demo/app"',
    'version = "1.0.0"',
    'import { "a@1.0.0", "b@2.0.0" }',
  ].join("\n");
  return { root, modules, metadata };
}

const mkMod = (
  name: string,
  version: string,
  license?: string,
  deps: Record<string, string> = {},
) =>
  JSON.stringify({
    name,
    version,
    ...(license ? { license } : {}),
    deps,
  });

describe("yanked 闭环", () => {
  it("yanked 包产出 YANKED-001 critical + freshness 0 + high 建议", () => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        {
          "a@1.0.0": {
            license: "MIT",
            latest_version: "1.2.0",
            yanked: true,
            yanked_reason: "broken release",
          },
        },
      ),
    });
    const diag = r.diagnostics.find((d) => d.code === "YANKED-001");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("critical");
    expect(diag!.node_id).toBe("a@1.0.0");
    expect(diag!.message).toBe(
      "a@1.0.0 is yanked on mooncakes.io: broken release",
    );
    const aScore = r.health_scores.find((s) => s.node_id === "a@1.0.0")!;
    expect(aScore.freshness).toBe(0);
    const sug = r.suggestions.find((s) => s.code === "YANKED-001")!;
    expect(sug.impact).toBe("high");
    expect(sug.command).toBe("moon add a@1.2.0");
    expect(sug.action).toBe("Replace yanked a@1.0.0");
    // node_metas 透传 yanked 字段
    expect(r.node_metas["a@1.0.0"].yanked).toBe(true);
    expect(r.node_metas["a@1.0.0"].yanked_reason).toBe("broken release");
    expect(r.node_metas["a@1.0.0"].source_unavailable).toBe(false);
  });

  it("latest 与当前版本相同（连最新版都被 yank）→ 建议为 moon remove", () => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        {
          "a@1.0.0": { license: "MIT", latest_version: "1.0.0", yanked: true },
        },
      ),
    });
    const sug = r.suggestions.find((s) => s.code === "YANKED-001")!;
    expect(sug.command).toBe("moon remove a");
    // latest == version 时不再报 OUTDATED-001
    expect(r.diagnostics.some((d) => d.code === "OUTDATED-001")).toBe(false);
  });

  it("无 latest_version 的 yanked 包 → moon remove", () => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        { "a@1.0.0": { license: "MIT", yanked: true } },
      ),
    });
    const sug = r.suggestions.find((s) => s.code === "YANKED-001")!;
    expect(sug.command).toBe("moon remove a");
  });
});

describe("SPDX 许可证评分（与 MoonBit single_license_score 一致）", () => {
  const complianceOf = (license: string): number => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        { "a@1.0.0": { license } },
      ),
    });
    return r.health_scores.find((s) => s.node_id === "a@1.0.0")!.compliance;
  };

  it("permissive / OR 取最优", () => {
    expect(complianceOf("MIT")).toBe(100);
    expect(complianceOf("Apache-2.0")).toBe(100);
    expect(complianceOf("MIT OR Apache-2.0")).toBe(100);
    expect(complianceOf("MIT/Apache-2.0")).toBe(100); // "/" 视作 OR
    expect(complianceOf("(MIT OR GPL-3.0)")).toBe(100); // 括号容错
  });

  it("weak copyleft → 60；LGPL 不触发 LICENSE-002", () => {
    expect(complianceOf("LGPL-2.1")).toBe(60);
    expect(complianceOf("MPL-2.0")).toBe(60);
    expect(complianceOf("EPL-2.0")).toBe(60);
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        { "a@1.0.0": { license: "LGPL-2.1" } },
      ),
    });
    expect(r.diagnostics.some((d) => d.code === "LICENSE-002")).toBe(false);
  });

  it("strong copyleft → 30；AND 取最差", () => {
    expect(complianceOf("GPL-3.0")).toBe(30);
    expect(complianceOf("AGPL-3.0")).toBe(30);
    expect(complianceOf("MIT AND GPL-3.0")).toBe(30);
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        { "a@1.0.0": { license: "GPL-3.0" } },
      ),
    });
    const diag = r.diagnostics.find((d) => d.code === "LICENSE-002")!;
    expect(diag.severity).toBe("warning");
    expect(diag.message).toBe("a uses GPL-3.0; beware of copyleft obligations");
  });

  it("私有/未知/缺失许可证", () => {
    expect(complianceOf("LicenseRef-Custom")).toBe(50);
    expect(complianceOf("PROPRIETARY")).toBe(40);
    // 无 license → 40 分 + LICENSE-001
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        {},
      ),
    });
    const aScore = r.health_scores.find((s) => s.node_id === "a@1.0.0")!;
    expect(aScore.compliance).toBe(40);
    const diag = r.diagnostics.find(
      (d) => d.code === "LICENSE-001" && d.node_id === "a@1.0.0",
    )!;
    expect(diag.message).toBe(
      "a declares no license; commercial use carries risk",
    );
  });

  it("评分只认 metadata.license，不回退模块文本 license", () => {
    // 模块文本带 MIT，但 metadata 无 license → 仍按缺失处理（与 WASM 一致）
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        {
          "a@1.0.0": mkMod("a", "1.0.0", "MIT"),
          "b@2.0.0": mkMod("b", "2.0.0"),
        },
        {},
      ),
    });
    const aScore = r.health_scores.find((s) => s.node_id === "a@1.0.0")!;
    expect(aScore.compliance).toBe(40);
    expect(
      r.diagnostics.some(
        (d) => d.code === "LICENSE-001" && d.node_id === "a@1.0.0",
      ),
    ).toBe(true);
  });
});

describe("parse_version 健壮性（freshness 信号）", () => {
  // 注意：节点 version 取自 root 依赖声明串（"a@<version>"），与模块内容无关
  const freshnessOf = (version: string, latest: string): number => {
    const root = [
      'name = "demo/app"',
      'version = "1.0.0"',
      `import { "a@${version}" }`,
    ].join("\n");
    const r = runJsAnalyzer({
      type: "context",
      context: {
        root,
        modules: { [`a@${version}`]: mkMod("a", version) },
        metadata: {
          [`a@${version}`]: { license: "MIT", latest_version: latest },
        },
      },
    });
    return r.health_scores.find((s) => s.node_id === `a@${version}`)!.freshness;
  };

  it("两段式 vs 预发布后缀", () => {
    expect(freshnessOf("2.0", "2.1.0-alpha")).toBe(65); // minor gap=1
  });

  it("v 前缀可解析", () => {
    expect(freshnessOf("v1.0.0", "1.0.0")).toBe(90); // 解析后同版本但字符串不同
  });

  it("build 元数据后缀", () => {
    expect(
      freshnessOf("0.1.20260920+7d59c7ec9", "0.1.20260920+7d59c7ec9"),
    ).toBe(100);
  });

  it("major gap → 20；大 minor gap 下限 30；无法解析 → 70", () => {
    expect(freshnessOf("1.0.0", "2.0.0")).toBe(20);
    expect(freshnessOf("1.0.0", "1.5.0")).toBe(30);
    expect(freshnessOf("1.0.0", "not-a-version")).toBe(70);
  });

  it("无 latest_version → 50", () => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        { "a@1.0.0": { license: "MIT" } },
      ),
    });
    expect(
      r.health_scores.find((s) => s.node_id === "a@1.0.0")!.freshness,
    ).toBe(50);
  });
});

describe("DUP-001 多版本共存检测", () => {
  it("同名多版本：旧节点告警 + 合并建议", () => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        {
          "a@1.0.0": mkMod("a", "1.0.0"),
          "b@2.0.0": mkMod("b", "2.0.0", undefined, { "a@2.0.0": "2.0.0" }),
          "a@2.0.0": mkMod("a", "2.0.0"),
        },
        {
          "a@1.0.0": { license: "MIT" },
          "a@2.0.0": { license: "MIT" },
          "b@2.0.0": { license: "MIT" },
        },
      ),
    });
    const dup = r.diagnostics.find((d) => d.code === "DUP-001")!;
    expect(dup.node_id).toBe("a@1.0.0");
    expect(dup.severity).toBe("warning");
    expect(dup.message).toBe(
      "a has multiple versions in the graph (1.0.0, 2.0.0); v1.0.0 is superseded by v2.0.0",
    );
    // newest 节点不告警
    expect(
      r.diagnostics.some(
        (d) => d.code === "DUP-001" && d.node_id === "a@2.0.0",
      ),
    ).toBe(false);
    const sug = r.suggestions.find((s) => s.code === "DUP-001")!;
    expect(sug.impact).toBe("medium");
    expect(sug.command).toBe("moon add a@2.0.0");
    expect(sug.action).toBe(
      "Consolidate a to a single version (newest v2.0.0)",
    );
  });

  it("newest 选择走 parse_version（1.10.0 > 1.9.0）", () => {
    // 节点 version 来自依赖声明串，故 root 直接 import a@1.9.0
    const root = [
      'name = "demo/app"',
      'version = "1.0.0"',
      'import { "a@1.9.0", "b@2.0.0" }',
    ].join("\n");
    const r = runJsAnalyzer({
      type: "context",
      context: {
        root,
        modules: {
          "a@1.9.0": mkMod("a", "1.9.0"),
          "b@2.0.0": mkMod("b", "2.0.0", undefined, { "a@1.10.0": "1.10.0" }),
          "a@1.10.0": mkMod("a", "1.10.0"),
        },
        metadata: {},
      },
    });
    const dup = r.diagnostics.find((d) => d.code === "DUP-001")!;
    expect(dup.node_id).toBe("a@1.9.0"); // 1.9.0 被 1.10.0 取代
    expect(dup.message).toContain("v1.9.0 is superseded by v1.10.0");
  });
});

describe("suggestions 契约", () => {
  it("按 impact 降序排列（high → medium → low）", () => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        {
          "a@1.0.0": { yanked: true, latest_version: "1.2.0" }, // high
          "b@2.0.0": { license: "MIT", latest_version: "2.1.0" }, // medium
        },
      ),
    });
    const impacts = r.suggestions.map((s) => s.impact);
    const rank = { high: 0, medium: 1, low: 2 } as const;
    for (let i = 1; i < impacts.length; i++) {
      expect(rank[impacts[i]]).toBeGreaterThanOrEqual(rank[impacts[i - 1]]);
    }
    // 每个建议字段齐全
    for (const s of r.suggestions) {
      expect(typeof s.code).toBe("string");
      expect(typeof s.node_id).toBe("string");
      expect(typeof s.action).toBe("string");
      expect(typeof s.command).toBe("string"); // 无命令时为空串而非 undefined
      expect(["high", "medium", "low"]).toContain(s.impact);
    }
  });

  it("OUTDATED major gap → high；minor gap → medium", () => {
    const major = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        { "a@1.0.0": { license: "MIT", latest_version: "2.0.0" } },
      ),
    });
    const majorSug = major.suggestions.find((s) => s.code === "OUTDATED-001")!;
    expect(majorSug.impact).toBe("high");
    expect(majorSug.command).toBe("moon add a@2.0.0");

    const minor = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        { "a@1.0.0": { license: "MIT", latest_version: "1.3.0" } },
      ),
    });
    const minorSug = minor.suggestions.find((s) => s.code === "OUTDATED-001")!;
    expect(minorSug.impact).toBe("medium");
  });

  it("LICENSE-001 建议为 low 且 command 为空串", () => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        { "a@1.0.0": {} },
      ),
    });
    const sug = r.suggestions.find(
      (s) => s.code === "LICENSE-001" && s.node_id === "a@1.0.0",
    )!;
    expect(sug.impact).toBe("low");
    expect(sug.command).toBe("");
    expect(sug.action).toBe("Add a license declaration to a");
  });
});

describe("诊断文案与 WASM 逐字对齐", () => {
  it("OUTDATED / DEPRECATED / ACTIVITY / SIZE message", () => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        {
          "a@1.0.0": {
            license: "MIT",
            latest_version: "1.2.0",
            deprecated_apis: ["old_api"],
            total_api_count: 10,
            self_size: 2_000_000,
            last_commit_days_ago: 400,
          },
        },
      ),
    });
    const msg = (code: string) =>
      r.diagnostics.find((d) => d.code === code)!.message;
    expect(msg("OUTDATED-001")).toBe(
      "a is at v1.0.0 (latest 1.2.0); consider upgrading",
    );
    expect(msg("DEPRECATED-001")).toBe("a contains 1 deprecated APIs");
    expect(msg("SIZE-001")).toContain("consider slimming it down");
    expect(msg("ACTIVITY-001")).toBe(
      "a has not been updated in 400 days and may be unmaintained",
    );
    const aScore = r.health_scores.find((s) => s.node_id === "a@1.0.0")!;
    expect(aScore.activity).toBe(10);
  });

  it("ACTIVITY-002（180 < days <= 365）", () => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        { "a@1.0.0": { license: "MIT", last_commit_days_ago: 200 } },
      ),
    });
    const diag = r.diagnostics.find((d) => d.code === "ACTIVITY-002")!;
    expect(diag.severity).toBe("info");
    expect(diag.message).toBe("a was last updated 200 days ago");
    expect(r.diagnostics.some((d) => d.code === "ACTIVITY-001")).toBe(false);
  });
});

describe("overall_score / avg_health_score 整数除法（截断，与 WASM 一致）", () => {
  it("平均值小数部分 >= 0.5 时截断而非四舍五入", () => {
    // 图共 3 个节点：
    //   root(demo/app)：无 license(40) + 无 latest(50) + 无废弃(100) + 无 size(80) + 无 activity(50)
    //     → 50*.25 + 40*.2 + 100*.25 + 80*.2 + 50*.1 = 66.5 → 67
    //   b@2.0.0：无 metadata，同 root → 67
    //   a@1.0.0：latest==version(100) + 未知 license(50) + 100 + size<100k(100) + <30d(100)
    //     → 100*.25 + 50*.2 + 100*.25 + 100*.2 + 100*.1 = 90
    // (67 + 67 + 90) / 3 = 74.67 → 截断 74（四舍五入会得 75）
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtx(
        { "a@1.0.0": mkMod("a", "1.0.0"), "b@2.0.0": mkMod("b", "2.0.0") },
        {
          "a@1.0.0": {
            license: "LicenseRef-Custom",
            latest_version: "1.0.0",
            self_size: 50_000,
            last_commit_days_ago: 10,
          },
        },
      ),
    });
    expect(r.overall_score).toBe(74);
    expect(r.ecosystem_stats.avg_health_score).toBe(74);
  });
});

// ===== v0.8.0-wasm 新特性（镜像 MoonBit 引擎 engine_test.mbt 契约测试） =====

/** 构造 root 仅依赖 a@1.0.0 的 context（指纹/环测试用） */
function makeCtxA(
  modules: Record<string, string>,
  metadata: Record<string, NodeMetaInput> = {},
) {
  const root = [
    'name = "demo/app"',
    'version = "1.0.0"',
    'import { "a@1.0.0" }',
  ].join("\n");
  return { root, modules, metadata };
}

describe("CYCLE-001 循环依赖诊断", () => {
  it("成环路径诊断 + 打破循环建议（high）", () => {
    // root → a@1.0.0 → b@1.0.0 → a@1.0.0（BFS visited 防环，图含回边）
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtxA(
        {
          "a@1.0.0": mkMod("a", "1.0.0", undefined, { "b@1.0.0": "1.0.0" }),
          "b@1.0.0": mkMod("b", "1.0.0", undefined, { "a@1.0.0": "1.0.0" }),
        },
        {},
      ),
    });
    const diag = r.diagnostics.find((d) => d.code === "CYCLE-001")!;
    expect(diag.severity).toBe("warning");
    expect(diag.node_id).toBe("a@1.0.0");
    expect(diag.message).toBe(
      "dependency cycle detected: a@1.0.0 -> b@1.0.0 -> a@1.0.0",
    );
    const sug = r.suggestions.find((s) => s.code === "CYCLE-001")!;
    expect(sug.impact).toBe("high");
    expect(sug.command).toBe("");
    expect(sug.action).toBe(
      "Break the dependency cycle involving a@1.0.0, b@1.0.0",
    );
    expect(r.graph.nodes.length).toBe(3);
  });
});

describe("import 解析健壮性（注释 / 多行块 / 旧版单行 / 空块）", () => {
  it("TOML 行尾注释 + 多行 import 块 + 旧版单行 + 空块", () => {
    const modText = [
      'name = "demo/app" # 行尾注释',
      'version = "1.0.0"',
      'license = "Apache-2.0"  # 根许可证',
      "import { # 多行块开始",
      '  "a@1.0.0", # 行内注释',
      '  "b@2.0.0"',
      "}",
      'import "c@3.0.0" # 旧版单行',
      'import "ignored" for "wasm" # 平台条件 import 跳过',
      "import {} # 空块不产出依赖",
    ].join("\n");
    const r = runJsAnalyzer({ type: "mod_text", mod_text: modText });
    // root + 3 个直接依赖（平台条件 import 与空块不计）
    expect(r.graph.nodes.length).toBe(4);
    // 根 license 进浅图 metas
    expect(r.node_metas[r.graph.root_id].license).toBe("Apache-2.0");
    expect(r.node_metas[r.graph.root_id].license_source).toBe("mod_text");
  });

  it("moon.mod.json：path 依赖跳过不崩溃", () => {
    const r = runJsAnalyzer({
      type: "mod_text",
      mod_text: JSON.stringify({
        name: "demo/app",
        version: "1.0.0",
        deps: { "local/pkg": { path: "../local" }, a: "1.0.0" },
      }),
    });
    expect(r.graph.root_id).toBe("demo/app@1.0.0");
    // 仅 a@1.0.0 入图（path 依赖被跳过）
    expect(r.graph.nodes.length).toBe(2);
  });
});

describe("version_resolved：latest 节点显式未解析标记", () => {
  it('"latest" → false；具体版本 → true', () => {
    const root = [
      'name = "demo/app"',
      'version = "1.0.0"',
      'import { "a@latest", "b@2.0.0" }',
    ].join("\n");
    const r = runJsAnalyzer({
      type: "context",
      context: {
        root,
        modules: {
          "a@latest": mkMod("a", "latest"),
          "b@2.0.0": mkMod("b", "2.0.0"),
        },
        metadata: { "a@latest": { license: "MIT", latest_version: "1.0.0" } },
      },
    });
    const a = r.graph.nodes.find((n) => n.id === "a@latest")!;
    expect(a.version).toBe("latest");
    expect(a.version_resolved).toBe(false);
    const b = r.graph.nodes.find((n) => n.id === "b@2.0.0")!;
    expect(b.version).toBe("2.0.0");
    expect(b.version_resolved).toBe(true);
  });
});

const MIT_LICENSE_TEXT = `MIT License

Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

describe("LICENSE 文本指纹（license_text → license + license_source）", () => {
  it("MIT 指纹：license=MIT/fingerprint，LICENSE-001 消除，overall=73", () => {
    // metadata 无 license 字段，仅凭 license_text 指纹
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtxA(
        { "a@1.0.0": mkMod("a", "1.0.0") },
        { "a@1.0.0": { license_text: MIT_LICENSE_TEXT } },
      ),
    });
    // 指纹命中 → license=MIT + license_source=fingerprint
    expect(r.node_metas["a@1.0.0"].license).toBe("MIT");
    expect(r.node_metas["a@1.0.0"].license_source).toBe("fingerprint");
    // a=78.5→79（MIT 后 compliance=100），root=67 → overall=73
    expect(r.overall_score).toBe(73);
    // 仅 root（demo/app）无 license 报 LICENSE-001，a 指纹命中不再误报
    const licDiags = r.diagnostics.filter((d) => d.code === "LICENSE-001");
    expect(licDiags.length).toBe(1);
    expect(licDiags[0].node_id).toBe("demo/app@1.0.0");
    expect(licDiags[0].message).toBe(
      "demo/app declares no license; commercial use carries risk",
    );
  });

  it("GPL-3.0 指纹：LICENSE-002 strong copyleft，overall=66", () => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtxA(
        { "a@1.0.0": mkMod("a", "1.0.0") },
        {
          "a@1.0.0": {
            license_text: "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007",
          },
        },
      ),
    });
    expect(r.node_metas["a@1.0.0"].license).toBe("GPL-3.0");
    expect(r.node_metas["a@1.0.0"].license_source).toBe("fingerprint");
    const diag = r.diagnostics.find((d) => d.code === "LICENSE-002")!;
    expect(diag.severity).toBe("warning");
    expect(diag.message).toBe(
      "a uses GPL-3.0; beware of copyleft obligations",
    );
    // a=64.5→65（GPL 后 compliance=30），root=67 → overall=66
    expect(r.overall_score).toBe(66);
  });
});

describe("SPDX 表达式规范化（变体 / WITH 剥离 / 大小写空白 / AND）", () => {
  // 带 latest_version "1.0.0" 使 a 节点 freshness=100，隔离 compliance 维度
  const complianceOf = (license: string): number => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtxA(
        { "a@1.0.0": mkMod("a", "1.0.0") },
        { "a@1.0.0": { license, latest_version: "1.0.0" } },
      ),
    });
    return r.health_scores.find((s) => s.node_id === "a@1.0.0")!.compliance;
  };

  it("变体归一：apache 2.0 → Apache-2.0 → 100", () => {
    expect(complianceOf("apache 2.0")).toBe(100);
  });

  it("WITH 异常子句剥离：Apache-2.0 WITH LLVM-exception → 100", () => {
    expect(complianceOf("Apache-2.0 WITH LLVM-exception")).toBe(100);
  });

  it('大小写/空白统一 + 变体："g p l v 3" → 30 + LICENSE-002', () => {
    const r = runJsAnalyzer({
      type: "context",
      context: makeCtxA(
        { "a@1.0.0": mkMod("a", "1.0.0") },
        { "a@1.0.0": { license: "g p l v 3", latest_version: "1.0.0" } },
      ),
    });
    // 诊断 message 展示原始声明串，故只断言 code 与固定文案后缀
    expect(
      r.health_scores.find((s) => s.node_id === "a@1.0.0")!.compliance,
    ).toBe(30);
    const diag = r.diagnostics.find((d) => d.code === "LICENSE-002")!;
    expect(diag.message).toContain("beware of copyleft obligations");
  });

  it("AND 取最差：GPLv3 AND MIT → 30", () => {
    expect(complianceOf("GPLv3 AND MIT")).toBe(30);
  });
});

describe("license_families 家族聚合视图", () => {
  it("五 key 恒输出 + 家族计数（原始声明串判定）", () => {
    // a=MIT(permissive) b=GPL-3.0(strong) c=无 license(unknown)；root 无 license
    const root = [
      'name = "demo/app"',
      'version = "1.0.0"',
      'import { "a@1.0.0", "b@1.0.0", "c@1.0.0" }',
    ].join("\n");
    const r = runJsAnalyzer({
      type: "context",
      context: {
        root,
        modules: {
          "a@1.0.0": mkMod("a", "1.0.0"),
          "b@1.0.0": mkMod("b", "1.0.0"),
          "c@1.0.0": mkMod("c", "1.0.0"),
        },
        metadata: {
          "a@1.0.0": { license: "MIT" },
          "b@1.0.0": { license: "GPL-3.0" },
        },
      },
    });
    const fam = r.ecosystem_stats.license_families;
    expect(fam["permissive"]).toBe(1);
    expect(fam["weak-copyleft"]).toBe(0);
    expect(fam["strong-copyleft"]).toBe(1);
    expect(fam["proprietary"]).toBe(0);
    expect(fam["unknown"]).toBe(2);
  });
});
