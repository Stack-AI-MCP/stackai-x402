/**
 * HTTP Client for Moltbook API — vendored from @moltbook/sdk
 */

import type { RequestConfig, RateLimitInfo, ApiErrorResponse } from './types.js'
import { MoltbookError, AuthenticationError, RateLimitError, NotFoundError, ValidationError, ForbiddenError, NetworkError } from './errors.js'

export { ForbiddenError } from './errors.js'

const DEFAULT_BASE_URL = 'https://www.moltbook.com/api/v1'
const DEFAULT_TIMEOUT = 30_000
const DEFAULT_RETRIES = 3
const DEFAULT_RETRY_DELAY = 1_000

export interface HttpClientConfig {
  apiKey?: string
  baseUrl?: string
  timeout?: number
  retries?: number
  retryDelay?: number
  headers?: Record<string, string>
}

export class HttpClient {
  private apiKey?: string
  private baseUrl: string
  private timeout: number
  private retries: number
  private retryDelay: number
  private customHeaders: Record<string, string>
  private rateLimitInfo: RateLimitInfo | null = null

  constructor(config: HttpClientConfig = {}) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL
    this.timeout = config.timeout || DEFAULT_TIMEOUT
    this.retries = config.retries ?? DEFAULT_RETRIES
    this.retryDelay = config.retryDelay || DEFAULT_RETRY_DELAY
    this.customHeaders = config.headers || {}
  }

  setApiKey(apiKey: string): void { this.apiKey = apiKey }
  getRateLimitInfo(): RateLimitInfo | null { return this.rateLimitInfo }

  private buildHeaders(additionalHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.customHeaders,
      ...additionalHeaders,
    }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`
    return headers
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    // Concatenate base path + resource path (new URL drops base path for absolute paths)
    const base = this.baseUrl.replace(/\/+$/, '')
    const suffix = path.startsWith('/') ? path : `/${path}`
    const url = new URL(`${base}${suffix}`)
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.append(key, String(value))
      }
    }
    return url.toString()
  }

  private parseRateLimitHeaders(headers: Headers): void {
    const limit = headers.get('X-RateLimit-Limit')
    const remaining = headers.get('X-RateLimit-Remaining')
    const reset = headers.get('X-RateLimit-Reset')
    if (limit && remaining && reset) {
      this.rateLimitInfo = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        resetAt: new Date(parseInt(reset, 10) * 1000),
      }
    }
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: ApiErrorResponse
    try { errorData = await response.json() as ApiErrorResponse } catch { errorData = { success: false, error: `HTTP ${response.status}: ${response.statusText}` } }
    const message = errorData.error || 'Unknown error'
    const hint = errorData.hint
    switch (response.status) {
      case 401: throw new AuthenticationError(message, hint)
      case 403: throw new ForbiddenError(message, hint)
      case 404: throw new NotFoundError(message, hint)
      case 429: throw new RateLimitError(message, errorData.retryAfter || 60, hint)
      case 400: throw new ValidationError(message, errorData.code, hint)
      default: throw new MoltbookError(message, response.status, errorData.code, hint)
    }
  }

  private shouldRetry(error: unknown, attempt: number): boolean {
    if (attempt >= this.retries) return false
    if (error instanceof MoltbookError && error.statusCode >= 400 && error.statusCode < 500) return error instanceof RateLimitError
    return error instanceof NetworkError || (error instanceof MoltbookError && error.statusCode >= 500)
  }

  private getRetryDelay(attempt: number, error?: unknown): number {
    if (error instanceof RateLimitError) return error.retryAfter * 1000
    return this.retryDelay * Math.pow(2, attempt)
  }

  private sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)) }

  async request<T>(config: RequestConfig): Promise<T> {
    const url = this.buildUrl(config.path, config.query)
    const headers = this.buildHeaders(config.headers)
    let lastError: unknown
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.timeout)
        const startMs = Date.now()
        const response = await fetch(url, {
          method: config.method,
          headers,
          body: config.body ? JSON.stringify(config.body) : undefined,
          signal: controller.signal,
        })
        const responseTimeMs = Date.now() - startMs
        clearTimeout(timeoutId)
        this.parseRateLimitHeaders(response.headers)
        if (!response.ok) {
          // Log 403 diagnostics before throwing
          if (response.status === 403 || response.status === 401) {
            const layer = responseTimeMs < 100 ? 'edge'
              : responseTimeMs < 500 ? 'challenge'
              : 'application'
            console.error(`[moltbook:sdk] ${response.status} ${layer} block (${responseTimeMs}ms) ${config.method} ${config.path}`)
          }
          await this.handleErrorResponse(response)
        }
        return await response.json() as T
      } catch (error) {
        lastError = error
        if (error instanceof TypeError && error.message.includes('fetch')) lastError = new NetworkError('Network request failed')
        if (!this.shouldRetry(lastError, attempt)) throw lastError
        await this.sleep(this.getRetryDelay(attempt, lastError))
      }
    }
    throw lastError
  }

  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> { return this.request<T>({ method: 'GET', path, query }) }
  async post<T>(path: string, body?: unknown): Promise<T> { return this.request<T>({ method: 'POST', path, body }) }
  async patch<T>(path: string, body?: unknown): Promise<T> { return this.request<T>({ method: 'PATCH', path, body }) }
  async delete<T>(path: string): Promise<T> { return this.request<T>({ method: 'DELETE', path }) }
}
