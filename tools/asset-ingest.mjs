#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import process from 'node:process'

const GLB_MAGIC = 0x46546c67
const GLB_JSON_CHUNK = 0x4e4f534a
const GLB_BIN_CHUNK = 0x004e4942
const KTX2_SIGNATURE = [
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32,
  0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]
const TRIANGLE_MODES = new Set([4, 5, 6])
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6,
  0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function fail(message) {
  process.stderr.write(message + '\n')
  process.exitCode = 1
}

function parseArgs(argv) {
  const args = [...argv]
  const manifestPath = args.shift()

  if (!manifestPath || manifestPath.startsWith('-')) {
    throw new Error(
      '用法：node tools/asset-ingest.mjs <manifest.json> [--check] [--out <dir>]',
    )
  }

  let checkOnly = false
  let outputDir

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--check') {
      checkOnly = true
      continue
    }

    if (arg === '--out') {
      const value = args.shift()
      if (!value) throw new Error('--out 缺少目录')
      outputDir = value
      continue
    }

    throw new Error('未知参数：' + arg)
  }

  if (checkOnly && outputDir) {
    throw new Error('--check 与 --out 不能同时使用')
  }

  if (!checkOnly && !outputDir) {
    throw new Error('非 --check 模式必须提供 --out <dir>')
  }

  return {
    manifestPath: resolve(process.cwd(), manifestPath),
    checkOnly,
    outputDir: outputDir ? resolve(process.cwd(), outputDir) : undefined,
  }
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined
}

function positiveFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(label + ' 必须为正数')
  }
  return value
}

function nonNegativeFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(label + ' 必须为非负数')
  }
  return value
}

function integer(value, label) {
  if (!Number.isInteger(value)) {
    throw new Error(label + ' 必须为整数')
  }
  return value
}

function safeReleaseSegment(value, label) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 128 ||
    !/^[a-zA-Z0-9._-]+$/.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new Error(
      label +
        ' 只能包含 1~128 位字母、数字、点、下划线和短横线，且不能是 . / ..',
    )
  }
  return value
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(label + ' 必须是 boolean')
  }
  return value
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(label + ' 不能为空')
  }
  return value
}

function validateBaseUri(value) {
  if (
    typeof value !== 'string' ||
    value.includes('?') ||
    value.includes('#') ||
    (!value.startsWith('https://') &&
      !(value.startsWith('/') && !value.startsWith('//')))
  ) {
    throw new Error(
      'catalogBaseUri 必须是无 query/hash 的 HTTPS URL 或站内绝对路径',
    )
  }

  return value.replace(/\/$/, '')
}

function validatePolicy(value) {
  const policy = asRecord(value)
  if (!policy) throw new Error('policy 格式无效')

  const maxTrianglesByLod = asRecord(policy.maxTrianglesByLod)
  const maxFileBytesByLod = asRecord(policy.maxFileBytesByLod)

  if (!maxTrianglesByLod || !maxFileBytesByLod) {
    throw new Error(
      'policy.maxTrianglesByLod / maxFileBytesByLod 必须存在',
    )
  }

  const normalizeBudget = (record, label) => {
    const result = {}

    for (const level of [0, 1, 2]) {
      const raw = record[String(level)]
      if (raw === undefined) {
        throw new Error(label + '.' + level + ' 必须配置')
      }
      result[level] = integer(
        positiveFinite(raw, label + '.' + level),
        label + '.' + level,
      )
    }

    return result
  }

  return {
    maxDimensionErrorRatio: nonNegativeFinite(
      policy.maxDimensionErrorRatio,
      'policy.maxDimensionErrorRatio',
    ),
    pivotToleranceMeters: nonNegativeFinite(
      policy.pivotToleranceMeters,
      'policy.pivotToleranceMeters',
    ),
    maxTrianglesByLod: normalizeBudget(
      maxTrianglesByLod,
      'policy.maxTrianglesByLod',
    ),
    maxFileBytesByLod: normalizeBudget(
      maxFileBytesByLod,
      'policy.maxFileBytesByLod',
    ),
    maxTextureEdge: integer(
      positiveFinite(policy.maxTextureEdge, 'policy.maxTextureEdge'),
      'policy.maxTextureEdge',
    ),
    requireMeshopt: booleanValue(
      policy.requireMeshopt,
      'policy.requireMeshopt',
    ),
    requireKtx2: booleanValue(
      policy.requireKtx2,
      'policy.requireKtx2',
    ),
    requireSelfContainedGlb: booleanValue(
      policy.requireSelfContainedGlb,
      'policy.requireSelfContainedGlb',
    ),
  }
}

