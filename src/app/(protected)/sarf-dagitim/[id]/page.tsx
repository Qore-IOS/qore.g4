'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Package, Search, ArrowLeft, ClipboardPlus } from 'lucide-react';
import { collection, getDocs, doc, getDoc, query, addDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Hospital, MinMaxRule, ProductCode, OrderItem, Order as ConsumableRequest, DeviceGroup } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHeader, TableRow, TableHead } from '@/components/ui/table';
import BackButton from '@/components/BackButton';
import { useAuth } from '@/contexts/auth-context';
import { generateId } from '@/lib/utils';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

function generateAndPrintTutanak(req: ConsumableRequest) {
    const doc = new jsPDF();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(`Sarf Talep Tutanağı`, 14, 22);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`Laboratuvar: ${req.kurumAdi}`, 14, 40);
    doc.text(`Talep Tarihi: ${req.createdAt ? format(req.createdAt as Date, 'dd.MM.yyyy HH:mm', { locale: tr }) : ''}`, 14, 50);
    doc.text(`Talebi Oluşturan: ${req.createdBy || ''}`, 14, 60);

    const tableColumn = ["Stok Kodu", "Ürün Adı", "Talep Adeti"];
    const tableRows: (string | number)[][] = [];

    (req.items || []).forEach(item => {
        const rowData = [
            item.stokKodu || '',
            item.stokAdi || '',
            item.adet || 0
        ];
        tableRows.push(rowData);
    });

    autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 70,
        theme: 'grid',
        styles: { font: "helvetica", halign: 'left' },
        headStyles: { fillColor: [22, 160, 133] },
    });
    
    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
}


