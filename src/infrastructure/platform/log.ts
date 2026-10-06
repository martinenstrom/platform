/**
 * The desktop's diagnostic log: what the application did and what refused,
 * as events with codes — never a client's name, a note, a passphrase or a
 * key. Bounded on disk (one file of at most a megabyte, three kept), one
 * JSON line per event so a support reading can be filtered with any tool.
 *
 * Redaction is by field name, not by trust: any field whose name says it
 * carries words — a name, a note, text, a statement, a title — or a secret
 * is replaced before it is written, whatever the caller passed. A stack
 * trace is written only when asked for in the environment; by default an
 * error is its name and its message.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogFields {
  [key: string]: unknown
}

export interface Logger {
  readonly path: string | null
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
  error(event: string, error?: unknown, fields?: LogFields): void
}

export interface LoggerOptions {
  /** Bytes a file may reach before it is rotated. */
  maxBytes?: number
  /** Rotated files kept beside the live one. */
  keep?: number
  now?: () => Date
  /** Stack traces in error events; off unless `FINANCIAL_OS_LOG_STACKS=1`. */
  stacks?: boolean
}

export const LOG_FILE = 'financial-os.log'
const DEFAULT_MAX_BYTES = 1_000_000
const DEFAULT_KEEP = 3
const MAX_STRING = 200
const MAX_DEPTH = 3

/** A field name that carries a person's words or a secret. */
const SENSITIVE =
  /name|note|text|statement|title|email|phone|address|passphrase|password|secret|token|key$|apikey|content|body|question|answer|transcript|line/iu

/** The same event, without what it must not carry. */
export function redactFields(fields: LogFields, depth = 0): LogFields {
  const out: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE.test(key)) {
      out[key] = '[redacted]'
      continue
    }
    out[key] = redactValue(value, depth)
  }
  return out
}

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string')
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[nested]'
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactValue(v, depth + 1))
  return redactFields(value as LogFields, depth + 1)
}

/** An error as the log carries it: its name and its message, the stack only when asked for. */
export function describeError(error: unknown, stacks = false): LogFields {
  if (error instanceof Error) {
    const described: LogFields = { name: error.name, message: error.message }
    if ('code' in error && typeof (error as { code?: unknown }).code === 'string')
      described['code'] = (error as { code: string }).code
    if (stacks && error.stack) described['stack'] = error.stack
    return described
  }
  return { name: 'Error', message: String(error) }
}

class FileLogger implements Logger {
  readonly path: string
  private readonly maxBytes: number
  private readonly keep: number
  private readonly now: () => Date
  private readonly stacks: boolean

  constructor(directory: string, options: LoggerOptions) {
    mkdirSync(directory, { recursive: true })
    this.path = join(directory, LOG_FILE)
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.keep = options.keep ?? DEFAULT_KEEP
    this.now = options.now ?? (() => new Date())
    this.stacks = options.stacks ?? process.env.FINANCIAL_OS_LOG_STACKS?.trim() === '1'
  }

  info(event: string, fields: LogFields = {}): void {
    this.write('info', event, fields)
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write('warn', event, fields)
  }

  error(event: string, error?: unknown, fields: LogFields = {}): void {
    this.write('error', event, fields, error === undefined ? undefined : describeError(error, this.stacks))
  }

  /* The caller's fields are redacted; an error's own description — its name, its message — stands as described. */
  private write(level: LogLevel, event: string, fields: LogFields, error?: LogFields): void {
    const line = JSON.stringify({
      at: this.now().toISOString(),
      level,
      event,
      ...redactFields(fields),
      ...(error ? { error } : {}),
    })
    try {
      this.rotateIfNeeded(Buffer.byteLength(line) + 1)
      appendFileSync(this.path, `${line}\n`)
    } catch {
      /* a log that cannot be written never stops the application */
    }
  }

  private rotateIfNeeded(incoming: number): void {
    if (!existsSync(this.path)) return
    if (statSync(this.path).size + incoming <= this.maxBytes) return
    const rotated = (n: number) => `${this.path}.${n}`
    if (existsSync(rotated(this.keep))) unlinkSync(rotated(this.keep))
    for (let n = this.keep - 1; n >= 1; n -= 1) {
      if (existsSync(rotated(n))) renameSync(rotated(n), rotated(n + 1))
    }
    renameSync(this.path, rotated(1))
  }
}

/** Where no directory is configured — development on the synthetic record — refusals still reach the console. */
class ConsoleLogger implements Logger {
  readonly path = null
  info(): void {
    /* quiet */
  }
  warn(event: string, fields: LogFields = {}): void {
    console.warn(`[financial-os] ${event}`, redactFields(fields))
  }
  error(event: string, error?: unknown, fields: LogFields = {}): void {
    console.error(`[financial-os] ${event}`, {
      ...redactFields(fields),
      ...(error === undefined ? {} : { error: describeError(error) }),
    })
  }
}

export function createLogger(directory: string, options: LoggerOptions = {}): Logger {
  return new FileLogger(directory, options)
}

/* The process's one logger, on `globalThis` like the other process-wide singletons. */
const LOGGER_KEY = Symbol.for('financial-os:logger')
const registry = globalThis as unknown as { [LOGGER_KEY]?: Logger }

/** Point the process's log at a directory; `null` returns to the console. */
export function configureLogger(directory: string | null, options: LoggerOptions = {}): Logger {
  const instance = directory ? new FileLogger(directory, options) : new ConsoleLogger()
  registry[LOGGER_KEY] = instance
  return instance
}

export function logger(): Logger {
  return registry[LOGGER_KEY] ?? (registry[LOGGER_KEY] = new ConsoleLogger())
}
