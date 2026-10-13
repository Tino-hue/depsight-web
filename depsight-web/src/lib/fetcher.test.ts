// fetcher 在线验证（13 条）：针对 mooncakes.io v0 端点（2026-10-04 实测可用）
// 覆盖：全量模块列表 / manifest / moon.mod.json 双路径（assets 直取 + zip 兜底）/ BFS 依赖展开
// 需要网络；单条超时 30s（vite.config.ts testTimeout），整体可能较慢
// OFFLINE=1 时跳过全部在线测试（CI 或网络受限环境）
/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMod, runJsAnalyzer } from "./analyzer";
import {
  fetchAllModules,
  fetchModJsonText,
  fetchModuleManifest,
  fetchPackageContext,
} from "./fetcher";

const describeOnline = process.env.OFFLINE === "1" ? describe.skip : describe;

describeOnline("fetcher 在线验证（mooncakes.io v0）", () => {
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
    // BFS 契约：根的所有直接依赖都必须在 metadata 留痕（源码缺失时标记 source_unavailable）。
    // 无版本声明的依赖（"latest"）会先经 manifest.latest_version 落地为真实版本号，
    // 因此断言时同时接受声明键与解析后的键
    for (const [dep, ver] of Object.entries(target!.deps)) {
      const declared = ctx.metadata[`${dep}@${ver}`] !== undefined;
      const resolved =
        ver === "latest" &&
        Object.keys(ctx.metadata).some((k) => k.startsWith(`${dep}@`));
      expect(declared || resolved).toBe(true);
    }
  });

  it("13. modules 内所有模块描述文本均可解析", async () => {
    const ctx = await fetchPackageContext("moonbitlang/x");
    for (const text of Object.values(ctx.modules)) {
      expect(parseMod(text).parse_error).toBeUndefined();
    }
  });
});

// ===== latest 解析与断链防护（mock fetch，离线）=====
describe("fetchPackageContext：latest 解析（mock fetch）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("无版本声明的依赖经 manifest.latest_version 落地，不断链", async () => {
    const now = new Date().toISOString();
    const manifests: Record<string, unknown> = {
      "moonbitlang/x": {
        latest_version: "0.4.0",
        metadata: { created_at: now },
      },
      "moonbitlang/core": {
        latest_version: "0.6.0",
        metadata: { created_at: now },
      },
    };
    const modTexts: Record<string, unknown> = {
      "moonbitlang/x@0.4.0": {
        name: "moonbitlang/x",
        version: "0.4.0",
        deps: { "moonbitlang/core": "latest" },
      },
      "moonbitlang/core@0.6.0": {
        name: "moonbitlang/core",
        version: "0.6.0",
        deps: {},
      },
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((async (
      input: RequestInfo | URL,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      const mf = url.match(/\/api\/v0\/manifest\/(.+)$/);
      if (mf) {
        const data = manifests[decodeURIComponent(mf[1])];
        return data
          ? new Response(JSON.stringify(data), { status: 200 })
          : new Response("", { status: 404 });
      }
      const src = url.match(/\/source\/(.+)@([^/]+)\/moon\.mod\.json$/);
      if (src) {
        const key = `${decodeURIComponent(src[1])}@${decodeURIComponent(src[2])}`;
        const data = modTexts[key];
        return data
          ? new Response(JSON.stringify(data), { status: 200 })
          : new Response("", { status: 404 });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch);

    const ctx = await fetchPackageContext("moonbitlang/x");
    // latest 落地为 0.6.0，而非残留 core@latest 断链
    expect(Object.keys(ctx.modules)).toContain("moonbitlang/core@0.6.0");
    expect(ctx.metadata["moonbitlang/core@0.6.0"]).toBeDefined();
    expect(ctx.metadata["moonbitlang/core@0.6.0"].latest_version).toBe("0.6.0");
    expect(ctx.metadata["moonbitlang/core@latest"]).toBeUndefined();
    expect(Object.keys(ctx.modules)).not.toContain("moonbitlang/core@latest");
    // 根元数据带活跃度代理信号（created_at → last_commit_days_ago，非负）
    expect(ctx.metadata["moonbitlang/x@0.4.0"].last_commit_days_ago).toBe(0);
  });

  it("latest 无法解析（manifest 404）→ 标记 source_unavailable 且不展开", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (
      input: RequestInfo | URL,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/v0/manifest/moonbitlang%2Fx"))
        return new Response(JSON.stringify({ latest_version: "0.4.0" }), {
          status: 200,
        });
      if (url.includes("/source/moonbitlang/x@0.4.0/moon.mod.json"))
        return new Response(
          JSON.stringify({
            name: "moonbitlang/x",
            version: "0.4.0",
            deps: { "ghost/pkg": "latest" },
          }),
          { status: 200 },
        );
      return new Response("", { status: 404 });
    }) as typeof fetch);

    const ctx = await fetchPackageContext("moonbitlang/x");
    expect(ctx.metadata["ghost/pkg@latest"]).toEqual({
      source_unavailable: true,
    });
    expect(Object.keys(ctx.modules)).not.toContain("ghost/pkg@latest");
    // 不展开：没有为 ghost 发起任何源码/zip 请求（modules 为空，根文本在 ctx.root）
    expect(Object.keys(ctx.modules)).toEqual([]);
    expect(ctx.root).toContain("ghost/pkg");
  });
});

