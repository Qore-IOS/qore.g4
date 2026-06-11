'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getDocsResilient } from '@/lib/firestore-network-recovery';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Loader2, QrCode, Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import { generateLabelsPdf } from '@/lib/pdf/LabelGenerator';
import type { Asset } from '@/lib/pdf/LabelGenerator';


type Grouped = Record<string, Asset[]>;

interface LabelPrinterProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assetDetailBasePath?: string;
  logoPath?: string;
}

export default function LabelPrinter({
  open,
  onOpenChange,
  assetDetailBasePath,
  logoPath = '/A0D5B407-8ADE-4410-B97B-520A830DA0FF.PNG',
}: LabelPrinterProps) {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [assetsByLocation, setAssetsByLocation] = useState<Grouped>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');

  const loadAssets = useCallback(async () => {
    setIsLoading(true);
    try {
      // only locations that actually have assets (konum not empty)
      const qAssets = scopedQuery('assets', currentCompanyId, isSuperAdmin, where('konum', '!=', ''));
      const snap = await getDocsResilient(qAssets);
      const items: Asset[] = snap.docs.map((d) => {
        const dt = d.data() as any;
        return {
          id: d.id,
          demirbasNo: dt.demirbasNo ?? d.id,
          urunAdi: dt.urunAdi ?? '',
          konum: dt.konum ?? 'Bilinmiyor',
          category: dt.category ?? 'Bilinmeyen Kategori'
        };
      });

      // group by konum
      const grouped: Grouped = items.reduce((acc, a) => {
        (acc[a.konum] = acc[a.konum] || []).push(a);
        return acc;
      }, {} as Grouped);

      // sort inside each group for deterministic UI
      Object.keys(grouped).forEach((k) => {
        grouped[k].sort((a, b) => (a.demirbasNo || '').localeCompare(b.demirbasNo || ''));
      });

      setAssetsByLocation(grouped);
      setExpanded(Object.keys(grouped)); // open all initially
    } catch (e) {
      console.error(e);
      toast({
        title: 'Veri Yüklenemedi',
        description: 'Varlıklar alınırken bir hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) {
      loadAssets();
      setSelected({});
      setSearch('');
    }
  }, [open, loadAssets]);

  const filteredLocations = useMemo(() => {
    if (!search.trim()) return Object.keys(assetsByLocation);
    const s = search.toLowerCase();
    return Object.keys(assetsByLocation).filter((loc) => loc.toLowerCase().includes(s));
  }, [assetsByLocation, search]);

  const allVisibleAssetIds = useMemo(() => {
    const ids: string[] = [];
    filteredLocations.forEach((loc) => {
      assetsByLocation[loc]?.forEach((a) => ids.push(a.id));
    });
    return ids;
  }, [assetsByLocation, filteredLocations]);

  const locationSelectState = (loc: string) => {
    const list = assetsByLocation[loc] || [];
    const checkedCount = list.filter((a) => selected[a.id]).length;
    return {
      all: list.length > 0 && checkedCount === list.length,
      some: checkedCount > 0 && checkedCount < list.length,
    };
  };

  const toggleLocationAll = (loc: string) => {
    const list = assetsByLocation[loc] || [];
    const { all } = locationSelectState(loc);
    const next = { ...selected };
    list.forEach((a) => {
      next[a.id] = !all;
    });
    setSelected(next);
  };

  const toggleAsset = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAllVisible = () => {
    const next = { ...selected };
    let setTrue = false;
    const allSelected = allVisibleAssetIds.every((id) => next[id]);
    if (!allSelected) setTrue = true;
    allVisibleAssetIds.forEach((id) => (next[id] = setTrue));
    setSelected(next);
  };

  const buildAssetUrl = (asset: Asset) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const base = assetDetailBasePath ?? '/yonetim/envanter-yonetimi';
    return `${origin}${base}/${encodeURIComponent(asset.category || 'diger')}/${asset.id}`;
  };

  const makePdf = async () => {
    const chosenAssets: Asset[] = [];
    Object.keys(selected).forEach((id) => {
      if (selected[id]) {
        // find asset
        for (const loc of Object.keys(assetsByLocation)) {
          const found = assetsByLocation[loc].find((a) => a.id === id);
          if (found) {
            chosenAssets.push(found);
            break;
          }
        }
      }
    });

    if (chosenAssets.length === 0) {
      toast({ title: 'Seçim Yapılmadı', description: 'En az bir ürün seçmelisiniz.' });
      return;
    }

    setIsLoading(true);
    try {
      await generateLabelsPdf({
          assets: chosenAssets,
          buildAssetUrl: buildAssetUrl,
          logoPath: logoPath
      });
      toast({ title: 'PDF Hazır', description: 'Etiketler başarıyla oluşturuldu.' });
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast({
        title: 'PDF Oluşturulamadı',
        description: 'Etiket PDF’i hazırlanırken bir hata oluştu.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const totalSelected = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Envanter Etiket Yazdır
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 py-2">
          <Input
            placeholder="Konum ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Button variant="secondary" onClick={selectAllVisible}>
            Görünenlerin Tümünü Seç
          </Button>
          <div className="text-sm text-muted-foreground ml-auto">
            Seçili ürün: <span className="font-medium">{totalSelected}</span>
          </div>
        </div>

        <ScrollArea className="h-[60vh] border rounded-xl">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Varlıklar yükleniyor...
            </div>
          ) : filteredLocations.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Ürün bulunan bir konum yok.</div>
          ) : (
            <Accordion
              type="multiple"
              value={expanded}
              onValueChange={(v) => setExpanded(v as string[])}
              className="p-2"
            >
              {filteredLocations.map((loc) => {
                const { all, some } = locationSelectState(loc);
                const assets = assetsByLocation[loc] || [];
                return (
                  <AccordionItem key={loc} value={loc} className="border rounded-lg mb-2">
                    <AccordionTrigger className="px-4">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={all}
                          onCheckedChange={() => toggleLocationAll(loc)}
                          className={some ? 'data-[state=indeterminate]:bg-primary' : ''}
                          aria-label={`${loc} hepsini seç`}
                        />
                        <span className="font-semibold">{loc}</span>
                        <span className="text-xs text-muted-foreground">({assets.length} ürün)</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-3">
                      <div className="flex items-center gap-2 mb-3">
                        <Button variant="outline" size="sm" onClick={() => toggleLocationAll(loc)}>
                          Bu Konumdakilerin Tümünü Seç
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {assets.map((a) => (
                          <label
                            key={a.id}
                            className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/30 transition"
                          >
                            <Checkbox checked={!!selected[a.id]} onCheckedChange={() => toggleAsset(a.id)} />
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">{a.urunAdi || 'Ürün'}</span>
                              <span className="text-xs text-muted-foreground">
                                {a.demirbasNo || '-'}
                              </span>
                            </div>
                          </label>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <QrCode className="h-4 w-4" />
            PDF: Yatay A4, 4×3 (12 etiket)
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button onClick={makePdf} disabled={isLoading || totalSelected === 0}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Printer className="h-4 w-4 mr-2" />}
              PDF Oluştur
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
