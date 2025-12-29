/**
 * @fileoverview Error Boundary component for Orders (Siparisler) module
 * @description Provides graceful error handling and recovery UI for order-related errors
 * @module components/siparisler/ErrorBoundary
 * @version 1.0.0
 */

'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { siparislerLogger } from '@/lib/logger';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Home, ChevronDown, ChevronUp } from 'lucide-react';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Error Boundary props
 */
interface SiparislerErrorBoundaryProps {
  /** Child components to render */
  children: ReactNode;
  /** Custom fallback component */
  fallback?: ReactNode;
  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Module name for logging */
  moduleName?: 'siparisler' | 'siparis-gecmis' | 'siparis-toplama';
  /** Custom recovery action */
  onRecovery?: () => void;
}

/**
 * Error Boundary state
 */
interface SiparislerErrorBoundaryState {
  /** Whether an error has been caught */
  hasError: boolean;
  /** The caught error */
  error: Error | null;
  /** Error info from React */
  errorInfo: ErrorInfo | null;
  /** Whether to show error details */
  showDetails: boolean;
  /** Number of recovery attempts */
  recoveryAttempts: number;
}

// =============================================================================
// ERROR BOUNDARY COMPONENT
// =============================================================================

/**
 * Error Boundary for Orders module
 * @description Catches JavaScript errors anywhere in the child component tree,
 * logs them, and displays a fallback UI
 *
 * @example
 * ```tsx
 * <SiparislerErrorBoundary moduleName="siparisler">
 *   <SiparislerPanel />
 * </SiparislerErrorBoundary>
 * ```
 */
export class SiparislerErrorBoundary extends Component<
  SiparislerErrorBoundaryProps,
  SiparislerErrorBoundaryState
