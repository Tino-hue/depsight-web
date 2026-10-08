// WASM 加载 hook：应用启动时初始化，失败自动回退 JS
import { useEffect, useState } from 'react'

import type { WasmInitResult, WasmStatus } from '@/lib/types'
import { initWasm } from '@/lib/wasm-loader'

interface UseWasmReturn {
  status: WasmStatus
  useWasm: boolean
  wasm: WasmInitResult | null
}

export function useWasm(): UseWasmReturn {
  const [wasm, setWasm] = useState<WasmInitResult | null>(null)
  const [status, setStatus] = useState<WasmStatus>('loading')

  useEffect(() => {
    let cancelled = false
    initWasm().then((result) => {
      if (cancelled) return
      setWasm(result)
      setStatus(result.status)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { status, useWasm: wasm?.useWasm ?? false, wasm }
}
