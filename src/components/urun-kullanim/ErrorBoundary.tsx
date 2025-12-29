/**
 * @fileoverview Error Boundary Component for Product Usage Panel
 * @description Enterprise-grade error boundary with logging, recovery options,
 * and user-friendly error display for the Product Usage panel.
 * @module components/urun-kullanim/ErrorBoundary
 * @version 1.0.0
 */

'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, Bug, PackageMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { urunKullanimLogger } from '@/lib/logger';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Props for the ErrorBoundary component
 */
interface ErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Fallback component to render on error */
  fallback?: ReactNode;
  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Whether to show technical details */
  showDetails?: boolean;
  /** Custom error message */
  errorMessage?: string;
  /** Component name for logging */
  componentName?: string;
}

/**
 * State for the ErrorBoundary component
 */
interface ErrorBoundaryState {
  /** Whether an error has occurred */
  hasError: boolean;
  /** The error that occurred */
  error: Error | null;
  /** React error info */
  errorInfo: ErrorInfo | null;
  /** Unique error ID for support */
  errorId: string | null;
  /** Whether retry is in progress */
  isRetrying: boolean;
}

// =============================================================================
// ERROR BOUNDARY COMPONENT
// =============================================================================

/**
 * Product Usage Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs the error, and displays a fallback UI.
 *
 * @example
 * ```tsx
 * <UrunKullanimErrorBoundary componentName="UsagePanel">
 *   <UrunKullanimPanel />
 * </UrunKullanimErrorBoundary>
 * ```
 */
export class UrunKullanimErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
      isRetrying: false,
    };
  }

  /**
   * Derive error state from caught error
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      errorId: `UK-ERR-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
    };
  }

  /**
   * Log error when caught
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { onError, componentName = 'Unknown' } = this.props;

    // Log to structured logger
    urunKullanimLogger.error(
      'Component error caught by ErrorBoundary',
      error,
      {
        componentName,
        componentStack: errorInfo.componentStack,
        errorId: this.state.errorId,
      },
      {
        operationId: this.state.errorId || undefined,
      }
    );

    this.setState({ errorInfo });

    if (onError) {
      onError(error, errorInfo);
    }
  }

  /**
   * Handle retry action
   */
  handleRetry = (): void => {
    this.setState({ isRetrying: true });

    urunKullanimLogger.info('User initiated error recovery', {
      errorId: this.state.errorId,
      componentName: this.props.componentName,
    });

    setTimeout(() => {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        errorId: null,
        isRetrying: false,
      });
    }, 500);
  };

  /**
   * Handle navigation to home
   */
  handleGoHome = (): void => {
    urunKullanimLogger.info('User navigated to home after error', {
      errorId: this.state.errorId,
    });
    window.location.href = '/';
  };

  /**
   * Handle navigation back to usage panel
   */
  handleGoToUsage = (): void => {
    urunKullanimLogger.info('User navigated to usage panel after error', {
      errorId: this.state.errorId,
    });
    window.location.href = '/urun-kullanim';
  };

  /**
   * Render error UI or children
   */
  render(): ReactNode {
    const { hasError, error, errorInfo, errorId, isRetrying } = this.state;
    const { children, fallback, showDetails = false, errorMessage } = this.props;

    if (hasError) {
      if (fallback) {
        return fallback;
      }

      return (
        <div
          className="flex items-center justify-center min-h-[400px] p-6"
          role="alert"
          aria-live="assertive"
          aria-label="Hata mesajı"
        >
          <Card className="max-w-lg w-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-destructive/10 rounded-full">
                  <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-xl">Kullanım Kaydı Hatası</CardTitle>
                  <CardDescription>
                    {errorMessage || 'Ürün kullanım işlemi sırasında beklenmedik bir hata oluştu.'}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <Bug className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Hata Detayı</AlertTitle>
                <AlertDescription className="font-mono text-sm">
                  {error?.message || 'Bilinmeyen hata'}
                </AlertDescription>
              </Alert>

              {errorId && (
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium">Hata Kodu:</span>{' '}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs select-all">{errorId}</code>
                  <p className="text-xs mt-1">Destek ekibine iletirken bu kodu paylaşın.</p>
                </div>
              )}

              {showDetails && errorInfo?.componentStack && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    Teknik Detaylar (Geliştiriciler İçin)
                  </summary>
                  <pre className="mt-2 p-3 bg-muted rounded-md text-xs overflow-auto max-h-40 font-mono">
                    {errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </CardContent>

            <CardFooter className="flex flex-wrap gap-3">
              <Button
                onClick={this.handleRetry}
                disabled={isRetrying}
                className="flex-1 min-w-[120px]"
                aria-label="Sayfayı yeniden yükle"
              >
                {isRetrying ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Yenileniyor...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                    Tekrar Dene
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={this.handleGoToUsage}
                aria-label="Kullanım paneline git"
              >
                <PackageMinus className="mr-2 h-4 w-4" aria-hidden="true" />
                Kullanım
              </Button>
              <Button
                variant="ghost"
                onClick={this.handleGoHome}
                aria-label="Ana sayfaya git"
              >
                <Home className="mr-2 h-4 w-4" aria-hidden="true" />
                Ana Sayfa
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return children;
  }
}

// =============================================================================
// HOOK FOR FUNCTIONAL COMPONENTS
// =============================================================================

/**
 * Custom hook for error handling in functional components
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { handleError, clearError, error } = useUsageErrorHandler('MyComponent');
 *
 *   const doConsumption = async () => {
 *     try {
 *       await recordConsumption(item);
 *     } catch (e) {
 *       handleError(e, { labId: 'xxx', stokKodu: 'yyy' });
 *     }
 *   };
 * }
 * ```
 */
export function useUsageErrorHandler(componentName: string) {
  const [error, setError] = React.useState<Error | null>(null);

  const handleError = React.useCallback(
    (err: unknown, context?: Record<string, unknown>) => {
      const error = err instanceof Error ? err : new Error(String(err));

      urunKullanimLogger.error(
        `Error in ${componentName}`,
        error,
        { componentName, ...context }
      );

      setError(error);
    },
    [componentName]
  );

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  return {
    error,
    handleError,
    clearError,
    hasError: error !== null,
  };
}

// =============================================================================
// ASYNC ERROR UTILITIES
// =============================================================================

/**
 * Safely execute an async consumption operation with error handling
 *
 * @example
 * ```ts
 * const result = await safeConsumptionAsync(
 *   () => recordConsumption(item),
 *   'recordConsumption',
 *   { retries: 2, context: { labId } }
 * );
 *
 * if (result.success) {
 *   toast({ title: 'Stoktan düşüldü' });
 * } else {
 *   toast({ title: 'Hata', description: result.error.message, variant: 'destructive' });
 * }
 * ```
 */
export async function safeConsumptionAsync<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: {
    retries?: number;
    retryDelay?: number;
    context?: Record<string, unknown>;
  } = {}
): Promise<{ success: true; data: T } | { success: false; error: Error }> {
  const { retries = 0, retryDelay = 1000, context } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const startTime = performance.now();
      const data = await operation();
      const duration = performance.now() - startTime;

      urunKullanimLogger.performance(
        `${operationName} completed successfully`,
        duration,
        { attempt, ...context }
      );

      return { success: true, data };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      urunKullanimLogger.warn(
        `${operationName} failed (attempt ${attempt + 1}/${retries + 1})`,
        { error: lastError.message, attempt, ...context }
      );

      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
      }
    }
  }

  urunKullanimLogger.error(
    `${operationName} failed after ${retries + 1} attempts`,
    lastError,
    context
  );

  return { success: false, error: lastError! };
}

