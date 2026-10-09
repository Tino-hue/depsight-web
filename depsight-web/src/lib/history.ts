// 分析历史持久化 + 可分享链接编解码
// 存储：localStorage（键 depsight_history_v1），上限 MAX_ENTRIES 条，超限按 key（时间戳 id）升序淘汰最旧
// 分享：结果 JSON → deflate → base64url → 附加到 #share=<payload>；接收方解析后写回应用状态
import type { AnalysisResult } from "./types";

export interface HistoryEntry {
  id: string; // `${Date.now()}-${rand}`，同时作为 localStorage 内的唯一键
  ts: number;
  /** 根包名（无则取图根节点名） */
  root: string | null;
  /** 输入来源：mod 文本 / 包名 / demo 等 */
  source: string;
  score: number;
  nodeCount: number;
  summary: { critical: number; warning: number; info: number };
  result: AnalysisResult;
}

const STORAGE_KEY = "depsight_history_v1";
const MAX_ENTRIES = 20;
// localStorage 单键上限约 5MB；条目体积超限时仅保留摘要 + 错误标记
const MAX_RESULT_CHARS = 400_000;

function safeGet(): string | null {
  try {
    return typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeSet(raw: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/** 读取全量历史（新→旧排序） */
export function loadHistory(): HistoryEntry[] {
  const raw = safeGet();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.values(parsed)
      .filter(
        (v): v is HistoryEntry =>
          !!v &&
          typeof v === "object" &&
          typeof (v as HistoryEntry).id === "string" &&
          typeof (v as HistoryEntry).ts === "number" &&
          typeof (v as HistoryEntry).result === "object",
      )
      .sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

/** 持久化历史列表（按 id 升序淘汰超限条目） */
export function saveHistory(entries: HistoryEntry[]): void {
  const map: Record<string, HistoryEntry> = {};
  let list = [...entries];
  list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (list.length > MAX_ENTRIES) list = list.slice(list.length - MAX_ENTRIES);
  for (const e of list) map[e.id] = e;
  if (!safeSet(JSON.stringify(map))) {
    // quota 超限：逐条剔除带完整 result 的旧条目直到能写入
    for (let i = 0; i < list.length && !safeSet(JSON.stringify(map)); i++) {
      const victim = list[i];
      map[victim.id] = {
        ...victim,
        result: {
          ...victim.result,
          health_scores: [],
          diagnostics: [],
          node_metas: {},
          size_offenders_top5: [],
        } as AnalysisResult,
      };
      if (JSON.stringify(map[victim.id]).length > MAX_RESULT_CHARS) {
        delete map[victim.id];
        list = list.filter((e) => e.id !== victim.id);
      }
    }
  }
}

export function removeHistoryEntry(id: string): HistoryEntry[] {
  const next = loadHistory().filter((e) => e.id !== id);
  saveHistory(next);
  return next;
}

/** 从分析结果构建历史条目（裁剪超大字段） */
export function makeEntry(
  result: AnalysisResult,
  source: string,
): HistoryEntry {
  const trimmed: AnalysisResult = {
    ...result,
    health_scores: result.health_scores ?? [],
    diagnostics: result.diagnostics ?? [],
    node_metas: result.node_metas ?? {},
    size_offenders_top5: result.size_offenders_top5 ?? [],
  };
  const raw = JSON.stringify(trimmed);
  const root = result._root_mod?.name ?? result.graph?.root_id ?? null;
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    root,
    source,
    score: result.overall_score ?? 0,
    nodeCount: result.node_count ?? 0,
    summary: result.summary ?? { critical: 0, warning: 0, info: 0 },
    result:
      raw.length > MAX_RESULT_CHARS
        ? ({
            ...trimmed,
            health_scores: [],
            node_metas: {},
            size_offenders_top5: [],
            diagnostics: trimmed.diagnostics.slice(0, 50),
          } as AnalysisResult)
        : trimmed,
  };
}

// ===== 可分享链接：#share=<deflate+base64url> =====

/** 将分析结果编码为 hash payload（UTF-8 → deflate → base64url，无 padding） */
export async function encodeSharePayload(
  result: AnalysisResult,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(result));
  const cs = new CompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 解析 #share= payload，返回分析结果；非法返回 null */
export async function decodeSharePayload(
  payload: string,
): Promise<AnalysisResult | null> {
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const text = await new Response(stream).text();
    const result = JSON.parse(text) as AnalysisResult;
    if (!result || typeof result.overall_score !== "number") return null;
    return result;
  } catch {
    return null;
  }
}
