
'use client';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, orderBy, query, setDoc, deleteDoc, writeBatch, deleteField } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import type { BarcodeFormat, ExpiryPattern } from '@/lib/barcode';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, PlusCircle, Save, Trash2, Edit3, SlidersHorizontal, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import BackButton from '@/components/BackButton';
import { YonetimShell, YonetimHeader, YonetimCard } from '@/components/yonetim-ui/YonetimHub';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { normalizePos, normalizeFormat } from '@/lib/barcode/pos-utils';


type Pos = { start: number | string; length: number | string };

type LocalFormat = (Partial<BarcodeFormat> & {
    parseTarget?: 'reference' | 'barcodeNumber';
    trackLot?: boolean;
    totalLength?: number | string;
    reference: Pos;
    lot: Pos;
    expiry?: (Pos & { pattern?: any }) | undefined;
});

const EXPIRY_PATTERNS: ExpiryPattern[] = ['YYMMDD','YYYYMMDD','DDMMYYYY','MMYY','MMYYYY', 'text'];

function Section({ title, disabled, children }: { title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('md:col-span-3 border rounded-xl p-3 transition-opacity', disabled && 'opacity-50')}>
      <div className="text-sm font-medium mb-2 flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> {title}</div>
      <div className={disabled ? 'pointer-events-none' : ''}>
        {children}
      </div>
    </div>
  );
}

function PosInputs({ value, onChange }: { value?: Pos; onChange: (v: Pos) => void }) {
  const v = value ?? { start: 0, length: 0 };
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label>Başlangıç (1 bazlı)</Label>
        <Input type="number" value={Number(v.start ?? 0)} onChange={e => onChange({ ...v, start: Number(e.target.value) })} />
      </div>
      <div>
        <Label>Uzunluk</Label>
        <Input type="number" value={Number(v.length ?? 0)} onChange={e => onChange({ ...v, length: Number(e.target.value) })} />
      </div>
    </div>
  );
}

function cleanPos(p?: Pos) {
  if (!p) return undefined;
  const s = Number(p.start ?? 0);
  const l = Number(p.length ?? 0);
  if (!s || !l) return undefined;
  return { start: s, length: l };
}

function cleanExpiry(p?: any) {
  if (!p) return undefined;
  const s = Number(p.start ?? 0);
  const l = Number(p.length ?? 0);
  const pattern = p.pattern || undefined;
  if (!s || !l) return undefined;
  return { start: s, length: l, pattern };
}


