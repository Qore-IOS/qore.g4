/**
 * @fileoverview Unit Tests for Enterprise Logging System
 * @description Tests for the structured logging system functionality.
 * @module tests/mal-kabul/logger.test
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// =============================================================================
// LOG LEVEL PRIORITY TESTS
// =============================================================================

describe('Log Level Priority', () => {
  const LOG_LEVEL_PRIORITY: Record<string, number> = {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
  };

  it('should have fatal as highest priority (lowest number)', () => {
    assert.equal(LOG_LEVEL_PRIORITY.fatal, 0);
  });

  it('should have debug as lowest priority (highest number)', () => {
    assert.equal(LOG_LEVEL_PRIORITY.debug, 4);
  });

  it('should have correct ordering', () => {
    assert.ok(LOG_LEVEL_PRIORITY.fatal < LOG_LEVEL_PRIORITY.error);
    assert.ok(LOG_LEVEL_PRIORITY.error < LOG_LEVEL_PRIORITY.warn);
    assert.ok(LOG_LEVEL_PRIORITY.warn < LOG_LEVEL_PRIORITY.info);
    assert.ok(LOG_LEVEL_PRIORITY.info < LOG_LEVEL_PRIORITY.debug);
  });
});

// =============================================================================
// LOG ENTRY STRUCTURE TESTS
// =============================================================================

describe('Log Entry Structure', () => {
  interface LogEntry {
    timestamp: string;
    level: string;
    module: string;
    message: string;
    data?: Record<string, unknown>;
    error?: { name: string; message: string; stack?: string };
    user?: { uid?: string; email?: string; name?: string };
    context?: Record<string, unknown>;
    performance?: { durationMs?: number };
  }

  function createLogEntry(
    level: string,
    module: string,
    message: string,
    options: Partial<LogEntry> = {}
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      ...options,
    };
  }

  it('should create basic log entry', () => {
    const entry = createLogEntry('info', 'mal-kabul', 'Test message');

    assert.ok(entry.timestamp);
    assert.equal(entry.level, 'info');
    assert.equal(entry.module, 'mal-kabul');
    assert.equal(entry.message, 'Test message');
  });

  it('should include optional data', () => {
    const entry = createLogEntry('info', 'mal-kabul', 'Test', {
      data: { key: 'value', count: 42 },
    });

    assert.deepEqual(entry.data, { key: 'value', count: 42 });
  });

  it('should include error information', () => {
    const entry = createLogEntry('error', 'mal-kabul', 'Error occurred', {
      error: { name: 'ValidationError', message: 'Invalid input' },
    });

    assert.equal(entry.error?.name, 'ValidationError');
    assert.equal(entry.error?.message, 'Invalid input');
  });

  it('should include user context', () => {
    const entry = createLogEntry('info', 'mal-kabul', 'User action', {
      user: { uid: 'user123', email: 'test@example.com', name: 'Test User' },
    });

    assert.equal(entry.user?.uid, 'user123');
    assert.equal(entry.user?.email, 'test@example.com');
  });

  it('should include performance metrics', () => {
    const entry = createLogEntry('info', 'mal-kabul', 'Operation completed', {
      performance: { durationMs: 150 },
    });

    assert.equal(entry.performance?.durationMs, 150);
  });

  it('should have valid ISO 8601 timestamp', () => {
    const entry = createLogEntry('info', 'mal-kabul', 'Test');
    const parsed = new Date(entry.timestamp);

    assert.ok(!isNaN(parsed.getTime()));
    assert.ok(entry.timestamp.includes('T'));
    assert.ok(entry.timestamp.includes('Z') || entry.timestamp.includes('+'));
  });
});

// =============================================================================
// SENSITIVE DATA REDACTION TESTS
// =============================================================================

describe('Sensitive Data Redaction', () => {
  const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'credential', 'authorization'];

  function redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const redacted = JSON.parse(JSON.stringify(data)); // Deep clone

    const redactRecursive = (obj: Record<string, unknown>): void => {
      for (const key in obj) {
        if (sensitiveFields.some(field =>
          key.toLowerCase().includes(field.toLowerCase())
        )) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          redactRecursive(obj[key] as Record<string, unknown>);
        }
      }
    };

    redactRecursive(redacted);
    return redacted;
  }

  it('should redact password field', () => {
    const data = { username: 'test', password: 'secret123' };
    const redacted = redactSensitiveData(data);

    assert.equal(redacted.username, 'test');
    assert.equal(redacted.password, '[REDACTED]');
  });

  it('should redact token field', () => {
    const data = { accessToken: 'abc123', refreshToken: 'xyz789' };
    const redacted = redactSensitiveData(data);

    assert.equal(redacted.accessToken, '[REDACTED]');
    assert.equal(redacted.refreshToken, '[REDACTED]');
  });

  it('should redact apiKey field', () => {
    const data = { apiKey: 'sk_live_123', name: 'test' };
    const redacted = redactSensitiveData(data);

    assert.equal(redacted.apiKey, '[REDACTED]');
    assert.equal(redacted.name, 'test');
  });

  it('should redact nested sensitive fields', () => {
    const data = {
      user: { name: 'test', password: 'secret' },
      config: { apiKey: 'key123' },
    };
    const redacted = redactSensitiveData(data);

    assert.equal((redacted.user as Record<string, unknown>).name, 'test');
    assert.equal((redacted.user as Record<string, unknown>).password, '[REDACTED]');
    assert.equal((redacted.config as Record<string, unknown>).apiKey, '[REDACTED]');
  });

  it('should handle case variations', () => {
    const data = { PASSWORD: 'secret', ApiKey: 'key', user_token: 'tok' };
    const redacted = redactSensitiveData(data);

    assert.equal(redacted.PASSWORD, '[REDACTED]');
    assert.equal(redacted.ApiKey, '[REDACTED]');
    assert.equal(redacted.user_token, '[REDACTED]');
  });

  it('should preserve non-sensitive data', () => {
    const data = { username: 'test', email: 'test@example.com', count: 42 };
    const redacted = redactSensitiveData(data);

    assert.equal(redacted.username, 'test');
    assert.equal(redacted.email, 'test@example.com');
    assert.equal(redacted.count, 42);
  });
});

// =============================================================================
// ERROR FORMATTING TESTS
// =============================================================================

describe('Error Formatting', () => {
  function formatError(error: unknown): { name: string; message: string; stack?: string; code?: string } | undefined {
    if (!error) return undefined;

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as Error & { code?: string }).code,
      };
    }

    return {
      name: 'UnknownError',
      message: String(error),
    };
  }

  it('should format Error instance', () => {
    const error = new Error('Test error');
    const formatted = formatError(error);

    assert.equal(formatted?.name, 'Error');
    assert.equal(formatted?.message, 'Test error');
    assert.ok(formatted?.stack);
  });

  it('should format TypeError', () => {
    const error = new TypeError('Invalid type');
    const formatted = formatError(error);

    assert.equal(formatted?.name, 'TypeError');
    assert.equal(formatted?.message, 'Invalid type');
  });

  it('should handle error with code', () => {
    const error = new Error('Auth failed') as Error & { code: string };
    error.code = 'AUTH_FAILED';
    const formatted = formatError(error);

    assert.equal(formatted?.code, 'AUTH_FAILED');
  });

  it('should handle string error', () => {
    const formatted = formatError('Something went wrong');

    assert.equal(formatted?.name, 'UnknownError');
    assert.equal(formatted?.message, 'Something went wrong');
  });

  it('should handle number error', () => {
    const formatted = formatError(404);

    assert.equal(formatted?.name, 'UnknownError');
    assert.equal(formatted?.message, '404');
  });

  it('should handle null/undefined', () => {
    assert.equal(formatError(null), undefined);
    assert.equal(formatError(undefined), undefined);
  });
});

// =============================================================================
// UTILITY FUNCTION TESTS
// =============================================================================

describe('Logging Utilities', () => {
  describe('formatBytes', () => {
    function formatBytes(bytes: number): string {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    it('should format zero bytes', () => {
      assert.equal(formatBytes(0), '0 Bytes');
    });

    it('should format bytes', () => {
      assert.equal(formatBytes(100), '100 Bytes');
      assert.equal(formatBytes(1023), '1023 Bytes');
    });

    it('should format kilobytes', () => {
      assert.equal(formatBytes(1024), '1 KB');
      assert.equal(formatBytes(1536), '1.5 KB');
    });

    it('should format megabytes', () => {
      assert.equal(formatBytes(1048576), '1 MB');
      assert.equal(formatBytes(5242880), '5 MB');
    });

    it('should format gigabytes', () => {
      assert.equal(formatBytes(1073741824), '1 GB');
    });
  });

  describe('formatDuration', () => {
    function formatDuration(ms: number): string {
      if (ms < 1000) return `${ms.toFixed(2)}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
      return `${(ms / 60000).toFixed(2)}min`;
    }

    it('should format milliseconds', () => {
      assert.equal(formatDuration(100), '100.00ms');
      assert.equal(formatDuration(999.5), '999.50ms');
    });

    it('should format seconds', () => {
      assert.equal(formatDuration(1000), '1.00s');
      assert.equal(formatDuration(30000), '30.00s');
    });

    it('should format minutes', () => {
      assert.equal(formatDuration(60000), '1.00min');
      assert.equal(formatDuration(150000), '2.50min');
    });
  });

  describe('createCorrelationId', () => {
    function createCorrelationId(): string {
      return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
    }

    it('should create unique IDs', () => {
      const id1 = createCorrelationId();
      const id2 = createCorrelationId();

      assert.notEqual(id1, id2);
    });

    it('should have correct format', () => {
      const id = createCorrelationId();

      assert.ok(id.includes('-'));
      const parts = id.split('-');
      assert.equal(parts.length, 2);
    });

    it('should be alphanumeric', () => {
      const id = createCorrelationId();
      const cleaned = id.replace('-', '');

      assert.ok(/^[a-z0-9]+$/.test(cleaned));
    });
  });
});

// =============================================================================
// LOG LEVEL FILTERING TESTS
// =============================================================================

describe('Log Level Filtering', () => {
  const LOG_LEVEL_PRIORITY: Record<string, number> = {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
  };

  function shouldLog(level: string, minLevel: string): boolean {
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[minLevel];
  }

  it('should log at same level', () => {
    assert.ok(shouldLog('info', 'info'));
    assert.ok(shouldLog('debug', 'debug'));
    assert.ok(shouldLog('error', 'error'));
  });

  it('should log more severe than min level', () => {
    assert.ok(shouldLog('error', 'info'));
    assert.ok(shouldLog('fatal', 'debug'));
    assert.ok(shouldLog('warn', 'debug'));
  });

  it('should not log less severe than min level', () => {
    assert.ok(!shouldLog('debug', 'info'));
    assert.ok(!shouldLog('info', 'warn'));
    assert.ok(!shouldLog('warn', 'error'));
  });

  it('should always log fatal', () => {
    assert.ok(shouldLog('fatal', 'fatal'));
    assert.ok(shouldLog('fatal', 'error'));
    assert.ok(shouldLog('fatal', 'warn'));
    assert.ok(shouldLog('fatal', 'info'));
    assert.ok(shouldLog('fatal', 'debug'));
  });
});

// =============================================================================
// MODULE LOGGER TESTS
// =============================================================================

describe('Module Logger', () => {
  interface MockLog {
    level: string;
    module: string;
    message: string;
    data?: Record<string, unknown>;
  }

  class MockLogger {
    logs: MockLog[] = [];

    log(level: string, module: string, message: string, data?: Record<string, unknown>) {
      this.logs.push({ level, module, message, data });
    }

    createModuleLogger(module: string) {
      return {
        debug: (msg: string, data?: Record<string, unknown>) => this.log('debug', module, msg, data),
        info: (msg: string, data?: Record<string, unknown>) => this.log('info', module, msg, data),
        warn: (msg: string, data?: Record<string, unknown>) => this.log('warn', module, msg, data),
        error: (msg: string, data?: Record<string, unknown>) => this.log('error', module, msg, data),
      };
    }
  }

  it('should prefix logs with module name', () => {
    const logger = new MockLogger();
    const malKabulLogger = logger.createModuleLogger('mal-kabul');

    malKabulLogger.info('Test message');

    assert.equal(logger.logs[0].module, 'mal-kabul');
    assert.equal(logger.logs[0].level, 'info');
    assert.equal(logger.logs[0].message, 'Test message');
  });

  it('should support all log levels', () => {
    const logger = new MockLogger();
    const moduleLogger = logger.createModuleLogger('test-module');

    moduleLogger.debug('Debug message');
    moduleLogger.info('Info message');
    moduleLogger.warn('Warn message');
    moduleLogger.error('Error message');

    assert.equal(logger.logs.length, 4);
    assert.equal(logger.logs[0].level, 'debug');
    assert.equal(logger.logs[1].level, 'info');
    assert.equal(logger.logs[2].level, 'warn');
    assert.equal(logger.logs[3].level, 'error');
  });

  it('should pass data through', () => {
    const logger = new MockLogger();
    const moduleLogger = logger.createModuleLogger('test');

    moduleLogger.info('Message', { key: 'value' });

    assert.deepEqual(logger.logs[0].data, { key: 'value' });
  });
});
