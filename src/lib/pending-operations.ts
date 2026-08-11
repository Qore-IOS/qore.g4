/**
 * @fileoverview Bekleyen işlemler defteri.
 *
 * NE İŞE YARAR
 *
 * Firestore çevrimdışı yazımları zaten kendi kuyruğunda tutar ve bağlantı
 * gelince gönderir; bu kuyruk kalıcıdır, uygulama kapansa bile kaybolmaz.
 * Eksik olan şey GÖRÜNÜRLÜKTÜ: kullanıcı neyin gitmediğini, kaç işlemin
 * beklediğini ve ne zaman gönderildiğini göremiyordu.
 *
 * Bu modül, Firestore'un kuyruğunun YANINDA insan tarafından okunabilir bir
 * defter tutar: "14:32 · Mal kabul · 12 kalem · bekliyor". Kayıtlar
 * `localStorage`'a yazılır, yani uygulama kapanıp açılsa da liste durur.
 *
 * ÖNEMLİ SINIR
 *
 * Bu defter işlemleri GÖNDERMEZ — göndermeyi Firestore yapar. Defter yalnızca
 * durumu yansıtır. İki ayrı kuyruk tutmak (biri gerçek yazımlar, biri kendi
 * yeniden gönderim mantığımız) çift yazma riski doğururdu: SDK bir yazımı
 * gönderirken bizim de aynı işlemi tekrar göndermemiz, aynı seri numarasının
 * iki kez stoğa girmesi demekti.
 */

const STORAGE_KEY = 'qore.terminal.pendingOps';

/** Defterde tutulan işlem türleri. */
export type PendingOperationKind = 'mal_kabul' | 'transfer' | 'siparis_karsilama';

export type PendingOperationStatus = 'pending' | 'sent' | 'failed';

export type PendingOperation = {
  id: string;
  kind: PendingOperationKind;
  /** Ekranda görünen tek satırlık özet. */
  summary: string;
  /** Kalem sayısı — listede sağda gösterilir. */
  itemCount: number;
  /** Oluşturulma anı (ISO). */
  createdAt: string;
  status: PendingOperationStatus;
  /** Sunucuya işlendiği an (ISO) — yalnızca `sent` için. */
  sentAt?: string;
  /** Reddedilme gerekçesi — yalnızca `failed` için. */
  error?: string;
};

export const OPERATION_LABELS: Record<PendingOperationKind, string> = {
  mal_kabul: 'Mal kabul',
  transfer: 'Direkt transfer',
  siparis_karsilama: 'Sipariş sevkiyatı',
};

/**
 * Gönderilmiş kayıtların defterde tutulma süresi.
 *
 * Gönderilenler hemen silinmez: kullanıcının "gitti mi?" sorusuna bakabileceği
 * bir pencere kalmalı. Ama sonsuza kadar da birikmemeli.
 */
const SENT_RETENTION_MS = 24 * 60 * 60 * 1000;

type Listener = (operations: PendingOperation[]) => void;

const listeners = new Set<Listener>();
let cache: PendingOperation[] | null = null;

function read(): PendingOperation[] {
  if (cache) return cache;
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as PendingOperation[]) : [];
  } catch {
    // Bozuk kayıt defterin tamamını kullanılamaz hâle getirmemeli.
    cache = [];
  }
  return cache;
}

function write(operations: PendingOperation[]) {
  cache = operations;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(operations));
  } catch {
    /* kota dolu — defter yalnızca bu oturumda geçerli olur */
  }
  listeners.forEach(listener => listener(operations));
}

/** Süresi dolmuş `sent` kayıtlarını ayıklar. */
function prune(operations: PendingOperation[]): PendingOperation[] {
  const cutoff = Date.now() - SENT_RETENTION_MS;
  return operations.filter(op => {
    if (op.status !== 'sent') return true;
    const sent = op.sentAt ? Date.parse(op.sentAt) : 0;
    return sent > cutoff;
  });
}

/** Defteri okur (en yeni önce). */
export function listPendingOperations(): PendingOperation[] {
  return [...read()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Deftere abone olur; anında mevcut listeyle çağrılır. */
export function subscribeToPendingOperations(listener: Listener): () => void {
  listeners.add(listener);
  listener(read());
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Deftere yeni bir işlem yazar.
 *
 * @returns İşlem kimliği — `markOperationSent`/`markOperationFailed` için.
 */
export function recordOperation(params: {
  id: string;
  kind: PendingOperationKind;
  summary: string;
  itemCount: number;
}): string {
  const operation: PendingOperation = {
    ...params,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  write(prune([operation, ...read()]));
  return operation.id;
}

function update(id: string, patch: Partial<PendingOperation>) {
  write(prune(read().map(op => (op.id === id ? { ...op, ...patch } : op))));
}

/** İşlem sunucuya işlendi. */
export function markOperationSent(id: string) {
  update(id, { status: 'sent', sentAt: new Date().toISOString(), error: undefined });
}

/** İşlem reddedildi (kural ihlali, geçersiz belge …). */
export function markOperationFailed(id: string, error: unknown) {
  update(id, {
    status: 'failed',
    error: error instanceof Error ? error.message : String(error ?? 'Bilinmeyen hata'),
  });
}

/** Gönderilmiş kayıtları defterden siler — "listeyi topla" eylemi. */
export function clearSentOperations() {
  write(read().filter(op => op.status !== 'sent'));
}

/** Bekleyen (henüz gönderilmemiş) işlem sayısı. */
export function countPendingOperations(operations = read()): number {
  return operations.filter(op => op.status === 'pending').length;
}
