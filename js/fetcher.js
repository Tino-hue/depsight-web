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

import { parseMod } from "./js-analyzer.js";

const API_BASE = "https://mooncakes.io/api/v0";
const ASSETS_SOURCE = "https://assets.mooncakes.io/source";
const DOWNLOAD_BASE = "https://download.mooncakes.io/user";

const REQUEST_TIMEOUT = 15000;

// 带超时的 fetch
async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ===== 全量模块列表（供真实搜索，会话内缓存）=====
let modulesCache = null;

export async function fetchAllModules() {
  if (modulesCache) return modulesCache;
  const resp = await fetchWithTimeout(`${API_BASE}/modules`);
  if (!resp.ok) throw new Error(`modules list HTTP ${resp.status}`);
  modulesCache = await resp.json();
  return modulesCache;
}

// ===== 模块 manifest（best-effort，失败重试一次后返回 null）=====
export async function fetchModuleManifest(name) {
  for (let attempt = 1; ; attempt++) {
    try {
      const resp = await fetchWithTimeout(
        `${API_BASE}/manifest/${encodeURIComponent(name)}`,
      );
      if (resp.ok) return await resp.json();
      // 5xx 等瞬时错误重试一次；404（模块不存在）直接返回
      if (resp.status !== 404 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      return null;
    } catch {
      if (attempt >= 2) return null;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}

// ===== 拉取指定版本模块描述文本（assets 直取 → zip 兜底）=====
export async function fetchModJsonText(name, version) {
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
    console.warn(`[fetcher] ${name}@${version} 模块描述不可用:`, e.message);
    return null;
  }
}

// 从发布 zip 提取模块描述文本（浏览器/Node 原生 DecompressionStream，无需第三方库）
// 第三方包 zip 内含生成的 moon.mod.json；官方包（moonbitlang/core 等）只发布 TOML 版 moon.mod
async function fetchModJsonFromZip(name, version) {
  const resp = await fetchWithTimeout(
    `${DOWNLOAD_BASE}/${name}/${encodeURIComponent(version)}.zip`,
  );
  if (!resp.ok) throw new Error(`zip HTTP ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  const json = await extractZipEntryText(buf, "moon.mod.json");
  if (json != null) return json;
  const toml = await extractZipEntryText(buf, "moon.mod");
  if (toml != null) return toml;
  throw new Error("zip 内未找到 moon.mod.json / moon.mod");
}

// 极简 zip 解析：扫 central directory 定位条目 → 读 local header → inflate
async function extractZipEntryText(buf, entryName) {
  const decoder = new TextDecoder();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const EOCD_SIG = 0x06054b50;
  const CDFH_SIG = 0x02014b50;
  const LFH_SIG = 0x04034b50;

  // End Of Central Directory 固定在文件末尾 22+ 字节处
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("非法 zip：未找到 EOCD");

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true); // central directory 起始偏移
  let fallback = null; // 非根目录的备选匹配（zip 顶层有包裹目录时）

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CDFH_SIG)
      throw new Error("非法 zip：CDFH 签名错误");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const fileName = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));

    const isTarget =
      !fileName.endsWith("/") && fileName.split("/").pop() === entryName;
    if (isTarget && fallback === null)
      fallback = { method, compSize, localOff, fileName };
    if (isTarget && !fileName.includes("/")) {
      // 根目录精确匹配，直接使用
      return await inflateEntry(buf, view, method, compSize, localOff, decoder);
    }

    p += 46 + nameLen + extraLen + commentLen;
  }

  if (fallback) {
    return await inflateEntry(
      buf,
      view,
      fallback.method,
      fallback.compSize,
      fallback.localOff,
      decoder,
    );
  }
  return null;
}

async function inflateEntry(buf, view, method, compSize, localOff, decoder) {
  const LFH_SIG = 0x04034b50;
  if (view.getUint32(localOff, true) !== LFH_SIG)
    throw new Error("非法 zip：LFH 签名错误");
  const lNameLen = view.getUint16(localOff + 26, true);
  const lExtraLen = view.getUint16(localOff + 28, true);
  const dataStart = localOff + 30 + lNameLen + lExtraLen;
  const compData = buf.subarray(dataStart, dataStart + compSize);

  if (method === 0) return decoder.decode(compData); // stored
  if (method === 8) {
    // deflate：zip 使用 raw deflate（无 zlib 头）
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([compData]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  }
  throw new Error(`不支持的 zip 压缩方式: ${method}`);
}

// ===== 递归收集依赖 =====
// 返回 context：{ root, modules, metadata, options }
//   root     根包模块描述文本（moon.mod.json 或 moon.mod TOML）
//   modules  { "name@version": 模块描述文本 }
//   metadata { "name@version": { license, latest_version, repository,
//              yanked, last_commit_days_ago, source_unavailable? } }
export async function fetchPackageContext(name, version = null, maxDepth = 3) {
  // 1. 根 manifest：确定解析版本 + 拿元数据
  const rootManifest = await fetchModuleManifest(name);
  const rootVersion = version || rootManifest?.latest_version;
  if (!rootVersion) {
    throw new Error(`无法确定 ${name} 的版本（模块不存在或未发布）`);
  }

  // 2. 拉根 moon.mod.json
  const rootModText = await fetchModJsonText(name, rootVersion);
  if (!rootModText) {
    throw new Error(`拉取 ${name}@${rootVersion} 的模块描述失败`);
  }
  const rootMod = parseModTextSafe(rootModText);
  if (!rootMod) {
    throw new Error(`解析 ${name}@${rootVersion} 的模块描述失败`);
  }

  // 3. BFS 展开传递依赖
  const modules = {};
  const metadata = {};
  const rootId = `${rootMod.name}@${rootVersion}`;
  const visited = new Set([rootId]);
  metadata[rootId] = buildMeta(rootManifest, rootMod);

  const queue = [{ name: rootMod.name, version: rootVersion, depth: 0 }];
  while (queue.length > 0) {
    const cur = queue.shift();
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
function buildMeta(manifest, mod) {
  const meta = {};
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
function parseModTextSafe(text) {
  if (!text) return null;
  // js-analyzer 的 parseMod：JSON 解析失败时返回 parse_error 字段而非抛异常
  const mod = parseMod(text);
  return mod.parse_error ? null : mod;
}
