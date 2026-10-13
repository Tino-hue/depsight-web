// 测试 moonbitlang/core 的 moon.mod.json 拉取路径
const version = "0.1.20261012+943464bfa";
const encoded = encodeURIComponent(version);

// 路径 1: assets
const url1 = `https://assets.mooncakes.io/user/moonbitlang/core@${encoded}/moon.mod.json`;
console.log("路径1:", url1);
try {
  const r1 = await fetch(url1, { signal: AbortSignal.timeout(10000) });
  console.log("  状态:", r1.status);
} catch(e) { console.log("  错误:", e.message); }

// 路径 2: zip
const url2 = `https://download.mooncakes.io/user/moonbitlang/core/${encoded}.zip`;
console.log("路径2:", url2);
try {
  const r2 = await fetch(url2, { signal: AbortSignal.timeout(30000) });
  console.log("  状态:", r2.status, "大小:", r2.headers.get("content-length"));
} catch(e) { console.log("  错误:", e.message); }
