
'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Archive, Loader2, Printer, Settings, History, Trash2, Nfc, Bot, Box, Grid3X3 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import type { Hospital as Laboratory, Rack } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { sealRack } from '@/lib/archive/rack-service';
import useHidScanner from '@/hooks/useHidScanner';
import { playFeedback } from '@/lib/utils';
import { generateLabelsPdf } from '@/lib/pdf/LabelGenerator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const SampleRack3D = dynamic(() => import('@/components/SampleRack3D'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[500px] rounded-xl border bg-gray-900 flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  ),
});


// Helper to convert index to A1-style position
const idxToPos = (index: number, cols = 10) => {
  const row = String.fromCharCode(65 + Math.floor(index / cols));
  const col = (index % cols) + 1;
  return `${row}${col}`;
};

interface LastScannedInfo {
    specimenId: string;
    position: string;
    location: string;
}

export default function NumuneArsiviPage() {
  const { currentUserProfile, isAdmin } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [laboratories, setLaboratories] = useState<Laboratory[]>([]);
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [loading, setLoading] = useState({ labs: true, fridges: false });
  const [scannedSpecimens, setScannedSpecimens] = useState<(string | null)[]>(Array(100).fill(null) as (string | null)[]);
  const [lastScannedInfo, setLastScannedInfo] = useState<LastScannedInfo | null>(null);

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsSelectedLabId, setSettingsSelectedLabId] = useState<string>('');
  const [fridgeCode, setFridgeCode] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFridgeCode, setSelectedFridgeCode] = useState<string>('');
  
  const [nextScanAction, setNextScanAction] = useState<{ type: 'specific'; index: number } | { type: 'sequential' }>({ type: 'sequential' });
  const [nextSequentialIndex, setNextSequentialIndex] = useState(0); // New state for "start from here"
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clickedIndex, setClickedIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | '3d'>('grid');
  const [lastPlacedIndex, setLastPlacedIndex] = useState<number | null>(null);

  useEffect(() => {
    async function fetchLaboratories() {
      setLoading({ labs: true, fridges: false });
      try {
        const labsSnap = await getDocs(collection(db, 'hospitals'));
        const labsData = labsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Laboratory));
        setLaboratories(labsData.sort((a,b) => (a.name || '').localeCompare(b.name || '')));
      } catch (error) {
        console.error("Error fetching laboratories:", error);
        toast({
          title: "Hata",
          description: "Laboratuvarlar yüklenirken bir sorun oluştu.",
          variant: "destructive",
        });
      } finally {
        setLoading(p => ({...p, labs: false }));
      }
    }
    fetchLaboratories();
  }, [toast]);

  const authorizedLaboratories = useMemo(() => {
    if (isAdmin) return laboratories;
    if (!currentUserProfile?.assignedLaboratories) return [];
    return laboratories.filter(lab => lab.id && currentUserProfile.assignedLaboratories?.includes(lab.id));
  }, [laboratories, currentUserProfile, isAdmin]);
  
  useEffect(() => {
    if (authorizedLaboratories.length === 1 && !selectedLabId && authorizedLaboratories[0].id) {
      setSelectedLabId(authorizedLaboratories[0].id);
    }
  }, [authorizedLaboratories, selectedLabId]);
  
  useEffect(() => {
    if(selectedLabId) {
        const selectedLabData = laboratories.find(l => l.id === selectedLabId);
        const labFridgeCode = (selectedLabData as any)?.fridgeCode || '';
        setSelectedFridgeCode(labFridgeCode);
    } else {
        setSelectedFridgeCode('');
    }
  }, [selectedLabId, laboratories]);

  useEffect(() => {
    if (isSettingsModalOpen) {
      setSettingsSelectedLabId(selectedLabId);
      const selectedLabData = laboratories.find(l => l.id === selectedLabId);
      setFridgeCode((selectedLabData as any)?.fridgeCode || '');
    }
  }, [isSettingsModalOpen, selectedLabId, laboratories]);
  
  useEffect(() => {
      if (settingsSelectedLabId) {
          const selectedLabData = laboratories.find(l => l.id === settingsSelectedLabId);
          setFridgeCode((selectedLabData as any)?.fridgeCode || '');
      } else {
          setFridgeCode('');
      }
  }, [settingsSelectedLabId, laboratories]);

  const resetRack = useCallback(() => {
    setScannedSpecimens(Array(100).fill(null));
    setLastScannedInfo(null);
    setLastPlacedIndex(null);
    setNextScanAction({ type: 'sequential' });
    setNextSequentialIndex(0); // Reset sequential index
  }, []);

  const handleSealAndSave = useCallback(async () => {
    const specimensToSave = scannedSpecimens.filter((s): s is string => s !== null);
    if (!selectedLabId || !selectedFridgeCode) {
        toast({ title: 'Eksik Bilgi', description: 'Lütfen bir laboratuvar ve buzdolabı seçin.', variant: 'destructive' });
        return;
    }

    if (specimensToSave.length === 0) {
        toast({ title: 'Liste Boş', description: 'Kaydedilecek numune bulunmuyor.', variant: 'default'});
        return;
    }

    setIsSaving(true);
    try {
        const lab = laboratories.find(l => l.id === selectedLabId);
        const rackData: Partial<Rack> = {
            labId: selectedLabId,
            labName: lab?.name,
            labCode: lab?.kod,
            fridgeCode: selectedFridgeCode,
            specimens: scannedSpecimens.map(s => s ?? '') as string[], // Use the sparse array directly
            sealedAt: new Date(),
            sealedBy: currentUserProfile?.name || 'Bilinmeyen Kullanıcı',
        };
        
        const rackId = await sealRack(rackData);
        
        toast({
            title: 'Raf Kaydedildi',
            description: `Raf ID: ${rackId} geçmişe kaydedildi. Yazdırma penceresi açılıyor...`,
        });

        const assetsToPrint = [{
          id: rackId,
          demirbasNo: rackId,
          konum: `${lab?.name} / ${selectedFridgeCode}`,
          category: 'Numune Rafı',
        }];

        await generateLabelsPdf({
          assets: assetsToPrint,
          buildAssetUrl: (asset) => `${window.location.origin}/numune-arsivi/gecmis/${asset.id}`,
        });

        resetRack();

    } catch (error) {
        console.error("Error sealing rack:", error);
        toast({ title: 'Hata', description: 'Raf kaydedilirken veya yazdırılırken bir hata oluştu.', variant: 'destructive' });
    } finally {
        setIsSaving(false);
    }
  }, [selectedLabId, selectedFridgeCode, currentUserProfile, toast, laboratories, resetRack, scannedSpecimens]);

  const handleScan = useCallback((barcode: string) => {
    if (isSaving) return;

    if (scannedSpecimens.includes(barcode)) {
      playFeedback(true);
      toast({ title: 'Mükerrer Kayıt', description: 'Bu barkod bu rafta zaten okutulmuş.', variant: 'destructive' });
      return;
    }
  
    let targetIndex: number;
    let isSpecificAssignment = false;
  
    if (nextScanAction.type === 'specific') {
      targetIndex = nextScanAction.index;
      isSpecificAssignment = true;
    } else {
      // Start searching from the sequential index
      targetIndex = scannedSpecimens.findIndex((s, i) => s === null && i >= nextSequentialIndex);
      // If not found, search from the beginning
      if (targetIndex === -1) {
        targetIndex = scannedSpecimens.findIndex(s => s === null);
      }
    }
    
    if (targetIndex === -1) {
      toast({ title: 'Raf Dolu', description: 'Bu raf tamamen doldu.', variant: 'default' });
      return;
    }
  
    const newSpecimens = [...scannedSpecimens];
    newSpecimens[targetIndex] = barcode;
    setScannedSpecimens(newSpecimens);
    setLastPlacedIndex(targetIndex);

    const selectedLab = laboratories.find(l => l.id === selectedLabId);
    setLastScannedInfo({
        specimenId: barcode,
        position: idxToPos(targetIndex),
        location: `${selectedLab?.name || 'Bilinmeyen Lab'} - ${selectedFridgeCode || 'Bilinmeyen Dolap'}`
    });
  
    playFeedback();
  
    // If it was a specific assignment, reset to sequential scanning from the original start point.
    if (isSpecificAssignment) {
      setNextScanAction({ type: 'sequential' });
    } else {
      // Otherwise, update the starting point for the next sequential scan
      setNextSequentialIndex(targetIndex + 1);
    }
  
    if (newSpecimens.every(s => s !== null)) {
        setTimeout(() => handleSealAndSave(), 100);
    }
  }, [scannedSpecimens, laboratories, selectedLabId, selectedFridgeCode, toast, handleSealAndSave, isSaving, nextScanAction, nextSequentialIndex]);
  
  useHidScanner({
    onScan: ({ raw }) => handleScan(raw),
    enabled: !isSettingsModalOpen && !dialogOpen
  });
  
  const handleCellClick = (index: number) => {
    if (scannedSpecimens[index] === null) {
      setClickedIndex(index);
      setDialogOpen(true);
    }
  };

  const handleDialogAction = (action: 'start' | 'assign') => {
    if (clickedIndex === null) return;
  
    if (action === 'start') {
      setNextScanAction({ type: 'sequential' });
      setNextSequentialIndex(clickedIndex);
      toast({ title: "Başlangıç Ayarlandı", description: `Sıradaki okutma ${idxToPos(clickedIndex)} yuvasından başlayacak.` });
    } else if (action === 'assign') {
        setNextScanAction({ type: 'specific', index: clickedIndex });
        toast({ title: "Atama Modu", description: `Sonraki okutma ${idxToPos(clickedIndex)} yuvasına atanacak.` });
    }
    setDialogOpen(false);
    setClickedIndex(null);
  };

  return (
    <>
      <div className="p-4 md:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="lg:sticky lg:top-6">
          <Card className="glass-card">
              <CardHeader>
                  <div className="flex justify-between items-center">
                      <div>
                          <CardTitle>Aktif Raf</CardTitle>
                          <CardDescription>Taranan numuneler buraya yerleştirilecek.</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center border rounded-lg overflow-hidden">
                          <button
                            onClick={() => setViewMode('grid')}
                            className={cn(
                              "p-1.5 transition-colors",
                              viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                            )}
                            title="Izgara Görünümü"
                          >
                            <Grid3X3 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setViewMode('3d')}
                            className={cn(
                              "p-1.5 transition-colors",
                              viewMode === '3d' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                            )}
                            title="3D Görünüm"
                          >
                            <Box className="h-4 w-4" />
                          </button>
                        </div>
                        <Button variant="destructive" onClick={resetRack} disabled={scannedSpecimens.filter(s => s !== null).length === 0} className="h-8 px-3">
                          <Trash2 className="mr-2 h-4 w-4" />
                          Raftakileri Temizle
                        </Button>
                        <Button variant="secondary" onClick={() => handleSealAndSave()} disabled={isSaving || scannedSpecimens.filter(s => s !== null).length === 0} className="h-8 px-3">
                          <Printer className="mr-2 h-4 w-4" />
                          Erken Sonlandır ve Yazdır
                        </Button>
                      </div>
                  </div>
              </CardHeader>
              <CardContent>
                {viewMode === '3d' ? (
                  <div className="-mt-4">
                    <SampleRack3D
                      specimens={scannedSpecimens}
                      lastPlacedIndex={lastPlacedIndex}
                      onSlotClick={handleCellClick}
                    />
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      Fare ile döndür, kaydır ve yakınlaştır. Boş yuvaya tıklayarak atama yap.
                    </p>
                  </div>
                ) : (
                 <TooltipProvider>
                  <div className="grid grid-cols-10 gap-2 p-2 border rounded-xl bg-background/50 -mt-4">
                      {Array.from({ length: 100 }).map((_, i) => {
                        const specimenId = scannedSpecimens[i];
                        const isFilled = specimenId !== null;
                        const position = idxToPos(i);
                        return (
                          <Tooltip key={i}>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => handleCellClick(i)}
                                className={cn(
                                  "h-12 rounded-md flex items-center justify-center text-xs font-mono border transition-colors",
                                  isFilled
                                    ? 'bg-green-500/20 border-green-500/50 text-green-700 dark:text-green-300 font-bold cursor-default'
                                    : 'bg-muted/50 border-border hover:bg-muted cursor-pointer'
                                )}
                              >
                                {isFilled ? 'Dolu' : position}
                              </button>
                            </TooltipTrigger>
                            {isFilled && (
                              <TooltipContent>
                                <p>Yuva: {position}</p>
                                <p>ID: {specimenId}</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        )
                      })}
                  </div>
                </TooltipProvider>
                )}
              </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="px-3 py-2 bg-background/60">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                      <Label>Laboratuvar</Label>
                      <Select value={selectedLabId} onValueChange={setSelectedLabId} disabled={loading.labs || (authorizedLaboratories.length <= 1 && !isAdmin)}>
                      <SelectTrigger>
                          <SelectValue placeholder="Laboratuvar seçin..." />
                      </SelectTrigger>
                      <SelectContent>
                          {authorizedLaboratories.length > 0 ? (
                          authorizedLaboratories.filter(lab => lab.id).map(lab => (
                              <SelectItem key={lab.id} value={lab.id!}>
                              {lab.name}
                              </SelectItem>
                          ))
                          ) : (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                              Yetkili olduğunuz laboratuvar bulunmuyor.
                          </div>
                          )}
                      </SelectContent>
                      </Select>
                  </div>
                  <div>
                      <Label>Buzdolabı</Label>
                      <Select value={selectedFridgeCode} onValueChange={setSelectedFridgeCode} disabled={!selectedLabId}>
                      <SelectTrigger>
                          <SelectValue placeholder={!selectedLabId ? 'Önce Laboratuvar Seçin' : 'Buzdolabı seçin...'} />
                      </SelectTrigger>
                      <SelectContent>
                          {selectedFridgeCode ? (
                          <SelectItem value={selectedFridgeCode}>{selectedFridgeCode}</SelectItem>
                          ) : (
                          <div className="p-2 text-xs text-muted-foreground">Bu laboratuvara atanmış buzdolabı yok.</div>
                          )}
                      </SelectContent>
                      </Select>
                  </div>
              </div>
               <div className="flex items-center gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => router.push('/yonetim/laboratuvarlar')}>
                      <Settings className="mr-2 h-4 w-4" />
                      Ayarlar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => router.push('/numune-arsivi/gecmis')}>
                      <History className="mr-2 h-4 w-4" />
                      Geçmiş
                  </Button>
                   <Input
                      placeholder="Manuel Barkod Girişi"
                      onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                              handleScan(e.currentTarget.value);
                              e.currentTarget.value = '';
                          }
                      }}
                      className="h-9 max-w-xs"
                  />
              </div>
          </Card>
          
           <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg font-semibold flex items-center gap-2"><Nfc /> Son Okutulan Numune</CardTitle>
            </CardHeader>
            <CardContent>
              {lastScannedInfo ? (
                <div className="space-y-3 text-center">
                    <div className="bg-primary/10 text-primary-foreground p-3 rounded-lg">
                        <p className="text-sm font-medium text-primary-foreground/80">Numune ID</p>
                        <p className="text-3xl font-bold font-mono tracking-wider">{lastScannedInfo.specimenId}</p>
                    </div>
                    <div className="bg-secondary p-3 rounded-lg">
                        <p className="text-sm font-medium text-secondary-foreground/80">Atandığı Yuva</p>
                        <p className="text-4xl font-bold text-secondary-foreground">{lastScannedInfo.position}</p>
                    </div>
                    <p className="text-sm text-muted-foreground pt-2">{lastScannedInfo.location}</p>
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">Henüz numune okutulmadı.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      
       <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Boş Yuva: {clickedIndex !== null ? idxToPos(clickedIndex) : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              Bu yuva için yapmak istediğiniz işlemi seçin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <AlertDialogAction onClick={() => handleDialogAction('start')}>
              Buradan Başla
            </AlertDialogAction>
            <AlertDialogAction onClick={() => handleDialogAction('assign')}>
              Bu Yuvaya Ata
            </AlertDialogAction>
            <AlertDialogCancel asChild className="col-span-1 sm:col-span-2">
              <Button variant="outline">İptal</Button>
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
