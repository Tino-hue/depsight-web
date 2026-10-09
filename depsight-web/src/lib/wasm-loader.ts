// WASM 加载器：加载 depsight.wasm（MoonBit wasm-gc + js-string builtins），失败回退纯 JS 实现
// WASM 由 d:\MoonStep\moonbit 编译产出（moon build --target wasm-gc --release），
// 开启 use-js-builtin-string 后，导出的 String 参数/返回值直接映射为 JS string：
//   JS 侧可直接调用 exports.analyze_from_context_json(jsonString: string): string
// 加载时必须传 compileOptions { builtins: ['js-string'], importedStringConstants: '_' }，
// 否则模块内 wasm:js-string 导入与 "_" 字符串常量模块无法解析。

import type { WasmInitResult } from "./types";

let wasmInstance: WebAssembly.Instance | null = null;
let useWasm = false;

// TS lib.dom 尚未内置 WebAssembly compile options 类型，这里本地声明
interface WasmCompileOptions {
  builtins?: string[];
  importedStringConstants?: string;
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
    console.log(
      "[wasm-loader] All exports:",
      exports.map((e) => `${e.name}: ${e.kind}`),
    );

    const hasAnalyze = exports.some(
      (e) => e.name === "analyze_from_context_json" && e.kind === "function",
    );
    if (!hasAnalyze) {
      console.warn(
        "[wasm-loader] analyze_from_context_json not in exports, falling back to JS",
        exports,
      );
      useWasm = false;
    } else {
      // 探测 String ABI：version() 应直接返回 JS string
      try {
        const exportsObj = wasmInstance.exports as Record<string, unknown>;
        const v = (exportsObj.version as () => unknown)?.();
        if (typeof v === "string") {
          console.log("[wasm-loader] version string:", v);
          useWasm = true;
        } else {
          console.warn(
            "[wasm-loader] version() did not return a JS string (wasm not built with use-js-builtin-string?)",
            v,
          );
          useWasm = false;
        }
      } catch (e) {
        console.warn(
          "[wasm-loader] version() call failed:",
          e instanceof Error ? e.message : String(e),
        );
        useWasm = false;
      }
    }
  } catch (e) {
    console.warn(
      "[wasm-loader] Failed to load WASM, falling back to JS:",
      e instanceof Error ? e.message : String(e),
    );
    useWasm = false;
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
  try {
    const fn = (wasmInstance.exports as Record<string, unknown>)
      .analyze_from_context_json;
    if (typeof fn !== "function") {
      console.warn("[wasm-loader] analyze_from_context_json is not a function");
      return null;
    }
    const result = (fn as (input: string) => unknown)(contextJson);
    if (typeof result === "string") {
      console.log(
        "[wasm-loader] analysis computed by WASM (analyze_from_context_json)",
      );
      return result;
    }
    console.warn("[wasm-loader] WASM returned non-string:", result);
    return null;
  } catch (e) {
    console.error("[wasm-loader] WASM call failed:", e);
    return null;
  }
}

// 调用 WASM 导出的 analyze_from_mod_text（单 moon.mod 文本，不递归依赖）
export function callWasmAnalyzeModText(modText: string): string | null {
  if (!useWasm || !wasmInstance) {
    return null;
  }
  try {
    const fn = (wasmInstance.exports as Record<string, unknown>)
      .analyze_from_mod_text;
    if (typeof fn !== "function") {
      console.warn("[wasm-loader] analyze_from_mod_text is not a function");
      return null;
    }
    const result = (fn as (input: string) => unknown)(modText);
    if (typeof result === "string") {
      console.log(
        "[wasm-loader] analysis computed by WASM (analyze_from_mod_text)",
      );
      return result;
    }
    console.warn("[wasm-loader] WASM returned non-string:", result);
    return null;
  } catch (e) {
    console.error("[wasm-loader] WASM call failed:", e);
    return null;
  }
}

export function isWasmAvailable(): boolean {
  return useWasm;
}
