import { BabylonSceneRenderer } from '@homescape/renderer-babylon'
import { sampleApartment } from '@homescape/spatial-model'
import { useEffect, useRef } from 'react'

export function BabylonViewport() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current

    if (!host) return

    const renderer = new BabylonSceneRenderer()
    let disposed = false

    void renderer
      .mount(host)
      .then(() => {
        if (disposed) return

        return renderer.sync({
          spatialModel: sampleApartment,
          objects: [],
        })
      })
      .catch((error: unknown) => {
        if (disposed) return
        const message = error instanceof Error ? error.message : String(error)
        host.dataset.error = message
      })

    return () => {
      disposed = true
      void renderer.dispose()
    }
  }, [])

  return (
    <div className="viewport-host" ref={hostRef}>
      <div className="viewport-loading">正在初始化 3D Runtime…</div>
    </div>
  )
}
