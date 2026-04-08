'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';
import { withCompanyScope, filterByCompanyScope } from '@/lib/company-scope';
import type { MinMaxRule, ProductCode, YedekParcaDepoStokItem } from '@/lib/types';
import { addDoc, collection, getDocs, Timestamp } from 'firebase/firestore';
import { ArrowLeft, CheckCircle2, ClipboardList, History, Loader2, RefreshCw, ShoppingCart, Trash2, Warehouse } from 'lucide-react';

interface SparePartOrderItem {
  stokKodu: string;
  stokAdi: string;
  mevcut: number;
  max: number;
  siparisAdedi: number;
}

const makeDefaultOrderNo = () => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `YP-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
};

const normalizeCode = (value?: string | null) => String(value || '').trim().toUpperCase();
const canonicalCode = (value?: string | null) => {
  const normalized = normalizeCode(value);
  const stripped = normalized.replace(/^0+/, '');
  return stripped || normalized;
};

export default function YedekParcaSiparisPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentUserProfile, currentCompanyId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orderNo, setOrderNo] = useState(makeDefaultOrderNo());
  const [items, setItems] = useState<SparePartOrderItem[]>([]);

  const loadData = useCallback(async () => {
    if (!currentCompanyId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [rulesSnap, depoStockSnap, productsSnap] = await Promise.all([
        getDocs(collection(db, 'yedekParcaDepoMinMax', currentCompanyId, 'minMaxRules')),
        getDocs(collection(db, 'yedekParcaDepoStok')),
        getDocs(collection(db, 'productCodes')),
      ]);

      const rules = rulesSnap.docs
        .map((doc) => doc.data() as MinMaxRule)
        .filter((rule) => Boolean(rule.stokKodu));

      const depoStock = filterByCompanyScope(
        depoStockSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as YedekParcaDepoStokItem),
        currentCompanyId,
      );

      const products = filterByCompanyScope(
        productsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ProductCode),
        currentCompanyId,
      ).filter((product) => product.urunGrubu === 'yedek_parca');

      const productNameByCode = new Map<string, string>();
      for (const product of products) {
        const rawCode = product.stokKodu;
        if (!rawCode) continue;
        const nameCandidate = (
          product.stokAdi ||
          (product as any).urunAdi ||
          (product as any).name ||
          (product as any).ad ||
          ''
        ).trim();
        if (!nameCandidate) continue;
        const normalized = normalizeCode(rawCode);
        const canonical = canonicalCode(rawCode);
        if (!productNameByCode.has(normalized)) productNameByCode.set(normalized, nameCandidate);
        if (!productNameByCode.has(canonical)) productNameByCode.set(canonical, nameCandidate);
      }

      const stockNameByCode = new Map<string, string>();
      const currentByCode = new Map<string, number>();
      for (const stock of depoStock) {
        const code = normalizeCode(stock.stokKodu);
        const canonical = canonicalCode(stock.stokKodu);
        if (!code) continue;
        const prevQty = currentByCode.get(code) || 0;
        currentByCode.set(code, prevQty + (Number(stock.quantity) || 0));
        if (code !== canonical) {
          const canonicalQty = currentByCode.get(canonical) || 0;
          currentByCode.set(canonical, canonicalQty + (Number(stock.quantity) || 0));
        }
        if (!stockNameByCode.has(code) && stock.stokAdi?.trim()) {
          stockNameByCode.set(code, stock.stokAdi.trim());
        }
        if (!stockNameByCode.has(canonical) && stock.stokAdi?.trim()) {
          stockNameByCode.set(canonical, stock.stokAdi.trim());
        }
      }

      const autoItems = rules
        .map((rule) => {
          const code = normalizeCode(rule.stokKodu);
          const codeCanonical = canonicalCode(rule.stokKodu);
          const mevcut = currentByCode.get(code) || currentByCode.get(codeCanonical) || 0;
          const max = Number(rule.max) || 0;
          const siparisAdedi = Math.max(0, max - mevcut);
          const productName = productNameByCode.get(code) || productNameByCode.get(codeCanonical);
          const stockName = stockNameByCode.get(code) || stockNameByCode.get(codeCanonical);

          return {
            stokKodu: code,
            stokAdi: stockName || productName || rule.stokKodu || code,
            mevcut,
            max,
            siparisAdedi,
          };
        })
        .filter((item) => item.siparisAdedi > 0)
        .sort((a, b) => b.siparisAdedi - a.siparisAdedi);

      setItems(autoItems);
    } catch (error) {
      console.error('Yedek parça sipariş paneli verileri yüklenemedi:', error);
      toast({ title: 'Hata', description: 'Sipariş paneli verileri yüklenirken bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totals = useMemo(() => {
    const kalem = items.length;
    const toplamSiparis = items.reduce((sum, item) => sum + item.siparisAdedi, 0);
    return { kalem, toplamSiparis };
  }, [items]);

  const updateQty = (stokKodu: string, qty: number) => {
    const safeQty = Number.isFinite(qty) ? Math.max(1, Math.floor(qty)) : 1;
    setItems((prev) => prev.map((item) => (item.stokKodu === stokKodu ? { ...item, siparisAdedi: safeQty } : item)));
  };

  const removeRow = (stokKodu: string) => {
    setItems((prev) => prev.filter((item) => item.stokKodu !== stokKodu));
  };

  const handleSaveOrder = async () => {
    if (!currentCompanyId || !currentUserProfile?.uid) {
      toast({ title: 'Yetki Hatası', description: 'Sipariş kaydı için kullanıcı bilgisi bulunamadı.', variant: 'destructive' });
      return;
    }

    if (!orderNo.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Lütfen sipariş numarası girin.', variant: 'destructive' });
      return;
    }

    if (items.length === 0) {
      toast({ title: 'Sipariş Yok', description: 'Kaydedilecek sipariş kalemi bulunamadı.' });
      return;
    }

    setSaving(true);
    try {
      await addDoc(collection(db, 'yedekParcaSiparisler'), withCompanyScope({
        type: 'auto_max_replenishment',
        status: 'draft',
        orderNo: orderNo.trim(),
        orderName: `Yedek Parça Sipariş - ${orderNo.trim()}`,
        createdAt: Timestamp.fromDate(new Date()),
        createdByUid: currentUserProfile.uid,
        createdByName: currentUserProfile.name || currentUserProfile.email || 'Bilinmeyen Kullanıcı',
        target: 'spare_parts_depot',
        totalItems: totals.kalem,
        totalQuantity: totals.toplamSiparis,
        items,
      }, currentCompanyId));

      toast({ title: 'Başarılı', description: `${orderNo.trim()} numaralı sipariş taslak olarak kaydedildi.` });
      setOrderNo(makeDefaultOrderNo());
    } catch (error) {
      console.error('Yedek parça sipariş kaydı başarısız:', error);
      toast({ title: 'Kayıt Hatası', description: 'Sipariş taslağı kaydedilemedi.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="cihaz-card-strong p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" style={{ color: 'var(--dashboard-accent)' }} />
            <h1 className="text-sm font-bold" style={{ color: 'var(--dashboard-text)' }}>Yedek Parça Sipariş Paneli</h1>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--dashboard-muted)' }}>
            Depo Min/Max kurallarına göre eksik stokları otomatik tamamlar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => router.push('/direkt-transfer/yedek-parca-transfer?section=depo-stok')} className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>
            <ArrowLeft className="w-3.5 h-3.5" /> Depo Stok
          </button>
          <button onClick={() => router.push('/direkt-transfer/yedek-parca-transfer/siparis/gecmis')} className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium" style={{ color: 'var(--dashboard-text)' }}>
            <History className="w-3.5 h-3.5" /> Sipariş Geçmişi
          </button>
          <button onClick={() => void loadData()} disabled={loading} className="cihaz-tool-item inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium disabled:opacity-50" style={{ color: 'var(--dashboard-text)' }}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Yenile
          </button>
          <button onClick={handleSaveOrder} disabled={saving || loading || items.length === 0} className="cihaz-action-tile inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--dashboard-accent)' }}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardList className="w-3.5 h-3.5" />} Siparişi Kaydet
          </button>
        </div>
      </div>

      <div className="cihaz-card p-3">
        <label className="text-[11px] font-semibold" style={{ color: 'var(--dashboard-muted)' }}>Sipariş Numarası</label>
        <input
          value={orderNo}
          onChange={(e) => setOrderNo(e.target.value)}
          placeholder="Örn: YP-20260408-001"
          className="w-full mt-1 px-3 py-2 text-sm rounded-xl border outline-none"
          style={{ borderColor: 'var(--dashboard-stroke)', background: 'var(--dashboard-surface)', color: 'var(--dashboard-text)' }}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="cihaz-card p-3">
          <p className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>Sipariş Kalemi</p>
          <p className="text-xl font-bold" style={{ color: 'var(--dashboard-text)' }}>{totals.kalem}</p>
        </div>
        <div className="cihaz-card p-3">
          <p className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>Toplam Sipariş Miktarı</p>
          <p className="text-xl font-bold" style={{ color: 'var(--dashboard-text)' }}>{totals.toplamSiparis}</p>
        </div>
        <div className="cihaz-card p-3">
          <p className="text-[11px]" style={{ color: 'var(--dashboard-muted)' }}>Hedef</p>
          <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--dashboard-text)' }}><Warehouse className="w-3.5 h-3.5" /> Yedek Parça Deposu</p>
        </div>
      </div>

      <div className="cihaz-card overflow-hidden">
        <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--dashboard-stroke)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--dashboard-text)' }}>Otomatik Sipariş Listesi</p>
        </div>

        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2" style={{ color: 'var(--dashboard-muted)' }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Veriler hazırlanıyor...
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center" style={{ color: 'var(--dashboard-muted)' }}>
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium">Şu an sipariş gerektiren eksik stok bulunmuyor.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ background: 'var(--dashboard-surface-2)' }}>
                  <th className="px-3 py-2 font-semibold">Stok Kodu</th>
                  <th className="px-3 py-2 font-semibold">Stok Adı</th>
                  <th className="px-3 py-2 font-semibold text-right">Mevcut</th>
                  <th className="px-3 py-2 font-semibold text-right">Max</th>
                  <th className="px-3 py-2 font-semibold text-right">Sipariş Adedi</th>
                  <th className="px-3 py-2 font-semibold text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.stokKodu} className="border-t" style={{ borderColor: 'var(--dashboard-stroke)' }}>
                    <td className="px-3 py-2 font-mono">{item.stokKodu}</td>
                    <td className="px-3 py-2 text-[13px] font-medium">{item.stokAdi}</td>
                    <td className="px-3 py-2 text-right">{item.mevcut}</td>
                    <td className="px-3 py-2 text-right">{item.max}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end items-center gap-1.5">
                        <button onClick={() => updateQty(item.stokKodu, item.siparisAdedi - 1)} className="cihaz-tool-item w-7 h-7 text-sm">-</button>
                        <input
                          type="number"
                          min={1}
                          value={item.siparisAdedi}
                          onChange={(e) => updateQty(item.stokKodu, Number(e.target.value || 1))}
                          className="w-20 text-center text-lg font-bold rounded-lg border"
                          style={{ borderColor: 'var(--dashboard-stroke)', background: 'var(--dashboard-surface)', color: 'var(--dashboard-accent)' }}
                        />
                        <button onClick={() => updateQty(item.stokKodu, item.siparisAdedi + 1)} className="cihaz-tool-item w-7 h-7 text-sm">+</button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => removeRow(item.stokKodu)} className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-red-50">
                        <Trash2 className="w-4 h-4" style={{ color: '#B91C1C' }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
