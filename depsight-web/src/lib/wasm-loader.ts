// WASM 加载器：加载 depsight.wasm（MoonBit wasm-gc + js-string builtins），失败回退纯 JS 实现
// WASM 由 d:\MoonStep\moonbit 编译产出（moon build --target wasm-gc --release），
// 开启 use-js-builtin-string 后，导出的 String 参数/返回值直接映射为 JS string：
//   JS 侧可直接调用 exports.analyze_from_context_json(jsonString: string): string
// 加载时必须传 compileOptions { builtins: ['js-string'], importedStringConstants: '_' }，
// 否则模块内 wasm:js-string 导入与 "_" 字符串常量模块无法解析。
//
// 桥接稳定性策略（v0.8.0-wasm 契约）：
//   1. version() 契约门：期望 0.8.x，版本不符则禁用 WASM 走 JS fallback
//      （JS fallback 与 WASM 输出契约一致，行为不分裂）
//   2. 失败可观测：getLastWasmError() 暴露最近一次失败原因
//   3. 连续失败熔断：同一会话内连续失败 >= 3 次自动禁用 WASM
//   4. 超大输入防护：context JSON > 8MB / mod 文本 > 1MB 时不进 WASM

import type { WasmInitResult } from "./types";

/** WASM 引擎契约版本（与 moonbit/main/api.mbt version() 对齐；0.8.x 引入
 *  CYCLE-001 / version_resolved / license_source / license_families /
 *  license_text 指纹 / SPDX 规范化，JS fallback 同步实现） */
const EXPECTED_WASM_VERSION_PREFIX = "0.8.";
/** context JSON 体积上限（UTF-8 字节） */
const MAX_CONTEXT_JSON_BYTES = 8 * 1024 * 1024;
/** 单 moon.mod 文本体积上限（UTF-8 字节）；上传入口与 WASM 入参共用同一上限 */
export const MAX_MOD_TEXT_BYTES = 1 * 1024 * 1024;
/** 连续失败熔断阈值 */
const MAX_CONSECUTIVE_FAILURES = 3;

let wasmInstance: WebAssembly.Instance | null = null;
let useWasm = false;
/** 最近一次失败/禁用原因（供 UI 与调试读取） */
let lastError: string | null = null;
/** 已加载 WASM 的 version() 返回值 */
let wasmVersion: string | null = null;
/** 连续失败计数（成功即清零） */
let consecutiveFailures = 0;

// TS lib.dom 尚未内置 WebAssembly compile options 类型，这里本地声明
interface WasmCompileOptions {
  builtins?: string[];
  importedStringConstants?: string;
}

/** WASM 被禁用时的监听器集合（熔断等运行时禁用需实时通知 UI 更新状态徽章） */
const disableListeners = new Set<() => void>();

/** 订阅 WASM 禁用事件，返回取消订阅函数 */
export function onWasmDisabled(cb: () => void): () => void {
  disableListeners.add(cb);
  return () => disableListeners.delete(cb);
}

/** 禁用 WASM 并记录原因（后续调用走 JS fallback） */
function disableWasm(reason: string): void {
  if (useWasm) {
    console.warn("[wasm-loader] WASM disabled:", reason);
  }
  useWasm = false;
  lastError = reason;
  // 通知订阅者（如 useWasm hook 把徽章切到 fallback）；单个回调异常不影响其他订阅者
  for (const cb of disableListeners) {
    try {
      cb();
    } catch (e) {
      console.warn("[wasm-loader] onWasmDisabled listener error:", e);
    }
  }
}

/** UTF-8 字节长度（WASM String ABI 侧按 UTF-8 编码传递） */
function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** 记录一次 WASM 调用失败；达到熔断阈值则禁用 */
function recordFailure(where: string, detail: string): void {
  consecutiveFailures += 1;
  lastError = `${where}: ${detail}`;
  console.error(`[wasm-loader] ${where} failed:`, detail);
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    disableWasm(
      `circuit breaker open after ${consecutiveFailures} consecutive failures`,
    );
  }
}

