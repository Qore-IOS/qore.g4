'use client';
import { useEffect, useMemo, useState } from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { DepoStokItem } from '@/lib/types';
import { cn, generateId } from '@/lib/utils';
import { TrackingMode } from '@/lib/tracking';

export type TransferRow = DepoStokItem & { adet?: number; isGroup?: boolean };

type ProductOption = { code: string; name: string; tracking: TrackingMode };

function ManualInlineAdder({
  visible,
  onClose,
  depotName,
  stockPool,
  transferRows,
  products, // only manual modes will be passed in
  onAddLots, // ({ code, name, selections: { [lotKey]: qty }, lotMeta: { [lotKey]: { lot, miad } } })
  onAddQty,  // ({ code, name, qty })
}: {
  visible: boolean;
  onClose: () => void;
  depotName: string;
  stockPool: DepoStokItem[];
  transferRows: TransferRow[];
  products: ProductOption[];          // filtered to lot_manual | qty_manual
  onAddLots: (args: { code: string; name: string; selections: Record<string, number>; lotMeta: Record<string, { lot: string; miad: string }> }) => void;
  onAddQty: (args: { code: string; name: string; qty: number }) => void;
}) {
  const [code, setCode] = useState<string>('');
  const [qtyInline, setQtyInline] = useState<number>(1);

  // Lot editor dialog state
  const [lotOpen, setLotOpen] = useState(false);
  const [lotSelections, setLotSelections] = useState<Record<string, number>>({}); // key -> qty
  const [lotMeta, setLotMeta] = useState<Record<string, { lot: string; miad: string }>>({});

  const chosen = useMemo(() => products.find(p => p.code === code), [products, code]);

  // Helpers
  const availableCountFor = (pool: DepoStokItem[], stokKodu: string, lot?: string) =>
    pool.filter(s => s.stokKodu === stokKodu && !s.isShipped && (lot ? s.lotNumarasi === lot : true)).length;

  const allocatedCountFor = (rows: TransferRow[], stokKodu: string, lot?: string) =>
    rows
      .filter(r => r.stokKodu === stokKodu && (lot ? r.lotNumarasi === lot : !r.lotNumarasi))
      .reduce((n, r) => n + (r.isGroup ? (r.adet ?? 1) : 1), 0);

  // For qty_manual — remaining total across lots
  const totalRemaining = useMemo(() => {
    if (!chosen || chosen.tracking !== 'qty_manual') return 0;
    const avail = availableCountFor(stockPool, chosen.code);
    const alloc = allocatedCountFor(transferRows, chosen.code);
    return Math.max(0, avail - alloc);
  }, [chosen, stockPool, transferRows]);

  // For lot_manual — group stock by lot and compute remaining per lot
  const lotRows = useMemo(() => {
    if (!chosen || chosen.tracking !== 'lot_manual') return [];
    const pool = stockPool.filter(s => s.stokKodu === chosen.code && !s.isShipped);
    const byLot = new Map<string, { lot: string; miad: string; available: number; allocated: number }>();
    for (const s of pool) {
      const key = `${s.lotNumarasi}__${s.miad}`;
      const rec = byLot.get(key) || { lot: s.lotNumarasi || '', miad: s.miad || '', available: 0, allocated: 0 };
      rec.available += 1;
      byLot.set(key, rec);
    }
    // allocations from current transfer list
    for (const r of transferRows.filter(r => r.stokKodu === chosen.code && r.isGroup && r.lotNumarasi)) {
      const key = `${r.lotNumarasi}__${r.miad}`;
      const rec = byLot.get(key);
      if (rec) rec.allocated += (r.adet ?? 1);
    }
    return Array.from(byLot.entries()).map(([key, rec]) => ({
      key, lot: rec.lot, miad: rec.miad,
      remaining: Math.max(0, rec.available - rec.allocated),
    })).sort((a, b) => a.miad.localeCompare(b.miad));
  }, [chosen, stockPool, transferRows]);

  // Open lot dialog as soon as a lot_manual product picked
  useEffect(() => {
    if (chosen?.tracking === 'lot_manual') {
      // prepare selections with zeroed entries
      const meta: Record<string, { lot: string; miad: string }> = {};
      const init: Record<string, number> = {};
      lotRows.forEach(r => { meta[r.key] = { lot: r.lot, miad: r.miad }; init[r.key] = 0; });
      setLotMeta(meta);
      setLotSelections(init);
      setLotOpen(true);
    }
  }, [chosen?.tracking, lotRows]);

  const onSaveLots = () => {
    // clamp to remaining and ignore zeros
    const clamped: Record<string, number> = {};
    for (const r of lotRows) {
      const v = Math.max(0, Math.min(lotSelections[r.key] || 0, r.remaining));
      if (v > 0) clamped[r.key] = v;
    }
    if (Object.keys(clamped).length === 0) {
      setLotOpen(false);
      return;
    }
    onAddLots({ code: chosen!.code, name: chosen!.name, selections: clamped, lotMeta });
    setLotOpen(false);
    setCode(''); // reset row
  };

  const addQtyInline = () => {
    if (!chosen) return;
    const qty = Math.max(1, Math.min(Number(qtyInline) || 1, totalRemaining));
    if (qty <= 0) return;
    onAddQty({ code: chosen.code, name: chosen.name, qty });
    setCode('');
    setQtyInline(1);
  };

  if (!visible) return null;

  return (
    <div className="mt-2 rounded-xl border bg-background/40 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[280px]">
          <div className="text-xs text-muted-foreground mb-1">Ürün Seç</div>
          <Select value={code} onValueChange={setCode}>
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder={depotName ? `${depotName} stoklarından` : 'Ürün seçin'} />
            </SelectTrigger>
            <SelectContent>
              {products.map(p => (
                <SelectItem key={p.code} value={p.code}>
                  {p.name} • {p.code} {p.tracking === 'qty_manual' ? '— Adet Manuel' : '— Lot Manuel'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* qty_manual inline input */}
        {chosen?.tracking === 'qty_manual' && (
          <>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Adet (Kalan: {totalRemaining})</div>
              <Input
                type="number" min={1}
                max={Math.max(1, totalRemaining)}
                value={qtyInline}
                onChange={(e) => setQtyInline(Number(e.target.value) || 1)}
                className="w-28"
              />
            </div>
            <Button onClick={addQtyInline} disabled={totalRemaining <= 0}>Ekle</Button>
          </>
        )}
      </div>

      {/* Lot picker dialog */}
      <Dialog open={lotOpen} onOpenChange={setLotOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Lot Seçimi — {chosen?.name} ({chosen?.code})</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            {lotRows.length === 0 && (
              <div className="text-sm text-muted-foreground">Bu ürüne ait kullanılabilir lot bulunamadı.</div>
            )}
            {lotRows.map(({ key, lot, miad, remaining }) => (
              <div key={key} className={cn('flex items-center justify-between gap-3 rounded-md border px-3 py-2')}>
                <div className="text-sm">
                  <div className="font-medium">{lot || '—'}</div>
                  <div className="text-xs text-muted-foreground">Miad: {miad || '—'} • Kalan: {remaining}</div>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={remaining}
                  value={lotSelections[key] ?? 0}
                  onChange={(e) => setLotSelections(s => ({ ...s, [key]: Math.max(0, Math.min(Number(e.target.value) || 0, remaining)) }))}
                  className="w-24"
                />
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button onClick={onSaveLots} disabled={lotRows.every(r => (lotSelections[r.key] ?? 0) <= 0)}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ManualInlineAdder;
