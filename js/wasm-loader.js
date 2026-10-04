// WASM 加载器：尝试加载 depsight.wasm，失败回退到纯 JS 实现
// WASM 文件由 MoonBit 编译产物（moonbit/depsight.wasm）提供，
// 如果不存在则使用 JS 端的 fallback analyzer（行为与 WASM API 一致）。

let wasmInstance = null;
let wasmModule = null;
let useWasm = false;

export async function initWasm() {
  try {
    const resp = await fetch('./moonbit/depsight.wasm');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const bytes = await resp.arrayBuffer();

    // MoonBit wasm-gc 编译产物是 WASI 风格，导入最少宿主函数
    const imports = buildWasiImports();
    const mod = await WebAssembly.instantiate(bytes, imports);
    wasmModule = mod.module;
    wasmInstance = mod.instance;

    // 检查导出（MoonBit wasm-gc 导出形态可能是 __moonbit_* 或 analyze_from_context_json）
    const exports = WebAssembly.Module.exports(wasmModule);
    const hasAnalyze = exports.some(e => e.name === 'analyze_from_context_json' || e.name.includes('analyze_from_context'));
    if (!hasAnalyze) {
      console.warn('[wasm-loader] analyze_from_context_json not in exports, falling back to JS', exports);
      useWasm = false;
    } else {
      useWasm = true;
      console.log('[wasm-loader] WASM loaded, exports:', exports.slice(0, 10));
    }
  } catch (e) {
    console.warn('[wasm-loader] Failed to load WASM, falling back to JS:', e.message);
    useWasm = false;
  }

  return {
    instance: wasmInstance,
    useWasm,
    status: useWasm ? 'loaded' : 'fallback',
  };
}

function buildWasiImports() {
  // 最小 WASI + 自定义宿主函数
  return {
    wasi_snapshot_preview1: {
      proc_exit: code => { throw new Error(`WASM proc_exit: ${code}`); },
      fd_write: () => 0,
      fd_close: () => 0,
      fd_seek: () => 0,
      fd_read: () => 0,
      fd_fdstat_get: () => 0,
      fd_fdstat_set_flags: () => 0,
      clock_time_get: () => 0n,
      random_get: (ptr, len) => { return 0; },
      poll_oneoff: () => 0,
      sched_yield: () => 0,
      path_open: () => 0,
      path_filestat_get: () => 0,
      path_readlink: () => 0,
      path_create_directory: () => 0,
      path_remove_directory: () => 0,
      path_unlink_file: () => 0,
      path_rename: () => 0,
      path_symlink: () => 0,
      path_link: () => 0,
      path_filestat_set_size: () => 0,
      path_filestat_set_times: () => 0,
      fd_filestat_get: () => 0,
      fd_filestat_set_size: () => 0,
      fd_filestat_set_times: () => 0,
      fd_renumber: () => 0,
      fd_advise: () => 0,
      fd_allocate: () => 0,
      fd_datasync: () => 0,
      fd_prestat_get: () => 0,
      fd_prestat_dir_name: () => 0,
      fd_readdir: () => 0,
      fd_readlink: () => 0,
      fd_filestat_get: () => 0,
      fd_filestat_set_size: () => 0,
      fd_filestat_set_times: () => 0,
      fd_renumber: () => 0,
      fd_advise: () => 0,
      fd_allocate: () => 0,
      fd_datasync: () => 0,
      fd_sync: () => 0,
      fd_tell: () => 0,
      fd_prestat_get: () => 0,
      fd_prestat_dir_name: () => 0,
      fd_readdir: () => 0,
      fd_readlink: () => 0,
      fd_filestat_get: () => 0,
      fd_filestat_set_size: () => 0,
      fd_filestat_set_times: () => 0,
      fd_renumber: () => 0,
      fd_advise: () => 0,
      fd_allocate: () => 0,
      fd_datasync: () => 0,
      fd_sync: () => 0,
      fd_tell: () => 0,
      fd_prestat_get: () => 0,
      fd_prestat_dir_name: () => 0,
      fd_readdir: () => 0,
      fd_readlink: () => 0,
    },
    // 自定义宿主函数：MoonBit 通过 externref / string 与 JS 交互
    env: {
      // 若 WASM 需要日志输出
      js_log: (ptr, len) => {
        console.log('[wasm]', ptr, len);
      },
    },
  };
}

// 调用 WASM 导出的 analyze_from_context_json
export function callWasmAnalyze(contextJson) {
  if (!useWasm || !wasmInstance) {
    return null;
  }
  try {
    const fn = wasmInstance.exports.analyze_from_context_json;
    if (typeof fn !== 'function') {
      console.warn('[wasm-loader] analyze_from_context_json is not a function');
      return null;
    }
    return fn(contextJson);
  } catch (e) {
    console.error('[wasm-loader] WASM call failed:', e);
    return null;
  }
}

export function isWasmAvailable() {
  return useWasm;
}