> {
  /** Maximum recovery attempts before showing permanent error */
  private static MAX_RECOVERY_ATTEMPTS = 3;

  constructor(props: SiparislerErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      recoveryAttempts: 0,
    };
  }

  /**
   * Update state when an error is caught
   */
  static getDerivedStateFromError(error: Error): Partial<SiparislerErrorBoundaryState> {
    return { hasError: true, error };
  }

  /**
   * Log error information
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { onError, moduleName = 'siparisler' } = this.props;

    // Log error with structured logging
    siparislerLogger.error(
      `Sipariş modülünde hata yakalandı: ${error.message}`,
      error,
      {
        componentStack: errorInfo.componentStack,
        moduleName,
        recoveryAttempts: this.state.recoveryAttempts,
      }
    );

    // Update state with error info
    this.setState({ errorInfo });

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }
  }

  /**
   * Handle recovery attempt
   */
  private handleRecovery = (): void => {
    const { onRecovery } = this.props;
    const newAttempts = this.state.recoveryAttempts + 1;

    siparislerLogger.info('Sipariş modülü kurtarma denemesi', {
      attempt: newAttempts,
      maxAttempts: SiparislerErrorBoundary.MAX_RECOVERY_ATTEMPTS,
    });

    if (newAttempts >= SiparislerErrorBoundary.MAX_RECOVERY_ATTEMPTS) {
      siparislerLogger.warn('Maksimum kurtarma denemesi aşıldı', {
        attempts: newAttempts,
      });
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      recoveryAttempts: newAttempts,
    });

    if (onRecovery) {
      onRecovery();
    }
  };

  /**
   * Handle page reload
   */
  private handleReload = (): void => {
    siparislerLogger.info('Sayfa yeniden yükleniyor');
    window.location.reload();
  };

  /**
   * Handle navigation to home
   */
  private handleGoHome = (): void => {
    siparislerLogger.info('Ana sayfaya yönlendiriliyor');
    window.location.href = '/';
  };

  /**
   * Toggle error details visibility
   */
  private toggleDetails = (): void => {
    this.setState(prev => ({ showDetails: !prev.showDetails }));
  };

  /**
   * Get user-friendly error message
   */
  private getErrorMessage(): string {
    const { error } = this.state;

    if (!error) {
      return 'Bilinmeyen bir hata oluştu.';
    }

    // Check for common error types and provide friendly messages
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return 'Ağ bağlantısı hatası. Lütfen internet bağlantınızı kontrol edin.';
    }

    if (error.message.includes('permission') || error.message.includes('unauthorized')) {
      return 'Yetkilendirme hatası. Bu işlem için yetkiniz olmayabilir.';
    }

    if (error.message.includes('timeout')) {
      return 'İşlem zaman aşımına uğradı. Lütfen tekrar deneyin.';
    }

    if (error.message.includes('firebase') || error.message.includes('firestore')) {
      return 'Veritabanı bağlantı hatası. Lütfen bir süre sonra tekrar deneyin.';
    }

    return 'Sipariş işlemlerinde beklenmeyen bir hata oluştu.';
  }

  /**
   * Get module-specific title
   */
  private getModuleTitle(): string {
    const { moduleName = 'siparisler' } = this.props;

    switch (moduleName) {
      case 'siparis-gecmis':
        return 'Sipariş Geçmişi';
      case 'siparis-toplama':
        return 'Sipariş Toplama';
      default:
        return 'Siparişler';
    }
  }

  render(): ReactNode {
    const { children, fallback } = this.props;
    const { hasError, error, errorInfo, showDetails, recoveryAttempts } = this.state;

    if (!hasError) {
      return children;
    }

    // Use custom fallback if provided
    if (fallback) {
      return fallback;
    }

    const canRetry = recoveryAttempts < SiparislerErrorBoundary.MAX_RECOVERY_ATTEMPTS;

    return (
      <div
        className="min-h-[400px] flex items-center justify-center p-4"
        role="alert"
        aria-live="assertive"
        aria-labelledby="order-error-title"
        aria-describedby="order-error-description"
      >
        <Card className="max-w-lg w-full shadow-lg border-destructive/20">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-destructive/10 rounded-full">
                <AlertTriangle
                  className="h-6 w-6 text-destructive"
                  aria-hidden="true"
                />
              </div>
              <CardTitle id="order-error-title" className="text-lg">
                {this.getModuleTitle()} - Hata
              </CardTitle>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <p
              id="order-error-description"
              className="text-muted-foreground"
            >
              {this.getErrorMessage()}
            </p>

            {recoveryAttempts > 0 && (
              <p className="text-sm text-muted-foreground">
                Kurtarma denemesi: {recoveryAttempts}/{SiparislerErrorBoundary.MAX_RECOVERY_ATTEMPTS}
              </p>
            )}

            {/* Error Details (collapsible) */}
            {error && process.env.NODE_ENV === 'development' && (
              <div className="border rounded-md">
                <button
                  onClick={this.toggleDetails}
                  className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/50 transition-colors"
                  aria-expanded={showDetails}
                  aria-controls="error-details"
                >
                  <span>Teknik Detaylar</span>
                  {showDetails ? (
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>

                {showDetails && (
                  <div
                    id="error-details"
                    className="p-3 border-t bg-muted/30 space-y-2"
                  >
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Hata Türü:
                      </p>
                      <code className="text-xs text-destructive">
                        {error.name}
                      </code>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        Hata Mesajı:
                      </p>
                      <code className="text-xs text-destructive break-all">
                        {error.message}
                      </code>
                    </div>

                    {errorInfo?.componentStack && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Bileşen Yığını:
                        </p>
                        <pre className="text-xs text-muted-foreground overflow-auto max-h-32 mt-1">
                          {errorInfo.componentStack}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-wrap gap-2 pt-4">
            {canRetry && (
              <Button
                onClick={this.handleRecovery}
                variant="default"
                className="flex-1"
              >
                <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
                Tekrar Dene
              </Button>
            )}

            <Button
              onClick={this.handleReload}
              variant="outline"
              className="flex-1"
            >
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
              Sayfayı Yenile
            </Button>

            <Button
              onClick={this.handleGoHome}
              variant="ghost"
              className="flex-1"
            >
              <Home className="h-4 w-4 mr-2" aria-hidden="true" />
              Ana Sayfa
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }
}

// =============================================================================
// WRAPPER COMPONENTS
// =============================================================================

/**
 * Error Boundary specifically for Siparisler panel
 */
export function SiparislerPanelErrorBoundary({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <SiparislerErrorBoundary moduleName="siparisler">
      {children}
    </SiparislerErrorBoundary>
  );
}

/**
 * Error Boundary specifically for Siparis Gecmis panel
 */
export function SiparisGecmisPanelErrorBoundary({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <SiparislerErrorBoundary moduleName="siparis-gecmis">
      {children}
    </SiparislerErrorBoundary>
  );
}

/**
 * Error Boundary specifically for Siparis Toplama page
 */
export function SiparisToplamaPanelErrorBoundary({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <SiparislerErrorBoundary moduleName="siparis-toplama">
      {children}
    </SiparislerErrorBoundary>
  );
}

export default SiparislerErrorBoundary;
