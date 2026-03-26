
'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, query, where, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import BackButton from '@/components/BackButton';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope } from '@/lib/company-scope';

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
}

export default function AssetLocationPage() {
  const params = useParams();
  const router = useRouter();
  const locationName = decodeURIComponent(Array.isArray(params.locationName) ? params.locationName[0] : params.locationName || '');
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchData = useCallback(async () => {
    if (!locationName) return;
    setLoading(true);
    try {
      const assetsQuery = query(collection(db, 'assets'), where('konum', '==', locationName));
      const assetsSnap = await getDocs(assetsQuery);
      setAssets(filterByCompanyScope(
        assetsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Asset)),
        currentCompanyId,
        isSuperAdmin
      ));
    } catch (e) {
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
    return assets.filter(asset => 
        Object.values(asset).some(val => String(val).toLowerCase().includes(lowerSearch))
    );
  }, [assets, searchTerm]);

  const handleDelete = async (id: string) => {
    if (confirm('Bu kaydı silmek istediğinizden emin misiniz?')) {
      setLoading(true);
      try {
        await deleteDoc(doc(db, 'assets', id));
        toast({ title: 'Silindi', description: 'Envanter kaydı silindi.', variant: 'destructive' });
        fetchData();
      } catch (e) {
        toast({ title: 'Hata', description: 'Silme işlemi başarısız oldu.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <BackButton fallback="/yonetim/envanter-yonetimi" />
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl font-headline capitalize">{locationName}</CardTitle>
          <CardDescription>Bu konumda bulunan tüm demirbaş envanteri.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Listede ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : (
            <ScrollArea className="h-[60vh] border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Demirbaş No</TableHead>
                    <TableHead>Ürün Kategorisi</TableHead>
                    <TableHead>Seri No</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Marka</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Personel</TableHead>
                    <TableHead>Açıklama</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssets.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8">Bu konum için kayıtlı ürün yok veya filtre ile eşleşmiyor.</TableCell></TableRow>
                  ) : (
                    filteredAssets.map(asset => (
                      <TableRow key={asset.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/yonetim/envanter-yonetimi/${asset.category}/${asset.id}`)}>
                        <TableCell className="font-mono text-xs">{asset.demirbasNo}</TableCell>
                        <TableCell className="font-medium">{asset.category}</TableCell>
                        <TableCell className="font-mono text-xs">{asset.seriNumarasi || '-'}</TableCell>
                        <TableCell className="capitalize">{asset.durum || '-'}</TableCell>
                        <TableCell>{asset.marka}</TableCell>
                        <TableCell>{asset.model}</TableCell>
                        <TableCell>{asset.teslimEdilenPersonel}</TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]" title={asset.aciklama}>{asset.aciklama}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDelete(asset.id); }} disabled={loading}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
