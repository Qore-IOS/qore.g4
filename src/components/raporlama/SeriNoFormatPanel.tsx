'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, orderBy, query, setDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import type { BarcodeFormat, ExpiryPattern } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, PlusCircle, Save, Trash2, Edit3, SlidersHorizontal, Info, Barcode } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import BackButton from '@/components/BackButton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { normalizePos, normalizeFormat } from '@/lib/barcode/pos-utils';

type Pos = { start: number | string; length: number | string };

type LocalFormat = (Partial<BarcodeFormat> & {
    parseTarget?: 'reference' | 'barcodeNumber';
    trackLot?: boolean;
    trackSerial?: boolean;
    priority?: number;
    totalLength?: number | string;
    reference: Pos;
    lot: Pos;
    expiry?: (Pos & { pattern?: any }) | undefined;
    serial?: Pos;
});

const EXPIRY_PATTERNS: ExpiryPattern[] = ['YYMMDD','YYYYMMDD','DDMMYYYY','MMYY','MMYYYY', 'text'];

function Section({ title, disabled, children }: { title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('md:col-span-3 border rounded-xl p-3 transition-opacity', disabled && 'opacity-50')}>
      <div className="text-sm font-medium mb-2 flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4" /> {title}
      </div>
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
        <Input 
            type="number" 
            value={Number(v.start ?? 0)} 
            onChange={e => onChange({ ...v, start: Number(e.target.value) })} 
        />
      </div>
      <div>
        <Label>Uzunluk</Label>
        <Input 
            type="number" 
            value={Number(v.length ?? 0)} 
            onChange={e => onChange({ ...v, length: Number(e.target.value) })} 
        />
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

export default function SeriNoFormatPanel() {
  const { toast } = useToast();
  const { currentCompanyId } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [formats, setFormats] = useState<BarcodeFormat[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<LocalFormat | null>(null);

  const fetchFormats = useCallback(async () => {
    setIsLoading(true);
    try {
        const snap = await getDocs(query(collection(db, 'barcodeFormats'), orderBy('priority', 'asc')));
        const rawFormats = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setFormats(rawFormats.map(f => normalizeFormat(f) as BarcodeFormat));
    } catch (error) {
        console.error("Format fetch error:", error);
    } finally {
        setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchFormats(); }, [fetchFormats]);

  const openNew = () => {
    setEditing({
      name: '',
      strategy: 'positional',
      active: true,
      priority: 10,
      totalLength: 0,
      reference: { start: 1, length: 1 },
      lot: { start: 0, length: 0 },
      expiry: { start: 0, length: 0, pattern: 'YYMMDD' },
      serial: { start: 0, length: 0 },
      parseTarget: 'reference',
      trackLot: true,
      trackSerial: true,
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
    const trackSerial = editing.trackSerial === true;

    if (!editing.name?.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Ad zorunlu.', variant: 'destructive' });
      return;
    }
    if (!referenceClean) {
      toast({ title: 'Eksik Dilim', description: 'Referans başlangıç ve uzunluk girin.', variant: 'destructive' });
      return;
    }

    const lotClean = trackLot ? cleanPos(editing.lot) : undefined;
    const expiryClean = trackLot ? cleanExpiry(editing.expiry) : undefined;
    const serialClean = (trackSerial && editing.strategy === 'positional') ? cleanPos(editing.serial) : undefined;

    const payload: any = {
      name: editing.name.trim(),
      active: editing.active !== false,
      priority: Number(editing.priority ?? 10),
      strategy: editing.strategy ?? 'positional',
      parseTarget: (editing.parseTarget as 'reference' | 'barcodeNumber') ?? 'reference',
      trackLot: trackLot,
      trackSerial: trackSerial,
      reference: referenceClean,
    };

    if (totalLengthNum > 0) payload.totalLength = totalLengthNum; else payload.totalLength = deleteField();

    if (trackLot) {
      if (payload.strategy === 'positional' && (!lotClean || !expiryClean)) {
        toast({ title: 'Eksik Dilim', description: 'Lot ve Miad için aralıkları girin.', variant: 'destructive' });
        return;
      }
      payload.lot = lotClean;
      payload.expiry = expiryClean;
    } else {
      payload.lot = deleteField();
      payload.expiry = deleteField();
    }

    if (trackSerial) {
       if (serialClean) {
         payload.serial = serialClean;
       } else {
         payload.serial = deleteField(); 
       }
    } else {
       payload.serial = deleteField();
    }
  
    if (!editing.id) {
      payload.companyId = currentCompanyId;
    }

    try {
      await setDoc(doc(db, 'barcodeFormats', id), payload, { merge: true });
      toast({ title: 'Kaydedildi', description: 'Barkod formatı başarıyla güncellendi.' });
      setIsModalOpen(false);
      setEditing(null);
      fetchFormats();
    } catch (e) {
      console.error(e);
      toast({ title: 'Kayıt Hatası', description: 'Format kaydedilemedi.', variant: 'destructive' });
    }
  };

  const remove = async (f: BarcodeFormat) => {
    if(!confirm(`'${f.name}' formatını silmek istediğinizden emin misiniz?`)) return;
    await deleteDoc(doc(db, 'barcodeFormats', f.id));
    toast({ title: 'Silindi', description: 'Format kaldırıldı.' });
    if (editing?.id === f.id) setEditing(null);
    fetchFormats();
  };

  return (
    <div className="p-6 space-y-6">
      <BackButton fallback="/raporlama" />
      <Card className="shadow-lg border-l-4 border-l-primary">
        <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold flex items-center gap-2"><Barcode className="h-6 w-6"/>Seri Numarası Format Tanımlama</CardTitle>
              <CardDescription>Yeni seri numaralı barkod formatları oluşturun veya mevcutları düzenleyin.</CardDescription>
            </div>
          <Button onClick={openNew} className="gap-2"><PlusCircle className="h-4 w-4" /> Yeni Format</Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Yükleniyor...</div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ad</TableHead>
                    <TableHead>Strateji</TableHead>
                    <TableHead>Öncelik</TableHead>
                    <TableHead>Tanıma</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Seri No</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {formats.map(f => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.name}</TableCell>
                      <TableCell>{f.strategy || 'Positional'}</TableCell>
                      <TableCell>{f.priority ?? 10}</TableCell>
                      <TableCell>{f.parseTarget === 'barcodeNumber' ? 'UDI' : 'Referans'}</TableCell>
                      <TableCell>
                        <span className={cn("px-2 py-1 rounded text-xs", (f as any).trackLot !== false ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800")}>
                           {(f as any).trackLot !== false ? 'Aktif' : 'Pasif'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={cn("px-2 py-1 rounded text-xs", (f as any).trackSerial === true ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-800")}>
                           {(f as any).trackSerial === true ? 'Aktif' : 'Pasif'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(f)}><Edit3 className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(f)} className="text-red-600 hover:text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={(open) => { if (!open) setEditing(null); setIsModalOpen(open); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Formatı Düzenle' : 'Yeni Format Oluştur'}</DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4">
              {/* Basic Info */}
              <div className="col-span-1 md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4 bg-muted/20 p-4 rounded-lg">
                <div>
                  <Label>Format Adı</Label>
                  <Input 
                    value={editing.name || ''} 
                    onChange={e => setEditing(prev => ({ ...prev!, name: e.target.value }))}
                    placeholder="Örn: Roche Kit Barkodu" 
                  />
                </div>
                <div>
                  <Label>Öncelik (Küçük önce taranır)</Label>
                  <Input type="number" value={editing.priority ?? 10} onChange={e => setEditing(p => ({ ...p!, priority: Number(e.target.value) }))} />
                </div>
                <div className="flex items-end gap-2 pb-2">
                  <div className="flex items-center space-x-2">
                      <Label htmlFor="active">Aktif</Label>
                      <Switch
                        id="active"
                        checked={editing.active !== false}
                        onCheckedChange={v => setEditing(p => ({ ...p!, active: Boolean(v) }))}
                      />
                  </div>
                </div>
              </div>

              {/* Strategy & Target */}
              <div className="space-y-4">
                  <div>
                    <Label>Okuma Stratejisi</Label>
                    <Select value={editing.strategy ?? 'positional'} onValueChange={v => setEditing(p => ({ ...p!, strategy: v as any }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="positional">Pozisyonel (Karakter Sayısı)</SelectItem>
                        <SelectItem value="regex">Regex (Gelişmiş Desen)</SelectItem>
                        <SelectItem value="legacy_roche">Legacy (Roche Özel)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Ürün Eşleştirme Hedefi</Label>
                    <Select
                      value={editing.parseTarget ?? 'reference'}
                      onValueChange={(v: 'reference' | 'barcodeNumber') => setEditing(p => ({ ...p!, parseTarget: v }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="reference">Referans No (stokKodu)</SelectItem>
                        <SelectItem value="barcodeNumber">Barkod No (UDI/GTIN)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
              </div>

              {/* Switches Panel */}
              <div className="md:col-span-2 grid grid-cols-2 gap-4 border p-4 rounded-lg bg-card">
                  <div className="flex flex-col justify-center space-y-3">
                      <div className="flex items-center justify-between border-b pb-2">
                          <Label htmlFor="trackLot" className="font-semibold">Lot & Miad Takibi</Label>
                          <Switch
                              id="trackLot"
                              checked={editing.trackLot !== false}
                              onCheckedChange={(checked) => setEditing(p => ({ ...p!, trackLot: checked }))}
                          />
                      </div>
                      <p className="text-xs text-muted-foreground">Ürünün lot numarası ve son kullanma tarihini içeriyorsa açın.</p>
                  </div>

                  <div className="flex flex-col justify-center space-y-3 border-l pl-4">
                       <div className="flex items-center justify-between border-b pb-2">
                          <Label htmlFor="trackSerial" className="font-semibold">Seri No Takibi</Label>
                          <Switch
                            id="trackSerial"
                            checked={editing.trackSerial === true}
                            onCheckedChange={(checked) => setEditing(p => ({ ...p!, trackSerial: checked }))}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">Her ürünün kendine ait tekil (unique) seri numarası varsa açın.</p>
                  </div>
              </div>


              {/* POSITIONAL INPUTS */}
              {(editing.strategy ?? 'positional') === 'positional' && (
                <>
                  <div className="md:col-span-3 border-t pt-4 mt-2">
                    <Label className="text-lg">Pozisyon Ayarları</Label>
                  </div>

                  <div className="md:col-span-1">
                    <Label>Toplam Barkod Uzunluğu</Label>
                    <Input type="number" value={String(editing.totalLength ?? '')} onChange={e => setEditing(p => ({ ...p!, totalLength: Number(e.target.value) }))} />
                  </div>
                  <div className="md:col-span-2"></div>

                  <Section title="Referans / Ürün Kodu">
                    <PosInputs value={editing.reference} onChange={v => setEditing(p => ({ ...p!, reference: normalizePos(v) }))} />
                  </Section>

                  {editing.trackLot !== false && (
                    <>
                        <Section title="Lot Numarası">
                            <PosInputs
                            value={editing.lot}
                            onChange={v => setEditing(p => ({ ...p!, lot: normalizePos(v) }))}
                            />
                        </Section>
                        <Section title="Son Kullanma Tarihi (Miad)">
                            <div className="grid grid-cols-3 gap-2">
                                <div className="col-span-2">
                                <PosInputs value={editing.expiry as any} onChange={v => setEditing(p => ({ ...p!, expiry: { ...(p?.expiry as any), ...normalizePos(v) } }))} />
                                </div>
                                <div>
                                <Label>Format</Label>
                                <Select
                                    value={editing.expiry?.pattern ?? 'YYMMDD'}
                                    onValueChange={(v) => setEditing(p => ({ ...p!, expiry: { ...(p?.expiry as any), pattern: v } }))}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                    {EXPIRY_PATTERNS.map(p => (<SelectItem key={p} value={p}>{p}</SelectItem>))}
                                    </SelectContent>
                                </Select>
                                </div>
                            </div>
                        </Section>
                    </>
                  )}
                  
                  {editing.trackSerial === true && (
                    <Section title="Seri Numarası">
                        <div className="space-y-4">
                            <PosInputs
                              value={editing?.serial}
                              onChange={v => setEditing(p => ({ ...p!, serial: normalizePos(v) }))}
                            />
                            <div className="bg-yellow-50 p-2 rounded text-xs text-yellow-800 border border-yellow-200">
                                <strong>Bilgi:</strong> Başlangıç ve Uzunluk alanlarını 0 bırakırsanız, sistem barkodun <em>geri kalanını</em> seri numarası olarak alır.
                            </div>
                        </div>
                    </Section>
                  )}
                </>
              )}

              {/* REGEX INPUTS */}
              {editing.strategy === 'regex' && (
                <div className="md:col-span-3 p-4 border border-blue-200 bg-blue-50/50 rounded-md mt-4">
                  <Label className="text-blue-900">Regex İfadesi</Label>
                  <Input
                    className="font-mono mt-1"
                    value={editing.regex ?? ''}
                    onChange={e => setEditing(p => ({ ...p!, regex: e.target.value }))}
                    placeholder="^(.{10})(.{5}).*$"
                  />
                   <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                    Parantez grupları şu sırayla eşleştirilir:<br/>
                    1. Referans/Barkod No<br/>
                    2. Lot (Lot Takibi açıksa)<br/>
                    3. Miad (Lot Takibi açıksa)<br/>
                    4. Seri No (Seri No Takibi açıksa)
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Vazgeç</Button></DialogClose>
            <Button onClick={save} className="gap-2"><Save className="h-4 w-4" /> Değişiklikleri Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
