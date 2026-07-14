export type ShortcutMetricValue = string | number | boolean | null;

export interface ShortcutContext {
  shortcutId: string;
  runId: string;
  companyId?: string | null;
  createdByUid?: string | null;
  createdByName?: string | null;
  now: Date;
}

export interface ShortcutParams {
  [key: string]: unknown;
}

export interface ShortcutResult {
  status?: 'success' | 'skipped' | 'failed';
  summaryText: string;
  rows?: Record<string, unknown>[];
  metrics?: Record<string, ShortcutMetricValue>;
  attachments?: Array<{
    name: string;
    contentType?: string;
    url?: string;
    path?: string;
    sizeBytes?: number;
  }>;
  warnings?: string[];
  deepLink?: string;
}

export interface ShortcutHandler<TParams extends ShortcutParams = ShortcutParams> {
  key: string;
  label: string;
  handle(params: TParams, context: ShortcutContext): Promise<ShortcutResult>;
}