export default function BarkodFormatlariPage() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [formats, setFormats] = useState<BarcodeFormat[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<LocalFormat | null>(null);

  const fetchFormats = useCallback(async () => {
    setIsLoading(true);
    const snap = await getDocs(scopedQuery('barcodeFormats', currentCompanyId, isSuperAdmin, orderBy('name', 'asc')));
    const rawFormats = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as BarcodeFormat[];
    setFormats(rawFormats.map(f => normalizeFormat(f) as BarcodeFormat));
    setIsLoading(false);
  }, [currentCompanyId, isSuperAdmin]);

  useEffect(() => { fetchFormats(); }, [fetchFormats]);

  const openNew = () => {
    setEditing({
      name: '',
      strategy: 'positional',
      active: true,
      totalLength: 0,
      reference: { start: 1, length: 1 },
      lot: { start: 0, length: 0 },
      expiry: { start: 0, length: 0, pattern: 'YYMMDD' },
      parseTarget: 'reference',
      trackLot: true,
    });
    setIsModalOpen(true);
  };
  
  const openEdit = (f: BarcodeFormat) => {
    setEditing(normalizeFormat(f) as LocalFormat);
    setIsModalOpen(true);
  };
  
  const save = async () => {
    if (!editing) return;
    const id = editing.id || crypto.randomUUID();

    const totalLengthNum = Number(editing.totalLength ?? 0);
    const referenceClean = cleanPos(editing.reference);
    const trackLot = editing.trackLot !== false;

    if (!editing.name?.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Ad zorunlu.', variant: 'destructive' });
      return;
    }
    if (!referenceClean) {
      toast({ title: 'Eksik Dilim', description: 'Referans / Ürün Barkodu başlangıç ve uzunluk girin.', variant: 'destructive' });
      return;
    }

    const lotClean    = trackLot ? cleanPos(editing.lot) : undefined;
    const expiryClean = trackLot ? cleanExpiry(editing.expiry) : undefined;

    const payload: any = {
      name: editing.name.trim(),
      active: editing.active !== false,
      strategy: editing.strategy ?? 'positional',
      parseTarget: (editing.parseTarget as 'reference' | 'barcodeNumber') ?? 'reference',
      trackLot: trackLot,
      reference: referenceClean,
      priority: 0, // This field is no longer used but kept for schema compatibility if needed.
    };

    if (totalLengthNum > 0) payload.totalLength = totalLengthNum; else payload.totalLength = deleteField();

    if (trackLot) {
      if (payload.strategy === 'positional' && (!lotClean || !expiryClean)) {
        toast({ title: 'Eksik Dilim', description: 'Lot ve Miad için başlangıç/uzunluk girin.', variant: 'destructive' });
        return;
      }
      payload.lot = lotClean;
      payload.expiry = expiryClean;
    } else {
      payload.lot = deleteField();
      payload.expiry = deleteField();
    }
  
    if (!editing.id) {
      payload.companyId = currentCompanyId;
    }

    try {
      await setDoc(doc(db, 'barcodeFormats', id), payload, { merge: true });
      toast({ title: 'Kaydedildi', description: 'Barkod formatı güncellendi.' });
      setIsModalOpen(false);
      setEditing(null);
      fetchFormats();
    } catch (e) {
      console.error(e);
      toast({ title: 'Kayıt Hatası', description: 'Barkod formatı kaydedilemedi.', variant: 'destructive' });
    }
  };

  const remove = async (f: BarcodeFormat) => {
    if(!confirm(`'${f.name}' formatını silmek istediğinizden emin misiniz?`)) return;
    await deleteDoc(doc(db, 'barcodeFormats', f.id));
    toast({ title: 'Silindi', description: `${f.name} kaldırıldı.` });
    if (editing?.id === f.id) setEditing(null);
    fetchFormats();
  };

  return (
    <YonetimShell>
      <YonetimHeader
        title="Barkod Formatları"
        description="GS1, DataMatrix ve özel barkod format kurallarını yönetin."
        backHref="/yonetim/tanimlar"
        rightAction={
          <Button onClick={openNew} className="gap-2" style={{ background: 'var(--mg-accent)', color: '#0a0a0c', border: 'none', fontWeight: 700 }}>
            <PlusCircle className="h-4 w-4" />
            Yeni Format
          </Button>
        }
      />
      <YonetimCard>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Yükleniyor...</div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ad</TableHead>
                    <TableHead>Strateji</TableHead>
                    <TableHead>Aktif</TableHead>
                    <TableHead>Tanıma</TableHead>
                    <TableHead>Lot Takibi</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {formats.map(f => (
                    <TableRow key={f.id}>
                      <TableCell>{f.name}</TableCell>
                      <TableCell>{f.strategy || '-'}</TableCell>
                      <TableCell>{f.active === false ? 'Hayır' : 'Evet'}</TableCell>
                      <TableCell>{f.parseTarget === 'barcodeNumber' ? 'Barkod (UDI)' : 'Referans'}</TableCell>
                      <TableCell>{(f as any).trackLot === false ? 'Hayır' : 'Evet'}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(f)} className="gap-1"><Edit3 className="h-4 w-4" /> Düzenle</Button>
                        <Button variant="outline" size="sm" onClick={() => remove(f)} className="gap-1 text-red-600"><Trash2 className="h-4 w-4" /> Sil</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </YonetimCard>

      <Dialog open={isModalOpen} onOpenChange={(open) => { if (!open) setEditing(null); setIsModalOpen(open); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Formatı Düzenle' : 'Yeni Format'}</DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
              <div className="col-span-1 md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Ad</Label>
                  <Input value={editing.name || ''} onChange={e => setEditing(prev => ({ ...prev!, name: e.target.value }))} />
                </div>
                <div className="flex items-end gap-2">
                  <Checkbox
                    id="active"
                    checked={editing.active !== false}
                    onCheckedChange={v => setEditing(p => ({ ...p!, active: Boolean(v) }))}
                  />
                  <Label htmlFor="active">Aktif</Label>
                </div>
              </div>

              <div>
                <Label>Strateji</Label>
                <Select value={editing.strategy ?? 'positional'} onValueChange={v => setEditing(p => ({ ...p!, strategy: v as any }))}>
                  <SelectTrigger><SelectValue placeholder="Strateji seçin" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="positional">Pozisyonel</SelectItem>
                    <SelectItem value="regex">Regex</SelectItem>
                    <SelectItem value="legacy_roche">Legacy (Roche)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-1">
                <Label>Tanıma Kriteri</Label>
                <Select
                  value={editing.parseTarget ?? 'reference'}
                  onValueChange={(v: 'reference' | 'barcodeNumber') => setEditing(p => ({ ...p!, parseTarget: v }))}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Seçin" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reference">Referans (stokKodu) ile tanı</SelectItem>
                    <SelectItem value="barcodeNumber">Barkod (UDI) ile tanı</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>
                    <b>Barkod (UDI)</b> seçerseniz, aşağıdaki <em>Referans</em> aralığını ürünün barkod numarasına ayarlayın.
                  </span>
                </p>
              </div>
              
              <div className="md:col-span-1">
                <Label>Lot Takibi</Label>
                <Select
                  value={((editing as any).trackLot === false ? 'off' : 'on')}
                  onValueChange={(v: 'on' | 'off') => setEditing(p => {
                    const trackLot = v === 'on';
                    return trackLot ? { ...p!, trackLot } : {
                      ...p!,
                      trackLot,
                      lot: { start: 0, length: 0 },
                      expiry: { start: 0, length: 0, pattern: p?.expiry?.pattern || 'YYMMDD' },
                    };
                  })}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="Seçin" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">Evet — Lot & Miad aranır</SelectItem>
                    <SelectItem value="off">Hayır — Sadece adet takibi</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(editing.strategy ?? 'positional') === 'positional' && (
                <>
                  <div className="md:col-span-3">
                    <Label>Toplam Uzunluk</Label>
                    <Input type="number" value={String(editing.totalLength ?? '')} onChange={e => setEditing(p => ({ ...p!, totalLength: Number(e.target.value) }))} />
                  </div>

                  <Section title="Referans / Ürün Barkodu">
                    <PosInputs value={editing.reference} onChange={v => setEditing(p => ({ ...p!, reference: normalizePos(v) }))} />
                  </Section>

                  <Section title="Lot" disabled={(editing as any).trackLot === false}>
                    <PosInputs
                      value={editing.lot}
                      onChange={v => setEditing(p => ({ ...p!, lot: normalizePos(v) }))}
                    />
                  </Section>

                  <Section title="Miad" disabled={(editing as any).trackLot === false}>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <PosInputs value={editing.expiry as any} onChange={v => setEditing(p => ({ ...p!, expiry: { ...(p?.expiry as any), ...normalizePos(v) } }))} />
                        </div>
                        <div>
                          <Label>Desen</Label>
                          <Select
                            value={editing.expiry?.pattern ?? 'YYMMDD'}
                            onValueChange={(v) => setEditing(p => ({ ...p!, expiry: { ...(p?.expiry as any), pattern: v } }))}
                            disabled={(editing as any).trackLot === false}
                          >
                            <SelectTrigger><SelectValue placeholder="Seçin" /></SelectTrigger>
                            <SelectContent>
                              {EXPIRY_PATTERNS.map(p => (<SelectItem key={p} value={p}>{p}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                  </Section>
                </>
              )}

              {editing.strategy === 'regex' && (
                <div className="md:col-span-3 p-3 border rounded-md">
                  <p className="text-xs text-muted-foreground mb-2">
                    Regex stratejisinde parantezli grupları kullanın. Gruplar sıralaması şu olabilir: (reference?) (lot?) (expiry?) (serial?) (barcodeNumber?) — yalnızca kullanacaklarınızı ekleyin.
                  </p>
                  <Label>Regex</Label>
                  <Input
                    value={editing.regex ?? ''}
                    onChange={e => setEditing(p => ({ ...p!, regex: e.target.value }))}
                    placeholder="Örn: ^(.{3}).{1}(.{5}).{1}(.{6}).*$"
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Kapat</Button></DialogClose>
            <Button onClick={save} className="gap-2"><Save className="h-4 w-4" /> Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </YonetimShell>
  );
}
