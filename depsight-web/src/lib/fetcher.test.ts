// fetcher 在线验证（13 条）：针对 mooncakes.io v0 端点（2026-10-04 实测可用）
// 覆盖：全量模块列表 / manifest / moon.mod.json 双路径（assets 直取 + zip 兜底）/ BFS 依赖展开
// 需要网络；单条超时 30s（vite.config.ts testTimeout），整体可能较慢
import { describe, expect, it } from "vitest";
import { parseMod } from "./analyzer";
import {
  fetchAllModules,
  fetchModJsonText,
  fetchModuleManifest,
  fetchPackageContext,
} from "./fetcher";

describe("fetcher 在线验证（mooncakes.io v0）", () => {
  it("1. 全量模块列表返回非空数组", async () => {
    const mods = await fetchAllModules();
    expect(Array.isArray(mods)).toBe(true);
    expect(mods.length).toBeGreaterThan(0);
  });

  it("2. 模块列表包含 moonbitlang/core", async () => {
    const mods = await fetchAllModules();
    expect(mods.some((m) => m.name === "moonbitlang/core")).toBe(true);
  });

  it("3. moonbitlang/core manifest 含 latest_version", async () => {
    const manifest = await fetchModuleManifest("moonbitlang/core");
    expect(manifest).not.toBeNull();
    expect(typeof manifest!.latest_version).toBe("string");
  });

  it("4. 不存在模块的 manifest 返回 null", async () => {
    const ghost = await fetchModuleManifest("depsight/this-does-not-exist-xyz");
    expect(ghost).toBeNull();
  });

  it("5. 官方包 moon.mod 走 zip 兜底路径可取回", async () => {
    const manifest = await fetchModuleManifest("moonbitlang/core");
    const text = await fetchModJsonText(
      "moonbitlang/core",
      manifest!.latest_version!,
    );
    expect(text).not.toBeNull();
    expect(parseMod(text!).name).toBe("moonbitlang/core");
  });

  it("6. 第三方包走 assets 直取路径（前 5 个候选中取第一个可用）", async () => {
    const mods = await fetchAllModules();
    const candidates = mods
      .filter((m) => !m.name.startsWith("moonbitlang/"))
      .slice(0, 5);
    let tpText: string | null = null;
    for (const c of candidates) {
      const mf = await fetchModuleManifest(c.name);
      if (!mf?.latest_version) continue;
      tpText = await fetchModJsonText(c.name, mf.latest_version);
      if (tpText) break;
    }
    expect(tpText).not.toBeNull();
  });

  it("7. 取回的模块描述文本可解析且包名匹配", async () => {
    const mods = await fetchAllModules();
    const tp = mods.find((m) => !m.name.startsWith("moonbitlang/"));
    expect(tp).toBeDefined();
    const mf = await fetchModuleManifest(tp!.name);
    expect(mf).not.toBeNull();
    const text = await fetchModJsonText(tp!.name, mf!.latest_version!);
    expect(text).not.toBeNull();
    expect(parseMod(text!).name).toBe(tp!.name);
  });

  it("8. fetchPackageContext 返回完整 context 结构", async () => {
    const ctx = await fetchPackageContext("moonbitlang/x");
    expect(typeof ctx.root).toBe("string");
    expect(typeof ctx.modules).toBe("object");
    expect(typeof ctx.metadata).toBe("object");
    expect(ctx.options?.max_depth).toBe(3);
  });

  it("9. context.root 解析出正确的包名与版本", async () => {
    const ctx = await fetchPackageContext("moonbitlang/x");
    const rootMod = parseMod(ctx.root);
    expect(rootMod.name).toBe("moonbitlang/x");
    expect(typeof rootMod.version).toBe("string");
    expect(rootMod.version.length).toBeGreaterThan(0);
  });

  it("10. 根节点元数据含 latest_version", async () => {
    const ctx = await fetchPackageContext("moonbitlang/x");
    const rootMod = parseMod(ctx.root);
    const rootMeta = ctx.metadata[`moonbitlang/x@${rootMod.version}`];
    expect(rootMeta).toBeDefined();
    expect(typeof rootMeta.latest_version).toBe("string");
  });

  it("11. metadata 覆盖 BFS 访问到的所有节点", async () => {
    const ctx = await fetchPackageContext("moonbitlang/x");
    const rootMod = parseMod(ctx.root);
    const rootId = `moonbitlang/x@${rootMod.version}`;
    for (const id of [rootId, ...Object.keys(ctx.modules)]) {
      expect(ctx.metadata[id]).toBeDefined();
    }
  });

  it("12. BFS 展开传递依赖（取第一个有依赖的第三方包验证）", async () => {
    // 注意：新版 MoonBit 中 core 是隐式依赖，moonbitlang/x 等官方包 moon.mod 无 deps，
    // 因此动态找一个真实声明了依赖的第三方包来验证 BFS 契约
    const mods = await fetchAllModules();
    const candidates = mods
      .filter((m) => !m.name.startsWith("moonbitlang/"))
      .slice(0, 8);
    let target: { name: string; deps: Record<string, string> } | null = null;
    for (const c of candidates) {
      const mf = await fetchModuleManifest(c.name);
      if (!mf?.latest_version) continue;
      const text = await fetchModJsonText(c.name, mf.latest_version);
      if (!text) continue;
      const mod = parseMod(text);
      if (Object.keys(mod.deps).length > 0) {
        target = { name: c.name, deps: mod.deps };
        break;
      }
    }
    expect(target).not.toBeNull();
    const ctx = await fetchPackageContext(target!.name);
    // BFS 契约：根的所有直接依赖都必须在 metadata 留痕（源码缺失时标记 source_unavailable）
    for (const [dep, ver] of Object.entries(target!.deps)) {
      expect(ctx.metadata[`${dep}@${ver}`]).toBeDefined();
    }
  });

  it("13. modules 内所有模块描述文本均可解析", async () => {
    const ctx = await fetchPackageContext("moonbitlang/x");
    for (const text of Object.values(ctx.modules)) {
      expect(parseMod(text).parse_error).toBeUndefined();
    }
  });
});
