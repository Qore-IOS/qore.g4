import { getShortcutCatalogForViews } from './catalog';

export type ShortcutDraft = {
  sourceText: string;
  panelKey?: string;
  panelLabel?: string;
  actionKey?: string;
  actionLabel?: string;
  actionDescription?: string;
  actionHref?: string;
  filters: string[];
  scheduleLabel: string;
  schedule?: { type: 'once' | 'interval'; intervalDays?: number } | string | null;
  channel: string;
  outputs: string[];
  recipients: string[];
};

const normalise = (value: string) => value.toLocaleLowerCase('tr').trim();

const uniq = <T,>(items: T[]) => Array.from(new Set(items));

function inferSchedule(text: string) {
  if (/her\s+pazartesi|pazartesi/.test(text)) return { label: 'Haftalık', payload: { type: 'interval' as const, intervalDays: 7 } };
  if (/hafta|haftalık|her\s+hafta/.test(text)) return { label: 'Haftalık', payload: { type: 'interval' as const, intervalDays: 7 } };
  if (/her\s+sabah|sabah|günlük|her\s+gün/.test(text)) return { label: 'Günlük', payload: { type: 'interval' as const, intervalDays: 1 } };
  if (/ay\s+sonu|aylık|her\s+ay/.test(text)) return { label: 'Aylık', payload: { type: 'interval' as const, intervalDays: 30 } };
  return { label: 'Manuel', payload: null };
}

function inferChannel(text: string) {
  if (/whatsapp|wp|watsap/.test(text)) return { channel: 'whatsapp', outputs: ['whatsapp'] };
  if (/mail|e-?posta|eposta/.test(text)) return { channel: 'email', outputs: ['email'] };
  if (/excel/.test(text)) return { channel: 'excel', outputs: ['excel'] };
  if (/pdf/.test(text)) return { channel: 'pdf', outputs: ['pdf'] };
  return { channel: 'app', outputs: ['app'] };
}

function inferRecipients(text: string) {
  const recipients: string[] = [];
  if (/lab\s+sorumlu|laboratuvar\s+sorumlu/.test(text)) recipients.push('Lab sorumluları');
  if (/sorumlular/.test(text) && recipients.length === 0) recipients.push('Sorumlular');
  if (/teknisyen/.test(text)) recipients.push('Teknisyenler');
  if (/yönetici|yonetici|müdür|mudur/.test(text)) recipients.push('Yöneticiler');
  return recipients;
}

function findDraftTarget(text: string, accessibleViews: readonly string[]) {
  const catalog = getShortcutCatalogForViews(accessibleViews);
  const includes = (...terms: string[]) => terms.some((term) => text.includes(term));

  const target = (() => {
    if (includes('riskli stok', 'stok risk', 'kritik stok')) return { panel: 'raporlama', action: 'raporlama.stock-risk-report', fallback: 'Stok risk raporu otomasyonu', filters: ['Depo', 'Laboratuvar', 'Ürün grubu', 'Marka', 'Eşik gün sayısı'] };
    if (includes('açık arıza', 'acik ariza', 'arızaları', 'arizalari')) return { panel: 'ariza-yonetimi', action: 'ariza-yonetimi.acik-ariza-yaslandirma-raporu', fallback: 'Açık arıza yaşlandırma raporu', filters: ['Laboratuvar', 'Durum', 'Tarih aralığı'] };
    if (includes('maliyet')) return { panel: 'cost-dashboard', action: 'cost-dashboard.maliyet-raporu', fallback: 'Maliyet raporu oluştur', filters: ['Laboratuvar', 'Tarih aralığı'] };
    if (includes('ürün kullanım', 'urun kullanim', 'tüketim', 'tuketim')) return { panel: 'urun-kullanim', action: 'urun-kullanim.haftalik-lab-tuketim-raporu', fallback: 'Haftalık lab tüketim raporu', filters: ['Laboratuvar', 'Tarih aralığı', 'Ürün kodu / marka'] };
    return null;
  })();

  if (!target) return null;
  const panel = catalog.find((item) => String(item.panelKey) === target.panel) ?? catalog.find((item) => item.actions.some((action) => action.key === target.action));
  if (!panel) return null;
  const action = target.action ? panel.actions.find((item) => item.key === target.action) : undefined;
  return { panel, action, fallbackActionLabel: target.fallback, filters: target.filters };
}

export function createShortcutDraft(input: { text: string; accessibleViews: readonly string[] }): ShortcutDraft | null {
  const sourceText = input.text.trim();
  if (!sourceText) return null;
  const text = normalise(sourceText);
  const target = findDraftTarget(text, input.accessibleViews);
  if (!target) return null;
  const schedule = inferSchedule(text);
  const delivery = inferChannel(text);
  const recipients = inferRecipients(text);
  const filters = uniq([...target.filters, ...(recipients.length ? ['Alıcılar'] : [])]);

  return {
    sourceText,
    panelKey: String(target.panel.panelKey),
    panelLabel: target.panel.panelLabel,
    actionKey: target.action?.key,
    actionLabel: target.action?.label || target.fallbackActionLabel,
    actionDescription: target.action?.description || `${sourceText} ifadesinden oluşturulan kestirme taslağı.`,
    actionHref: target.action?.href,
    filters,
    scheduleLabel: schedule.label,
    schedule: schedule.payload,
    channel: delivery.channel,
    outputs: delivery.outputs,
    recipients,
  };
}
