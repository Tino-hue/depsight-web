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
// 注意：vitest 等 node 环境无 storage，一律 typeof 防御后跳过
const MODULES_CACHE_KEY = "depsight_modules_cache";
const MODULES_CACHE_TTL = 30 * 60 * 1000;
const MANIFEST_CACHE_PREFIX = "depsight_manifest_";
const MANIFEST_CACHE_TTL = 24 * 60 * 60 * 1000;
const MANIFEST_CACHE_MAX_ENTRIES = 300;

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
export async function fetchModuleManifest(
  name: string,
): Promise<ModuleManifest | null> {
  const cached = readManifestCache(name);
  if (cached !== undefined) return cached;

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
}

// ===== 拉取指定版本模块描述文本（assets 直取 → zip 兜底）=====
export async function fetchModJsonText(
  name: string,
  version: string,
): Promise<string | null> {
  const ver = encodeURIComponent(version);
  // 路径 1：assets 源码直取（大多数包可用）
  try {
    const resp = await fetchWithTimeout(
      `${ASSETS_SOURCE}/${name}@${ver}/moon.mod.json`,
    );
    if (resp.ok) return await resp.text();
  } catch {
    /* 超时/网络问题 → 走兜底 */
  }
  // 路径 2：下载发布 zip，提取 moon.mod.json 或 moon.mod（官方包走这条路）
  try {
    return await fetchModJsonFromZip(name, version);
  } catch (e) {
    console.warn(
      `[fetcher] ${name}@${version} 模块描述不可用:`,
      e instanceof Error ? e.message : String(e),
    );
    return null;
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

// ===== 递归收集依赖 =====
// 返回 context：{ root, modules, metadata, options }
//   root     根包模块描述文本（moon.mod.json 或 moon.mod TOML）
//   modules  { "name@version": 模块描述文本 }
//   metadata { "name@version": { license, latest_version, repository,
//              yanked, last_commit_days_ago, source_unavailable? } }
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

  const queue = [{ name: rootMod.name, version: rootVersion, depth: 0 }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.depth >= maxDepth) continue;

    const curMod =
      cur.name === rootMod.name && cur.version === rootVersion
        ? rootMod
        : parseModTextSafe(modules[`${cur.name}@${cur.version}`]);
    if (!curMod) continue;

    for (const [depName, depVersion] of Object.entries(curMod.deps || {})) {
      const depId = `${depName}@${depVersion}`;
      if (visited.has(depId)) continue;
      visited.add(depId);

      // 元数据与源码并行拉取；单个依赖失败不影响整体
      const [modText, manifest] = await Promise.all([
        fetchModJsonText(depName, depVersion),
        fetchModuleManifest(depName),
      ]);
      if (modText) modules[depId] = modText;
      const depMod = parseModTextSafe(modText);
      metadata[depId] = buildMeta(manifest, depMod);
      if (!modText) metadata[depId].source_unavailable = true;

      queue.push({ name: depName, version: depVersion, depth: cur.depth + 1 });
    }
  }

  return {
    root: rootModText,
    modules,
    metadata,
    options: { max_depth: maxDepth },
  };
}

// 组装元数据：manifest 提供 latest_version/license/repository/yanked/发布活跃度
function buildMeta(
  manifest: ModuleManifest | null,
  mod: ParsedMod | null,
): NodeMetaInput {
  const meta: NodeMetaInput = {};
  if (mod?.license) meta.license = mod.license;
  if (manifest) {
    if (manifest.latest_version) meta.latest_version = manifest.latest_version;
    if (manifest.repository) meta.repository = manifest.repository;
    if (manifest.yanked) {
      meta.yanked = true;
      if (manifest.yanked_reason) meta.yanked_reason = manifest.yanked_reason;
    }
    // 维护活跃度代理指标：最近版本的发布时间
    const created = manifest.metadata?.created_at;
    if (created) {
      const days = Math.floor(
        (Date.now() - new Date(created).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (Number.isFinite(days)) meta.last_commit_days_ago = days;
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
