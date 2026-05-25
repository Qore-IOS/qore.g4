'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import NextImage from 'next/image';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Loader2, Search, Trash2, ChevronLeft, MapPin, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, query, where, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/firestore-helpers';
import { useIconMappings, getIconSrc } from '@/hooks/useIconMappings';

interface Asset {
  id: string;
  category: string;
  demirbasNo: string;
  urunKodu: string;
  urunAdi: string;
  marka: string;
  model: string;
  konum: string;
  teslimEdilenPersonel: string;
  aciklama: string;
  seriNumarasi?: string;
  durum?: 'iyi' | 'orta' | 'kötü' | 'çok kötü';
  alimFiyatiTl?: number;
  zimmetliKisi?: string;
}

export default function AssetLocationPage() {
  const params = useParams();
  const router = useRouter();
  const locationName = decodeURIComponent(Array.isArray(params.locationName) ? params.locationName[0] : params.locationName || '');
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const iconData = useIconMappings();
  const envanterIcons = iconData?.mappings?.envanter || {};

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchData = useCallback(async () => {
    if (!locationName) return;
    setLoading(true);
    try {
      const assetsSnap = await getDocs(scopedQuery('assets', currentCompanyId, isSuperAdmin, where('konum', '==', locationName)));
      setAssets(
        filterByCompanyScope(
          assetsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Asset)),
          currentCompanyId,
          isSuperAdmin
        )
      );
    } catch {
      toast({ title: 'Hata', description: 'Bu konuma ait veriler yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [locationName, toast, currentCompanyId, isSuperAdmin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredAssets = useMemo(() => {
    if (!searchTerm) return assets;
    const lowerSearch = searchTerm.toLowerCase();
    return assets.filter(asset => Object.values(asset).some(val => String(val).toLowerCase().includes(lowerSearch)));
  }, [assets, searchTerm]);

  const stats = useMemo(
    () => ({
      total: assets.length,
      categories: new Set(assets.map(a => a.category).filter(Boolean)).size,
      assigned: assets.filter(a => Boolean(a.zimmetliKisi || a.teslimEdilenPersonel)).length,
      totalCost: assets.reduce((sum, a) => sum + (Number(a.alimFiyatiTl) || 0), 0),
    }),
    [assets]
  );

  const handleDelete = async (id: string) => {
    if (!confirm('Bu kaydı silmek istediğinizden emin misiniz?')) return;
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'assets', id));
      toast({ title: 'Silindi', description: 'Envanter kaydı silindi.', variant: 'destructive' });
      fetchData();
    } catch {
      toast({ title: 'Hata', description: 'Silme işlemi başarısız oldu.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cihaz-shell min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-24">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Link
              href="/yonetim/envanter-yonetimi"
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="flex-1 flex items-center justify-center">
              <div className="relative pl-14 min-h-[68px] flex flex-col justify-center">
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center overflow-visible">
                  <MapPin className="w-9 h-9 text-[var(--dashboard-accent)]" />
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)] capitalize">{locationName}</h1>
                <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">Bu konumda bulunan tüm demirbaş envanteri</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Toplam', value: stats.total },
            { label: 'Kategori', value: stats.categories, color: 'text-sky-500' },
            { label: 'Zimmetli', value: stats.assigned, color: 'text-amber-500' },
            { label: 'Maliyet', value: `${stats.totalCost.toLocaleString('tr-TR')} ₺`, color: 'text-[var(--dashboard-accent)]' },
          ].map((s, i) => (
            <div key={i} className="cihaz-pressed px-4 py-3 flex items-center gap-3">
              <span className={`text-lg font-bold ${s.color || 'text-[var(--dashboard-text)]'}`}>{s.value}</span>
              <span className="text-[11px] text-[var(--dashboard-muted)]">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="cihaz-card-strong p-5 sm:p-6">
          <div className="relative w-full sm:w-72 mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--dashboard-muted)]" />
            <input
              type="text"
              placeholder="Ürün, kategori veya personel ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-xl text-sm bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)] outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/30"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
            </div>
          ) : (
            <ScrollArea className="h-[60vh]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--dashboard-stroke)]">
                    <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Kategori</th>
                    <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Demirbaş No</th>
                    <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Ürün Adı</th>
                    <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Seri No</th>
                    <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Durum</th>
                    <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Marka / Model</th>
                    <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Personel</th>
                    <th className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">Fiyat</th>
                    <th className="text-right py-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--dashboard-muted)]">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssets.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-[var(--dashboard-muted)]">Bu konum için kayıtlı ürün yok veya filtre ile eşleşmiyor.</td>
                    </tr>
                  ) : (
                    filteredAssets.map(asset => {
                      const categoryIcon = envanterIcons[asset.category];
                      return (
                        <tr
                          key={asset.id}
                          className="border-b border-[var(--dashboard-stroke)]/60 hover:bg-[var(--dashboard-surface-2)]/45 transition-colors cursor-pointer"
                          onClick={() => router.push(`/yonetim/envanter-yonetimi/${encodeURIComponent(asset.category)}/${asset.id}`)}
                        >
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-9 h-9 flex items-center justify-center shrink-0">
                                {categoryIcon ? (
                                  <NextImage src={getIconSrc(categoryIcon)} alt="" width={32} height={32} className="object-contain" />
                                ) : (
                                  <Package className="w-5 h-5 text-[var(--dashboard-muted)]" />
                                )}
                              </div>
                              <span className="font-medium text-[var(--dashboard-text)]">{asset.category || '-'}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono text-xs text-[var(--dashboard-text)]">{asset.demirbasNo || '-'}</td>
                          <td className="py-2 px-3 text-[var(--dashboard-text)]">{asset.urunAdi || '-'}</td>
                          <td className="py-2 px-3 font-mono text-xs text-[var(--dashboard-text)]">{asset.seriNumarasi || '-'}</td>
                          <td className="py-2 px-3 capitalize text-[var(--dashboard-text)]">{asset.durum || '-'}</td>
                          <td className="py-2 px-3 text-[var(--dashboard-text)]">{[asset.marka, asset.model].filter(Boolean).join(' / ') || '-'}</td>
                          <td className="py-2 px-3 text-[var(--dashboard-text)]">{asset.teslimEdilenPersonel || '-'}</td>
                          <td className="py-2 px-3 text-[var(--dashboard-text)]">{typeof asset.alimFiyatiTl === 'number' ? asset.alimFiyatiTl.toLocaleString('tr-TR') : '-'}</td>
                          <td className="py-2 px-3 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(asset.id);
                              }}
                              disabled={loading}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--dashboard-muted)] hover:text-red-500 hover:bg-[var(--dashboard-surface-2)]"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
}
