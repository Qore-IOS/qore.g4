'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { collection, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

interface DefinitionItem {
  id: string;
  name: string;
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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, type));
      setItems(snap.docs.map(d => ({ id: d.id, name: d.data().name } as DefinitionItem)).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      toast({ title: 'Hata', description: `${title} yüklenemedi.`, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [type, title, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAdd = async () => {
    if (!newItemName.trim()) return;
    setLoading(true);
    try {
      await addDoc(collection(db, type), { name: newItemName.trim() });
      toast({ title: 'Başarılı', description: `${title} tanımı eklendi.` });
      setNewItemName('');
      fetchData();
    } catch (e) {
      toast({ title: 'Hata', description: 'Tanım eklenemedi.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
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
        <CardTitle className="text-lg">{title}</CardTitle>
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
              <div key={item.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50">
                <span className="text-sm">{item.name}</span>
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
