// WASM 加载 hook：应用启动时初始化，失败自动回退 JS
import { useEffect, useState } from 'react'

import type { WasmInitResult, WasmStatus } from '@/lib/types'
import { initWasm, onWasmDisabled } from '@/lib/wasm-loader'

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
    // 运行时被禁用（如连续失败熔断）：徽章实时切到 fallback，无需等下次刷新
    const unsubscribe = onWasmDisabled(() => {
      if (cancelled) return
      setStatus('fallback')
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return { status, useWasm: wasm?.useWasm ?? false, wasm }
}
