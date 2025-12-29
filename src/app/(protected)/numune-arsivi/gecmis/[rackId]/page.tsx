
'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc, updateDoc, arrayRemove, arrayUnion } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Rack } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Printer, PackageMinus, List } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import BackButton from '@/components/BackButton';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { buildZplForRack, openHtmlTag } from '@/lib/archive/printing';
import useHidScanner from '@/hooks/useHidScanner';

function idxToPos(index: number, cols = 10) {
  const row = String.fromCharCode(65 + Math.floor(index / cols));
  const col = (index % cols) + 1;
  return `${row}${col}`;
}

export default function GecmisRafDetayPage() {
  const params = useParams();
  const rackId = Array.isArray(params?.rackId) ? params.rackId[0] : params?.rackId;
  const { toast } = useToast();
  const router = useRouter();

  const [rack, setRack] = useState<Rack | null>(null);
  const [loading, setLoading] = useState(true);
  const [separationMode, setSeparationMode] = useState(false);
  const [viewingSeparated, setViewingSeparated] = useState(false);

  const fetchRack = useCallback(async () => {
    if (!rackId) return;
    setLoading(true);
    try {
      const rackRef = doc(db, 'archiveRacks', rackId as string);
      const rackSnap = await getDoc(rackRef);
      if (rackSnap.exists()) {
        const data = rackSnap.data();
        const rackData: Rack = {
          ...(data as Omit<Rack, 'id' | 'specimens' | 'separatedSpecimens' | 'sealedAt'>),
          id: rackSnap.id,
          labId: data.labId || '',
          labCode: data.labCode || '',
          fridgeCode: data.fridgeCode || '',
          date: data.date || new Date().toISOString().split('T')[0],
          labName: data.labName || '',
          sealedBy: data.sealedBy || '',
          specimens: data.specimens || [],
          separatedSpecimens: data.separatedSpecimens || {},
          sealedAt: data.sealedAt?.toDate ? data.sealedAt.toDate() : new Date(),
          sequence: data.sequence || 0,
          status: data.status || 'sealed',
        };
        setRack(rackData);
      } else {
        toast({ title: 'Hata', description: 'Raf detayı bulunamadı.', variant: 'destructive' });
        router.push('/numune-arsivi/gecmis');
      }
    } catch (error) {
      toast({ title: 'Hata', description: 'Raf detayı yüklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [rackId, router, toast]);

  useEffect(() => {
    fetchRack();
  }, [fetchRack]);

  const handlePrint = async () => {
    if (!rack) return;
    try {
        const zpl = await buildZplForRack(rack.id);
        openHtmlTag(zpl, toast);
    } catch (e: any) {
        toast({ title: 'Yazdırma Hatası', description: e.message, variant: 'destructive'});
    }
  };

  const handleSeparateScan = useCallback(async (barcode: string) => {
    if (!rack || !separationMode) return;
    
    const specimenId = barcode.trim();
    const specimens = rack.specimens || [];
    const specimenIndex = specimens.indexOf(specimenId);

    if (specimenIndex === -1) {
      toast({ title: 'Bulunamadı', description: `Numune (${specimenId}) bu rafta değil.`, variant: 'default' });
      return;
    }
    
    setLoading(true);
    try {
      const rackRef = doc(db, 'archiveRacks', rack.id);
      const originalPosition = idxToPos(specimenIndex);
      
      // Update Firestore: remove from specimens and add to separatedSpecimens map
      await updateDoc(rackRef, {
        specimens: arrayRemove(specimenId),
        [`separatedSpecimens.${specimenId}`]: {
          position: originalPosition,
          separatedAt: new Date(),
        }
      });
      
      // Update local state to reflect change immediately
      setRack(prev => {
        if (!prev) return null;
        const newSpecimens = (prev.specimens || []).filter(s => s !== specimenId);
        const newSeparated = {
          ...prev.separatedSpecimens,
          [specimenId]: { position: originalPosition, separatedAt: new Date() }
        };
        return { ...prev, specimens: newSpecimens, separatedSpecimens: newSeparated };
      });

      toast({ title: 'Numune Ayrıldı', description: `${specimenId} raftan çıkarıldı.` });
      
    } catch(err) {
       console.error("Error separating specimen:", err);
       toast({ title: 'Hata', description: 'Numune ayırma işlemi başarısız oldu.', variant: 'destructive' });
    } finally {
       setLoading(false);
    }

  }, [rack, separationMode, toast]);

  useHidScanner({
    enabled: separationMode,
    onScan: ({ raw }) => handleSeparateScan(raw),
  });

  const toggleSeparationMode = () => {
    setSeparationMode(prev => {
      if (!prev) {
        toast({ title: 'Ayırma Modu Aktif', description: 'Ayrılacak numuneleri okutun.' });
      } else {
        toast({ title: 'Ayırma Modu Kapatıldı', variant: 'default' });
      }
      return !prev;
    });
  };

  const specimensToDisplay = useMemo(() => {
    if (viewingSeparated) {
        if (!rack?.separatedSpecimens) return [];
        return Object.entries(rack.separatedSpecimens).map(([id, data]) => ({
            id,
            position: (data as any).position,
            isFilled: true,
            specimenId: id,
        }));
    }
    
    // Normal view, create 100 cells
    const displayGrid = Array.from({ length: 100 }).map((_, i) => ({
      id: i,
      position: idxToPos(i),
      isFilled: false,
      specimenId: ''
    }));

    if (rack?.specimens) {
      rack.specimens.forEach((specimenId, index) => {
        if (specimenId) {
          const positionData = displayGrid.find(cell => cell.position === idxToPos(index));
          if(positionData) {
              positionData.isFilled = true;
              positionData.specimenId = specimenId;
          }
        }
      });
    }
    
    return displayGrid;
  }, [rack, viewingSeparated]);


  if (loading && !rack) {
    return <div className="flex justify-center items-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (!rack) {
    return <div className="p-4">Raf detayı bulunamadı.</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/numune-arsivi/gecmis" />
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>{viewingSeparated ? 'Ayrılmış Numuneler' : 'Arşivlenmiş Raf'}: {rack.id}</CardTitle>
              <CardDescription>
                {rack.labName} - {rack.sealedAt ? format(rack.sealedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : ''}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setViewingSeparated(v => !v)} variant="secondary" size="sm">
                <List className="mr-2 h-4 w-4" /> {viewingSeparated ? 'Rafa Geri Dön' : `Çıkarılmış Numuneleri Göster (${Object.keys(rack.separatedSpecimens || {}).length})`}
              </Button>
              <Button onClick={toggleSeparationMode} variant={separationMode ? 'destructive' : 'outline'} size="sm">
                <PackageMinus className="mr-2 h-4 w-4" /> {separationMode ? 'Ayırmayı Durdur' : 'Numune Ayır'}
              </Button>
              <Button onClick={handlePrint} variant="outline" size="sm">
                <Printer className="mr-2 h-4 w-4" /> Etiketi Tekrar Yazdır
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-10 gap-2 p-2 border rounded-xl bg-background/50">
            {specimensToDisplay.map((cell, i) => (
              <div
                key={cell.id}
                title={cell.specimenId ? `Yuva: ${cell.position} - ID: ${cell.specimenId}` : `Yuva: ${cell.position} - Boş`}
                className={cn(
                  "h-12 rounded-md flex flex-col items-center justify-center text-xs font-mono border transition-colors p-1",
                  cell.isFilled
                    ? 'bg-blue-500/10 border-blue-500/50 text-blue-700 dark:text-blue-300'
                    : 'bg-muted/50 border-border'
                )}
              >
                <span className="font-bold">{cell.position}</span>
                {cell.isFilled && <span className="text-[9px] truncate">{viewingSeparated ? cell.id : cell.specimenId}</span>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
