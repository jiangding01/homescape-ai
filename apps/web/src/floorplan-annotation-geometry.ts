import type { PixelPoint } from '@homescape/spatial-model'

export interface AnnotationViewport {
  x: number
  y: number
  width: number
  height: number
}

export const fullViewport = (width: number, height: number): AnnotationViewport =>
  ({ x: 0, y: 0, width, height })

export function clampViewport(view: AnnotationViewport, width: number, height: number): AnnotationViewport {
  const w = Math.min(width, Math.max(width / 8, view.width))
  const h = w * height / width
  return {
    x: Math.max(0, Math.min(width - w, view.x)),
    y: Math.max(0, Math.min(height - h, view.y)),
    width: w,
    height: h,
  }
}

export function zoomViewport(current: AnnotationViewport, factor: number, width: number, height: number) {
  const newWidth = Math.min(width, Math.max(width / 8, current.width / factor))
  const newHeight = newWidth * height / width
  return clampViewport({
    x: current.x + (current.width - newWidth) / 2,
    y: current.y + (current.height - newHeight) / 2,
    width: newWidth,
    height: newHeight,
  }, width, height)
}

export function orthogonalPoint(previous: PixelPoint, target: PixelPoint): PixelPoint {
  return Math.abs(target[0] - previous[0]) >= Math.abs(target[1] - previous[1])
    ? [target[0], previous[1]]
    : [previous[0], target[1]]
}

export const orthogonalEdge = (a: PixelPoint, b: PixelPoint) =>
  Math.abs(a[0] - b[0]) <= 1 || Math.abs(a[1] - b[1]) <= 1

export const clickNearStart = (a: PixelPoint, b: PixelPoint, zoom: number) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) <= Math.max(3, 18 / zoom)
