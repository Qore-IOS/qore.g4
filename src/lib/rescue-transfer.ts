/**
 * @fileoverview Miad Bazlı Akıllı Transfer Öneri Motoru
 * @description Riskli stokları imhadan kurtarmak için laboratuvarlara
 * optimal transfer önerileri üreten algoritma.
 */

import type { MinMaxRule } from '@/lib/types';

/* ────────────────────────────────────────────
   Types
   ──────────────────────────────────────────── */

/** Bir laboratuvardaki belirli bir lot'un stok ve miad bilgisi */
export interface LabStockEntry {
  lotNumarasi: string;
  miad: string;
  miadDays: number;
  quantity: number;
}

/** Bir laboratuvarın genel stok durumu */
export interface LabStockInfo {
  labId: string;
  labName: string;
  currentStock: number;
  maxStock: number;
  maxGun: number;
  dailyNeed: number;
  deficit: number;
  minMiadDays: number; // Labdaki en kısa miadlı stokun gün sayısı
  items: LabStockEntry[];
}

/** Transfer önerisi */
export interface TransferSuggestion {
  labId: string;
  labName: string;
  /** Kaç kutu transfer öneriliyor */
  suggestedTransfer: number;
  /** Güvenli transfer miktarı (tüketim hızına göre) */
  safeTransfer: number;
  /** Lab bu kadar kutuyu kaç günde tüketir */
  daysToConsume: number;
  /** Labdaki mevcut stok */
  currentStock: number;
  /** Max stok kuralı */
  maxStock: number;
  /** Açık (deficit) */
  deficit: number;
  /** Günlük tüketim */
  dailyNeed: number;
  /** Labdaki en kısa miadlı stok günü */
  labMinMiadDays: number;
  /** FEFO uyumu (labdaki stoklar transfer edilecekten daha uzun miadlı mı?) */
  fefoCompatible: boolean;
  /** Güven skoru (0-100) */
  confidenceScore: number;
  /** Öneri durumu */
  status: 'recommended' | 'possible' | 'not_suitable';
  /** Durum açıklaması */
  statusReason: string;
  /** Lab stok detayları */
  labItems: LabStockEntry[];
}

/** Toplu kurtarma planı sonucu */
export interface RescuePlanResult {
  stokKodu: string;
  stokAdi: string;
  totalRiskyBoxes: number;
  rescuableBoxes: number;
  unrescuableBoxes: number;
  miadDays: number;
  suggestions: TransferSuggestion[];
}

/* ────────────────────────────────────────────
   Algorithm
   ──────────────────────────────────────────── */

/**
 * Bir ürün için transfer önerilerini hesaplar.
 *
 * @param riskyBoxes - Depoda riskli kutu sayısı
 * @param miadDays - Riskli stokun miad günü
 * @param labStocks - Her laboratuvardaki stok bilgisi
 * @returns Skorlanmış ve sıralanmış transfer önerileri
 */
