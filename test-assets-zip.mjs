// 测试 assets.mooncakes.io 是否提供 zip 下载
const version = "0.1.20261012+943464bfa";
const encoded = encodeURIComponent(version);

// 试几个可能的 assets zip 路径
const urls = [
  `https://assets.mooncakes.io/user/moonbitlang/core@${encoded}.zip`,
  `https://assets.mooncakes.io/user/moonbitlang/core/${encoded}.zip`,
  `https://assets.mooncakes.io/user/moonbitlang/core@${encoded}/source.zip`,
];

for (const url of urls) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    console.log(`${r.status} ${url} (大小: ${r.headers.get("content-length") || "unknown"})`);
  } catch(e) {
    console.log(`ERR ${url}: ${e.message}`);
  }
}
