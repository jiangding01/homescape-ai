import type { ApiError, ApiErrorCode } from '@homescape/contracts'

type ApiErrorExtra = Omit<ApiError, 'code' | 'message'>

/** 业务层抛出的 HTTP 错误，由全局错误处理器转换为统一的中文错误响应。 */
export class ApiHttpError extends Error {
  readonly statusCode: number
  readonly code: ApiErrorCode
  readonly extra: ApiErrorExtra

  constructor(statusCode: number, code: ApiErrorCode, message: string, extra: ApiErrorExtra = {}) {
    super(message)
    this.name = 'ApiHttpError'
    this.statusCode = statusCode
    this.code = code
    this.extra = extra
  }

  toResponse(): { error: ApiError } {
    return { error: { code: this.code, message: this.message, ...this.extra } }
  }
}
