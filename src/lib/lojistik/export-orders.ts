'use client';

/**
 * Shared workbook builder for peripheral order exports. Produces a multi-sheet
 * .xlsx covering: order summary, line items, irsaliye deliveries, delivery
 * line items, and any "extras" (irsaliye products not part of the closed
 * order). All rows include the order id + hospital so downstream pivots can
 * join sheets together.
 */

import * as XLSX from 'xlsx';
import { format as formatDate } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Timestamp } from '../data/client';
import type { Order } from '@/lib/types';

function tsToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (
    typeof value === 'object' &&
    value &&
    'toDate' in (value as any) &&
    typeof (value as any).toDate === 'function'
  ) {
    return (value as any).toDate();
  }
  return null;
}

function fmt(date: Date | null): string {
  return date ? formatDate(date, 'dd.MM.yyyy HH:mm', { locale: tr }) : '';
}

function statusLabel(s: string | undefined): string {
  switch (s) {
    case 'pending':
      return 'Beklemede';
    case 'toplaniyor':
      return 'Hazırlanıyor';
    case 'completed':
      return 'Teslim Edildi';
    case 'eksik':
      return 'Eksik';
    case 'cancelled':
      return 'İptal';
    default:
      return s ?? '';
  }
}

function autoFitColumns(rows: any[], headers: string[]) {
  return headers.map((h) => {
    let max = String(h).length;
    for (const r of rows) {
      const v = r[h];
      const len = v == null ? 0 : String(v).length;
      if (len > max) max = len;
    }
    return { wch: Math.min(60, Math.max(10, max + 2)) };
  });
}

export interface ExportOrdersOptions {
  /** Optional name → file is `<name>_<timestamp>.xlsx`. Default: 'siparisler'. */
  fileBaseName?: string;
  /** Hospital id → name lookup so labId-only orders still get a readable name. */
  hospitalNameById?: Map<string, string>;
  /** stokKodu → human name lookup for product name columns. */
  productNameByStokKodu?: Map<string, string>;
}

