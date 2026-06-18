'use client';

import React, { useState } from 'react';
import { Plus, Save, Trash2, Network, Loader2 } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useTestAutoSumDefinitions } from '@/hooks/useTestAutoSumDefinitions';

type Draft = { mainTestName: string; includeTestNamesText: string };

const emptyDraft: Draft = { mainTestName: '', includeTestNamesText: '' };

function parseAliases(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function OtoToplamTanimlariPanel() {
  const { toast } = useToast();
  const { definitions, isLoading, error, createDefinition, updateDefinition, deleteDefinition } = useTestAutoSumDefinitions();
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, Draft>>({});

  async function handleCreate() {
    const aliases = parseAliases(draft.includeTestNamesText);
    if (!draft.mainTestName.trim() || aliases.length === 0) {
      toast({ title: 'Eksik bilgi', description: 'Ana test adı ve toplama eklenecek en az bir test adı girin.', variant: 'destructive' });
      return;
    }
    setSavingId('new');
    try {
      await createDefinition({ mainTestName: draft.mainTestName, includeTestNames: aliases });
      setDraft(emptyDraft);
      setIsAdding(false);
      toast({ title: 'Oto toplam tanımı eklendi' });
    } finally {
      setSavingId(null);
    }
  }

  async function handleUpdate(id: string) {
    const current = editing[id];
    if (!current?.mainTestName.trim()) return;
    setSavingId(id);
    try {
      await updateDefinition(id, { mainTestName: current.mainTestName, includeTestNames: parseAliases(current.includeTestNamesText) });
      toast({ title: 'Oto toplam tanımı güncellendi' });
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Bu oto toplam tanımı silinsin mi?')) return;
    setSavingId(id);
    try {
      await deleteDefinition(id);
      toast({ title: 'Oto toplam tanımı silindi' });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <BackButton fallback="/raporlama" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5 text-primary" />
            Oto Toplam Tanımları
          </CardTitle>
          <CardDescription>
            Kümülatif ve cihaz üstü hesaplamalarda aynı teste ait farklı dosya adlarını ana testte otomatik toplayın. Örn: ana test `AHIV`, eklenecek test `HIVAG`.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              {isLoading ? 'Tanımlar yükleniyor…' : `${definitions.length} tanım kayıtlı`}
            </div>
            <Button onClick={() => setIsAdding(true)} disabled={isAdding}>
              <Plus className="mr-2 h-4 w-4" /> Yeni Tanım
            </Button>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Hata</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isAdding && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Ana test adı</Label>
                    <Input value={draft.mainTestName} onChange={(e) => setDraft((prev) => ({ ...prev, mainTestName: e.target.value }))} placeholder="AHIV" />
                  </div>
                  <div>
                    <Label>Toplama eklenecek test adları</Label>
                    <Input value={draft.includeTestNamesText} onChange={(e) => setDraft((prev) => ({ ...prev, includeTestNamesText: e.target.value }))} placeholder="HIVAG, HIV-AG" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => { setIsAdding(false); setDraft(emptyDraft); }}>İptal</Button>
                  <Button onClick={handleCreate} disabled={savingId === 'new'}>
                    {savingId === 'new' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Kaydet
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-3">
            {definitions.map((definition) => {
              const current = editing[definition.id] ?? {
                mainTestName: definition.mainTestName,
                includeTestNamesText: definition.includeTestNames.join(', '),
              };
              return (
                <Card key={definition.id}>
                  <CardContent className="pt-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_auto] gap-3 items-end">
                      <div>
                        <Label>Ana test adı</Label>
                        <Input value={current.mainTestName} onChange={(e) => setEditing((prev) => ({ ...prev, [definition.id]: { ...current, mainTestName: e.target.value } }))} />
                      </div>
                      <div>
                        <Label>Toplama eklenecek test adları</Label>
                        <Input value={current.includeTestNamesText} onChange={(e) => setEditing((prev) => ({ ...prev, [definition.id]: { ...current, includeTestNamesText: e.target.value } }))} />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => handleUpdate(definition.id)} disabled={savingId === definition.id}>
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" className="text-red-600" onClick={() => handleDelete(definition.id)} disabled={savingId === definition.id}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