/**
 * Wrap a function with usage-specific error handling and logging
 */
export function withUsageErrorHandling<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  operationName: string
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const startTime = performance.now();

    try {
      const result = await fn(...args);
      const duration = performance.now() - startTime;

      urunKullanimLogger.debug(
        `${operationName} completed`,
        { durationMs: duration.toFixed(2) }
      );

      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const duration = performance.now() - startTime;

      urunKullanimLogger.error(
        `${operationName} failed after ${duration.toFixed(2)}ms`,
        error,
        { operationName }
      );

      throw error;
    }
  };
}

// =============================================================================
// CONSUMPTION SPECIFIC ERROR TYPES
// =============================================================================

/**
 * Consumption-specific error class with additional context
 */
export class ConsumptionError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;
  public readonly isRetryable: boolean;

  constructor(
    message: string,
    code: string,
    options?: {
      cause?: Error;
      context?: Record<string, unknown>;
      isRetryable?: boolean;
    }
  ) {
    super(message);
    this.name = 'ConsumptionError';
    this.code = code;
    this.context = options?.context;
    this.isRetryable = options?.isRetryable ?? true;

    if (options?.cause) {
      this.cause = options.cause;
    }

    urunKullanimLogger.error(
      message,
      this,
      { code, ...this.context }
    );
  }
}

/**
 * Stock not found error
 */
export class StockNotFoundError extends ConsumptionError {
  constructor(
    message: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'STOCK_NOT_FOUND', {
      context,
      isRetryable: false,
    });
    this.name = 'StockNotFoundError';
  }
}

/**
 * Already consumed error
 */
export class AlreadyConsumedError extends ConsumptionError {
  constructor(
    message: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'ALREADY_CONSUMED', {
      context,
      isRetryable: false,
    });
    this.name = 'AlreadyConsumedError';
  }
}

/**
 * Barcode parse error
 */
export class BarcodeParseError extends ConsumptionError {
  constructor(
    message: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'BARCODE_PARSE_ERROR', {
      context,
      isRetryable: false,
    });
    this.name = 'BarcodeParseError';
  }
}

export default UrunKullanimErrorBoundary;