// ===== v0.8 license_source 三级来源（mock fetch，离线）=====
describe("fetchPackageContext：license_source 标注（mock fetch）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const MIT_LICENSE_TEXT =
    'MIT License\n\nCopyright (c) 2024\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction.\n';

  /** 构造最小 stored（不压缩）zip，条目名支持目录层级（解析器按 basename 匹配） */
  function buildStoredZip(
    entries: Record<string, string>,
  ): Uint8Array<ArrayBuffer> {
    const enc = new TextEncoder();
    const u16 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
    const u32 = (v: number) =>
      new Uint8Array([
        v & 0xff,
        (v >> 8) & 0xff,
        (v >> 16) & 0xff,
        (v >>> 24) & 0xff,
      ]);
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(entries)) {
      const nb = enc.encode(name);
      const db = enc.encode(content);
      const lfh = [
        u32(0x04034b50),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0), // crc32：解析器不校验，写 0
        u32(db.length),
        u32(db.length),
        u16(nb.length),
        u16(0),
        nb,
        db,
      ];
      parts.push(...lfh);
      central.push(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(db.length),
        u32(db.length),
        u16(nb.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nb,
      );
      offset += lfh.reduce((s, x) => s + x.length, 0);
    }
    const cdSize = central.reduce((s, x) => s + x.length, 0);
    const count = Object.keys(entries).length;
    const eocd = [
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(count),
      u16(count),
      u32(cdSize),
      u32(offset),
      u16(0),
    ];
    const all = [...parts, ...central, ...eocd];
    const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
    let p = 0;
    for (const x of all) {
      out.set(x, p);
      p += x.length;
    }
    return out;
  }

  /** mock 三套路由：manifest / assets 源码 / 发布 zip */
  function mockRoutes(opts: {
    manifestLicense?: string;
    modLicense?: string;
    zipBody?: Uint8Array<ArrayBuffer> | null;
  }) {
    const now = new Date().toISOString();
    vi.spyOn(globalThis, "fetch").mockImplementation((async (
      input: RequestInfo | URL,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      const mf = url.match(/\/api\/v0\/manifest\/(.+)$/);
      if (mf) {
        const name = decodeURIComponent(mf[1]);
        if (name !== "moonbitlang/x") return new Response("", { status: 404 });
        return new Response(
          JSON.stringify({
            latest_version: "0.4.0",
            metadata: {
              created_at: now,
              ...(opts.manifestLicense
                ? { license: opts.manifestLicense }
                : {}),
            },
          }),
          { status: 200 },
        );
      }
      if (/\/source\/.+@.+\/moon\.mod\.json$/.test(url)) {
        return new Response(
          JSON.stringify({
            name: "moonbitlang/x",
            version: "0.4.0",
            ...(opts.modLicense ? { license: opts.modLicense } : {}),
            deps: {},
          }),
          { status: 200 },
        );
      }
      if (/\/user\/.+\/[^/]+\.zip$/.test(url)) {
        return opts.zipBody
          ? new Response(opts.zipBody, { status: 200 })
          : new Response("", { status: 404 });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch);
  }

  it("mod 文本 license 优先于 manifest → license_source=mod_text", async () => {
    mockRoutes({ manifestLicense: "MIT", modLicense: "Apache-2.0" });
    const ctx = await fetchPackageContext("moonbitlang/x");
    const meta = ctx.metadata["moonbitlang/x@0.4.0"];
    expect(meta.license).toBe("Apache-2.0");
    expect(meta.license_source).toBe("mod_text");
  });

  it("mod 无 license 时回退 manifest.metadata.license → license_source=manifest", async () => {
    mockRoutes({ manifestLicense: "MIT" });
    const ctx = await fetchPackageContext("moonbitlang/x");
    const meta = ctx.metadata["moonbitlang/x@0.4.0"];
    expect(meta.license).toBe("MIT");
    expect(meta.license_source).toBe("manifest");
  });

  it("manifest/mod 均无 license → zip 内 LICENSE 原文进 license_text，引擎指纹闭环", async () => {
    mockRoutes({
      zipBody: buildStoredZip({
        "moonbitlang-x-0.4.0/LICENSE": MIT_LICENSE_TEXT,
      }),
    });
    const ctx = await fetchPackageContext("moonbitlang/x");
    const meta = ctx.metadata["moonbitlang/x@0.4.0"];
    // 原文透传，标注由引擎指纹命中后给出
    expect(meta.license).toBeUndefined();
    expect(meta.license_text).toContain("Permission is hereby granted");
    // 端到端：引擎指纹推断 → license=MIT + license_source=fingerprint
    const r = runJsAnalyzer({ type: "context", context: ctx });
    expect(r.node_metas["moonbitlang/x@0.4.0"].license).toBe("MIT");
    expect(r.node_metas["moonbitlang/x@0.4.0"].license_source).toBe(
      "fingerprint",
    );
  });

  it("zip 无 LICENSE（404）→ license_text 缺省且不崩溃", async () => {
    mockRoutes({ zipBody: null });
    const ctx = await fetchPackageContext("moonbitlang/x");
    const meta = ctx.metadata["moonbitlang/x@0.4.0"];
    expect(meta.license).toBeUndefined();
    expect(meta.license_text).toBeUndefined();
  });
});
