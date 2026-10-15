import type { FloorPlanReviewBurdenRecord } from '@homescape/floorplan-extractor'
import { isFloorPlanDraft, type FloorPlanDraft } from '@homescape/spatial-model'

/**
 * Tiny IndexedDB wrapper that keeps one unfinished annotation draft per
 * sourceLabel (draft + Review Burden counters + uploaded source Blob), so a
 * refresh or crash does not lose hours of manual work. Every function rejects
 * on failure; callers must treat storage as best-effort.
 */

const DB_NAME = 'homescape-floorplan-annotation'
const DRAFT_STORE = 'drafts'
const IMAGE_STORE = 'images'
const DB_VERSION = 1

type EditCounts = FloorPlanReviewBurdenRecord['editCounts']

export type StoredSourceImage =
  | { kind: 'upload'; blob: Blob; widthPx: number; heightPx: number }
  | { kind: 'demo'; widthPx: number; heightPx: number }

export interface StoredAnnotationDraft {
  version: 1
  sourceLabel: string
  savedAt: number
  /** True once Ground Truth was exported; cleared by any later autosave. */
  exported: boolean
  workingDraft: FloorPlanDraft
  editCounts: EditCounts
  startedAt: number | null
  touchedRoomIds: string[]
  sourceImage: StoredSourceImage | null
}

/**
 * Row layout: the (potentially 15MB) image Blob lives in its own object store
 * so the 1s autosave only rewrites the small JSON row unless the image changed.
 */
type DraftRow = Omit<StoredAnnotationDraft, 'sourceImage'> & {
  sourceImage: { kind: 'upload' | 'demo'; widthPx: number; heightPx: number } | null
}

const requiredCountKeys = [
  'roomVertexMoves',
  'roomMetadataEdits',
  'openingGeometryEdits',
  'calibrationEdits',
  'assumptionEdits',
  'resets',
] as const

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/**
 * Validate a stored row (plus its image Blob, if any); returns null for anything
 * malformed, from another version, or whose uploaded image is missing.
 */
export function parseStoredDraft(raw: unknown, imageBlob?: unknown): StoredAnnotationDraft | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (record.version !== 1 || typeof record.sourceLabel !== 'string' || !record.sourceLabel) return null
  if (!isCount(record.savedAt) || typeof record.exported !== 'boolean') return null
  if (!isFloorPlanDraft(record.workingDraft)) return null
  const counts = record.editCounts as Record<string, unknown> | null
  if (typeof counts !== 'object' || counts === null) return null
  if (!requiredCountKeys.every((key) => isCount(counts[key]))) return null
  if (counts.roomStructureEdits !== undefined && !isCount(counts.roomStructureEdits)) return null
  if (record.startedAt !== null && !isCount(record.startedAt)) return null
  if (!Array.isArray(record.touchedRoomIds) ||
      !record.touchedRoomIds.every((id) => typeof id === 'string')) return null

  let sourceImage: StoredSourceImage | null = null
  if (record.sourceImage !== null) {
    const image = record.sourceImage as Record<string, unknown> | undefined
    if (typeof image !== 'object' || image === null ||
        !isPositive(image.widthPx) || !isPositive(image.heightPx)) return null
    if (image.kind === 'demo') {
      sourceImage = { kind: 'demo', widthPx: image.widthPx, heightPx: image.heightPx }
    } else if (image.kind === 'upload' && typeof Blob !== 'undefined' && imageBlob instanceof Blob) {
      sourceImage = { kind: 'upload', blob: imageBlob, widthPx: image.widthPx, heightPx: image.heightPx }
    } else {
      return null
    }
  }
  return {
    version: 1,
    sourceLabel: record.sourceLabel,
    savedAt: record.savedAt,
    exported: record.exported,
    workingDraft: record.workingDraft,
    editCounts: counts as unknown as EditCounts,
    startedAt: record.startedAt as number | null,
    touchedRoomIds: [...record.touchedRoomIds as string[]],
    sourceImage,
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: 'sourceLabel' })
      }
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE, { keyPath: 'sourceLabel' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'))
    request.onblocked = () => reject(new Error('IndexedDB 被其他页面占用'))
  })
}

