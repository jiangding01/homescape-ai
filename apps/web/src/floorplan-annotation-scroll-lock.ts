/**
 * Prevent wheel / trackpad gestures from scrolling the page behind the
 * full-screen annotation editor. The editor panel remains independently scrollable.
 * Restoring the precise inline values is important for Vite HMR / StrictMode cleanup.
 */
export interface ScrollLockHost {
  documentElement: { style: { overflow: string; overscrollBehavior: string } }
  body: { style: { overflow: string; overscrollBehavior: string } }
}

export function lockAnnotationBackgroundScroll(host: ScrollLockHost): () => void {
  const html = host.documentElement.style
  const body = host.body.style
  const previous = {
    htmlOverflow: html.overflow,
    bodyOverflow: body.overflow,
    htmlOverscroll: html.overscrollBehavior,
    bodyOverscroll: body.overscrollBehavior,
  }

  html.overflow = 'hidden'
  body.overflow = 'hidden'
  html.overscrollBehavior = 'none'
  body.overscrollBehavior = 'none'

  return () => {
    html.overflow = previous.htmlOverflow
    body.overflow = previous.bodyOverflow
    html.overscrollBehavior = previous.htmlOverscroll
    body.overscrollBehavior = previous.bodyOverscroll
  }
}
