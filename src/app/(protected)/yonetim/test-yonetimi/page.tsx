'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, Loader2, Beaker } from 'lucide-react';
import { collection, getDocs, onSnapshot, addDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import type { Hospital, ProductCode, TestDefinition } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function TestYonetimiPage() {
  const { toast } = useToast();
  
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [testDefinitions, setTestDefinitions] = useState<TestDefinition[]>([]);
  
  const [loading, setLoading] = useState({ labs: true, tests: false });
  
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [newTestName, setNewTestName] = useState('');
  const [selectedProductCode, setSelectedProductCode] = useState<string>('');
  const [isProductPopoverOpen, setIsProductPopoverOpen] = useState(false);

  // Fetch initial master data
  useEffect(() => {
    const fetchMasterData = async () => {
      setLoading({ labs: true, tests: false });
      try {
        const [hospitalsSnap, productsSnap] = await Promise.all([
          getDocs(query(collection(db, 'hospitals'), orderBy('name', 'asc'))),
          getDocs(query(collection(db, 'productCodes'), orderBy('stokAdi', 'asc'))),
        ]);
        setHospitals(hospitalsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Hospital)));
        setProductCodes(productsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductCode)));
      } catch (error) {
        console.error("Error fetching master data:", error);
        toast({ title: 'Hata', description: 'Laboratuvar veya ürün verileri yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(p => ({ ...p, labs: false }));
      }
    };
    fetchMasterData();
  }, [toast]);
  
  // Listen for test definitions when a lab is selected
  useEffect(() => {
    if (!selectedLabId) {
      setTestDefinitions([]);
      return;
    }
    setLoading(p => ({...p, tests: true}));
    const testsQuery = query(collection(db, 'hospitals', selectedLabId, 'tests'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(testsQuery, (snapshot) => {
      setTestDefinitions(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as TestDefinition)));
      setLoading(p => ({...p, tests: false}));
    }, (error) => {
      console.error("Error fetching test definitions:", error);
      toast({ title: 'Hata', description: 'Test tanımları yüklenemedi.', variant: 'destructive' });
      setLoading(p => ({...p, tests: false}));
    });
    return () => unsubscribe();
  }, [selectedLabId, toast]);

  const handleAddTest = async () => {
    if (!selectedLabId || !newTestName.trim() || !selectedProductCode.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Laboratuvar, Test Adı ve Bağlı Ürün Kodu seçilmelidir.', variant: 'destructive' });
      return;
    }
    setLoading(p => ({...p, tests: true}));
    try {
      await addDoc(collection(db, 'hospitals', selectedLabId, 'tests'), {
        name: newTestName.trim(),
        linkedProductCode: selectedProductCode.trim(),
      });
      toast({ title: 'Başarılı', description: 'Yeni test tanımı eklendi.' });
      setNewTestName('');
      setSelectedProductCode('');
    } catch (error) {
      console.error("Error adding test:", error);
      toast({ title: 'Hata', description: 'Test tanımı eklenemedi.', variant: 'destructive' });
    } finally {
      // The listener will update the state automatically, so we just stop the loader
      // setLoading({ ...loading, tests: false });
    }
  };

  const handleDeleteTest = async (testId: string) => {
    if (!selectedLabId) return;
    if (!confirm('Bu test tanımını silmek istediğinizden emin misiniz?')) return;
    setLoading(p => ({...p, tests: true}));
    try {
        await deleteDoc(doc(db, 'hospitals', selectedLabId, 'tests', testId));
        toast({ title: 'Silindi', description: 'Test tanımı silindi.' });
    } catch (error) {
        console.error("Error deleting test:", error);
        toast({ title: 'Hata', description: 'Test tanımı silinemedi.', variant: 'destructive' });
    }
  };
  
  return (
    <div className="p-4 space-y-4">
      <BackButton fallback="/yonetim/tanimlar" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Beaker className="h-6 w-6 text-primary" />
            Test Yönetimi
          </CardTitle>
          <CardDescription>
            Her laboratuvar için test tanımlarını ve bu testlerin hangi ürün kodlarına bağlı olduğunu yönetin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-w-md">
              <label className="text-sm font-medium mb-1 block">Laboratuvar</label>
              <Select value={selectedLabId} onValueChange={setSelectedLabId} disabled={loading.labs}>
                <SelectTrigger>
                    <SelectValue placeholder={loading.labs ? "Yükleniyor..." : "Laboratuvar seçin..."}/>
                </SelectTrigger>
                <SelectContent>
                    {hospitals.map(lab => (
                        <SelectItem key={lab.id} value={lab.id}>{lab.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
          </div>
          
          {selectedLabId && (
            <Card className="border">
              <CardHeader>
                <CardTitle className="text-lg">Yeni Test Ekle</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <Input
                  placeholder="Test Adı (örn: FERR)"
                  value={newTestName}
                  onChange={(e) => setNewTestName(e.target.value)}
                />
                 <Popover open={isProductPopoverOpen} onOpenChange={setIsProductPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={isProductPopoverOpen}
                      className="w-full justify-between font-normal"
                    >
                      {selectedProductCode
                        ? productCodes.find(p => p.stokKodu === selectedProductCode)?.stokAdi || selectedProductCode
                        : "Bağlı Ürün Kodunu Seçin..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command>
                      <CommandInput placeholder="Ürün adı veya kodu ara..." />
                      <CommandList>
                        <CommandEmpty>Ürün bulunamadı.</CommandEmpty>
                        <CommandGroup>
                          {productCodes.map((p) => (
                            <CommandItem
                              key={p.id}
                              value={`${p.stokAdi} ${p.stokKodu}`}
                              onSelect={() => {
                                setSelectedProductCode(p.stokKodu);
                                setIsProductPopoverOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedProductCode === p.stokKodu ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {p.stokAdi} ({p.stokKodu})
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                <Button onClick={handleAddTest} disabled={loading.tests}>
                  <Plus className="mr-2 h-4 w-4" /> Ekle
                </Button>
              </CardContent>

              <CardHeader className="pt-4">
                <CardTitle className="text-lg">Tanımlı Testler</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64 border rounded-md">
                  {loading.tests ? (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Yükleniyor...
                      </div>
                  ) : testDefinitions.length === 0 ? (
                    <div className="text-center text-muted-foreground p-8">Bu laboratuvar için tanımlı test bulunmuyor.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Test Adı</TableHead>
                          <TableHead>Bağlı Ürün Kodu</TableHead>
                          <TableHead>Bağlı Ürün Adı</TableHead>
                          <TableHead className="text-right">İşlem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {testDefinitions.map(t => (
                          <TableRow key={t.id}>
                            <TableCell className="font-medium">{t.name}</TableCell>
                            <TableCell className="font-mono text-xs">{t.linkedProductCode}</TableCell>
                            <TableCell>{productCodes.find(p => p.stokKodu === t.linkedProductCode)?.stokAdi || '-'}</TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteTest(t.id)} disabled={loading.tests}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