export function calculateTransferSuggestions(
  riskyBoxes: number,
  miadDays: number,
  labStocks: LabStockInfo[]
): TransferSuggestion[] {
  const suggestions: TransferSuggestion[] = [];

  for (const lab of labStocks) {
    const { deficit, dailyNeed, minMiadDays } = lab;

    // FEFO uyumu: labdaki stoklar transfer edilecekten daha uzun miadlı mı?
    // Eğer labda stok yoksa (minMiadDays === Infinity) FEFO uyumu var demektir
    const fefoCompatible = lab.currentStock === 0 || minMiadDays > miadDays;

    // Lab dolu
    if (deficit <= 0) {
      suggestions.push({
        labId: lab.labId,
        labName: lab.labName,
        suggestedTransfer: 0,
        safeTransfer: 0,
        daysToConsume: 0,
        currentStock: lab.currentStock,
        maxStock: lab.maxStock,
        deficit: 0,
        dailyNeed,
        labMinMiadDays: minMiadDays === Infinity ? -1 : minMiadDays,
        fefoCompatible,
        confidenceScore: 0,
        status: 'not_suitable',
        statusReason: 'Laboratuvar max kapasitesinde',
        labItems: lab.items,
      });
      continue;
    }

    // Transfer adayı = min(açık, riskli kutu)
    const transferCandidate = Math.min(deficit, riskyBoxes);

    // Tüketim hızı kontrolü
    let safeTransfer: number;
    let daysToConsume: number;

    if (dailyNeed <= 0) {
      // Tüketim verisi yoksa, sadece açık kadar öner
      safeTransfer = transferCandidate;
      daysToConsume = Infinity;
    } else {
      daysToConsume = transferCandidate / dailyNeed;
      if (daysToConsume > miadDays) {
        // Lab bu kadarını miadında tüketemez → güvenli miktarı hesapla
        safeTransfer = Math.max(0, Math.floor(miadDays * dailyNeed));
      } else {
        safeTransfer = transferCandidate;
      }
    }

    // Skor hesaplama (0-100)
    let score = 0;

    if (safeTransfer > 0) {
      // 1. Tüketim marjı (ağırlık: 3) — miadından ne kadar önce tüketir
      const consumptionMargin = dailyNeed > 0
        ? Math.min(1, Math.max(0, (miadDays - (safeTransfer / dailyNeed)) / miadDays))
        : 0;

      // 2. Açık oranı (ağırlık: 2) — labın ne kadar boş alanı var
      const deficitRatio = lab.maxStock > 0 ? Math.min(1, deficit / lab.maxStock) : 0;

      // 3. FEFO uyumu (ağırlık: 5)
      const fefoScore = fefoCompatible ? 1 : 0;

      score = Math.round(
        ((consumptionMargin * 3) + (deficitRatio * 2) + (fefoScore * 5)) / 10 * 100
      );
    }

    // Durum belirleme
    let status: TransferSuggestion['status'];
    let statusReason: string;

    if (safeTransfer <= 0) {
      status = 'not_suitable';
      statusReason = 'Tüketim hızı yetersiz — miad dolmadan tüketilemez';
    } else if (!fefoCompatible) {
      status = 'possible';
      statusReason = 'Labda daha kısa miadlı stok var — FEFO sırası bozulabilir';
    } else if (score >= 70) {
      status = 'recommended';
      statusReason = 'Uygun — miadı içinde tüketilebilir';
    } else {
      status = 'possible';
      statusReason = 'Kısmi uygunluk — marj dar';
    }

    suggestions.push({
      labId: lab.labId,
      labName: lab.labName,
      suggestedTransfer: transferCandidate,
      safeTransfer,
      daysToConsume: dailyNeed > 0 ? Math.round(safeTransfer / dailyNeed) : Infinity,
      currentStock: lab.currentStock,
      maxStock: lab.maxStock,
      deficit,
      dailyNeed,
      labMinMiadDays: minMiadDays === Infinity ? -1 : minMiadDays,
      fefoCompatible,
      confidenceScore: score,
      status,
      statusReason,
      labItems: lab.items,
    });
  }

  // Sıralama: recommended > possible > not_suitable, sonra skora göre
  const statusOrder = { recommended: 0, possible: 1, not_suitable: 2 };
  suggestions.sort((a, b) => {
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.confidenceScore - a.confidenceScore;
  });

  return suggestions;
}

/**
 * Önerilere göre dağıtım yapar — kalan riskli kutuları en iyi lablardan başlayarak dağıtır.
 */
export function distributeRiskyBoxes(
  riskyBoxes: number,
  suggestions: TransferSuggestion[]
): TransferSuggestion[] {
  let remaining = riskyBoxes;

  return suggestions.map(s => {
    if (remaining <= 0 || s.safeTransfer <= 0) {
      return { ...s, safeTransfer: 0 };
    }
    const allocate = Math.min(s.safeTransfer, remaining);
    remaining -= allocate;
    return {
      ...s,
      safeTransfer: allocate,
      daysToConsume: s.dailyNeed > 0 ? Math.round(allocate / s.dailyNeed) : Infinity,
    };
  });
}
