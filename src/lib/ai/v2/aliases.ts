/**
 * Centralised value aliases for status/enum fields across Qore collections.
 *
 * The LLM frequently uses friendly English names ("closed", "open", "active",
 * "pending") that don't match the actual Firestore values which are usually
 * Turkish ("cozuldu", "atama_bekliyor", "beklemede"). Rather than fixing this
 * per handler, every handler routes its enum filters through `expandAlias()`
 * which returns the full set of equivalent values; `robustQuery` will then
 * issue an `in` query that matches any of them.
 *
 * Adding a new collection / field is a one-liner here, no handler changes.
 */

export type AliasMap = Record<string, string[]>;

/**
 * Each entry maps a single canonical or friendly value to ALL equivalents
 * (including itself). Aliases are symmetric — looking up any of the listed
 * values returns the same group.
 */
type GroupedAlias = Record<string, AliasMap>;

const GROUPS: GroupedAlias = {
  /* ---------- deviceFaultReports.status ---------- */
  'deviceFaultReports.status': {
    closed: ['cozuldu', 'closed'],
    cozuldu: ['cozuldu', 'closed'],
    open: ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'],
    acik: ['atama_bekliyor', 'mudahale_bekliyor', 'mudahale_ediliyor', 'open'],
    atama_bekliyor: ['atama_bekliyor'],
    mudahale_bekliyor: ['mudahale_bekliyor'],
    mudahale_ediliyor: ['mudahale_ediliyor'],
  },

  /* ---------- orders.status ---------- */
  'orders.status': {
    open: ['pending', 'toplaniyor'],
    acik: ['pending', 'toplaniyor'],
    pending: ['pending'],
    beklemede: ['pending'],
    toplaniyor: ['toplaniyor'],
    closed: ['completed'],
    tamamlandi: ['completed'],
    completed: ['completed'],
    eksik: ['eksik'],
    partial: ['eksik'],
  },

  /* ---------- centralOrders.status ---------- */
  'centralOrders.status': {
    open: ['pending', 'in_progress', 'beklemede'],
    pending: ['pending', 'beklemede'],
    completed: ['completed', 'tamamlandi'],
    tamamlandi: ['completed', 'tamamlandi'],
  },

  /* ---------- consumableRequests.status ---------- */
  'consumableRequests.status': {
    open: ['pending', 'beklemede', 'onay_bekliyor'],
    acik: ['pending', 'beklemede', 'onay_bekliyor'],
    pending: ['pending', 'beklemede', 'onay_bekliyor'],
    approved: ['approved', 'onaylandi'],
    rejected: ['rejected', 'reddedildi'],
    completed: ['completed', 'tamamlandi'],
    tamamlandi: ['completed', 'tamamlandi'],
  },

  /* ---------- userRequests.status ---------- */
  'userRequests.status': {
    open: ['open'],
    acik: ['open'],
    reviewing: ['reviewing'],
    incelemede: ['reviewing'],
    done: ['done'],
    tamamlandi: ['done'],
    closed: ['done'],
  },

  /* ---------- expensePeriods.status ---------- */
  'expensePeriods.status': {
    pending: ['pending'],
    onay_bekliyor: ['pending'],
    beklemede: ['pending'],
    approved: ['approved'],
    onaylandi: ['approved'],
    rejected: ['rejected'],
    reddedildi: ['rejected'],
  },

  /* ---------- overtimeRequests.status ---------- */
  'overtimeRequests.status': {
    pending: ['pending', 'beklemede'],
    approved: ['approved', 'onaylandi'],
    rejected: ['rejected', 'reddedildi'],
  },

  /* ---------- purchasingTasks.status ---------- */
  'purchasingTasks.status': {
    open: ['planned', 'in_progress', 'pending'],
    acik: ['planned', 'in_progress', 'pending'],
    planned: ['planned'],
    in_progress: ['in_progress', 'devam_ediyor'],
    devam_ediyor: ['in_progress'],
    completed: ['completed', 'tamamlandi'],
    tamamlandi: ['completed'],
    cancelled: ['cancelled', 'iptal'],
  },

  /* ---------- count sessions ---------- */
  'depotStockCountSessions.status': {
    active: ['active', 'started', 'in_progress', 'basladi'],
    started: ['active', 'started', 'basladi'],
    basladi: ['active', 'started', 'basladi'],
    completed: ['completed', 'tamamlandi'],
    tamamlandi: ['completed'],
  },
  'depotBrandCountSessions.status': {
    active: ['active', 'started', 'basladi'],
    completed: ['completed', 'tamamlandi'],
  },
  'maliyetSayimSessions.status': {
    active: ['active', 'started', 'basladi'],
    completed: ['completed', 'tamamlandi'],
  },

  /* ---------- verificationReports.durum (Turkish, uppercase) ---------- */
  'verificationReports.durum': {
    accepted: ['KABUL EDİLDİ'],
    'kabul edildi': ['KABUL EDİLDİ'],
    rejected: ['KABUL EDİLMEDİ'],
    'kabul edilmedi': ['KABUL EDİLMEDİ'],
    'not in system': ['SİSTEMDE YOK'],
    'sistemde yok': ['SİSTEMDE YOK'],
    'sevk edildi': ['SEVK EDİLDİ'],
    shipped: ['SEVK EDİLDİ'],
    'sayim eksik': ['SAYIMDA EKSİK'],
    'sayimda eksik': ['SAYIMDA EKSİK'],
    'sayim fazla': ['SAYIMDA FAZLA'],
    'sayimda fazla': ['SAYIMDA FAZLA'],
    'kullanim dogrulandi': ['KULLANIM DOĞRULANDI'],
    'kullanim bekleniyor': ['KULLANIM BEKLENİYOR'],
    'imha dogrulandi': ['imha_dogrulandi'],
  },

  /* ---------- ejected/destroyed kits ---------- */
  'ejectedKitRecords.kitResolution': {
    imha: ['imha'],
    destroy: ['imha'],
    'tekrar kullanim': ['tekrar_kullanim'],
    reuse: ['tekrar_kullanim'],
    'tekrar_kullanim': ['tekrar_kullanim'],
  },

  /* ---------- spare parts ---------- */
  'personalStock.status': {
    in_stock: ['in_stock'],
    used: ['used'],
    pending_return: ['pending_return'],
    'iade_bekliyor': ['pending_return'],
  },
  'poolWarehouseStock.status': {
    in_stock: ['in_stock'],
    used: ['used'],
  },
  'sparePartTransferLogs.action': {
    use: ['kullanim'],
    kullanim: ['kullanim'],
    return: ['iade'],
    iade: ['iade'],
    transfer: ['transfer'],
    destroy: ['imha'],
    imha: ['imha'],
  },
  'yedekParcaDepoLog.action': {
    giris: ['giris'],
    in: ['giris'],
    cikis: ['cikis'],
    out: ['cikis'],
    transfer: ['transfer'],
    iade: ['iade'],
    return: ['iade'],
    imha: ['imha'],
    destroy: ['imha'],
  },

  /* ---------- routes / vehicles ---------- */
  'routes.status': {
    planned: ['planned', 'planlandi'],
    in_progress: ['in_progress', 'devam_ediyor'],
    completed: ['completed', 'tamamlandi'],
    cancelled: ['cancelled', 'iptal'],
  },

  /* ---------- shipments ---------- */
  // shipments don't have a status; left intentionally empty so we don't lie

  /* ---------- product / depo group fields ---------- */
  'productCodes.urunGrubu': {
    kit: ['kit'],
    sarf: ['sarf', 'consumable'],
    consumable: ['sarf'],
    yedek_parca: ['yedek_parca', 'spare_part'],
    spare_part: ['yedek_parca'],
  },
  'depoStok.urunGrubu': {
    kit: ['kit'],
    sarf: ['sarf', 'consumable'],
    consumable: ['sarf'],
    yedek_parca: ['yedek_parca'],
  },

  /* ---------- fault types & intervention ---------- */
  'deviceFaultReports.faultType': {
    teknik_servis: ['teknik_servis'],
    technical: ['teknik_servis'],
    aplikasyon: ['aplikasyon'],
    application: ['aplikasyon'],
  },
  'deviceFaultReports.interventionType': {
    telefon: ['telefon'],
    phone: ['telefon'],
    kurum_ziyaret: ['kurum_ziyaret'],
    site_visit: ['kurum_ziyaret'],
    onsite: ['kurum_ziyaret'],
  },

  /* ---------- notifications ---------- */
  'notifications.type': {
    fault: ['fault_opened', 'fault_closed'],
    order: ['order_created'],
  },

  /* ---------- personnel ---------- */
  'personnel.aktif': {
    active: ['true', 'aktif'],
    aktif: ['true'],
    passive: ['false', 'pasif'],
    pasif: ['false'],
  },
  'personnelAvailability.type': {
    office: ['office'],
    ofis: ['office'],
    training: ['training'],
    egitim: ['training'],
    leave: ['leave'],
    izin: ['leave'],
  },
};

