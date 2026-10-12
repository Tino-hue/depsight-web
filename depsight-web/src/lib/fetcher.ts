// mooncakes.io 数据拉取器 —— 基于官方 v0 API（2026-10-04 实测可用，CORS 全开放）
//
// 数据源：
//   GET https://mooncakes.io/api/v0/modules                              全量模块列表（真实搜索用，约 1MB）
//   GET https://mooncakes.io/api/v0/manifest/{name}                      模块元数据：latest_version、全部版本、
//                                                                          license、repository、yanked、created_at
//   GET https://assets.mooncakes.io/source/{name}@{ver}/moon.mod.json    生成的模块描述（含 deps，第三方包可用）
//   GET https://download.mooncakes.io/user/{name}/{ver}.zip              发布 zip 兜底：第三方包内含 moon.mod.json，
//                                                                        官方包（moonbitlang/core 等）只有 TOML 版 moon.mod
//
// 设计要点：模块描述随包发布在注册中心，分析只需元数据，无需下载/安装包本体。
// 从 js/fetcher.js 迁移，保持所有 API 调用逻辑不变。

import { parseMod } from "./analyzer";
import type {
  AnalysisContext,
  ModuleManifest,
  MooncakesModule,
  NodeMetaInput,
  ParsedMod,
} from "./types";
import { extractZipEntryText } from "./zip";

const API_BASE = "https://mooncakes.io/api/v0";
const ASSETS_SOURCE = "https://assets.mooncakes.io/source";
const DOWNLOAD_BASE = "https://download.mooncakes.io/user";

const REQUEST_TIMEOUT = 15000;

// ===== 分层缓存 =====
// modules 列表：体积大（~1MB），存 sessionStorage，TTL 30 分钟
// manifest：单条小，存 localStorage，TTL 24 小时，含 404 负缓存与条数上限
// mod 文本：按 name@version 存 localStorage，TTL 24 小时（版本发布后不可变，可安全缓存）；
//           仅缓存成功结果，瞬时网络失败不做负缓存
// 注意：vitest 等 node 环境无 storage，一律 typeof 防御后跳过
const MODULES_CACHE_KEY = "depsight_modules_cache";
const MODULES_CACHE_TTL = 30 * 60 * 1000;
const MANIFEST_CACHE_PREFIX = "depsight_manifest_";
const MANIFEST_CACHE_TTL = 24 * 60 * 60 * 1000;
const MANIFEST_CACHE_MAX_ENTRIES = 300;
const MODTEXT_CACHE_PREFIX = "depsight_modtext_";
const MODTEXT_CACHE_TTL = 24 * 60 * 60 * 1000;
const MODTEXT_CACHE_MAX_ENTRIES = 200;

function getStorage(kind: "local" | "session"): Storage | null {
  try {
    if (kind === "local" && typeof localStorage !== "undefined")
      return localStorage;
    if (kind === "session" && typeof sessionStorage !== "undefined")
      return sessionStorage;
  } catch {
    /* 隐私模式等场景下访问 storage 本身可能抛异常 */
  }
  return null;
}

function readManifestCache(name: string): ModuleManifest | null | undefined {
  const store = getStorage("local");
  if (!store) return undefined;
  const raw = store.getItem(MANIFEST_CACHE_PREFIX + name);
  if (!raw) return undefined;
  try {
    const { fetchedAt, data } = JSON.parse(raw) as {
      fetchedAt: number;
      data: ModuleManifest | null;
    };
    if (Date.now() - fetchedAt > MANIFEST_CACHE_TTL) {
      store.removeItem(MANIFEST_CACHE_PREFIX + name);
      return undefined;
    }
    return data; // null 为 404 负缓存
  } catch {
    store.removeItem(MANIFEST_CACHE_PREFIX + name);
    return undefined;
  }
}

function writeManifestCache(name: string, data: ModuleManifest | null): void {
  const store = getStorage("local");
  if (!store) return;
  try {
    // 条数上限：超出时按 key 字母序淘汰最旧的一批（实现简单，近似 LRU）
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(MANIFEST_CACHE_PREFIX)) keys.push(k);
    }
    if (keys.length >= MANIFEST_CACHE_MAX_ENTRIES) {
      keys
        .sort()
        .slice(0, keys.length - MANIFEST_CACHE_MAX_ENTRIES + 1)
        .forEach((k) => store.removeItem(k));
    }
    store.setItem(
      MANIFEST_CACHE_PREFIX + name,
      JSON.stringify({ fetchedAt: Date.now(), data }),
    );
  } catch {
    /* quota 超限等场景静默失败，仅影响缓存 */
  }
}