interface Stores {
  drafts: IDBObjectStore
  images: IDBObjectStore
}

/** Run one transaction over both stores; resolves with the value set by `work` after commit. */
async function runTransaction<T>(
  mode: IDBTransactionMode,
  work: (stores: Stores, setResult: (value: T) => void) => void,
  fallback: T,
): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      let result = fallback
      const transaction = db.transaction([DRAFT_STORE, IMAGE_STORE], mode)
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'))
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务被中止'))
      work({
        drafts: transaction.objectStore(DRAFT_STORE),
        images: transaction.objectStore(IMAGE_STORE),
      }, (value) => { result = value })
    })
  } finally {
    db.close()
  }
}

/** Persist a draft. `writeImage` must be true whenever the uploaded Blob is new for this label. */
export function saveAnnotationDraft(record: StoredAnnotationDraft, writeImage: boolean): Promise<void> {
  const { sourceImage } = record
  const row: DraftRow = {
    ...record,
    sourceImage: sourceImage
      ? { kind: sourceImage.kind, widthPx: sourceImage.widthPx, heightPx: sourceImage.heightPx }
      : null,
  }
  return runTransaction<void>('readwrite', ({ drafts, images }) => {
    drafts.put(row)
    if (writeImage) {
      if (sourceImage?.kind === 'upload') images.put({ sourceLabel: record.sourceLabel, blob: sourceImage.blob })
      else images.delete(record.sourceLabel)
    }
  }, undefined)
}

/** All readable drafts, newest first. Corrupt entries are skipped. */
export async function loadAnnotationDrafts(): Promise<StoredAnnotationDraft[]> {
  const { rows, images } = await runTransaction<{ rows: unknown[]; images: Map<string, unknown> }>(
    'readonly',
    ({ drafts, images: imageStore }, setResult) => {
      const rows: unknown[] = []
      const images = new Map<string, unknown>()
      const draftRequest = drafts.getAll()
      draftRequest.onsuccess = () => { rows.push(...(draftRequest.result as unknown[])) }
      const imageRequest = imageStore.getAll()
      imageRequest.onsuccess = () => {
        for (const entry of imageRequest.result as Array<{ sourceLabel?: string; blob?: unknown }>) {
          if (typeof entry?.sourceLabel === 'string') images.set(entry.sourceLabel, entry.blob)
        }
        setResult({ rows, images })
      }
    },
    { rows: [], images: new Map() },
  )
  return rows
    .map((row) => parseStoredDraft(row, images.get((row as { sourceLabel?: string } | null)?.sourceLabel ?? '')))
    .filter((draft): draft is StoredAnnotationDraft => draft !== null)
    .sort((a, b) => b.savedAt - a.savedAt)
}

export function deleteAnnotationDraft(sourceLabel: string): Promise<void> {
  return runTransaction<void>('readwrite', ({ drafts, images }) => {
    drafts.delete(sourceLabel)
    images.delete(sourceLabel)
  }, undefined)
}

export interface TrailingThrottle {
  /** Schedule `run` (at most once per interval; always runs with the latest closure state). */
  schedule(): void
  /** Run immediately if something is pending. */
  flush(): void
  cancel(): void
}

/** Trailing-edge throttle: the first call arms a timer, further calls before it fires are coalesced. */
export function createTrailingThrottle(run: () => void, intervalMs: number): TrailingThrottle {
  let timer: ReturnType<typeof setTimeout> | null = null
  const fire = () => {
    timer = null
    run()
  }
  return {
    schedule() {
      if (timer === null) timer = setTimeout(fire, intervalMs)
    },
    flush() {
      if (timer === null) return
      clearTimeout(timer)
      fire()
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
