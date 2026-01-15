/**
 * @fileoverview Error Boundary Component for Mal Kabul Panel
 * @description Enterprise-grade error boundary with logging, recovery options,
 * and user-friendly error display for the Goods Receiving panel.
 * @module components/mal-kabul/ErrorBoundary
 * @version 1.0.0
 */

'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { malKabulLogger } from '@/lib/logger';

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
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs the error, and displays a fallback UI.
 *
 * @example
 * ```tsx
 * <MalKabulErrorBoundary componentName="AnaPanel">
 *   <AnaPanel />
 * </MalKabulErrorBoundary>
 * ```
 */
export class MalKabulErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
      errorId: `ERR-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
    };
  }

  /**
   * Log error when caught
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { onError, componentName = 'Unknown' } = this.props;

    // Log to structured logger
    malKabulLogger.error(
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

    // Update state with error info
    this.setState({ errorInfo });

    // Call optional callback
    if (onError) {
      onError(error, errorInfo);
    }
  }

  /**
   * Handle retry action
   */
  handleRetry = (): void => {
    this.setState({ isRetrying: true });

    // Small delay for visual feedback
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
    window.location.href = '/';
  };

  /**
   * Render error UI or children
   */
  render(): ReactNode {
    const { hasError, error, errorInfo, errorId, isRetrying } = this.state;
    const { children, fallback, showDetails = false, errorMessage } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <div
          className="flex items-center justify-center min-h-[400px] p-6"
          role="alert"
          aria-live="assertive"
        >
          <Card className="max-w-lg w-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-destructive/10 rounded-full">
                  <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-xl">Bir Hata Oluştu</CardTitle>
                  <CardDescription>
                    {errorMessage || 'Beklenmedik bir hata meydana geldi. Lütfen tekrar deneyin.'}
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
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{errorId}</code>
                </div>
              )}

              {showDetails && errorInfo?.componentStack && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    Teknik Detaylar (Geliştiriciler İçin)
                  </summary>
                  <pre className="mt-2 p-3 bg-muted rounded-md text-xs overflow-auto max-h-40">
                    {errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </CardContent>

            <CardFooter className="flex gap-3">
              <Button
                onClick={this.handleRetry}
                disabled={isRetrying}
                className="flex-1"
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
 *   const { handleError, clearError, error } = useErrorHandler('MyComponent');
 *
 *   const doSomething = async () => {
 *     try {
 *       await riskyOperation();
 *     } catch (e) {
 *       handleError(e);
 *     }
 *   };
 * }
 * ```
 */
export function useErrorHandler(componentName: string) {
  const [error, setError] = React.useState<Error | null>(null);

  const handleError = React.useCallback(
    (err: unknown, context?: Record<string, unknown>) => {
      const error = err instanceof Error ? err : new Error(String(err));

      malKabulLogger.error(
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
// ASYNC ERROR BOUNDARY
// =============================================================================

/**
 * Props for async error wrapper
 */
interface AsyncErrorWrapperProps {
  /** Operation name for logging */
  operationName: string;
  /** The async operation to wrap */
  children: ReactNode;
}

/**
 * Higher-order component for async operations
 * Provides consistent error handling for async operations
 *
 * @example
 * ```tsx
 * <AsyncOperationWrapper operationName="loadProducts">
 *   <ProductList />
 * </AsyncOperationWrapper>
 * ```
 */
export function AsyncOperationWrapper({ operationName, children }: AsyncErrorWrapperProps) {
  return (
    <MalKabulErrorBoundary
      componentName={operationName}
      errorMessage={`${operationName} işlemi sırasında bir hata oluştu.`}
    >
      {children}
    </MalKabulErrorBoundary>
  );
}

// =============================================================================
// ERROR UTILITIES
// =============================================================================

/**
 * Safely execute an async operation with error handling
 *
 * @example
 * ```ts
 * const result = await safeAsync(
 *   () => fetchProducts(),
 *   'fetchProducts',
 *   { retries: 3 }
 * );
 *
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export async function safeAsync<T>(
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
      const data = await operation();
      return { success: true, data };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      malKabulLogger.warn(
        `${operationName} failed (attempt ${attempt + 1}/${retries + 1})`,
        { error: lastError.message, attempt, ...context }
      );

      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
      }
    }
  }

  malKabulLogger.error(
    `${operationName} failed after ${retries + 1} attempts`,
    lastError,
    context
  );

  return { success: false, error: lastError! };
}

/**
 * Create a wrapped version of an async function with error handling
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  operationName: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      malKabulLogger.error(`${operationName} failed`, error, { args });
      throw error;
    }
  }) as T;
}

export default MalKabulErrorBoundary;
