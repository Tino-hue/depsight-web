// WASM 加载器：尝试加载 depsight.wasm，失败回退到纯 JS 实现
// WASM 文件由 MoonBit 编译产物（public/depsight.wasm）提供，
// 如果不存在则使用 JS 端的 fallback analyzer（行为与 WASM API 一致）。
// 从 js/wasm-loader.js 迁移

import type { WasmInitResult } from './types'

let wasmInstance: WebAssembly.Instance | null = null
let wasmModule: WebAssembly.Module | null = null
let useWasm = false

export async function initWasm(): Promise<WasmInitResult> {
  try {
    const resp = await fetch('./depsight.wasm')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const bytes = await resp.arrayBuffer()

    // MoonBit wasm-gc 编译产物是 WASI 风格，导入最少宿主函数
    const imports = buildWasiImports()
    const mod = await WebAssembly.instantiate(bytes, imports)
    wasmModule = mod.module
    wasmInstance = mod.instance

    // 检查导出（MoonBit wasm-gc 导出形态可能是 __moonbit_* 或 analyze_from_context_json）
    const exports = WebAssembly.Module.exports(wasmModule)
    console.log(
      '[wasm-loader] All exports:',
      exports.map((e) => `${e.name}: ${e.kind}`),
    )

    const hasAnalyze = exports.some(
      (e) =>
        e.name === 'analyze_from_context_json_bytes' ||
        e.name.includes('analyze_from_context'),
    )
    if (!hasAnalyze) {
      console.warn(
        '[wasm-loader] analyze_from_context_json not in exports, falling back to JS',
        exports,
      )
      useWasm = false
    } else {
      // 尝试调用 version_bytes() 测试 Bytes ABI
      try {
        const exportsObj = wasmInstance.exports as Record<string, unknown>
        const v = (exportsObj.version_bytes as () => unknown)()
        console.log(
          '[wasm-loader] version_bytes() returned:',
          v,
          typeof v,
          v instanceof Uint8Array,
        )
        if (v instanceof Uint8Array) {
          const decoder = new TextDecoder()
          console.log('[wasm-loader] version string:', decoder.decode(v))
          useWasm = true
        } else {
          console.warn(
            '[wasm-loader] version_bytes() did not return Uint8Array',
          )
          useWasm = false
        }
      } catch (e) {
        console.warn(
          '[wasm-loader] version_bytes() call failed:',
          e instanceof Error ? e.message : String(e),
        )
        useWasm = false
      }
    }
  } catch (e) {
    console.warn(
      '[wasm-loader] Failed to load WASM, falling back to JS:',
      e instanceof Error ? e.message : String(e),
    )
    useWasm = false
  }

  return {
    instance: wasmInstance,
    useWasm,
    status: useWasm ? 'loaded' : 'fallback',
  }
}

function buildWasiImports(): WebAssembly.Imports {
  // 最小 WASI + 自定义宿主函数
  const noop = () => 0
  return {
    wasi_snapshot_preview1: {
      proc_exit: (code: number) => {
        throw new Error(`WASM proc_exit: ${code}`)
      },
      fd_write: noop,
      fd_close: noop,
      fd_seek: noop,
      fd_read: noop,
      fd_fdstat_get: noop,
      fd_fdstat_set_flags: noop,
      clock_time_get: () => 0n,
      random_get: () => 0,
      poll_oneoff: noop,
      sched_yield: noop,
      path_open: noop,
      path_filestat_get: noop,
      path_readlink: noop,
      path_create_directory: noop,
      path_remove_directory: noop,
      path_unlink_file: noop,
      path_rename: noop,
      path_symlink: noop,
      path_link: noop,
      path_filestat_set_size: noop,
      path_filestat_set_times: noop,
      fd_filestat_get: noop,
      fd_filestat_set_size: noop,
      fd_filestat_set_times: noop,
      fd_renumber: noop,
      fd_advise: noop,
      fd_allocate: noop,
      fd_datasync: noop,
      fd_prestat_get: noop,
      fd_prestat_dir_name: noop,
      fd_readdir: noop,
      fd_readlink: noop,
      fd_sync: noop,
      fd_tell: noop,
    },
    // 自定义宿主函数：MoonBit 通过 externref / string 与 JS 交互
    env: {
      js_log: (ptr: unknown, len: unknown) => {
        console.log('[wasm]', ptr, len)
      },
    },
  }
}

// 调用 WASM 导出的 analyze_from_context_json_bytes
export function callWasmAnalyze(contextJson: string): string | null {
  if (!useWasm || !wasmInstance) {
    return null
  }
  try {
    const fn = (
      wasmInstance.exports as Record<string, unknown>
    ).analyze_from_context_json_bytes
    if (typeof fn !== 'function') {
      console.warn(
        '[wasm-loader] analyze_from_context_json_bytes is not a function',
      )
      return null
    }
    // 将 JS string 转为 Uint8Array
    const encoder = new TextEncoder()
    const inputBytes = encoder.encode(contextJson)
    const resultBytes = (fn as (input: Uint8Array) => unknown)(inputBytes)
    // 将返回的 Uint8Array 转回 JS string
    if (resultBytes instanceof Uint8Array) {
      const decoder = new TextDecoder()
      return decoder.decode(resultBytes)
    }
    console.warn('[wasm-loader] WASM returned non-Uint8Array:', resultBytes)
    return null
  } catch (e) {
    console.error('[wasm-loader] WASM call failed:', e)
    return null
  }
}

export function isWasmAvailable(): boolean {
  return useWasm
}
