import type { MinMaxPeriodConfig, MinMaxRule } from './types';

export const DEFAULT_MIN_MAX_PERIOD_CONFIG: MinMaxPeriodConfig = {
  periods: [
    { id: 'kis', name: 'Kış' },
    { id: 'bahar', name: 'Bahar' },
    { id: 'yaz', name: 'Yaz' },
  ],
  monthPeriodMap: {
    1: 'kis', 2: 'kis', 3: 'bahar', 4: 'bahar', 5: 'bahar',
    6: 'yaz', 7: 'yaz', 8: 'yaz', 9: 'bahar', 10: 'bahar',
    11: 'kis', 12: 'kis',
  },
};

export function getActiveMinMaxPeriod(config: MinMaxPeriodConfig, date = new Date()) {
  const periodId = config.monthPeriodMap[date.getMonth() + 1] ?? config.periods[0]?.id;
  const period = config.periods.find(item => item.id === periodId) ?? config.periods[0];
  return period ?? { id: 'tanimsiz', name: 'Tanımsız' };
}

export function resolveSeasonalMinMaxRule(
  rule: MinMaxRule,
  config: MinMaxPeriodConfig,
  date = new Date(),
): MinMaxRule {
  const active = getActiveMinMaxPeriod(config, date);
  const seasonal = rule.donemDegerleri?.[active.id];
  return seasonal ? { ...rule, min: seasonal.min, max: seasonal.max } : rule;
}

export function normalizePeriodId(name: string) {
  return name
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