export async function initWasm(): Promise<WasmInitResult> {
  try {
    const resp = await fetch("./depsight.wasm");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const bytes = await resp.arrayBuffer();

    const compileOptions: WasmCompileOptions = {
      builtins: ["js-string"],
      importedStringConstants: "_",
    };
    // 走 bytes 重载：builtins 需在编译期声明（TS lib 尚未收录三参签名，本地断言）
    const instantiateWithOptions = WebAssembly.instantiate as unknown as (
      bytes: BufferSource,
      imports?: WebAssembly.Imports,
      options?: WasmCompileOptions,
    ) => Promise<WebAssembly.WebAssemblyInstantiatedSource>;
    // MoonBit 该模块无宿主函数导入（wasm:js-string 与 "_" 常量由引擎按 compileOptions 提供）
    const { module: mod, instance } = await instantiateWithOptions(
      bytes,
      {},
      compileOptions,
    );
    wasmInstance = instance;

    // 检查导出（应为 analyze_from_context_json / analyze_from_mod_text / version）
    const exports = WebAssembly.Module.exports(mod);
    const hasAnalyze = exports.some(
      (e) => e.name === "analyze_from_context_json" && e.kind === "function",
    );
    if (!hasAnalyze) {
      disableWasm("analyze_from_context_json not in exports");
      return {
        instance: wasmInstance,
        useWasm,
        status: useWasm ? "loaded" : "fallback",
      };
    }

    // 探测 String ABI + 版本契约：version() 应直接返回 JS string，且为 0.8.x
    try {
      const exportsObj = wasmInstance.exports as Record<string, unknown>;
      const v = (exportsObj.version as () => unknown)?.();
      if (typeof v !== "string") {
        disableWasm(
          `version() did not return a JS string (wasm not built with use-js-builtin-string?): ${String(v)}`,
        );
      } else {
        wasmVersion = v;
        if (!v.startsWith(EXPECTED_WASM_VERSION_PREFIX)) {
          // 版本不符：WASM 输出可能与 JS fallback 契约不一致，禁用走 fallback
          disableWasm(
            `version contract mismatch: expected ${EXPECTED_WASM_VERSION_PREFIX}x, got ${v}`,
          );
        } else {
          console.log("[wasm-loader] WASM ready, version:", v);
          useWasm = true;
          lastError = null;
          consecutiveFailures = 0;
        }
      }
    } catch (e) {
      disableWasm(
        `version() call failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } catch (e) {
    disableWasm(
      `failed to load WASM: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return {
    instance: wasmInstance,
    useWasm,
    status: useWasm ? "loaded" : "fallback",
  };
}

// 调用 WASM 导出的 analyze_from_context_json（String ABI：JS string 直传直取）
export function callWasmAnalyze(contextJson: string): string | null {
  if (!useWasm || !wasmInstance) {
    return null;
  }
  if (utf8Length(contextJson) > MAX_CONTEXT_JSON_BYTES) {
    // 输入超限：不进 WASM（不计入熔断，属于输入问题而非引擎故障）
    console.warn(
      `[wasm-loader] context JSON exceeds ${MAX_CONTEXT_JSON_BYTES} bytes, skipping WASM`,
    );
    return null;
  }
  try {
    const fn = (wasmInstance.exports as Record<string, unknown>)
      .analyze_from_context_json;
    if (typeof fn !== "function") {
      recordFailure("analyze_from_context_json", "export is not a function");
      return null;
    }
    const result = (fn as (input: string) => unknown)(contextJson);
    if (typeof result === "string") {
      consecutiveFailures = 0; // 成功即清零
      return result;
    }
    recordFailure(
      "analyze_from_context_json",
      `non-string result: ${String(result)}`,
    );
    return null;
  } catch (e) {
    recordFailure(
      "analyze_from_context_json",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

// 调用 WASM 导出的 analyze_from_mod_text（单 moon.mod 文本，不递归依赖）
export function callWasmAnalyzeModText(modText: string): string | null {
  if (!useWasm || !wasmInstance) {
    return null;
  }
  if (utf8Length(modText) > MAX_MOD_TEXT_BYTES) {
    console.warn(
      `[wasm-loader] mod text exceeds ${MAX_MOD_TEXT_BYTES} bytes, skipping WASM`,
    );
    return null;
  }
  try {
    const fn = (wasmInstance.exports as Record<string, unknown>)
      .analyze_from_mod_text;
    if (typeof fn !== "function") {
      recordFailure("analyze_from_mod_text", "export is not a function");
      return null;
    }
    const result = (fn as (input: string) => unknown)(modText);
    if (typeof result === "string") {
      consecutiveFailures = 0;
      return result;
    }
    recordFailure(
      "analyze_from_mod_text",
      `non-string result: ${String(result)}`,
    );
    return null;
  } catch (e) {
    recordFailure(
      "analyze_from_mod_text",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

export function isWasmAvailable(): boolean {
  return useWasm;
}

/** 最近一次 WASM 失败/禁用原因（无则 null）——供设置页与调试面板展示 */
export function getLastWasmError(): string | null {
  return lastError;
}

/** 已加载 WASM 的 version() 返回值（未加载或已禁用则 null） */
export function getWasmVersion(): string | null {
  return wasmVersion;
}