function validateDimensions(value, label) {
  const record = asRecord(value)
  if (!record) throw new Error(label + ' 格式无效')

  return {
    width: positiveFinite(record.width, label + '.width'),
    height: positiveFinite(record.height, label + '.height'),
    depth: positiveFinite(record.depth, label + '.depth'),
  }
}

function validateManifest(value) {
  const manifest = asRecord(value)

  if (!manifest || manifest.schemaVersion !== '0.1.0') {
    throw new Error('只支持 Asset Ingestion Manifest v0.1.0')
  }

  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error('manifest.assets 至少需要一个资产')
  }

  const ids = new Set()
  const skus = new Set()
  const assets = manifest.assets.map((rawAsset, assetIndex) => {
    const asset = asRecord(rawAsset)
    if (!asset) throw new Error('assets[' + assetIndex + '] 格式无效')

    const catalogAssetId = safeReleaseSegment(
      asset.catalogAssetId,
      'assets[' + assetIndex + '].catalogAssetId',
    )
    const sku = nonEmptyString(
      asset.sku,
      'assets[' + assetIndex + '].sku',
    )

    if (ids.has(catalogAssetId)) {
      throw new Error('catalogAssetId 重复：' + catalogAssetId)
    }
    if (skus.has(sku)) {
      throw new Error('sku 重复：' + sku)
    }
    ids.add(catalogAssetId)
    skus.add(sku)

    if (!Array.isArray(asset.lods) || asset.lods.length === 0) {
      throw new Error(sku + ' 至少需要一个 LOD')
    }

    const levels = new Set()
    const lods = asset.lods.map((rawLod, lodIndex) => {
      const lod = asRecord(rawLod)
      if (!lod) throw new Error(sku + ' LOD[' + lodIndex + '] 格式无效')

      const level = integer(lod.level, sku + '.lods[' + lodIndex + '].level')
      if (![0, 1, 2].includes(level)) {
        throw new Error(sku + ' 的 LOD level 只能是 0 / 1 / 2')
      }
      if (levels.has(level)) {
        throw new Error(sku + ' 的 LOD level 重复：' + level)
      }
      levels.add(level)

      if (typeof lod.sourcePath !== 'string' || !lod.sourcePath.trim()) {
        throw new Error(sku + ' 的 LOD sourcePath 不能为空')
      }

      return {
        level,
        sourcePath: lod.sourcePath,
      }
    })

    if (!levels.has(0)) {
      throw new Error(sku + ' 必须提供 LOD0')
    }

    return {
      catalogAssetId,
      sku,
      expectedDimensions: validateDimensions(
        asset.expectedDimensions,
        sku + '.expectedDimensions',
      ),
      lods,
    }
  })

  return {
    schemaVersion: '0.1.0',
    releaseVersion: safeReleaseSegment(
      manifest.releaseVersion,
      'releaseVersion',
    ),
    sourceRoot: nonEmptyString(manifest.sourceRoot, 'sourceRoot'),
    catalogBaseUri: validateBaseUri(manifest.catalogBaseUri),
    policy: validatePolicy(manifest.policy),
    assets,
  }
}

function issue(severity, code, message, lodLevel) {
  return {
    severity,
    code,
    message,
    ...(lodLevel !== undefined ? { lodLevel } : {}),
  }
}

function isDataUri(uri) {
  return uri.startsWith('data:')
}

function isRemoteUri(uri) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(uri) || uri.startsWith('//')
}

async function assertPathWithinRoot(rootPath, targetPath, label) {
  const [realRoot, realTarget] = await Promise.all([
    realpath(rootPath),
    realpath(targetPath),
  ])
  const rel = relative(realRoot, realTarget)

  if (rel === '..' || rel.startsWith('..' + sep)) {
    throw new Error(label + ' 越过允许目录')
  }

  return realTarget
}

async function resolveSourcePath(
  manifestPath,
  sourceRoot,
  sourcePath,
) {
  const root = resolve(dirname(manifestPath), sourceRoot)
  const target = resolve(root, sourcePath)

  return assertPathWithinRoot(
    root,
    target,
    'sourcePath ' + sourcePath,
  )
}

