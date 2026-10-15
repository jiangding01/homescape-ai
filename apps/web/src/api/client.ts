import {
  ApiErrorResponseSchema,
  API_V1_PREFIX,
  CommitRevisionResponseSchema,
  DESIGN_INTERPRET_PATH,
  DesignInterpretationSchema,
  ProjectDetailSchema,
  ProjectListResponseSchema,
  TimelineChangeResponseSchema,
  type CommitRevisionRequest,
  type CommitRevisionResponse,
  type CreateProjectRequest,
  type DesignCommandRequestDto,
  type DesignInterpretation,
  type ProjectDetail,
  type ProjectListResponse,
  type TimelineChangeResponse,
  type UploadSpatialModelRequest,
  type Violation,
} from '@homescape/contracts'

/** 契约包 zod schema 的结构化最小接口，避免 web 直接依赖 zod。 */
interface ResponseSchema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false }
}

export const DEFAULT_TIMEOUT_MS = 15_000
export const INTERPRET_TIMEOUT_MS = 20_000
/** 上传空间模型体量较大，放宽超时。 */
export const UPLOAD_TIMEOUT_MS = 30_000

/**
 * - network：fetch 本身失败（断网、服务未启动）
 * - timeout：超过超时时间被主动中止
 * - invalid_response：响应不是 JSON，或 JSON 不符合契约
 * - http：服务端以契约错误体返回的 4xx / 5xx
 */
export type ApiErrorKind = 'network' | 'timeout' | 'invalid_response' | 'http'