export function exportOrdersToExcel(
  orders: Order[],
  opts: ExportOrdersOptions = {}
): void {
  const productName = (stokKodu: string) =>
    opts.productNameByStokKodu?.get(stokKodu) || '';
  const hospitalName = (o: Order) =>
    o.kurumAdi ||
    (o.labId ? opts.hospitalNameById?.get(o.labId) ?? '' : '');

  // ---------- Sheet 1: Siparişler ----------
  const ordersRows = orders.map((o) => {
    const items = o.items ?? [];
    const fulfillment: any = (o as any).peripheralFulfillment ?? {};
    const fItems: any[] = fulfillment?.items ?? [];
    const partials: any[] = fulfillment?.partialDeliveries ?? [];
    const fByItemId = new Map(fItems.map((it: any) => [it.itemId, it]));

    const totalRequested = items.reduce(
      (s, it) => s + (Number(it.adet) || 0),
      0
    );
    const totalApproved = items.reduce((s, it, idx) => {
      const f = fByItemId.get(it.id ?? `${o.id}-${idx}`);
      const sent = Number(f?.sentAdet ?? it.adet) || 0;
      return s + sent;
    }, 0);
    const totalDelivered = fItems.reduce(
      (s: number, it: any) => s + (Number(it.deliveredAdet) || 0),
      0
    );
    const totalMissing = fItems.reduce(
      (s: number, it: any) => s + (Number(it.missingAdet) || 0),
      0
    );

    const created = tsToDate(o.createdAt as any);
    const approved = tsToDate((o as any).approvedAt);
    const transferred = tsToDate((o as any).transferredAt);
    const partialDates = partials
      .map((p) => tsToDate(p.at))
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime());

    const orderNo =
      ((o.id ?? '').slice(-6) || '').toUpperCase();

    return {
      'Sipariş No': orderNo ? `ORD-${orderNo}` : '',
      'Sipariş ID': o.id ?? '',
      'Durum': statusLabel(o.status),
      'Kurum': hospitalName(o),
      'Lab ID': o.labId ?? '',
      'Kalem Sayısı': items.length,
      'Talep Adet': totalRequested,
      'Onaylanan Adet': totalApproved,
      'Teslim Adet': totalDelivered,
      'Eksik Adet': totalMissing,
      'İrsaliye Sayısı': partials.length,
      'Oluşturma': fmt(created),
      'Oluşturan': o.createdBy ?? '',
      'Onay Tarihi': fmt(approved),
      'Onaylayan': (o as any).approvedBy ?? '',
      'İlk Teslim': fmt(partialDates[0] ?? null),
      'Son Teslim': fmt(partialDates[partialDates.length - 1] ?? null),
      'Tam Teslim Tarihi': fmt(transferred),
      'Tam Teslim Eden': (o as any).transferredBy ?? '',
    };
  });

  // ---------- Sheet 2: Sipariş Kalemleri ----------
  const itemRows: any[] = [];
  orders.forEach((o) => {
    const items = o.items ?? [];
    const fulfillment: any = (o as any).peripheralFulfillment ?? {};
    const fByItemId = new Map(
      (fulfillment?.items ?? []).map((it: any) => [it.itemId, it])
    );
    const orderNo =
      ((o.id ?? '').slice(-6) || '').toUpperCase();
    items.forEach((it, idx) => {
      const itemId = it.id ?? `${o.id}-${idx}`;
      const f: any = fByItemId.get(itemId) ?? {};
      itemRows.push({
        'Sipariş No': orderNo ? `ORD-${orderNo}` : '',
        'Sipariş ID': o.id ?? '',
        'Kurum': hospitalName(o),
        'Stok Kodu': it.stokKodu ?? '',
        'Ürün Adı':
          productName(it.stokKodu ?? '') ||
          it.stokAdi ||
          '',
        'Talep Adet': Number(it.adet) || 0,
        'Onaylanan Adet': Number(f.sentAdet ?? it.adet) || 0,
        'Teslim Adet': Number(f.deliveredAdet) || 0,
        'Eksik Adet': Number(f.missingAdet) || 0,
        'Durum': f.fulfilled
          ? 'Tamamlandı'
          : (Number(f.deliveredAdet) || 0) > 0
            ? 'Kısmi'
            : 'Bekliyor',
      });
    });
  });

  // ---------- Sheet 3: İrsaliye Teslimleri ----------
  const deliveryRows: any[] = [];
  orders.forEach((o) => {
    const partials: any[] = (o as any).peripheralFulfillment?.partialDeliveries ?? [];
    const orderNo = ((o.id ?? '').slice(-6) || '').toUpperCase();
    partials.forEach((p) => {
      const pItems: any[] = p.items ?? [];
      const totalDelivered = pItems.reduce(
        (s, it) => s + (Number(it.deliveredAdet) || 0),
        0
      );
      const totalMissing = pItems.reduce(
        (s, it) => s + (Number(it.missingAdet) || 0),
        0
      );
      const extras: any[] = p.extras ?? [];
      deliveryRows.push({
        'Sipariş No': orderNo ? `ORD-${orderNo}` : '',
        'Sipariş ID': o.id ?? '',
        'Kurum': hospitalName(o),
        'Tarih': fmt(tsToDate(p.at)),
        'Teslim Eden': p.actorName ?? '',
        'İrsaliye Dosyası': p.irsaliyeFileName ?? '',
        'İrsaliye Dosya ID': p.irsaliyeFileId ?? '',
        'Kalem Sayısı': pItems.length,
        'Teslim Toplam Adet': totalDelivered,
        'Eksik Toplam Adet': totalMissing,
        'Fazla Kalem Sayısı': extras.length,
      });
    });
  });

  // ---------- Sheet 4: İrsaliye Kalem Detayları ----------
  const deliveryItemRows: any[] = [];
  orders.forEach((o) => {
    const partials: any[] = (o as any).peripheralFulfillment?.partialDeliveries ?? [];
    const orderNo = ((o.id ?? '').slice(-6) || '').toUpperCase();
    partials.forEach((p) => {
      const pItems: any[] = p.items ?? [];
      pItems.forEach((it) => {
        deliveryItemRows.push({
          'Sipariş No': orderNo ? `ORD-${orderNo}` : '',
          'Sipariş ID': o.id ?? '',
          'Kurum': hospitalName(o),
          'Tarih': fmt(tsToDate(p.at)),
          'İrsaliye Dosyası': p.irsaliyeFileName ?? '',
          'Stok Kodu': it.stokKodu ?? '',
          'Ürün Adı': productName(it.stokKodu ?? ''),
          'Teslim Adet': Number(it.deliveredAdet) || 0,
          'Eksik Adet': Number(it.missingAdet) || 0,
        });
      });
    });
  });

  // ---------- Sheet 5: Fazla Kalemler (Extras) ----------
  const extrasRows: any[] = [];
  orders.forEach((o) => {
    const partials: any[] = (o as any).peripheralFulfillment?.partialDeliveries ?? [];
    const orderNo = ((o.id ?? '').slice(-6) || '').toUpperCase();
    partials.forEach((p) => {
      const extras: any[] = p.extras ?? [];
      extras.forEach((e) => {
        extrasRows.push({
          'Sipariş No': orderNo ? `ORD-${orderNo}` : '',
          'Sipariş ID': o.id ?? '',
          'Kurum': hospitalName(o),
          'İrsaliye Tarihi': fmt(tsToDate(p.at)),
          'İrsaliye Dosyası': p.irsaliyeFileName ?? '',
          'Stok Kodu': e.stokKodu ?? '',
          'Ürün Adı': productName(e.stokKodu ?? ''),
          'Fazla Adet': Number(e.adet) || 0,
        });
      });
    });
  });

  const wb = XLSX.utils.book_new();

  const append = (rows: any[], name: string) => {
    if (rows.length === 0) {
      // Still emit an empty sheet with headers for downstream consistency.
      const ws = XLSX.utils.aoa_to_sheet([['(kayıt yok)']]);
      XLSX.utils.book_append_sheet(wb, ws, name);
      return;
    }
    const headers = Object.keys(rows[0]);
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    (ws as any)['!cols'] = autoFitColumns(rows, headers);
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  append(ordersRows, 'Siparişler');
  append(itemRows, 'Sipariş Kalemleri');
  append(deliveryRows, 'İrsaliye Teslimleri');
  append(deliveryItemRows, 'İrsaliye Kalemleri');
  append(extrasRows, 'Fazla Kalemler');

  const stamp = formatDate(new Date(), 'yyyyMMdd_HHmm');
  const base = (opts.fileBaseName || 'siparisler').replace(/[^a-z0-9_-]+/gi, '_');
  XLSX.writeFile(wb, `${base}_${stamp}.xlsx`);
}
