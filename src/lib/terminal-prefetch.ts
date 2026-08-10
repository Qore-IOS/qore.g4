/**
 * @fileoverview Terminal önyükleme — tüm çalışma verisini yerele indirir ve
 * canlı tutar.
 *
 * NEDEN VAR
 *
 * Terminalin hiçbir ekranı, bir işlem sırasında ağ beklememelidir. Barkod
 * okutan bir kullanıcı saniyede birkaç kutu geçirir; araya giren tek bir ağ
 * turu bile akışı durdurur. Depoda bağlantı saatlerce gitmiş de olabilir.
 *
 * Çözüm, veriyi işlem anında değil GİRİŞTE indirmek: uygulama açılır açılmaz
 * ürün kodları, barkod formatları, depolar, laboratuvarlar ve seçili deponun
 * stoğu Firestore'un kalıcı önbelleğine yazılır. Sonrasında ekranlar bu
 * önbellekten okur ve anında açılır.
 *
 * CANLI TUTMA
 *
 * Tek seferlik indirme yetmez: bir ürün kodu değiştiğinde ya da başka bir
 * kullanıcı stok girdiğinde terminal bunu görmelidir. Bu yüzden indirme
 * `onSnapshot` dinleyicileriyle yapılır — ilk anlık görüntü indirmedir,
 * sonraki her değişiklik önbelleği kendiliğinden günceller. Dinleyiciler
 * kapandığında bile veri diskte kalır ve çevrimdışı açılışta oradan okunur.
 *
 * MALİYET NOTU
 *
 * Dinleyiciler yalnızca DEĞİŞEN belgeler için okuma üretir; ilk yüklemeden
 * sonra terminal başına maliyet, veri değişim hızıyla orantılıdır. Depo
 * stoğu depo bazında dinlenir (tüm şirketin stoğu değil), çünkü bir terminal
 * tek bir depoda durur.
 */

import { onSnapshot, where, type Unsubscribe } from 'firebase/firestore';

import { scopedQuery } from '@/lib/firestore-helpers';

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

export type PrefetchState = {
  stages: PrefetchStage[];
  /** Tüm koleksiyonların ilk anlık görüntüsü geldi mi? */
  ready: boolean;
  /** Yerele inen toplam belge sayısı. */
  total: number;
};

type Listener = (state: PrefetchState) => void;

/**
 * Şirket kapsamında, depodan bağımsız koleksiyonlar.
 *
 * `productCodes` ve `barcodeFormats` barkod çözümlemesinin ön koşuludur:
 * bunlar olmadan okutulan hiçbir barkod ürüne bağlanamaz. `depots` ve
 * `hospitals` ise kaynak/hedef seçimleri için gerekir.
 */
const GLOBAL_COLLECTIONS: Array<{ key: string; label: string }> = [
  { key: 'productCodes', label: 'Stok kartları' },
  { key: 'barcodeFormats', label: 'Barkod formatları' },
  { key: 'depots', label: 'Depolar' },
  { key: 'hospitals', label: 'Laboratuvarlar' },
];

/** Depoya bağlı koleksiyonlar — yalnızca seçili depo için dinlenir. */
const DEPOT_COLLECTIONS: Array<{ key: string; label: string }> = [
  { key: 'depoStok', label: 'Depo stoğu' },
  { key: 'orders', label: 'Siparişler' },
];

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

  const planned = [
    ...GLOBAL_COLLECTIONS,
    ...(depotId ? DEPOT_COLLECTIONS : []),
  ];

  const stages = new Map<string, PrefetchStage>(
    planned.map(c => [c.key, { key: c.key, label: c.label, count: 0, ready: false }]),
  );

  const emit = () => {
    const list = Array.from(stages.values());
    onChange({
      stages: list,
      ready: list.every(s => s.ready),
      total: list.reduce((n, s) => n + s.count, 0),
    });
  };

  emit();

  const unsubscribers: Unsubscribe[] = [];

  const listen = (key: string, depotScoped: boolean) => {
    const query = depotScoped && depotId
      ? scopedQuery(key, companyId, isSuperAdmin, where('depotId', '==', depotId))
      : scopedQuery(key, companyId, isSuperAdmin);

    const unsubscribe = onSnapshot(
      query,
      snapshot => {
        const stage = stages.get(key);
        if (!stage) return;
        stage.count = snapshot.size;
        stage.ready = true;
        stage.error = undefined;
        emit();
      },
      error => {
        const stage = stages.get(key);
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

  GLOBAL_COLLECTIONS.forEach(c => listen(c.key, false));
  if (depotId) DEPOT_COLLECTIONS.forEach(c => listen(c.key, true));

  return () => unsubscribers.forEach(u => u());
}
