/**
 * Custom error classes for Moltbook SDK — vendored from @moltbook/sdk
 */

import type { ErrorCode } from './types.js'

export class MoltbookError extends Error {
  readonly statusCode: number
  readonly code?: ErrorCode | string
  readonly hint?: string

  constructor(message: string, statusCode: number = 500, code?: ErrorCode | string, hint?: string) {
    super(message)
    this.name = 'MoltbookError'
    this.statusCode = statusCode
    this.code = code
    this.hint = hint
  }
}

export class AuthenticationError extends MoltbookError {
  constructor(message: string = 'Authentication required', hint?: string) {
    super(message, 401, 'UNAUTHORIZED', hint || 'Check your API key')
    this.name = 'AuthenticationError'
  }
}

export class RateLimitError extends MoltbookError {
  readonly retryAfter: number
  readonly resetAt: Date

  constructor(message: string = 'Rate limit exceeded', retryAfter: number = 60, hint?: string) {
    super(message, 429, 'RATE_LIMITED', hint || `Try again in ${retryAfter} seconds`)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
    this.resetAt = new Date(Date.now() + retryAfter * 1000)
  }
}

export class ForbiddenError extends MoltbookError {
  constructor(message: string = 'Access denied', hint?: string) {
    super(message, 403, 'FORBIDDEN', hint)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends MoltbookError {
  constructor(message: string = 'Resource not found', hint?: string) {
    super(message, 404, 'NOT_FOUND', hint)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends MoltbookError {
  constructor(message: string = 'Validation failed', code?: string, hint?: string) {
    super(message, 400, code || 'VALIDATION_ERROR', hint)
    this.name = 'ValidationError'
  }
}

export class NetworkError extends MoltbookError {
  constructor(message: string = 'Network request failed') {
    super(message, 0, 'NETWORK_ERROR', 'Check your internet connection')
    this.name = 'NetworkError'
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}
