// 下载 moonbitlang/core zip，列出所有 moon.mod 相关条目
const version = "0.1.20261012+943464bfa";
const url = `https://download.mooncakes.io/user/moonbitlang/core/${encodeURIComponent(version)}.zip`;
const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
const buf = new Uint8Array(await resp.arrayBuffer());
console.log("zip 大小:", buf.length);

// 找 EOCD
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let eocd = -1;
for (let i = buf.length - 22; i >= 0; i--) {
  if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
}
const count = view.getUint16(eocd + 10, true);
let p = view.getUint32(eocd + 16, true);
const decoder = new TextDecoder();

console.log("\n含 'mod' 的条目:");
for (let i = 0; i < count; i++) {
  const nameLen = view.getUint16(p + 28, true);
  const extraLen = view.getUint16(p + 30, true);
  const commentLen = view.getUint16(p + 32, true);
  const entryName = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
  if (entryName.toLowerCase().includes("mod")) {
    console.log(`  ${entryName}`);
  }
  p += 46 + nameLen + extraLen + commentLen;
}

console.log("\n前 20 个条目:");
p = view.getUint32(eocd + 16, true);
for (let i = 0; i < Math.min(20, count); i++) {
  const nameLen = view.getUint16(p + 28, true);
  const extraLen = view.getUint16(p + 30, true);
  const commentLen = view.getUint16(p + 32, true);
  const entryName = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
  console.log(`  ${entryName}`);
  p += 46 + nameLen + extraLen + commentLen;
}