export default function SarfDagilimDetayPage() {
  const { toast } = useToast();
  const router = useRouter();
  const params = useParams();
  const hospitalId = params.id as string;
  const { currentUser, currentUserProfile } = useAuth();

  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [minMaxRules, setMinMaxRules] = useState<MinMaxRule[]>([]);
  const [allProducts, setAllProducts] = useState<ProductCode[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<DeviceGroup[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [requestItems, setRequestItems] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!hospitalId) return;

    const fetchInitialData = async () => {
      setLoading(true);
      try {
        const [hospitalSnap, productsQuery, rulesSnap, deviceGroupsSnap] = await Promise.all([
          getDoc(doc(db, 'hospitals', hospitalId)),
          getDocs(collection(db, 'productCodes')),
          getDocs(collection(db, 'hospitals', hospitalId, 'minMaxRules')),
          getDocs(collection(db, 'def_deviceGroups'))
        ]);
        
        if (hospitalSnap.exists()) {
          setHospital({ id: hospitalSnap.id, ...hospitalSnap.data() } as Hospital);
        } else {
          toast({ title: "Hata", description: "Laboratuvar bulunamadı.", variant: "destructive" });
          router.push('/sarf-dagitim');
        }

        setAllProducts(productsQuery.docs.map(d => ({id: d.id, ...d.data()} as ProductCode)));
        setDeviceGroups(deviceGroupsSnap.docs.map(d => ({id: d.id, ...d.data()} as DeviceGroup)));
        setMinMaxRules(rulesSnap.docs.map(d => d.data() as MinMaxRule));
      } catch (error) {
        console.error("Error fetching data:", error);
        toast({ title: "Hata", description: "Veriler yüklenemedi.", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [hospitalId, toast, router]);

  const requestableProducts = useMemo(() => {
    const ruleStockCodes = new Set(minMaxRules.map(r => r.stokKodu));
    return allProducts
      .filter(p => ruleStockCodes.has(p.stokKodu))
      .map(p => {
        const deviceGroup = deviceGroups.find(dg => dg.name === p.cihazGrubu);
        return { ...p, deviceGroupImageUrl: deviceGroup?.imageUrl ? `/${deviceGroup.imageUrl}` : undefined };
      })
      .sort((a, b) => (a.stokAdi || '').localeCompare(b.stokAdi || ''));
  }, [minMaxRules, allProducts, deviceGroups]);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return requestableProducts;
    const lowerSearch = productSearch.toLowerCase();
    return requestableProducts.filter(p =>
      (p.stokAdi || '').toLowerCase().includes(lowerSearch) ||
      (p.stokKodu || '').toLowerCase().includes(lowerSearch)
    );
  }, [requestableProducts, productSearch]);

  const handleQuantityChange = (stokKodu: string, value: string) => {
    const quantity = parseInt(value, 10);
    setRequestItems(prev => ({
        ...prev,
        [stokKodu]: isNaN(quantity) || quantity < 0 ? 0 : quantity
    }));
  };

  const handleCreateRequest = async () => {
    if (!hospital) return;
    const itemsToRequest: OrderItem[] = Object.entries(requestItems)
      .filter(([, qty]) => qty > 0)
      .map(([stokKodu, adet]) => {
        const product = allProducts.find(p => p.stokKodu === stokKodu);
        return {
          id: product?.id || generateId(),
          stokKodu,
          stokAdi: product?.stokAdi || 'Bilinmeyen Ürün',
          adet
        };
      });

    if (itemsToRequest.length === 0) {
      toast({ title: "Uyarı", description: "Talep edilecek ürün bulunmuyor.", variant: "default" });
      return;
    }
      
    setIsSubmitting(true);
    try {
      const requestId = generateId();
      const newRequestData = {
        id: requestId,
        hospitalId: hospital.id,
        kurumAdi: hospital.name,
        createdAt: serverTimestamp(),
        createdBy: currentUserProfile?.name || currentUser?.email,
        createdById: currentUser?.uid, // Added creator ID
        items: itemsToRequest,
        status: 'pending' as const, // Explicitly set status
        depotId: '',
      };

      await setDoc(doc(db, 'consumableRequests', requestId), newRequestData);
      
      toast({
          title: "Talep Oluşturuldu",
          description: `${hospital.name} için ${itemsToRequest.length} kalem ürün talebi oluşturuldu.`
      });

      const newRequestForPdf: ConsumableRequest = {
        id: requestId,
        kurumAdi: hospital.name,
        createdAt: new Date(),
        createdBy: currentUserProfile?.name || currentUser?.email || '',
        items: itemsToRequest,
        status: 'pending', 
        depotId: '', 
      };
      generateAndPrintTutanak(newRequestForPdf);
      
      setRequestItems({});
      
    } catch (error) {
      console.error("Request creation failed:", error);
      toast({ title: "Hata", description: "Talep oluşturulurken bir sorun oluştu.", variant: "destructive"});
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin h-8 w-8" /></div>
  }

  return (
    <div className="p-4 md:p-6">
        <BackButton fallback="/sarf-dagitim" />
        <Card className="mt-4">
            <CardHeader>
                <CardTitle>{hospital?.name} - Ürün Talebi</CardTitle>
                <CardDescription>Min-Max tanımı olan ürünler için talep oluşturun.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex justify-between items-center mb-4">
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Ürün adı veya kodu ile ara..."
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                     <Button onClick={handleCreateRequest} disabled={isSubmitting || Object.values(requestItems).every(q => q === 0)}>
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardPlus className="mr-2 h-4 w-4"/>}
                        Talebi Oluştur
                    </Button>
                </div>
                <ScrollArea className="h-[60vh] border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Stok Kodu</TableHead>
                                <TableHead>Görsel</TableHead>
                                <TableHead>Stok Adı</TableHead>
                                <TableHead>Birim</TableHead>
                                <TableHead className="w-[150px]">Talep Adeti</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={5} className="text-center"><Loader2 className="animate-spin"/></TableCell></TableRow>
                            ) : filteredProducts.length === 0 ? (
                                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Bu poliklinik için talep edilebilir ürün bulunamadı.</TableCell></TableRow>
                            ) : filteredProducts.map(product => (
                                <TableRow key={product.id}>
                                    <TableCell className="font-mono text-xs">{product.stokKodu}</TableCell>
                                    <TableCell>
                                        {product.deviceGroupImageUrl ? (
                                            <Image src={product.deviceGroupImageUrl} alt={product.stokAdi} width={60} height={60} className="object-contain" />
                                        ) : null}
                                    </TableCell>
                                    <TableCell>{product.stokAdi}</TableCell>
                                    <TableCell>{product.anaBirim || '-'}</TableCell>
                                    <TableCell>
                                        <Input
                                            type="number"
                                            min="0"
                                            value={requestItems[product.stokKodu] || ''}
                                            onChange={(e) => handleQuantityChange(product.stokKodu, e.target.value)}
                                            className="h-8 w-24 text-center"
                                            placeholder="0"
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </CardContent>
        </Card>
    </div>
  );
}
