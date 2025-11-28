
'use client';
import { useEffect, useState } from 'react';

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }

export function normalizeMiad(input: string): string {
  const raw = (input || '').trim();

  if (/^\d{6}$/.test(raw)) {
    const yy = parseInt(raw.slice(0, 2), 10);
    const mm = parseInt(raw.slice(2, 4), 10);
    const dd = parseInt(raw.slice(4, 6), 10);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${pad(dd)}.${pad(mm)}.${yyyy}`;
  }

  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(raw)) {
    const [d, m, y] = raw.replace(/-/g, '.').replace(/\//g, '.').split('.');
    const yyyy = (y.length === 2) ? (parseInt(y, 10) >= 70 ? `19${y}` : `20${y}`) : y;
    return `${pad(parseInt(d, 10))}.${pad(parseInt(m, 10))}.${yyyy}`;
  }

  return raw;
}

function ddmmyyyyToIso(v: string): string {
  const norm = normalizeMiad(v);
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(norm)) return '';
  const [dd, mm, yyyy] = norm.split('.');
  return `${yyyy}-${mm}-${dd}`;
}

function isoToDdmmyyyy(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const [yyyy, mm, dd] = v.split('-');
  return `${dd}.${mm}.${yyyy}`;
}

export default function ExpiryDateInput({
  value,
  onChange,
  className,
  placeholder = 'gg.aa.yyyy veya YYMMDD',
}: {
  value: string;
  onChange: (ddmmyyyy: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [iso, setIso] = useState<string>(ddmmyyyyToIso(value));

  useEffect(() => {
    setIso(ddmmyyyyToIso(value));
  }, [value]);

  return (
    <input
      type="date"
      className={className}
      value={iso}
      onChange={(e) => {
        setIso(e.target.value);
        onChange(isoToDdmmyyyy(e.target.value));
      }}
      onBlur={(e) => {
        const ddmmyyyy = isoToDdmmyyyy(e.currentTarget.value);
        onChange(ddmmyyyy);
      }}
      placeholder={placeholder}
    />
  );
}