// ===== mod 文本缓存（localStorage，TTL 24h，按 fetchedAt 淘汰最旧）=====
function readModTextCache(name: string, version: string): string | undefined {
  const store = getStorage("local");
  if (!store) return undefined;
  const raw = store.getItem(MODTEXT_CACHE_PREFIX + name + "@" + version);
  if (!raw) return undefined;
  try {
    const { fetchedAt, text } = JSON.parse(raw) as {
      fetchedAt: number;
      text: string;
    };
    if (Date.now() - fetchedAt > MODTEXT_CACHE_TTL) {
      store.removeItem(MODTEXT_CACHE_PREFIX + name + "@" + version);
      return undefined;
    }
    return text;
  } catch {
    store.removeItem(MODTEXT_CACHE_PREFIX + name + "@" + version);
    return undefined;
  }
}

function writeModTextCache(name: string, version: string, text: string): void {
  const store = getStorage("local");
  if (!store) return;
  try {
    // 条数上限：按 fetchedAt 升序淘汰最旧的一批
    const entries: Array<{ key: string; fetchedAt: number }> = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k?.startsWith(MODTEXT_CACHE_PREFIX)) continue;
      try {
        const { fetchedAt } = JSON.parse(store.getItem(k)!) as {
          fetchedAt: number;
        };
        entries.push({ key: k, fetchedAt });
      } catch {
        store.removeItem(k);
      }
    }
    if (entries.length >= MODTEXT_CACHE_MAX_ENTRIES) {
      entries
        .sort((a, b) => a.fetchedAt - b.fetchedAt)
        .slice(0, entries.length - MODTEXT_CACHE_MAX_ENTRIES + 1)
        .forEach((e) => store.removeItem(e.key));
    }
    store.setItem(
      MODTEXT_CACHE_PREFIX + name + "@" + version,
      JSON.stringify({ fetchedAt: Date.now(), text }),
    );
  } catch {
    /* quota 超限等场景静默失败，仅影响缓存 */
  }
}

// 带超时的 fetch
async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ===== 全量模块列表（供真实搜索；sessionStorage 缓存 30 分钟）=====
let modulesCache: MooncakesModule[] | null = null;

export async function fetchAllModules(): Promise<MooncakesModule[]> {
  if (modulesCache) return modulesCache;

  const store = getStorage("session");
  if (store) {
    try {
      const raw = store.getItem(MODULES_CACHE_KEY);
      if (raw) {
        const { fetchedAt, data } = JSON.parse(raw) as {
          fetchedAt: number;
          data: MooncakesModule[];
        };
        if (
          Date.now() - fetchedAt <= MODULES_CACHE_TTL &&
          Array.isArray(data)
        ) {
          modulesCache = data;
          return modulesCache;
        }
        store.removeItem(MODULES_CACHE_KEY);
      }
    } catch {
      store.removeItem(MODULES_CACHE_KEY);
    }
  }

  const resp = await fetchWithTimeout(`${API_BASE}/modules`);
  if (!resp.ok) throw new Error(`modules list HTTP ${resp.status}`);
  modulesCache = (await resp.json()) as MooncakesModule[];
  if (store) {
    try {
      store.setItem(
        MODULES_CACHE_KEY,
        JSON.stringify({ fetchedAt: Date.now(), data: modulesCache }),
      );
    } catch {
      /* quota 超限等场景静默失败 */
    }
  }
  return modulesCache;
}

// ===== 模块 manifest（localStorage 缓存 24h；best-effort，失败重试一次后返回 null）=====
// 并发去重：同一 name 的在飞请求共享一个 Promise，避免 BFS 并行时重复请求
const manifestInFlight = new Map<string, Promise<ModuleManifest | null>>();

