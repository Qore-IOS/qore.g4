// src/components/TimestampText.tsx
'use client';
import React from 'react';
import { formatTimestamp, TimestampLike } from '@/lib/time';

type Props = {
  value?: TimestampLike;
  format?: string;
  fallback?: string;
  titleFormat?: string;
};

export function TimestampText({
  value,
  format = 'dd.MM.yyyy',
  fallback = '—',
  titleFormat = "yyyy-MM-dd'T'HH:mm",
}: Props) {
  const text = formatTimestamp(value ?? null, format);
  const title = formatTimestamp(value ?? null, titleFormat) ?? undefined;
  return <span title={title}>{text ?? fallback}</span>;
}

export default TimestampText;