async function resolveLocalResource(modelPath, uri) {
  if (isDataUri(uri)) return undefined

  if (isRemoteUri(uri) || uri.startsWith('/')) {
    throw new Error('模型包含非本地资源引用：' + uri)
  }

  const clean = decodeURIComponent(uri.split(/[?#]/, 1)[0] ?? '')
  const root = dirname(modelPath)
  const target = resolve(root, clean)

  return assertPathWithinRoot(
    root,
    target,
    '模型资源 ' + uri,
  )
}

function decodeDataUri(uri) {
  const comma = uri.indexOf(',')
  if (comma < 0) throw new Error('非法 data URI')

  const meta = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)

  return meta.endsWith(';base64')
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
}

function parseGlb(buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error('GLB Header 无效')
  }

  if (buffer.readUInt32LE(4) !== 2) {
    throw new Error('只支持 GLB 2.0')
  }

  const declaredLength = buffer.readUInt32LE(8)
  if (declaredLength !== buffer.length) {
    throw new Error('GLB declared length 与文件大小不一致')
  }

  let offset = 12
  let json
  let binary

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + length

    if (end > buffer.length) {
      throw new Error('GLB Chunk 越界')
    }

    if (type === GLB_JSON_CHUNK) {
      json = JSON.parse(
        buffer
          .subarray(start, end)
          .toString('utf8')
          .replace(/\u0000+$/g, '')
          .trim(),
      )
    } else if (type === GLB_BIN_CHUNK && binary === undefined) {
      binary = buffer.subarray(start, end)
    }

    offset = end
  }

  if (!json) throw new Error('GLB 缺少 JSON Chunk')

  return { json, binary }
}

async function loadModel(modelPath) {
  const bytes = await readFile(modelPath)
  const extension = extname(modelPath).toLowerCase()

  if (extension === '.gltf') {
    return {
      format: 'gltf',
      json: JSON.parse(bytes.toString('utf8')),
      bytes,
      binary: undefined,
    }
  }

  if (extension === '.glb') {
    const parsed = parseGlb(bytes)
    return {
      format: 'glb',
      json: parsed.json,
      bytes,
      binary: parsed.binary,
    }
  }

  throw new Error('Runtime Ingestion 仅接受 .gltf / .glb：' + modelPath)
}

function identityMatrix() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]
}

function multiplyMatrix(a, b) {
  const out = new Array(16).fill(0)

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0

      for (let k = 0; k < 4; k += 1) {
        value += a[k * 4 + row] * b[column * 4 + k]
      }

      out[column * 4 + row] = value
    }
  }

  return out
}

function finiteTuple(value, length, fallback, label) {
  if (value === undefined) return fallback

  if (
    !Array.isArray(value) ||
    value.length !== length ||
    !value.every(
      (entry) => typeof entry === 'number' && Number.isFinite(entry),
    )
  ) {
    throw new Error(label + ' 必须是 ' + length + ' 维有限数值数组')
  }

  return value
}

function nodeMatrix(node) {
  if (node.matrix !== undefined) {
    const matrix = finiteTuple(
      node.matrix,
      16,
      identityMatrix(),
      'node.matrix',
    )
    return [...matrix]
  }

  const translation = finiteTuple(
    node.translation,
    3,
    [0, 0, 0],
    'node.translation',
  )
  const rotation = finiteTuple(
    node.rotation,
    4,
    [0, 0, 0, 1],
    'node.rotation',
  )
  const scale = finiteTuple(
    node.scale,
    3,
    [1, 1, 1],
    'node.scale',
  )

  const rotationLength = Math.hypot(...rotation)
  if (rotationLength <= 1e-8) {
    throw new Error('node.rotation 不能是零四元数')
  }

  const [x, y, z, w] = rotation.map(
    (entry) => entry / rotationLength,
  )
  const [sx, sy, sz] = scale
  const [tx, ty, tz] = translation

  const xx = x * x
  const yy = y * y
  const zz = z * z
  const xy = x * y
  const xz = x * z
  const yz = y * z
  const wx = w * x
  const wy = w * y
  const wz = w * z

  return [
    (1 - 2 * (yy + zz)) * sx,
    (2 * (xy + wz)) * sx,
    (2 * (xz - wy)) * sx,
    0,
    (2 * (xy - wz)) * sy,
    (1 - 2 * (xx + zz)) * sy,
    (2 * (yz + wx)) * sy,
    0,
    (2 * (xz + wy)) * sz,
    (2 * (yz - wx)) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ]
}

