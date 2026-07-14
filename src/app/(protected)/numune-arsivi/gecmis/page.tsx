
'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { scopedQuery } from '@/lib/firestore-helpers';
import type { Rack } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Archive, Search, XCircle, ChevronUp, ChevronDown, Filter, Trash2 } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';


// Helper to convert index to A1-style position
const idxToPos = (index: number, cols = 10) => {
  const row = String.fromCharCode(65 + Math.floor(index / cols));
  const col = (index % cols) + 1;
  return `${row}${col}`;
};

type SortKey = keyof Rack | 'specimenCount';

const SortableHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  currentSortKey: SortKey;
  isAsc: boolean;
  onClick: (key: SortKey) => void;
  className?: string;
}> = ({ label, sortKey, currentSortKey, isAsc, onClick, className }) => (
  <TableHead onClick={() => onClick(sortKey)} className={cn("cursor-pointer", className)}>
    <div className="flex items-center gap-1">
      {label}
      {currentSortKey === sortKey && (isAsc ? <ChevronUp size={16} /> : <ChevronDown size={16} />)}
    </div>
  </TableHead>
);

const FilterPopover: React.FC<{
  title: string;
  options: string[];
  selectedValues: Set<string>;
  onSelectionChange: (newSelection: Set<string>) => void;
}> = ({ title, options, selectedValues, onSelectionChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isAllSelected = options.length > 0 && selectedValues.size === options.length;

  const handleSelectAll = () => {
    if (isAllSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(options));
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 -ml-3">
          {title}
          <Filter className="ml-2 h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Ara..." />
          <CommandList>
            <CommandEmpty>Sonuç bulunamadı.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={handleSelectAll} className="cursor-pointer">
                <Checkbox checked={isAllSelected} className="mr-2" />
                Tümünü Seç
              </CommandItem>
              {options.map(option => (
                <CommandItem
                  key={option}
                  onSelect={() => {
                    const newSelection = new Set(selectedValues);
                    if (newSelection.has(option)) {
                      newSelection.delete(option);
                    } else {
                      newSelection.add(option);
                    }
                    onSelectionChange(newSelection);
                  }}
                  className="cursor-pointer"
                >
                  <Checkbox checked={selectedValues.has(option)} className="mr-2" />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};


export default function NumuneArsiviGecmisPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [racks, setRacks] = useState<Rack[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{ rack: Rack; specimenIndex: number } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  
  const [sortKey, setSortKey] = useState<SortKey>('sealedAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [labFilter, setLabFilter] = useState<Set<string>>(new Set());

  useEffect(() => {
    const q = scopedQuery('archiveRacks', currentCompanyId, isSuperAdmin, orderBy('sealedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rackList = snapshot.docs.map(doc => {
        const data = doc.data();
        const specimens = Array.isArray(data.specimens) ? data.specimens.filter(s => s !== null) : [];
        return {
          id: doc.id,
          ...data,
          sealedAt: data.sealedAt?.toDate ? data.sealedAt.toDate() : new Date(),
          specimenCount: specimens.length, // Only count non-null items
        } as Rack;
      });
      setRacks(rackList);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching archive racks:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);
  
  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    const query = searchQuery.trim();
    
    let found = false;
    for (const rack of racks) {
        if (rack.specimens && Array.isArray(rack.specimens)) {
            const specimenIndex = rack.specimens.indexOf(query);
            if (specimenIndex !== -1) {
                setSearchResult({ rack, specimenIndex });
                found = true;
                break;
            }
        }
    }

    if (!found) {
        setSearchResult(null);
        toast({
            title: 'Bulunamadı',
            description: `Numune ID '${query}' hiçbir rafta bulunamadı.`,
            variant: 'default',
        });
    }
    setIsSearching(false);
  };

  const handleDelete = async (rackId: string) => {
    try {
        await deleteDoc(doc(db, 'archiveRacks', rackId));
        toast({ title: 'Başarılı', description: 'Arşivlenmiş raf silindi.' });
    } catch (e) {
        console.error("Error deleting rack:", e);
        toast({ title: 'Hata', description: 'Raf silinirken bir sorun oluştu.', variant: 'destructive' });
    }
  };
  
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(prev => !prev);
    } else {
      setSortKey(key);
      setSortAsc(key === 'sealedAt' ? false : true);
    }
  };

  const uniqueLabs = useMemo(() => {
    return Array.from(new Set(racks.map(r => r.labName || 'Bilinmeyen'))).sort();
  }, [racks]);

  const filteredAndSortedRacks = useMemo(() => {
    return racks
      .filter(rack => {
        const matchesGlobalSearch = searchQuery.trim() === '' ||
          rack.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          rack.labName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          rack.sealedBy?.toLowerCase().includes(searchQuery.toLowerCase());
        
        const matchesLabFilter = labFilter.size === 0 || labFilter.has(rack.labName || 'Bilinmeyen');

        return matchesGlobalSearch && matchesLabFilter;
      })
      .sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];

        if (valA instanceof Date && valB instanceof Date) {
            return sortAsc ? valA.getTime() - valB.getTime() : valB.getTime() - valA.getTime();
        }

        if (typeof valA === 'number' && typeof valB === 'number') {
            return sortAsc ? valA - valB : valB - valA;
        }

        return sortAsc
          ? String(valA || '').localeCompare(String(valB || ''))
          : String(valB || '').localeCompare(String(valA || ''));
      });
  }, [racks, searchQuery, sortKey, sortAsc, labFilter]);


  return (
    <div className="p-4 md:p-6 space-y-4">
      <BackButton fallback="/numune-arsivi" />
      
      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-primary"/>
                Numune veya Raf Bul
            </CardTitle>
            <CardDescription>Arşivlenmiş bir numunenin yerini bulmak için numune ID'sini, bir raf bulmak için raf ID'sini okutun veya manuel girin.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="flex gap-2">
                <Input 
                    placeholder="Numune veya Raf ID'si girin..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                />
                <Button onClick={handleSearch} disabled={isSearching}>
                    {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Bul'}
                </Button>
            </div>
        </CardContent>
      </Card>
      
      {searchResult && (
        <Card className="border-primary/50 shadow-lg">
           <CardHeader>
            <div className="flex justify-between items-start">
                <div>
                  <CardTitle>Arama Sonucu</CardTitle>
                  <CardDescription>Aranan numune <span className="font-bold text-primary">{searchResult.rack.id}</span> rafında bulundu.</CardDescription>
                </div>
                 <Button variant="ghost" size="icon" onClick={() => setSearchResult(null)}><XCircle className="h-5 w-5 text-muted-foreground"/></Button>
            </div>
          </CardHeader>
          <CardContent>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 space-y-2">
                    <h4 className="font-semibold">{searchResult.rack.labName}</h4>
                    <p className="text-sm">Mühürleme: {searchResult.rack.sealedAt ? format(searchResult.rack.sealedAt as Date, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}</p>
                    <p className="text-sm">Numune Yeri: <span className="font-bold text-lg text-green-500">{idxToPos(searchResult.specimenIndex)}</span></p>
                </div>
                <div className="md:col-span-2">
                    <div className="grid grid-cols-10 gap-2 p-2 border rounded-xl bg-background/50">
                    {Array.from({ length: 100 }).map((_, i) => {
                      const isFound = i === searchResult.specimenIndex;
                      return (
                        <div
                          key={i}
                          title={isFound ? `Bulunan Numune: ${searchQuery}` : `Yuva: ${idxToPos(i)}`}
                          className={cn(
                            "h-10 rounded-md flex items-center justify-center text-xs font-mono border transition-colors p-1",
                            isFound
                              ? 'bg-green-500/20 border-green-500/50 text-green-700 dark:text-green-300 font-bold'
                              : 'bg-muted/50 border-border'
                          )}
                        >
                          {idxToPos(i)}
                        </div>
                      )
                    })}
                  </div>
                </div>
             </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-6 w-6 text-primary" />
            Arşivlenmiş Raflar
          </CardTitle>
          <CardDescription>Mühürlenmiş tüm numune raflarının listesi.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : (
            <ScrollArea className="h-[70vh] border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader label="Raf ID" sortKey="id" currentSortKey={sortKey} isAsc={sortAsc} onClick={handleSort}/>
                    <TableHead>
                      <FilterPopover
                          title="Laboratuvar"
                          options={uniqueLabs}
                          selectedValues={labFilter}
                          onSelectionChange={setLabFilter}
                      />
                    </TableHead>
                    <SortableHeader label="Mühürleyen" sortKey="sealedBy" currentSortKey={sortKey} isAsc={sortAsc} onClick={handleSort}/>
                    <SortableHeader label="Tarih" sortKey="sealedAt" currentSortKey={sortKey} isAsc={sortAsc} onClick={handleSort}/>
                    <SortableHeader label="Numune Sayısı" sortKey="specimenCount" currentSortKey={sortKey} isAsc={sortAsc} onClick={handleSort}/>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedRacks.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center h-24">
                        Arşivlenmiş raf bulunamadı.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAndSortedRacks.map(rack => (
                      <TableRow
                        key={rack.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/numune-arsivi/gecmis/${rack.id}`)}
                      >
                        <TableCell className="font-mono text-xs">{rack.id}</TableCell>
                        <TableCell>{rack.labName}</TableCell>
                        <TableCell>{rack.sealedBy}</TableCell>
                        <TableCell>{rack.sealedAt ? format(rack.sealedAt as Date, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}</TableCell>
                        <TableCell>{rack.specimenCount}</TableCell>
                        <TableCell className="text-right">
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                                        <Trash2 className="h-4 w-4 text-destructive"/>
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Bu işlem geri alınamaz. "{rack.id}" rafını ve içindeki tüm numune kayıtlarını kalıcı olarak sileceksiniz.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>İptal</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDelete(rack.id)} className="bg-destructive hover:bg-destructive/90">
                                            Evet, Sil
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
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
