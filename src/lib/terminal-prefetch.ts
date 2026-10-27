/**
 * @fileoverview Terminal önyükleme — tüm çalışma verisini yerele indirir,
 * BELLEKTE TUTAR ve canlı günceller.
 *
 * NEDEN VAR
 *
 * Terminalin hiçbir ekranı, ne açılışta ne de bir işlem sırasında ağ
 * beklememelidir. Barkod okutan bir kullanıcı saniyede birkaç kutu geçirir;
 * araya giren tek bir ağ turu bile akışı durdurur. Depoda bağlantı saatlerce
 * gitmiş de olabilir.
 *
 * VERİ NEDEN BURADA TUTULUYOR
 *
 * İlk sürümde bu modül yalnızca "kaç belge indi" sayardı; ekranlar veriyi
 * kendi TanStack sorgularıyla (`useDepots`, `useProductCodes` …) çekiyordu.
 * O sorgular `getDocs` kullanır ve 5 dakikalık tazelik süresi dolduktan sonra
 * her ekran açılışında yeniden çalışır.
 *
 * Çevrimdışıyken bu ÖLÜMCÜLDÜ: ağ arayüzü "bağlı" görünüp internet olmadığı
 * durumda (depoda tipik olan hâl) `getDocs` sunucu yanıtını zaman aşımına
 * kadar bekler ve arayüz donar. Kullanıcının gördüğü şey buydu: "panel
 * değiştiriyorum, uygulama donuyor."
 *
 * Çözüm, veriyi indirmekle kalmayıp BURADA TUTMAK. `onSnapshot` dinleyicileri
 * zaten açık; ekranlar bu bellekten okuyunca panel geçişinde tek bir sorgu
 * bile atılmaz — çevrimdışıyken de anında açılır.
 *
 * MALİYET NOTU
 *
 * Dinleyiciler yalnızca DEĞİŞEN belgeler için okuma üretir. Depo stoğu depo
 * bazında dinlenir (tüm şirketin stoğu değil), çünkü bir terminal tek bir
 * depoda durur.
 */

import { onSnapshot, where, type DocumentData, type Unsubscribe } from './data/client';

import { scopedQuery } from '@/lib/document-helpers';
import { withLegacyBarcodeFormat } from '@/hooks/useSafeBarcodeFormats';
import type { BarcodeFormat } from '@/lib/barcode';
import type { DepoStokItem, Depot, Hospital, Order, ProductCode } from '@/lib/types';

/** Tek bir koleksiyonun önyükleme durumu. */
export type PrefetchStage = {
  key: string;
  label: string;
  /** Bu koleksiyondan yerele inen belge sayısı. */
  count: number;
  /** İlk anlık görüntü geldi mi? */
  ready: boolean;
  /** Dinleyici hata verdiyse mesajı. */
  error?: string;
};

/** Ekranların okuduğu, bellekte tutulan çalışma verisi. */
export type TerminalData = {
  depots: Depot[];
  hospitals: Hospital[];
  productCodes: ProductCode[];
  barcodeFormats: BarcodeFormat[];
  depotStock: DepoStokItem[];
  orders: Order[];
};

export type PrefetchState = {
  stages: PrefetchStage[];
  /** Tüm koleksiyonların ilk anlık görüntüsü geldi mi? */
  ready: boolean;
  /** Yerele inen toplam belge sayısı. */
  total: number;
  data: TerminalData;
};

export const EMPTY_TERMINAL_DATA: TerminalData = {
  depots: [],
  hospitals: [],
  productCodes: [],
  barcodeFormats: [],
  depotStock: [],
  orders: [],
};

type Listener = (state: PrefetchState) => void;

type CollectionSpec = {
  key: keyof TerminalData;
  collection: string;
  label: string;
  /** Yalnızca seçili depo için dinlenir. */
  depotScoped?: boolean;
};

/**
 * `productCodes` ve `barcodeFormats` barkod çözümlemesinin ön koşuludur:
 * bunlar olmadan okutulan hiçbir barkod ürüne bağlanamaz. `depots` ve
 * `hospitals` kaynak/hedef seçimleri için gerekir.
 */