function transformPoint(matrix, point) {
  const [x, y, z] = point

  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ]
}

function expandBounds(bounds, point) {
  for (let axis = 0; axis < 3; axis += 1) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis])
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis])
  }
}

function accessorBounds(gltf, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex]

  if (
    !accessor ||
    !Array.isArray(accessor.min) ||
    !Array.isArray(accessor.max) ||
    accessor.min.length < 3 ||
    accessor.max.length < 3
  ) {
    return undefined
  }

  return {
    min: accessor.min.slice(0, 3).map(Number),
    max: accessor.max.slice(0, 3).map(Number),
  }
}

function meshBounds(gltf) {
  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : []
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : []
  const children = new Set()

  for (const node of nodes) {
    for (const child of node.children ?? []) children.add(child)
  }

  const sceneIndex =
    Number.isInteger(gltf.scene) && gltf.scenes?.[gltf.scene]
      ? gltf.scene
      : 0
  const sceneRoots = gltf.scenes?.[sceneIndex]?.nodes
  const roots = Array.isArray(sceneRoots)
    ? sceneRoots
    : nodes
        .map((_, index) => index)
        .filter((index) => !children.has(index))

  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  }
  let positionedPrimitiveCount = 0
  const visiting = new Set()

  const visit = (nodeIndex, parentMatrix) => {
    if (visiting.has(nodeIndex)) {
      throw new Error('glTF Node Graph 存在循环：' + nodeIndex)
    }

    const node = nodes[nodeIndex]
    if (!node) throw new Error('glTF Node 不存在：' + nodeIndex)

    visiting.add(nodeIndex)
    const world = multiplyMatrix(parentMatrix, nodeMatrix(node))

    if (Number.isInteger(node.mesh)) {
      const mesh = meshes[node.mesh]

      if (!mesh) throw new Error('glTF Mesh 不存在：' + node.mesh)

      for (const primitive of mesh.primitives ?? []) {
        const positionAccessor = primitive.attributes?.POSITION
        if (!Number.isInteger(positionAccessor)) continue

        const localBounds = accessorBounds(gltf, positionAccessor)
        if (!localBounds) {
          throw new Error(
            'POSITION accessor 缺少 min/max，无法执行 Geometry QA',
          )
        }

        for (const x of [localBounds.min[0], localBounds.max[0]]) {
          for (const y of [localBounds.min[1], localBounds.max[1]]) {
            for (const z of [localBounds.min[2], localBounds.max[2]]) {
              expandBounds(bounds, transformPoint(world, [x, y, z]))
            }
          }
        }

        positionedPrimitiveCount += 1
      }
    }

    for (const child of node.children ?? []) visit(child, world)
    visiting.delete(nodeIndex)
  }

  for (const root of roots) visit(root, identityMatrix())

  if (
    positionedPrimitiveCount === 0 ||
    !bounds.min.every(Number.isFinite) ||
    !bounds.max.every(Number.isFinite)
  ) {
    throw new Error('模型没有可用于 QA 的 POSITION Bounds')
  }

  return {
    min: bounds.min,
    max: bounds.max,
    dimensions: {
      width: bounds.max[0] - bounds.min[0],
      height: bounds.max[1] - bounds.min[1],
      depth: bounds.max[2] - bounds.min[2],
    },
  }
}

function triangleCount(gltf) {
  let count = 0
  let primitiveCount = 0
  let unsupportedPrimitiveCount = 0

  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      primitiveCount += 1
      const mode = primitive.mode ?? 4

      if (!TRIANGLE_MODES.has(mode)) {
        unsupportedPrimitiveCount += 1
        continue
      }

      const accessorIndex = Number.isInteger(primitive.indices)
        ? primitive.indices
        : primitive.attributes?.POSITION
      const accessor = gltf.accessors?.[accessorIndex]
      const vertexCount = accessor?.count

      if (!Number.isInteger(vertexCount) || vertexCount < 0) continue

      if (mode === 4) count += Math.floor(vertexCount / 3)
      else count += Math.max(0, vertexCount - 2)
    }
  }

  return { count, primitiveCount, unsupportedPrimitiveCount }
}

function morphTargetCount(gltf) {
  let total = 0

  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      total += Array.isArray(primitive.targets)
        ? primitive.targets.length
        : 0
    }
  }

  return total
}

