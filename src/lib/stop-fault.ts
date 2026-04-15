export type StopFaultType = 'e_stop' | 's_stop' | 'normal_stop';

const normalize = (value: unknown) =>
  String(value ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, ' ')
    .trim();

export function classifyStopFault(report: Record<string, unknown> | null | undefined): StopFaultType | null {
  if (!report) return null;
  const text = [
    report.faultName,
    report.title,
    report.description,
    report.openDescription,
  ]
    .map(normalize)
    .join(' ');

  if (!text.includes('stop')) return null;
  if (/\be[\s-]?stop\b/.test(text)) return 'e_stop';
  if (/\bs[\s-]?stop\b/.test(text)) return 's_stop';
  if (/normal[\s-]?stop/.test(text)) return 'normal_stop';
  return 'normal_stop';
}
