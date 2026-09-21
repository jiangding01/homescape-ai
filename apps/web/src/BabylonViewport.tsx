import { BabylonSceneRenderer } from '@homescape/renderer-babylon'
import type { RenderSnapshot } from '@homescape/renderer-contract'
import { useEffect, useRef } from 'react'

export interface BabylonViewportProps {
  snapshot: RenderSnapshot
}

export function BabylonViewport({ snapshot }: BabylonViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<BabylonSceneRenderer | null>(null)
  const readyRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    const host = hostRef.current

    if (!host) return

    const renderer = new BabylonSceneRenderer()
    const ready = renderer.mount(host)

    rendererRef.current = renderer
    readyRef.current = ready

    void ready.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      host.dataset.error = message
    })

    return () => {
      rendererRef.current = null
      readyRef.current = null
      void renderer.dispose()
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    const renderer = rendererRef.current
    const ready = readyRef.current

    if (!host || !renderer || !ready) return

    let cancelled = false

    void ready
      .then(() => {
        if (cancelled) return
        return renderer.sync(snapshot)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        host.dataset.error = message
      })

    return () => {
      cancelled = true
    }
  }, [snapshot])

  return (
    <div className="viewport-host" ref={hostRef}>
      <div className="viewport-loading">正在初始化 3D Runtime…</div>
    </div>
  )
}