function localResourceUris(gltf) {
  const uris = new Set()

  for (const buffer of gltf.buffers ?? []) {
    if (
      typeof buffer.uri === 'string' &&
      !isDataUri(buffer.uri)
    ) {
      uris.add(buffer.uri)
    }
  }

  for (const image of gltf.images ?? []) {
    if (
      typeof image.uri === 'string' &&
      !isDataUri(image.uri)
    ) {
      uris.add(image.uri)
    }
  }

  return [...uris]
}

async function readBufferResource(modelPath, gltf, glbBinary, index) {
  const buffer = gltf.buffers?.[index]
  if (!buffer) throw new Error('glTF Buffer 不存在：' + index)

  if (typeof buffer.uri === 'string') {
    if (isDataUri(buffer.uri)) return decodeDataUri(buffer.uri)

    const resource = await resolveLocalResource(modelPath, buffer.uri)
    if (!resource) throw new Error('无法解析 Buffer URI')
    return readFile(resource)
  }

  if (index === 0 && glbBinary) return glbBinary

  throw new Error('Buffer 缺少 URI 且 GLB BIN Chunk 不可用')
}

async function imageBytes(modelPath, gltf, glbBinary, image) {
  if (typeof image.uri === 'string') {
    if (isDataUri(image.uri)) return decodeDataUri(image.uri)

    const resource = await resolveLocalResource(modelPath, image.uri)
    if (!resource) throw new Error('无法解析 Image URI')
    return readFile(resource)
  }

  if (Number.isInteger(image.bufferView)) {
    const view = gltf.bufferViews?.[image.bufferView]
    if (!view) throw new Error('Image bufferView 不存在')

    const source = await readBufferResource(
      modelPath,
      gltf,
      glbBinary,
      view.buffer ?? 0,
    )
    const start = view.byteOffset ?? 0
    const end = start + view.byteLength

    if (start < 0 || end > source.length) {
      throw new Error('Image bufferView 越界')
    }

    return source.subarray(start, end)
  }

  throw new Error('Image 缺少 uri / bufferView')
}

function hasSignature(bytes, signature) {
  if (bytes.length < signature.length) return false

  return signature.every((value, index) => bytes[index] === value)
}

function imageDimensions(bytes) {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes.toString('ascii', 1, 4) === 'PNG'
  ) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    }
  }

  if (hasSignature(bytes, KTX2_SIGNATURE) && bytes.length >= 28) {
    return {
      width: bytes.readUInt32LE(20),
      height: bytes.readUInt32LE(24),
    }
  }

  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8
  ) {
    let offset = 2

    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }

      const marker = bytes[offset + 1]
      if (marker === 0xd9 || marker === 0xda) break

      const length = bytes.readUInt16BE(offset + 2)
      if (length < 2 || offset + 2 + length > bytes.length) break

      if (JPEG_SOF_MARKERS.has(marker)) {
        return {
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7),
        }
      }

      offset += 2 + length
    }
  }

  return undefined
}

async function textureReport(modelPath, gltf, glbBinary) {
  let maxTextureEdge = 0
  let unknownDimensions = 0

  for (const image of gltf.images ?? []) {
    try {
      const bytes = await imageBytes(
        modelPath,
        gltf,
        glbBinary,
        image,
      )
      const dimensions = imageDimensions(bytes)

      if (!dimensions) {
        unknownDimensions += 1
        continue
      }

      maxTextureEdge = Math.max(
        maxTextureEdge,
        dimensions.width,
        dimensions.height,
      )
    } catch {
      unknownDimensions += 1
    }
  }

  return {
    maxTextureEdge:
      (gltf.images?.length ?? 0) > 0 && maxTextureEdge > 0
        ? maxTextureEdge
        : undefined,
    unknownDimensions,
  }
}

