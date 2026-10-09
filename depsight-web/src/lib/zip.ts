// 极简 zip 解析：扫 central directory 定位条目 → 读 local header → inflate
// 浏览器/Node 原生 DecompressionStream，无需第三方库
// 从 js/fetcher.js 中的 zip 相关逻辑抽离，便于单测

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

interface ZipEntryRef {
  method: number;
  compSize: number;
  localOff: number;
}

/** 从 zip 字节流中提取指定文件条目的文本内容（先精确匹配根目录，再退回任意层级） */
export async function extractZipEntryText(
  buf: Uint8Array<ArrayBuffer>,
  entryName: string,
): Promise<string | null> {
  const decoder = new TextDecoder();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // End Of Central Directory 固定在文件末尾 22+ 字节处
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid zip: EOCD not found");

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true); // central directory 起始偏移
  let fallback: ZipEntryRef | null = null; // 非根目录的备选匹配（zip 顶层有包裹目录时）

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CDFH_SIG)
      throw new Error("Invalid zip: bad CDFH signature");
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
      fallback = { method, compSize, localOff };
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

async function inflateEntry(
  buf: Uint8Array<ArrayBuffer>,
  view: DataView,
  method: number,
  compSize: number,
  localOff: number,
  decoder: TextDecoder,
): Promise<string> {
  if (view.getUint32(localOff, true) !== LFH_SIG)
    throw new Error("Invalid zip: bad LFH signature");
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
  throw new Error(`Unsupported zip compression method: ${method}`);
}