export class ApiClientError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined
  readonly code: string | undefined
  readonly violations: Violation[]
  /** 409 时服务端返回的当前 head。 */
  readonly headRevisionId: string | null | undefined

  constructor(
    kind: ApiErrorKind,
    message: string,
    details: {
      status?: number
      code?: string
      violations?: Violation[]
      headRevisionId?: string | null
    } = {},
  ) {
    super(message)
    this.name = 'ApiClientError'
    this.kind = kind
    this.status = details.status
    this.code = details.code
    this.violations = details.violations ?? []
    this.headRevisionId = details.headRevisionId
  }

  /** 提交 / 撤销 / 重做所基于的版本已落后于服务端。 */
  get isRevisionConflict() {
    return this.status === 409 && this.code === 'REVISION_CONFLICT'
  }

  /** 空间约束或领域规则不通过（422）。 */
  get isUnprocessable() {
    return this.status === 422
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ApiClientOptions {
  fetch?: FetchLike
  /** 缺省为同源（开发时由 Vite 代理到 API）。 */
  baseUrl?: string
  defaultTimeoutMs?: number
}

interface RequestOptions<T> {
  method: 'GET' | 'POST'
  path: string
  schema: ResponseSchema<T>
  body?: unknown
  timeoutMs?: number
}

export interface ApiClient {
  listProjects(): Promise<ProjectListResponse>
  getProject(projectId: string): Promise<ProjectDetail>
  createProject(request: CreateProjectRequest): Promise<ProjectDetail>
  uploadSpatialModel(
    projectId: string,
    request: UploadSpatialModelRequest,
  ): Promise<ProjectDetail>
  commitRevision(
    projectId: string,
    request: CommitRevisionRequest,
  ): Promise<CommitRevisionResponse>
  undo(projectId: string, baseRevisionId: string | null): Promise<TimelineChangeResponse>
  redo(projectId: string, baseRevisionId: string | null): Promise<TimelineChangeResponse>
  interpret(request: DesignCommandRequestDto): Promise<DesignInterpretation>
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const baseUrl = options.baseUrl ?? ''
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS

  async function request<T>({
    method,
    path,
    schema,
    body,
    timeoutMs = defaultTimeoutMs,
  }: RequestOptions<T>): Promise<T> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    let status: number
    let ok: boolean
    let text: string

    try {
      const response = await fetchImpl(baseUrl + path, {
        method,
        signal: controller.signal,
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
      status = response.status
      ok = response.ok
      // 响应体也在超时保护之内，避免服务端发完 header 后卡住。
      text = await response.text()
    } catch (error) {
      if (timedOut || isAbortError(error)) {
        throw new ApiClientError(
          'timeout',
          '请求超时（超过 ' + Math.round(timeoutMs / 1000) + ' 秒），请检查网络后重试。',
        )
      }

      throw new ApiClientError('network', '无法连接到设计服务，请检查网络后重试。')
    } finally {
      clearTimeout(timer)
    }

    let payload: unknown

    try {
      payload = JSON.parse(text)
    } catch {
      throw new ApiClientError(
        'invalid_response',
        '服务返回了无法识别的内容（HTTP ' + status + '），请稍后重试。',
        { status },
      )
    }

    if (!ok) {
      const parsedError = ApiErrorResponseSchema.safeParse(payload)

      if (!parsedError.success) {
        throw new ApiClientError('invalid_response', '请求失败（HTTP ' + status + '）。', { status })
      }

      const { code, message, violations, headRevisionId } = parsedError.data.error

      throw new ApiClientError('http', message, {
        status,
        code,
        ...(violations ? { violations } : {}),
        ...(headRevisionId !== undefined ? { headRevisionId } : {}),
      })
    }

    const parsed = schema.safeParse(payload)

    if (!parsed.success) {
      throw new ApiClientError(
        'invalid_response',
        '服务返回的数据格式不符合预期，请刷新页面后重试。',
        { status },
      )
    }

    return parsed.data
  }

  const projectPath = (projectId: string) =>
    API_V1_PREFIX + '/projects/' + encodeURIComponent(projectId)

  return {
    listProjects: () =>
      request({
        method: 'GET',
        path: API_V1_PREFIX + '/projects',
        schema: ProjectListResponseSchema,
      }),
    getProject: (projectId) =>
      request({ method: 'GET', path: projectPath(projectId), schema: ProjectDetailSchema }),
    createProject: (body) =>
      request({
        method: 'POST',
        path: API_V1_PREFIX + '/projects',
        schema: ProjectDetailSchema,
        body,
        timeoutMs: UPLOAD_TIMEOUT_MS,
      }),
    uploadSpatialModel: (projectId, body) =>
      request({
        method: 'POST',
        path: projectPath(projectId) + '/spatial-models',
        schema: ProjectDetailSchema,
        body,
        timeoutMs: UPLOAD_TIMEOUT_MS,
      }),
    commitRevision: (projectId, body) =>
      request({
        method: 'POST',
        path: projectPath(projectId) + '/revisions',
        schema: CommitRevisionResponseSchema,
        body,
      }),
    undo: (projectId, baseRevisionId) =>
      request({
        method: 'POST',
        path: projectPath(projectId) + '/undo',
        schema: TimelineChangeResponseSchema,
        body: { baseRevisionId },
      }),
    redo: (projectId, baseRevisionId) =>
      request({
        method: 'POST',
        path: projectPath(projectId) + '/redo',
        schema: TimelineChangeResponseSchema,
        body: { baseRevisionId },
      }),
    interpret: (body) =>
      request({
        method: 'POST',
        path: DESIGN_INTERPRET_PATH,
        schema: DesignInterpretationSchema,
        body,
        timeoutMs: INTERPRET_TIMEOUT_MS,
      }),
  }
}

function isAbortError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  )
}

const MAX_VIOLATIONS_SHOWN = 3

/** 面向用户的错误文案；422 附带违规原因（最多列出前几条）。 */
export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return error instanceof Error ? error.message : String(error)
  }

  const reasons = error.violations
    .filter((violation) => violation.severity === 'error')
    .slice(0, MAX_VIOLATIONS_SHOWN)
    .map((violation) => violation.message)

  if (reasons.length === 0) return error.message

  const total = error.violations.filter((violation) => violation.severity === 'error').length
  const more = total > reasons.length ? '（另有 ' + (total - reasons.length) + ' 项）' : ''

  return error.message + ' 原因：' + reasons.join('；') + more
}