function compressionReport(gltf) {
  const usesMeshopt = (gltf.bufferViews ?? []).some(
    (view) =>
      asRecord(view.extensions)?.EXT_meshopt_compression !== undefined,
  )
  const usesKtx2 =
    (gltf.textures ?? []).some(
      (texture) =>
        asRecord(texture.extensions)?.KHR_texture_basisu !== undefined,
    ) ||
    (gltf.images ?? []).some(
      (image) =>
        image.mimeType === 'image/ktx2' ||
        (typeof image.uri === 'string' &&
          image.uri.toLowerCase().split(/[?#]/, 1)[0].endsWith('.ktx2')),
    )

  return { usesMeshopt, usesKtx2 }
}

function usesDracoCompression(gltf) {
  if ((gltf.extensionsRequired ?? []).includes('KHR_draco_mesh_compression')) {
    return true
  }

  return (gltf.meshes ?? []).some((mesh) =>
    (mesh.primitives ?? []).some(
      (primitive) =>
        asRecord(primitive.extensions)?.KHR_draco_mesh_compression !==
        undefined,
    ),
  )
}

function dimensionIssues(bounds, expected, policy, level) {
  const issues = []
  const checks = [
    ['width', bounds.dimensions.width, expected.width],
    ['height', bounds.dimensions.height, expected.height],
    ['depth', bounds.dimensions.depth, expected.depth],
  ]

  for (const [name, actual, target] of checks) {
    const ratio = Math.abs(actual - target) / target

    if (ratio > policy.maxDimensionErrorRatio) {
      issues.push(
        issue(
          'error',
          'asset.dimension_mismatch',
          name +
            ' 实际=' +
            actual.toFixed(4) +
            'm，Catalog=' +
            target.toFixed(4) +
            'm，误差=' +
            (ratio * 100).toFixed(2) +
            '%',
          level,
        ),
      )
    }
  }

  const centerX = (bounds.min[0] + bounds.max[0]) / 2
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2
  const floorY = bounds.min[1]

  if (
    Math.abs(centerX) > policy.pivotToleranceMeters ||
    Math.abs(centerZ) > policy.pivotToleranceMeters ||
    Math.abs(floorY) > policy.pivotToleranceMeters
  ) {
    issues.push(
      issue(
        'error',
        'asset.pivot_not_floor_center',
        'Pivot QA 未通过：centerX=' +
          centerX.toFixed(4) +
          'm, floorY=' +
          floorY.toFixed(4) +
          'm, centerZ=' +
          centerZ.toFixed(4) +
          'm',
        level,
      ),
    )
  }

  return issues
}

async function inspectLod(
  manifestPath,
  asset,
  lod,
  policy,
  baseUri,
  releaseVersion,
  sourceRoot,
) {
  const sourcePath = await resolveSourcePath(
    manifestPath,
    sourceRoot,
    lod.sourcePath,
  )
  const loaded = await loadModel(sourcePath)
  const gltf = loaded.json
  const issues = []

  if (gltf.asset?.version !== '2.0') {
    issues.push(
      issue(
        'error',
        'asset.gltf_version_unsupported',
        '只支持 glTF 2.0',
        lod.level,
      ),
    )
  }

  const externalUris = localResourceUris(gltf)

  for (const uri of externalUris) {
    try {
      await resolveLocalResource(sourcePath, uri)
    } catch (error) {
      issues.push(
        issue(
          'error',
          'asset.external_resource_unsafe',
          error instanceof Error ? error.message : String(error),
          lod.level,
        ),
      )
    }
  }

  if (
    policy.requireSelfContainedGlb &&
    (loaded.format !== 'glb' || externalUris.length > 0)
  ) {
    issues.push(
      issue(
        'error',
        'asset.self_contained_glb_required',
        '生产策略要求自包含 GLB，当前 format=' +
          loaded.format +
          ' externalResources=' +
          externalUris.length,
        lod.level,
      ),
    )
  }

  let bounds
  try {
    bounds = meshBounds(gltf)
    issues.push(
      ...dimensionIssues(
        bounds,
        asset.expectedDimensions,
        policy,
        lod.level,
      ),
    )
  } catch (error) {
    issues.push(
      issue(
        'error',
        'asset.bounds_unavailable',
        error instanceof Error ? error.message : String(error),
        lod.level,
      ),
    )
  }

  const triangles = triangleCount(gltf)
  const compression = compressionReport(gltf)

  if (usesDracoCompression(gltf)) {
    issues.push(
      issue(
        'error',
        'asset.draco_not_allowed',
        '当前 Production Pipeline 只接受 Meshopt，不允许 Draco',
        lod.level,
      ),
    )
  }
  const textures = await textureReport(
    sourcePath,
    gltf,
    loaded.binary,
  )
  const bytes = loaded.bytes.length
  const triangleBudget = policy.maxTrianglesByLod[lod.level]
  const byteBudget = policy.maxFileBytesByLod[lod.level]

  if (
    triangleBudget !== undefined &&
    triangles.count > triangleBudget
  ) {
    issues.push(
      issue(
        'error',
        'asset.triangle_budget_exceeded',
        'Triangles=' +
          triangles.count +
          '，预算=' +
          triangleBudget,
        lod.level,
      ),
    )
  }

  if (byteBudget !== undefined && bytes > byteBudget) {
    issues.push(
      issue(
        'error',
        'asset.file_budget_exceeded',
        'File bytes=' + bytes + '，预算=' + byteBudget,
        lod.level,
      ),
    )
  }

  if (triangles.unsupportedPrimitiveCount > 0) {
    issues.push(
      issue(
        'warning',
        'asset.non_triangle_primitive',
        '存在 ' +
          triangles.unsupportedPrimitiveCount +
          ' 个非三角形 Primitive',
        lod.level,
      ),
    )
  }

  if (textures.unknownDimensions > 0) {
    issues.push(
      issue(
        'error',
        'asset.texture_dimensions_unknown',
        '有 ' +
          textures.unknownDimensions +
          ' 张纹理无法确认尺寸',
        lod.level,
      ),
    )
  }

  if (
    textures.maxTextureEdge !== undefined &&
    textures.maxTextureEdge > policy.maxTextureEdge
  ) {
    issues.push(
      issue(
        'error',
        'asset.texture_budget_exceeded',
        '最大纹理边=' +
          textures.maxTextureEdge +
          '，预算=' +
          policy.maxTextureEdge,
        lod.level,
      ),
    )
  }

  if (policy.requireMeshopt && !compression.usesMeshopt) {
    issues.push(
      issue(
        'error',
        'asset.meshopt_required',
        '生产策略要求 EXT_meshopt_compression',
        lod.level,
      ),
    )
  }

  if (
    policy.requireKtx2 &&
    (gltf.images?.length ?? 0) > 0 &&
    !compression.usesKtx2
  ) {
    issues.push(
      issue(
        'error',
        'asset.ktx2_required',
        '存在纹理时生产策略要求 KTX2 / KHR_texture_basisu',
        lod.level,
      ),
    )
  }

  if ((gltf.animations?.length ?? 0) > 0) {
    issues.push(
      issue(
        'error',
        'asset.animation_not_allowed',
        '家具生产资产不允许包含 Animation',
        lod.level,
      ),
    )
  }

  if ((gltf.skins?.length ?? 0) > 0) {
    issues.push(
      issue(
        'error',
        'asset.skin_not_allowed',
        '家具生产资产不允许包含 Skin',
        lod.level,
      ),
    )
  }

  const morphTargets = morphTargetCount(gltf)

  if (morphTargets > 0) {
    issues.push(
      issue(
        'error',
        'asset.morph_target_not_allowed',
        '家具生产资产不允许包含 Morph Target',
        lod.level,
      ),
    )
  }

  const publishFileName = 'model.' + loaded.format
  const uri =
    baseUri +
    '/' +
    asset.catalogAssetId +
    '/' +
    releaseVersion +
    '/lod' +
    lod.level +
    '/' +
    publishFileName

  return {
    sourcePath,
    publishFileName,
    format: loaded.format,
    gltf,
    localResources: externalUris,
    issues,
    releaseLod: {
      level: lod.level,
      uri,
      format: loaded.format,
      byteSize: bytes,
      contentHash:
        'sha256:' +
        createHash('sha256').update(loaded.bytes).digest('hex'),
      geometry: {
        ...(bounds ? { bounds } : {}),
        meshCount: gltf.meshes?.length ?? 0,
        primitiveCount: triangles.primitiveCount,
        triangleCount: triangles.count,
        materialCount: gltf.materials?.length ?? 0,
        textureCount: gltf.images?.length ?? 0,
        ...(textures.maxTextureEdge !== undefined
          ? { maxTextureEdge: textures.maxTextureEdge }
          : {}),
        animationCount: gltf.animations?.length ?? 0,
        skinCount: gltf.skins?.length ?? 0,
        morphTargetCount: morphTargets,
        usesMeshopt: compression.usesMeshopt,
        usesKtx2: compression.usesKtx2,
        externalResourceCount: externalUris.length,
      },
    },
  }
}

async function copyBundle(outputDir, asset, releaseVersion, inspected) {
  const destination = join(
    outputDir,
    asset.catalogAssetId,
    releaseVersion,
    'lod' + inspected.releaseLod.level,
  )
  await mkdir(destination, { recursive: true })
  await copyFile(
    inspected.sourcePath,
    join(destination, inspected.publishFileName),
  )

  for (const uri of inspected.localResources) {
    const source = await resolveLocalResource(
      inspected.sourcePath,
      uri,
    )
    if (!source) continue

    const clean = decodeURIComponent(uri.split(/[?#]/, 1)[0] ?? '')
    const target = join(destination, clean)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
  }
}

async function inspectAsset(
  manifestPath,
  asset,
  manifest,
) {
  const inspectedLods = []

  for (const lod of [...asset.lods].sort((a, b) => a.level - b.level)) {
    inspectedLods.push(
      await inspectLod(
        manifestPath,
        asset,
        lod,
        manifest.policy,
        manifest.catalogBaseUri,
        manifest.releaseVersion,
        manifest.sourceRoot,
      ),
    )
  }

  for (let index = 1; index < inspectedLods.length; index += 1) {
    const previous = inspectedLods[index - 1]
    const current = inspectedLods[index]

    if (
      previous &&
      current &&
      current.releaseLod.geometry.triangleCount >
        previous.releaseLod.geometry.triangleCount
    ) {
      current.issues.push(
        issue(
          'error',
          'asset.lod_triangle_order_invalid',
          'LOD' +
            current.releaseLod.level +
            ' triangle 数不能高于前一级 LOD',
          current.releaseLod.level,
        ),
      )
    }
  }

  const issues = inspectedLods.flatMap((lod) => lod.issues)
  const blocked = issues.some((entry) => entry.severity === 'error')
  const lods = inspectedLods.map((lod) => lod.releaseLod)

  const renderAsset = blocked
    ? undefined
    : {
        version: manifest.releaseVersion,
        unit: 'meter',
        coordinateSystem: 'right-handed-y-up',
        pivot: 'floor-center',
        lods: lods.map((lod) => ({
          level: lod.level,
          uri: lod.uri,
          format: lod.format,
          byteSize: lod.byteSize,
          contentHash: lod.contentHash,
        })),
        compression: {
          meshopt: lods.every(
            (lod) => lod.geometry.usesMeshopt,
          ),
          ktx2: lods.every(
            (lod) =>
              lod.geometry.textureCount === 0 ||
              lod.geometry.usesKtx2,
          ),
          draco: false,
        },
      }

  return {
    asset,
    inspectedLods,
    record: {
      catalogAssetId: asset.catalogAssetId,
      sku: asset.sku,
      status: blocked ? 'blocked' : 'ready',
      expectedDimensions: asset.expectedDimensions,
      issues,
      lods,
      ...(renderAsset ? { renderAsset } : {}),
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifestRaw = JSON.parse(
    await readFile(args.manifestPath, 'utf8'),
  )
  const manifest = validateManifest(manifestRaw)
  const inspectedAssets = []

  for (const asset of manifest.assets) {
    try {
      inspectedAssets.push(
        await inspectAsset(
          args.manifestPath,
          asset,
          manifest,
        ),
      )
    } catch (error) {
      inspectedAssets.push({
        asset,
        inspectedLods: [],
        record: {
          catalogAssetId: asset.catalogAssetId,
          sku: asset.sku,
          status: 'blocked',
          expectedDimensions: asset.expectedDimensions,
          issues: [
            issue(
              'error',
              'asset.ingestion_failed',
              error instanceof Error ? error.message : String(error),
            ),
          ],
          lods: [],
        },
      })
    }
  }

  const assets = inspectedAssets.map((entry) => entry.record)
  const blocked = assets.some((asset) => asset.status === 'blocked')

  if (!blocked && !args.checkOnly && args.outputDir) {
    for (const entry of inspectedAssets) {
      for (const inspected of entry.inspectedLods) {
        await copyBundle(
          args.outputDir,
          entry.asset,
          manifest.releaseVersion,
          inspected,
        )
      }
    }
  }
  const release = {
    schemaVersion: '0.1.0',
    releaseVersion: manifest.releaseVersion,
    generatedAt: new Date().toISOString(),
    policy: manifest.policy,
    status: blocked ? 'blocked' : 'ready',
    assets,
  }

  const output = JSON.stringify(release, null, 2) + '\n'

  if (!args.checkOnly && args.outputDir) {
    await mkdir(args.outputDir, { recursive: true })
    await writeFile(
      join(
        args.outputDir,
        blocked
          ? 'asset-release.blocked.json'
          : 'asset-release.json',
      ),
      output,
      'utf8',
    )
  }

  process.stdout.write(output)

  if (blocked) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error))
})
