'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Loader2, Sparkles } from 'lucide-react';
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

interface DefinitionItem {
  id: string;
  name: string;
  modelSvg?: string;
  modelGeneratedAt?: Date;
}

type DefinitionType =
  | 'def_brands'
  | 'def_labGroups'
  | 'def_testGroups'
  | 'def_deviceGroups'
  | 'def_productGroups'
  | 'def_mainUnits';

interface DefinitionManagerProps {
    type: DefinitionType;
    title: string;
    placeholder: string;
}

const DefinitionManager: React.FC<DefinitionManagerProps> = ({ type, title, placeholder }) => {
  const { toast } = useToast();
  const [items, setItems] = useState<DefinitionItem[]>([]);
  const [newItemName, setNewItemName] = useState('');
  const [loading, setLoading] = useState(false);
  const [isGeneratingModels, setIsGeneratingModels] = useState(false);

  const isMainUnitType = type === 'def_mainUnits';

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, type));
      setItems(
        snap.docs
          .map(d => ({
            id: d.id,
            name: d.data().name,
            modelSvg: d.data().modelSvg,
            modelGeneratedAt: d.data().modelGeneratedAt?.toDate?.() ?? undefined,
          } as DefinitionItem))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (e) {
      toast({ title: 'Hata', description: `${title} yüklenemedi.`, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [type, title, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const generateAndPersistModel = useCallback(async (unitDocId: string, unitName: string) => {
    const response = await fetch('/api/ai/main-unit-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mainUnitName: unitName }),
    });

    const payload = await response.json();
    if (!response.ok || !payload?.modelSvg) {
      throw new Error(payload?.error || '3D model üretilemedi.');
    }

    await updateDoc(doc(db, 'def_mainUnits', unitDocId), {
      modelSvg: payload.modelSvg,
      modelModelName: payload.model || '',
      modelGeneratedAt: new Date(),
    });
  }, []);

  const handleAdd = async () => {
    if (!newItemName.trim()) return;
    setLoading(true);
    try {
      const cleanName = newItemName.trim();
      const docRef = await addDoc(collection(db, type), { name: cleanName });

      if (isMainUnitType) {
        try {
          await generateAndPersistModel(docRef.id, cleanName);
          toast({ title: 'Başarılı', description: `${cleanName} için 3D model üretildi ve kaydedildi.` });
        } catch (e) {
          toast({ title: 'Uyarı', description: `${cleanName} eklendi, 3D model üretimi başarısız oldu. Sonradan tekrar deneyebilirsiniz.`, variant: 'destructive' });
        }
      } else {
        toast({ title: 'Başarılı', description: `${title} tanımı eklendi.` });
      }

      setNewItemName('');
      fetchData();
    } catch (e) {
      toast({ title: 'Hata', description: 'Tanım eklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateMissingModels = async () => {
    if (!isMainUnitType) return;
    const missing = items.filter(item => !item.modelSvg);
    if (!missing.length) {
      toast({ title: 'Bilgi', description: 'Eksik 3D model bulunmuyor.' });
      return;
    }

    setIsGeneratingModels(true);
    let success = 0;
    for (const item of missing) {
      try {
        await generateAndPersistModel(item.id, item.name);
        success += 1;
      } catch {
        // Continue for all items
      }
    }
    setIsGeneratingModels(false);
    fetchData();

    toast({
      title: success === missing.length ? 'Tamamlandı' : 'Kısmi Tamamlandı',
      description: `${success}/${missing.length} ana birim için 3D model kaydedildi.`,
      variant: success === missing.length ? 'default' : 'destructive',
    });
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    try {
      await deleteDoc(doc(db, type, id));
      toast({ title: 'Silindi', description: 'Tanım silindi.', variant: 'destructive' });
      fetchData();
    } catch (e) {
      toast({ title: 'Hata', description: 'Tanım silinemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between gap-2">
          <span>{title}</span>
          {isMainUnitType && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateMissingModels}
              disabled={loading || isGeneratingModels}
              className="gap-1"
            >
              {isGeneratingModels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              3D Üret
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-4">
          <Input
            placeholder={placeholder}
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            disabled={loading}
          />
          <Button onClick={handleAdd} disabled={loading || !newItemName.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="h-48 border rounded-md p-2">
          {loading && items.length === 0 ? <Loader2 className="h-5 w-5 animate-spin mx-auto"/> :
            items.length === 0 ? <p className="text-sm text-center text-muted-foreground p-4">Tanım bulunmuyor.</p> :
            items.map(item => (
              <div key={item.id} className="flex items-center justify-between gap-2 p-2 rounded hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <span className="text-sm block truncate">{item.name}</span>
                  {isMainUnitType && (
                    <span className="text-[11px] text-muted-foreground">{item.modelSvg ? '3D model hazır' : '3D model bekleniyor'}</span>
                  )}
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} disabled={loading}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          }
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default DefinitionManager;
