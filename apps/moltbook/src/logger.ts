/**
 * Lightweight structured logger — no external dependencies.
 * Outputs JSON lines in production, human-readable in dev.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info'
const JSON_OUTPUT = process.env.NODE_ENV === 'production'

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL]
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void
  info(msg: string, ctx?: Record<string, unknown>): void
  warn(msg: string, ctx?: Record<string, unknown>): void
  error(msg: string, ctx?: Record<string, unknown>): void
  child(tag: string): Logger
}

function createLogger(tag: string): Logger {
  function log(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (!shouldLog(level)) return

    if (JSON_OUTPUT) {
      const entry = { ts: new Date().toISOString(), level, tag, msg, ...ctx }
      const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      out(JSON.stringify(entry))
    } else {
      const prefix = `[${tag}]`
      const extra = ctx ? ` ${JSON.stringify(ctx)}` : ''
      const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      out(`${prefix} ${msg}${extra}`)
    }
  }

  return {
    debug: (msg, ctx) => log('debug', msg, ctx),
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
    child: (childTag) => createLogger(`${tag}:${childTag}`),
  }
}

export const logger = createLogger('moltbook')

/** Helper to safely extract error message for logging context */
export function errCtx(err: unknown): { error: string } {
  return { error: formatError(err) }
}
