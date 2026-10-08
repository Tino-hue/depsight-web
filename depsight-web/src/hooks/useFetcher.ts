// mooncakes.io 拉取 hook：封装加载状态与错误
import { useCallback, useState } from 'react'

import { fetchPackageContext } from '@/lib/fetcher'
import type { AnalysisContext } from '@/lib/types'

interface UseFetcherReturn {
  loading: boolean
  error: string | null
  fetchedCount: number
  fetchContext: (
    name: string,
    version?: string | null,
  ) => Promise<AnalysisContext | null>
  reset: () => void
}

export function useFetcher(): UseFetcherReturn {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchedCount, setFetchedCount] = useState(0)

  const fetchContext = useCallback(
    async (name: string, version?: string | null) => {
      setLoading(true)
      setError(null)
      try {
        const ctx = await fetchPackageContext(name, version ?? null)
        setFetchedCount(Object.keys(ctx.modules || {}).length + 1)
        return ctx
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return null
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const reset = useCallback(() => {
    setLoading(false)
    setError(null)
    setFetchedCount(0)
  }, [])

  return { loading, error, fetchedCount, fetchContext, reset }
}
