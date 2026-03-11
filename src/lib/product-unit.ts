export type ProductUnitMeta = {
  anaBirim?: string;
  ambalajDegeri?: number | null;
};

export function normalizeUnitLabel(unit?: string): string {
  const value = (unit || 'Adet').trim();
  return value ? value.toLocaleLowerCase('tr-TR') : 'adet';
}

export function formatUnitMultiplier(meta?: ProductUnitMeta): string {
  const ambalaj = Number(meta?.ambalajDegeri ?? 0);
  return ambalaj > 0 ? `x${ambalaj}` : '';
}

export function formatQuantityWithUnit(
  quantity: number,
  meta?: ProductUnitMeta,
  options?: { showMultiplier?: boolean }
): string {
  const unit = normalizeUnitLabel(meta?.anaBirim);
  const multiplier = formatUnitMultiplier(meta);
  if (options?.showMultiplier && multiplier) {
    return `${quantity} ${unit} (${multiplier})`;
  }
  return `${quantity} ${unit}`;
}