const COLLECTIONS: CollectionSpec[] = [
  { key: 'productCodes', collection: 'productCodes', label: 'Stok kartları' },
  { key: 'barcodeFormats', collection: 'barcodeFormats', label: 'Barkod formatları' },
  { key: 'depots', collection: 'depots', label: 'Depolar' },
  { key: 'hospitals', collection: 'hospitals', label: 'Laboratuvarlar' },
  { key: 'depotStock', collection: 'depoStok', label: 'Depo stoğu', depotScoped: true },
  { key: 'orders', collection: 'orders', label: 'Siparişler', depotScoped: true },
];

/**
 * Sevk edilmiş ya da tükenmiş kalemler depo stoğu sayılmaz.
 *
 * `useUnshippedDepoStokByDepot` ile aynı ölçüt: ekranlar artık o hook yerine
 * buradan okuduğu için filtre de burada uygulanmalıdır.
 */
function isAvailableStock(item: DepoStokItem): boolean {
  if (item.isShipped) return false;
  const adet = (item as { adet?: number }).adet;
  return adet === undefined || adet > 0;
}

export type PrefetchOptions = {
  companyId: string | null | undefined;
  isSuperAdmin: boolean | undefined;
  /** Seçili depo; yoksa depoya bağlı koleksiyonlar dinlenmez. */
  depotId: string | null;
  onChange: Listener;
};

/**
 * Önyüklemeyi başlatır.
 *
 * @returns Tüm dinleyicileri kapatan fonksiyon.
 */
export function startTerminalPrefetch(options: PrefetchOptions): Unsubscribe {
  const { companyId, isSuperAdmin, depotId, onChange } = options;

  const planned = COLLECTIONS.filter(spec => !spec.depotScoped || depotId);

  const stages = new Map<string, PrefetchStage>(
    planned.map(spec => [spec.key, { key: spec.key, label: spec.label, count: 0, ready: false }]),
  );
  const data: TerminalData = { ...EMPTY_TERMINAL_DATA };

  const emit = () => {
    const list = Array.from(stages.values());
    onChange({
      stages: list,
      ready: list.every(s => s.ready),
      total: list.reduce((n, s) => n + s.count, 0),
      // Yeni nesne: React'in referans karşılaştırması değişikliği görsün.
      data: { ...data },
    });
  };

  emit();

  const unsubscribers: Unsubscribe[] = [];

  const listen = (spec: CollectionSpec) => {
    const query = spec.depotScoped && depotId
      ? scopedQuery(spec.collection, companyId, isSuperAdmin, where('depotId', '==', depotId))
      : scopedQuery(spec.collection, companyId, isSuperAdmin);

    const unsubscribe = onSnapshot(
      query,
      snapshot => {
        const rows = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as DocumentData) }));

        if (spec.key === 'depotStock') {
          data.depotStock = (rows as DepoStokItem[]).filter(isAvailableStock);
        } else if (spec.key === 'barcodeFormats') {
          // Etkin olmayan formatlar elenir, gömülü Roche formatı eklenir —
          // web tarafındaki `useSafeBarcodeFormats` ile aynı davranış.
          const active = (rows as Array<BarcodeFormat & { active?: boolean; priority?: number }>)
            .filter(f => f.active !== false)
            .sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));
          data.barcodeFormats = withLegacyBarcodeFormat(active);
        } else {
          (data[spec.key] as unknown[]) = rows;
        }

        const stage = stages.get(spec.key);
        if (stage) {
          stage.count = snapshot.size;
          stage.ready = true;
          stage.error = undefined;
        }
        emit();
      },
      error => {
        const stage = stages.get(spec.key);
        if (!stage) return;
        // Hata da "hazır" sayılır: aksi hâlde tek bir izin sorunu yüzünden
        // önyükleme ekranı sonsuza kadar açık kalır ve kullanıcı hiçbir işe
        // başlayamaz. Eksik veriyi ilgili ekran zaten kendi diliyle söyler.
        stage.ready = true;
        stage.error = error.message;
        emit();
      },
    );

    unsubscribers.push(unsubscribe);
  };

  planned.forEach(listen);

  return () => unsubscribers.forEach(u => u());
}
