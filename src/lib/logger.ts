/**
 * @fileoverview Enterprise Structured Logging System
 * @description Provides a centralized, structured logging system with support for
 * different log levels, contexts, and optional integration with external services.
 * @module lib/logger
 * @version 1.0.0
 */

// =============================================================================
// LOG TYPES
// =============================================================================

/**
 * Log severity levels following RFC 5424
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Log level priority (lower = more severe)
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/**
 * Application modules for log categorization
 */
export type LogModule =
  | 'mal-kabul'
  | 'sevkiyat'
  | 'stok-yonetimi'
  | 'siparisler'
  | 'auth'
  | 'firebase'
  | 'ocr'
  | 'barcode'
  | 'general';

/**
 * Structured log entry
 */
export interface LogEntry {
  /** Timestamp in ISO 8601 format */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Module/component that generated the log */
  module: LogModule;
  /** Log message */
  message: string;
  /** Additional structured data */
  data?: Record<string, unknown>;
  /** Error object if applicable */
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  /** User context */
  user?: {
    uid?: string;
    email?: string;
    name?: string;
  };
  /** Request/operation context */
  context?: {
    operationId?: string;
    depotId?: string;
    transactionId?: string;
    [key: string]: unknown;
  };
  /** Performance metrics */
  performance?: {
    durationMs?: number;
    memoryUsage?: number;
  };
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  minLevel: LogLevel;
  /** Whether to include stack traces */
  includeStackTrace: boolean;
  /** Whether to output to console */
  consoleOutput: boolean;
  /** Whether to output as JSON */
  jsonOutput: boolean;
  /** External log handler (e.g., for Sentry, Datadog) */
  externalHandler?: (entry: LogEntry) => void;
  /** Sensitive field names to redact */
  redactFields: string[];
}

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const defaultConfig: LoggerConfig = {
  minLevel: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  includeStackTrace: process.env.NODE_ENV !== 'production',
  consoleOutput: true,
  jsonOutput: process.env.NODE_ENV === 'production',
  redactFields: ['password', 'token', 'apiKey', 'secret', 'credential', 'authorization'],
};

// =============================================================================
// LOGGER CLASS
// =============================================================================

/**
 * Structured Logger Class
 * Provides enterprise-grade logging capabilities
 */
class Logger {
  private config: LoggerConfig;
  private userContext: LogEntry['user'] | null = null;
  private globalContext: Record<string, unknown> = {};

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Set the current user context for all subsequent logs
   */
  setUserContext(user: LogEntry['user'] | null): void {
    this.userContext = user;
  }

  /**
   * Set global context that will be included in all logs
   */
  setGlobalContext(context: Record<string, unknown>): void {
    this.globalContext = { ...this.globalContext, ...context };
  }

  /**
   * Clear global context
   */
  clearGlobalContext(): void {
    this.globalContext = {};
  }

