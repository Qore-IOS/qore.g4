/**
 * @fileoverview Error Boundary components for Verimlilik (Efficiency) modules
 * @description Provides error boundary components with recovery UI for all
 * efficiency-related panels including calculation, statistics, history, and total views.
 * @module components/verimlilik/ErrorBoundary
 * @version 1.0.0
 *
 * @features
 * - Graceful error handling with user-friendly messages
 * - Recovery attempt mechanism with retry button
 * - Detailed error information in development mode
 * - Structured logging integration
 * - Separate boundaries for each panel type
 *
 * @accessibility
 * - ARIA live region for error announcements
 * - Keyboard accessible recovery button
 * - Clear error messaging in Turkish
 */

'use client';

import React, { Component, ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Home, Calculator, BarChart3, History, TrendingUp } from 'lucide-react';
import {
  verimlilikHesaplamaLogger,
  verimlilikIstatistikLogger,
  verimlilikGecmisLogger,
  totalVerimlilikLogger,
} from '@/lib/logger';
import type { ModuleLogger } from '@/lib/logger';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Error boundary component props
 */
interface ErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Name of the panel for display */
  panelName: string;
  /** Module logger instance */
  logger: ModuleLogger;
  /** Icon component to display */
  icon: React.ReactNode;
  /** Fallback URL for navigation */
  fallbackUrl?: string;
}

/**
 * Error boundary component state
 */
interface ErrorBoundaryState {
  /** Whether an error has occurred */
  hasError: boolean;
  /** The error that occurred */
  error: Error | null;
  /** Error information string */
  errorInfo: string | null;
  /** Number of recovery attempts */
  recoveryAttempts: number;
}

// =============================================================================
// BASE ERROR BOUNDARY COMPONENT
// =============================================================================

/**
 * Base Error Boundary for Verimlilik panels
 * Catches JavaScript errors in child component tree and displays fallback UI
 */
class VerimlilikErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /** Maximum recovery attempts before suggesting page reload */
  private static readonly MAX_RECOVERY_ATTEMPTS = 3;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      recoveryAttempts: 0,
    };
  }

  /**
   * Static method to derive state from error
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  /**
   * Lifecycle method called after error is caught
   */
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const { logger, panelName } = this.props;

    // Log the error with structured logging
    logger.error(
      `${panelName} panelinde beklenmeyen hata oluştu`,
      error,
      {
        componentStack: errorInfo.componentStack,
        panelName,
        recoveryAttempts: this.state.recoveryAttempts,
      }
    );

    this.setState({
      errorInfo: errorInfo.componentStack || null,
    });
  }

  /**
   * Handles recovery attempt
   */
  handleRecovery = (): void => {
    const { logger, panelName } = this.props;
    const newAttemptCount = this.state.recoveryAttempts + 1;

    logger.info(`${panelName} kurtarma denemesi`, {
      attemptNumber: newAttemptCount,
    });

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      recoveryAttempts: newAttemptCount,
    });
  };

  /**
   * Handles page reload
   */
  handleReload = (): void => {
    const { logger, panelName } = this.props;

    logger.info(`${panelName} sayfa yenileniyor`);
    window.location.reload();
  };

  /**
   * Navigates to home page
   */
  handleGoHome = (): void => {
    const { fallbackUrl } = this.props;
    window.location.href = fallbackUrl || '/';
  };

  render(): ReactNode {
    const { children, panelName, icon, fallbackUrl } = this.props;
    const { hasError, error, errorInfo, recoveryAttempts } = this.state;

    if (hasError) {
      const showDetailedError = process.env.NODE_ENV === 'development';
      const maxAttemptsReached = recoveryAttempts >= VerimlilikErrorBoundary.MAX_RECOVERY_ATTEMPTS;

      return (
        <div
          className="p-4 min-h-[400px] flex items-center justify-center"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <Card className="max-w-lg w-full border-destructive/50">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="p-3 rounded-full bg-destructive/10">
                  <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
                </div>
              </div>
              <CardTitle className="text-destructive flex items-center justify-center gap-2">
                {icon}
                {panelName} Hatası
              </CardTitle>
              <CardDescription>
                {maxAttemptsReached
                  ? 'Birden fazla kurtarma denemesi başarısız oldu. Lütfen sayfayı yenileyin.'
                  : 'Bir hata oluştu. Lütfen tekrar deneyin veya sayfayı yenileyin.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {showDetailedError && error && (
                <div className="p-3 bg-muted rounded-md overflow-auto max-h-40">
                  <p className="text-sm font-mono text-destructive" aria-label="Hata mesajı">
                    {error.message}
                  </p>
                  {errorInfo && (
                    <details className="mt-2">
                      <summary className="text-xs text-muted-foreground cursor-pointer">
                        Teknik Detaylar
                      </summary>
                      <pre className="text-xs mt-2 whitespace-pre-wrap">
                        {errorInfo}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              <div className="text-center text-sm text-muted-foreground">
                Kurtarma denemesi: {recoveryAttempts} / {VerimlilikErrorBoundary.MAX_RECOVERY_ATTEMPTS}
              </div>

              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                {!maxAttemptsReached && (
                  <Button
                    onClick={this.handleRecovery}
                    variant="default"
                    className="gap-2"
                    aria-label="Tekrar dene"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    Tekrar Dene
                  </Button>
                )}
                <Button
                  onClick={this.handleReload}
                  variant="outline"
                  className="gap-2"
                  aria-label="Sayfayı yenile"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Sayfayı Yenile
                </Button>
                {fallbackUrl && (
                  <Button
                    onClick={this.handleGoHome}
                    variant="secondary"
                    className="gap-2"
                    aria-label="Ana sayfaya dön"
                  >
                    <Home className="h-4 w-4" aria-hidden="true" />
                    Ana Sayfa
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return children;
  }
}

// =============================================================================
// SPECIALIZED ERROR BOUNDARY COMPONENTS
// =============================================================================

/**
 * Error Boundary for Verimlilik Hesaplama (Efficiency Calculation) Panel
 */
export function VerimlilikHesaplamaPanelErrorBoundary({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <VerimlilikErrorBoundary
      panelName="Verimlilik Hesaplama"
      logger={verimlilikHesaplamaLogger}
      icon={<Calculator className="h-5 w-5" aria-hidden="true" />}
      fallbackUrl="/"
    >
      {children}
    </VerimlilikErrorBoundary>
  );
}

/**
 * Error Boundary for Verimlilik İstatistikleri (Efficiency Statistics) Panel
 */
export function VerimlilikIstatistikleriPanelErrorBoundary({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <VerimlilikErrorBoundary
      panelName="Verimlilik İstatistikleri"
      logger={verimlilikIstatistikLogger}
      icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
      fallbackUrl="/verimlilik-hesaplama"
    >
      {children}
    </VerimlilikErrorBoundary>
  );
}

/**
 * Error Boundary for Verimlilik Geçmişi (Efficiency History) Panel
 */
export function VerimlilikGecmisPanelErrorBoundary({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <VerimlilikErrorBoundary
      panelName="Verimlilik Geçmişi"
      logger={verimlilikGecmisLogger}
      icon={<History className="h-5 w-5" aria-hidden="true" />}
      fallbackUrl="/verimlilik-hesaplama"
    >
      {children}
    </VerimlilikErrorBoundary>
  );
}

/**
 * Error Boundary for Total Verimlilik (Total Efficiency) Panel
 */
export function TotalVerimlilikPanelErrorBoundary({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <VerimlilikErrorBoundary
      panelName="Total Verimlilik"
      logger={totalVerimlilikLogger}
      icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
      fallbackUrl="/"
    >
      {children}
    </VerimlilikErrorBoundary>
  );
}

/**
 * Error Boundary for Total Verimlilik Geçmişi (Total Efficiency History) Panel
 */
export function TotalVerimlilikGecmisPanelErrorBoundary({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <VerimlilikErrorBoundary
      panelName="Total Verimlilik Geçmişi"
      logger={totalVerimlilikLogger}
      icon={<History className="h-5 w-5" aria-hidden="true" />}
      fallbackUrl="/total-verimlilik"
    >
      {children}
    </VerimlilikErrorBoundary>
  );
}

/**
 * Error Boundary for Total Verimlilik Geçmiş Detay (Total Efficiency History Detail) Panel
 */
export function TotalVerimlilikGecmisDetayPanelErrorBoundary({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <VerimlilikErrorBoundary
      panelName="Total Verimlilik Detay"
      logger={totalVerimlilikLogger}
      icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
      fallbackUrl="/total-verimlilik/gecmis"
    >
      {children}
    </VerimlilikErrorBoundary>
  );
}

export default VerimlilikErrorBoundary;
