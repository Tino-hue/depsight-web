// 直接用项目的 zip.ts 提取 moon.mod
import { extractZipEntryText } from "./depsight-web/src/lib/zip.ts";

const version = "0.1.20261012+943464bfa";
const url = `https://download.mooncakes.io/user/moonbitlang/core/${encodeURIComponent(version)}.zip`;
const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
const buf = new Uint8Array(await resp.arrayBuffer());

const text = await extractZipEntryText(buf, "moon.mod");
if (text) {
  console.log("moon.mod 前 200 字符:");
  console.log(text.slice(0, 200));
} else {
  console.log("extractZipEntryText 返回 null");
}