  /**
   * Update logger configuration
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[this.config.minLevel];
  }

  /**
   * Redact sensitive fields from data
   */
  private redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const redacted = { ...data };
    const redactRecursive = (obj: Record<string, unknown>): void => {
      for (const key in obj) {
        if (this.config.redactFields.some(field =>
          key.toLowerCase().includes(field.toLowerCase())
        )) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          redactRecursive(obj[key] as Record<string, unknown>);
        }
      }
    };
    redactRecursive(redacted);
    return redacted;
  }

  /**
   * Format error for logging
   */
  private formatError(error: unknown): LogEntry['error'] | undefined {
    if (!error) return undefined;

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: this.config.includeStackTrace ? error.stack : undefined,
        code: (error as Error & { code?: string }).code,
      };
    }

    return {
      name: 'UnknownError',
      message: String(error),
    };
  }

  /**
   * Create a log entry
   */
  private createEntry(
    level: LogLevel,
    module: LogModule,
    message: string,
    options: {
      data?: Record<string, unknown>;
      error?: unknown;
      context?: LogEntry['context'];
      performance?: LogEntry['performance'];
    } = {}
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
    };

    if (options.data) {
      entry.data = this.redactSensitiveData(options.data);
    }

    if (options.error) {
      entry.error = this.formatError(options.error);
    }

    if (this.userContext) {
      entry.user = this.userContext;
    }

    if (options.context || Object.keys(this.globalContext).length > 0) {
      entry.context = { ...this.globalContext, ...options.context };
    }

    if (options.performance) {
      entry.performance = options.performance;
    }

    return entry;
  }

  /**
   * Output log entry
   */
  private output(entry: LogEntry): void {
    if (this.config.consoleOutput) {
      const consoleMethod = this.getConsoleMethod(entry.level);

      if (this.config.jsonOutput) {
        consoleMethod(JSON.stringify(entry));
      } else {
        const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}]`;
        consoleMethod(`${prefix} ${entry.message}`);

        if (entry.data) {
          consoleMethod('  Data:', entry.data);
        }
        if (entry.error) {
          consoleMethod('  Error:', entry.error);
        }
        if (entry.context) {
          consoleMethod('  Context:', entry.context);
        }
        if (entry.performance) {
          consoleMethod('  Performance:', entry.performance);
        }
      }
    }

    if (this.config.externalHandler) {
      try {
        this.config.externalHandler(entry);
      } catch (e) {
        console.error('Failed to send log to external handler:', e);
      }
    }
  }

  /**
   * Get appropriate console method for log level
   */
  private getConsoleMethod(level: LogLevel): typeof console.log {
    switch (level) {
      case 'debug':
        return console.debug.bind(console);
      case 'info':
        return console.info.bind(console);
      case 'warn':
        return console.warn.bind(console);
      case 'error':
      case 'fatal':
        return console.error.bind(console);
      default:
        return console.log.bind(console);
    }
  }

  /**
   * Log at debug level
   */
  debug(
    module: LogModule,
    message: string,
    data?: Record<string, unknown>,
    context?: LogEntry['context']
  ): void {
    if (!this.shouldLog('debug')) return;
    const entry = this.createEntry('debug', module, message, { data, context });
    this.output(entry);
  }

  /**
   * Log at info level
   */
  info(
    module: LogModule,
    message: string,
    data?: Record<string, unknown>,
    context?: LogEntry['context']
  ): void {
    if (!this.shouldLog('info')) return;
    const entry = this.createEntry('info', module, message, { data, context });
    this.output(entry);
  }

  /**
   * Log at warn level
   */
  warn(
    module: LogModule,
    message: string,
    data?: Record<string, unknown>,
    context?: LogEntry['context']
  ): void {
    if (!this.shouldLog('warn')) return;
    const entry = this.createEntry('warn', module, message, { data, context });
    this.output(entry);
  }

  /**
   * Log at error level
   */
  error(
    module: LogModule,
    message: string,
    error?: unknown,
    data?: Record<string, unknown>,
    context?: LogEntry['context']
  ): void {
    if (!this.shouldLog('error')) return;
    const entry = this.createEntry('error', module, message, { data, error, context });
    this.output(entry);
  }

  /**
   * Log at fatal level
   */
  fatal(
    module: LogModule,
    message: string,
    error?: unknown,
    data?: Record<string, unknown>,
    context?: LogEntry['context']
  ): void {
    const entry = this.createEntry('fatal', module, message, { data, error, context });
    this.output(entry);
  }

  /**
   * Log with performance metrics
   */
  performance(
    module: LogModule,
    message: string,
    durationMs: number,
    data?: Record<string, unknown>,
    context?: LogEntry['context']
  ): void {
    if (!this.shouldLog('info')) return;
    const entry = this.createEntry('info', module, message, {
      data,
      context,
      performance: { durationMs },
    });
    this.output(entry);
  }

  /**
   * Create a child logger with a fixed module
   */
  createModuleLogger(module: LogModule): ModuleLogger {
    return new ModuleLogger(this, module);
  }

  /**
   * Measure and log performance of an async operation
   */
  async measure<T>(
    module: LogModule,
    operationName: string,
    operation: () => Promise<T>,
    context?: LogEntry['context']
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await operation();
      const durationMs = performance.now() - start;
      this.performance(module, `${operationName} completed`, durationMs, undefined, context);
      return result;
    } catch (error) {
      const durationMs = performance.now() - start;
      this.error(module, `${operationName} failed after ${durationMs.toFixed(2)}ms`, error, undefined, context);
      throw error;
    }
  }
}

/**
 * Module-specific logger for convenience
 */
class ModuleLogger {
  constructor(
    private logger: Logger,
    private module: LogModule
  ) {}

  debug(message: string, data?: Record<string, unknown>, context?: LogEntry['context']): void {
    this.logger.debug(this.module, message, data, context);
  }

  info(message: string, data?: Record<string, unknown>, context?: LogEntry['context']): void {
    this.logger.info(this.module, message, data, context);
  }

  warn(message: string, data?: Record<string, unknown>, context?: LogEntry['context']): void {
    this.logger.warn(this.module, message, data, context);
  }

  error(message: string, error?: unknown, data?: Record<string, unknown>, context?: LogEntry['context']): void {
    this.logger.error(this.module, message, error, data, context);
  }

  fatal(message: string, error?: unknown, data?: Record<string, unknown>, context?: LogEntry['context']): void {
    this.logger.fatal(this.module, message, error, data, context);
  }

  performance(message: string, durationMs: number, data?: Record<string, unknown>, context?: LogEntry['context']): void {
    this.logger.performance(this.module, message, durationMs, data, context);
  }

  async measure<T>(operationName: string, operation: () => Promise<T>, context?: LogEntry['context']): Promise<T> {
    return this.logger.measure(this.module, operationName, operation, context);
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

/**
 * Global logger instance
 * Use this for application-wide logging
 */
export const logger = new Logger();

/**
 * Create a module-specific logger
 */
export function createLogger(module: LogModule): ModuleLogger {
  return logger.createModuleLogger(module);
}

// =============================================================================
// SPECIALIZED LOGGERS
// =============================================================================

/**
 * Mal Kabul module logger
 */
export const malKabulLogger = createLogger('mal-kabul');

/**
 * Auth module logger
 */
export const authLogger = createLogger('auth');

/**
 * Firebase module logger
 */
export const firebaseLogger = createLogger('firebase');

/**
 * OCR module logger
 */
export const ocrLogger = createLogger('ocr');

/**
 * Barcode module logger
 */
export const barcodeLogger = createLogger('barcode');

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}min`;
}

/**
 * Create a correlation ID for tracking related operations
 */
export function createCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}