/**
 * Look up the full equivalent-value list for a (collection.field, value).
 * Returns `[input]` unchanged when no alias is registered.
 *
 * @example expandAlias('deviceFaultReports', 'status', 'closed') → ['cozuldu','closed']
 */
export function expandAlias(collection: string, field: string, value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'string') return [value];
  const key = `${collection}.${field}`;
  const map = GROUPS[key];
  if (!map) return [value];

  const lower = value.toLowerCase().trim();
  const direct = map[lower] ?? map[value] ?? map[value.trim()];
  if (direct) return Array.from(new Set([value, ...direct]));

  // Scan all groups: maybe `value` exists as a target somewhere
  for (const [, group] of Object.entries(map)) {
    if (group.includes(value) || group.includes(lower)) {
      return Array.from(new Set([value, ...group]));
    }
  }
  return [value];
}

/**
 * Convenience builder for use with `robustQuery`:
 *   filters.push(aliasedFilter('deviceFaultReports', 'status', 'closed'))
 */
export function aliasedFilter(
  collection: string,
  field: string,
  value: unknown,
  options: { priority?: number | 'required' } = {},
): { field: string; value: unknown; aliases?: unknown[]; priority?: number | 'required' } {
  if (value === undefined || value === null) {
    return { field, value };
  }
  const all = expandAlias(collection, field, value);
  return {
    field,
    value: all[0],
    aliases: all.length > 1 ? all.slice(1) : undefined,
    priority: options.priority,
  };
}
