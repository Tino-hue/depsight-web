// mooncakes.io 数据拉取器
// 从 mooncakes.io API 递归拉取依赖的 moon.mod.json

const MOONCAKES_BASE = "https://mooncakes.io";

// 拉取单个包的 moon.mod.json
async function fetchModJson(name, version = null) {
  // URL 形如 https://mooncakes.io/api/v1/packages/{name}/{version}/moon.mod.json
  // 不带 version 则取 latest
  const ver = version || "latest";
  const url = `${MOONCAKES_BASE}/api/v1/packages/${encodeURIComponent(name)}/${encodeURIComponent(ver)}/moon.mod.json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${name}@${ver}`);
  const text = await resp.text();
  return text;
}

// 拉取包的元信息（含 license、description、repo_url 等）
async function fetchPackageMeta(name) {
  try {
    const url = `${MOONCAKES_BASE}/api/v1/packages/${encodeURIComponent(name)}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// 递归收集依赖
// 返回 context：{ root, modules, metadata }
export async function fetchPackageContext(name, version = null, maxDepth = 3) {
  // 1. 拉根 moon.mod.json
  const rootModText = await fetchModJson(name, version);
  const rootMod = parseModJsonSafe(rootModText);
  if (!rootMod) throw new Error(`Failed to parse moon.mod.json for ${name}`);

  // 2. BFS 收集依赖
  const modules = {}; // "name@version" -> moon.mod.json text
  const metadata = {}; // "name@version" -> meta
  const visited = new Set();

  // 根节点
  const rootId = `${rootMod.name}@${rootMod.version}`;
  visited.add(rootId);

  // 给根节点加 metadata
  metadata[rootId] = {
    license: rootMod.license || null,
  };

  // BFS
  const queue = [{ name: rootMod.name, version: rootMod.version, depth: 0 }];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.depth >= maxDepth) continue;

    let curMod;
    if (cur.name === rootMod.name) {
      curMod = rootMod;
    } else {
      const key = `${cur.name}@${cur.version}`;
      const content = modules[key];
      if (!content) continue;
      curMod = parseModJsonSafe(content);
      if (!curMod) continue;
    }

    for (const [depName, depVersion] of Object.entries(curMod.deps || {})) {
      const depId = `${depName}@${depVersion}`;
      if (visited.has(depId)) continue;
      visited.add(depId);

      try {
        const modText = await fetchModJson(depName, depVersion);
        modules[depId] = modText;
        const depMod = parseModJsonSafe(modText);
        if (depMod) {
          metadata[depId] = {
            license: depMod.license || null,
          };
        }
        queue.push({
          name: depName,
          version: depVersion,
          depth: cur.depth + 1,
        });
      } catch {
        // 拉不到就跳过
        console.warn(`[fetcher] Failed to fetch ${depName}@${depVersion}`);
      }
    }
  }

  // 3. 尝试给每个包补充元数据（latest_version、last_commit_days_ago）
  // 这需要调 GitHub API 或 mooncakes API，先做 best-effort
  await enrichMetadata(rootMod, modules, metadata);

  return {
    root: rootModText,
    modules,
    metadata,
    options: { max_depth: maxDepth },
  };
}

// 补充元数据：从 mooncakes 拉最新版本、从 GitHub 拉 last commit
async function enrichMetadata(rootMod, modules, metadata) {
  const allIds = Object.keys(metadata);

  for (const id of allIds) {
    const [name, version] = id.split("@");
    if (name === rootMod.name) continue;

    // 拉 mooncakes package info 获取 latest_version
    try {
      const pkg = await fetchPackageMeta(name);
      if (pkg) {
        if (pkg.latest_version) {
          metadata[id].latest_version = pkg.latest_version;
        }
        if (pkg.repo_url) {
          // 尝试从 GitHub 拿 last commit
          const days = await fetchLastCommitDays(pkg.repo_url);
          if (days != null) {
            metadata[id].last_commit_days_ago = days;
          }
        }
        if (pkg.size) {
          metadata[id].self_size = pkg.size;
        }
      }
    } catch {
      // best-effort，失败不影响主流程
    }
  }
}

// 从 GitHub URL 拿 last commit 天数
async function fetchLastCommitDays(repoUrl) {
  try {
    // 形如 https://github.com/owner/repo
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return null;
    const [, owner, repo] = match;
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.pushed_at) {
      const days = Math.floor(
        (Date.now() - new Date(data.pushed_at)) / (1000 * 60 * 60 * 24),
      );
      return days;
    }
  } catch {
    // ignore
  }
  return null;
}

// 安全解析 moon.mod.json 为对象
function parseModJsonSafe(text) {
  try {
    const obj = JSON.parse(text);
    return {
      name: obj.name || "unknown",
      version: obj.version || "0.0.0",
      license: obj.license || null,
      deps: obj.deps || {},
    };
  } catch {
    return null;
  }
}