export async function fetchModuleManifest(
  name: string,
): Promise<ModuleManifest | null> {
  const cached = readManifestCache(name);
  if (cached !== undefined) return cached;

  const pending = manifestInFlight.get(name);
  if (pending) return pending;

  const task = (async () => {
    let result: ModuleManifest | null = null;
    for (let attempt = 1; ; attempt++) {
      try {
        const resp = await fetchWithTimeout(
          `${API_BASE}/manifest/${encodeURIComponent(name)}`,
        );
        if (resp.ok) {
          result = (await resp.json()) as ModuleManifest;
          break;
        }
        // 5xx 等瞬时错误重试一次；404（模块不存在）直接返回
        if (resp.status !== 404 && attempt < 2) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        result = null;
        break;
      } catch {
        if (attempt >= 2) {
          result = null;
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    writeManifestCache(name, result);
    return result;
  })();

  manifestInFlight.set(name, task);
  try {
    return await task;
  } finally {
    manifestInFlight.delete(name);
  }
}

// ===== 拉取指定版本模块描述文本（缓存 → assets 直取 → zip 兜底）=====
// 并发去重：同一 name@version 的在飞请求共享一个 Promise
const modTextInFlight = new Map<string, Promise<string | null>>();

export async function fetchModJsonText(
  name: string,
  version: string,
): Promise<string | null> {
  const cached = readModTextCache(name, version);
  if (cached !== undefined) return cached;

  const key = `${name}@${version}`;
  const pending = modTextInFlight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const ver = encodeURIComponent(version);
    // 路径 1：assets 源码直取（大多数包可用）
    try {
      const resp = await fetchWithTimeout(
        `${ASSETS_SOURCE}/${name}@${ver}/moon.mod.json`,
      );
      if (resp.ok) {
        const text = await resp.text();
        writeModTextCache(name, version, text);
        return text;
      }
    } catch {
      /* 超时/网络问题 → 走兜底 */
    }
    // 路径 2：下载发布 zip，提取 moon.mod.json 或 moon.mod（官方包走这条路）
    try {
      const text = await fetchModJsonFromZip(name, version);
      writeModTextCache(name, version, text);
      return text;
    } catch (e) {
      console.warn(
        `[fetcher] ${name}@${version} 模块描述不可用:`,
        e instanceof Error ? e.message : String(e),
      );
      return null;
    }
  })();

  modTextInFlight.set(key, task);
  try {
    return await task;
  } finally {
    modTextInFlight.delete(key);
  }
}

// 从发布 zip 提取模块描述文本
// 第三方包 zip 内含生成的 moon.mod.json；官方包（moonbitlang/core 等）只发布 TOML 版 moon.mod
async function fetchModJsonFromZip(
  name: string,
  version: string,
): Promise<string> {
  const resp = await fetchWithTimeout(
    `${DOWNLOAD_BASE}/${name}/${encodeURIComponent(version)}.zip`,
  );
  if (!resp.ok) throw new Error(`zip HTTP ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  const json = await extractZipEntryText(buf, "moon.mod.json");
  if (json != null) return json;
  const toml = await extractZipEntryText(buf, "moon.mod");
  if (toml != null) return toml;
  throw new Error("moon.mod.json / moon.mod not found in zip");
}

// ===== LICENSE 文本拉取（指纹推断用；localStorage 缓存 24h + 在飞去重）=====
// 仅当 manifest 与 mod 文本都无 license 声明时调用，发布 zip 内按常见文件名匹配
const LICENSE_CACHE_PREFIX = "depsight_license_";
const LICENSE_CACHE_TTL = 24 * 60 * 60 * 1000;
const LICENSE_CACHE_MAX_ENTRIES = 200;
const LICENSE_BASENAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "COPYING",
];

function readLicenseCache(name: string, version: string): string | undefined {
  const store = getStorage("local");
  if (!store) return undefined;
  const raw = store.getItem(LICENSE_CACHE_PREFIX + name + "@" + version);
  if (!raw) return undefined;
  try {
    const { fetchedAt, text } = JSON.parse(raw) as {
      fetchedAt: number;
      text: string;
    };
    if (Date.now() - fetchedAt > LICENSE_CACHE_TTL) {
      store.removeItem(LICENSE_CACHE_PREFIX + name + "@" + version);
      return undefined;
    }
    return text;
  } catch {
    store.removeItem(LICENSE_CACHE_PREFIX + name + "@" + version);
    return undefined;
  }
}

function writeLicenseCache(name: string, version: string, text: string): void {
  const store = getStorage("local");
  if (!store) return;
  try {
    // 条数上限：按 fetchedAt 升序淘汰最旧的一批
    const entries: Array<{ key: string; fetchedAt: number }> = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k?.startsWith(LICENSE_CACHE_PREFIX)) continue;
      try {
        const { fetchedAt } = JSON.parse(store.getItem(k)!) as {
          fetchedAt: number;
        };
        entries.push({ key: k, fetchedAt });
      } catch {
        store.removeItem(k);
      }
    }
    if (entries.length >= LICENSE_CACHE_MAX_ENTRIES) {
      entries
        .sort((a, b) => a.fetchedAt - b.fetchedAt)
        .slice(0, entries.length - LICENSE_CACHE_MAX_ENTRIES + 1)
        .forEach((e) => store.removeItem(e.key));
    }
    store.setItem(
      LICENSE_CACHE_PREFIX + name + "@" + version,
      JSON.stringify({ fetchedAt: Date.now(), text }),
    );
  } catch {
    /* quota 超限等场景静默失败，仅影响缓存 */
  }
}

// 并发去重：同一 name@version 的在飞请求共享一个 Promise
const licenseInFlight = new Map<string, Promise<string | null>>();

/**
 * 拉取发布 zip 内的 LICENSE 文件原文（按常见文件名依次匹配）。
 * best-effort：任何失败都返回 null，不做负缓存（zip 内容随版本不可变，可安全缓存成功结果）。
 */
export async function fetchLicenseText(
  name: string,
  version: string,
): Promise<string | null> {
  const cached = readLicenseCache(name, version);
  if (cached !== undefined) return cached;

  const key = `${name}@${version}`;
  const pending = licenseInFlight.get(key);
  if (pending) return pending;

  const task = (async () => {
    try {
      const resp = await fetchWithTimeout(
        `${DOWNLOAD_BASE}/${name}/${encodeURIComponent(version)}.zip`,
      );
      if (!resp.ok) return null;
      const buf = new Uint8Array(await resp.arrayBuffer());
      for (const base of LICENSE_BASENAMES) {
        const text = await extractZipEntryText(buf, base);
        if (text !== null) {
          writeLicenseCache(name, version, text);
          return text;
        }
      }
      return null;
    } catch {
      return null;
    }
  })();

  licenseInFlight.set(key, task);
  try {
    return await task;
  } finally {
    licenseInFlight.delete(key);
  }
}

// ===== 递归收集依赖 =====
// 返回 context：{ root, modules, metadata, options }
//   root     根包模块描述文本（moon.mod.json 或 moon.mod TOML）
//   modules  { "name@version": 模块描述文本 }
//   metadata { "name@version": { license, latest_version, repository,
//              yanked, last_commit_days_ago, source_unavailable? } }
// BFS 并发上限：每个节点的依赖并行拉取，全局同时在飞任务不超过 DEP_CONCURRENCY
const DEP_CONCURRENCY = 4;

/** 简易并发限制器：保证同时在飞任务数不超过 limit */
function createLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

export async function fetchPackageContext(
  name: string,
  version: string | null = null,
  maxDepth = 3,
): Promise<AnalysisContext> {
  // 1. 根 manifest：确定解析版本 + 拿元数据
  const rootManifest = await fetchModuleManifest(name);
  const rootVersion = version || rootManifest?.latest_version;
  if (!rootVersion) {
    throw new Error(
      `Cannot determine a version for ${name} (module does not exist or is unpublished)`,
    );
  }

  // 2. 拉根 moon.mod.json
  const rootModText = await fetchModJsonText(name, rootVersion);
  if (!rootModText) {
    throw new Error(
      `Failed to fetch module manifest for ${name}@${rootVersion}`,
    );
  }
  const rootMod = parseModTextSafe(rootModText);
  if (!rootMod) {
    throw new Error(
      `Failed to parse module manifest for ${name}@${rootVersion}`,
    );
  }

  // 3. BFS 展开传递依赖
  const modules: Record<string, string> = {};
  const metadata: Record<string, NodeMetaInput> = {};
  const rootId = `${rootMod.name}@${rootVersion}`;
  const visited = new Set([rootId]);
  metadata[rootId] = buildMeta(rootManifest, rootMod);
  // license 三级兜底：manifest / mod 文本均无声明时，取 LICENSE 文件原文交由引擎指纹推断
  if (!metadata[rootId].license) {
    const licenseText = await fetchLicenseText(name, rootVersion);
    if (licenseText) metadata[rootId].license_text = licenseText;
  }

  const limit = createLimiter(DEP_CONCURRENCY);
  const queue = [{ name: rootMod.name, version: rootVersion, depth: 0 }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.depth >= maxDepth) continue;

    const curMod =
      cur.name === rootMod.name && cur.version === rootVersion
        ? rootMod
        : parseModTextSafe(modules[`${cur.name}@${cur.version}`]);
    if (!curMod) continue;

    // 当前节点的依赖并行拉取（受并发上限约束）；单个依赖失败不影响整体
    await Promise.all(
      Object.entries(curMod.deps || {}).map(([depName, depVersion]) =>
        limit(async () => {
          // "latest" 落地：无版本声明的依赖（import { "pkg" }）先用 manifest 的
          // latest_version 解析出真实版本，否则 assets/zip 双路径必然 404 断链
          let depVer = depVersion;
          const manifest = await fetchModuleManifest(depName);
          if (depVer === "latest") {
            if (manifest?.latest_version) {
              depVer = manifest.latest_version;
            } else {
              // 无法解析版本：保留 latest 节点痕迹，标记源码不可用，不再展开
              const looseId = `${depName}@latest`;
              if (!visited.has(looseId)) {
                visited.add(looseId);
                metadata[looseId] = { source_unavailable: true };
              }
              return;
            }
          }

          const depId = `${depName}@${depVer}`;
          if (visited.has(depId)) return;
          visited.add(depId);

          const modText = await fetchModJsonText(depName, depVer);
          if (modText) modules[depId] = modText;
          const depMod = parseModTextSafe(modText);
          metadata[depId] = buildMeta(manifest, depMod);
          if (!modText) metadata[depId].source_unavailable = true;
          // license 三级兜底：manifest / mod 文本均无声明时，取 LICENSE 文件原文交由引擎指纹推断
          if (!metadata[depId].license) {
            const licenseText = await fetchLicenseText(depName, depVer);
            if (licenseText) metadata[depId].license_text = licenseText;
          }

          queue.push({
            name: depName,
            version: depVer,
            depth: cur.depth + 1,
          });
        }),
      ),
    );
  }

  return {
    root: rootModText,
    modules,
    metadata,
    options: { max_depth: maxDepth },
  };
}

// 组装元数据：manifest 提供 latest_version/license/repository/yanked/发布活跃度
// license 来源标注（与引擎 license_source 契约一致）：mod 文本声明 → "mod_text"，
// manifest.metadata.license 回退 → "manifest"；LICENSE 文件原文由调用方放入
// license_text，引擎做文本指纹推断后标注 "fingerprint"
function buildMeta(
  manifest: ModuleManifest | null,
  mod: ParsedMod | null,
): NodeMetaInput {
  const meta: NodeMetaInput = {};
  if (mod?.license) {
    meta.license = mod.license;
    meta.license_source = "mod_text";
  }
  if (manifest) {
    if (!meta.license && manifest.metadata?.license) {
      meta.license = manifest.metadata.license;
      meta.license_source = "manifest";
    }
    if (manifest.latest_version) meta.latest_version = manifest.latest_version;
    if (manifest.repository) meta.repository = manifest.repository;
    if (manifest.yanked) {
      meta.yanked = true;
      if (manifest.yanked_reason) meta.yanked_reason = manifest.yanked_reason;
    }
    // 维护活跃度代理指标：最近版本的发布时间（mooncakes v0 manifest 无提交时间字段，
    // created_at 是可得的最接近信号；时钟偏差导致的负值钳位为 0）
    const created = manifest.metadata?.created_at;
    if (created) {
      const days = Math.floor(
        (Date.now() - new Date(created).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (Number.isFinite(days)) {
        meta.last_commit_days_ago = days > 0 ? days : 0;
      }
    }
  }
  return meta;
}

// 安全解析模块描述文本为对象（moon.mod.json 或 moon.mod TOML 均可，兼容无 deps 字段）
function parseModTextSafe(text: string | null): ParsedMod | null {
  if (!text) return null;
  // analyzer 的 parseMod：JSON 解析失败时返回 parse_error 字段而非抛异常
  const mod = parseMod(text);
  return mod.parse_error ? null : mod;
}
