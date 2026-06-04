"use client";
import { useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileClock, Search } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { listCariFirmalar } from "@/lib/cari-odeme/firestore";
import { listLedgerEntries } from "@/lib/cari-odeme/ledger-firestore";
import type { CariFirma } from "@/lib/cari-odeme/types";
import type { LedgerEntry, LedgerEntryType } from "@/lib/cari-odeme/finance-types";
import { format } from "date-fns";
import { tr } from "date-fns/locale";

const ENTRY_TYPE_LABELS: Record<LedgerEntryType, string> = {
  fatura_borc: "Fatura (Borç)",
  fatura_alacak: "Fatura (Alacak)",
  odeme: "Ödeme Çıkışı",
  tahsilat: "Tahsilat",
  mahsup: "Mahsup",
  virman: "Virman",
  acilis_bakiye: "Açılış Bakiyesi",
};

export default function EkstrePage() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  
  const [firmalar, setFirmalar] = useState<CariFirma[]>([]);
  const [selectedFirmaId, setSelectedFirmaId] = useState<string>("");
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFirmalarLoading, setIsFirmalarLoading] = useState(true);

  useEffect(() => {
    async function fetchFirmalar() {
      setIsFirmalarLoading(true);
      try {
        const data = await listCariFirmalar({ companyId: currentCompanyId, isSuperAdmin }, { size: 1000 });
        setFirmalar(data.items);
      } catch (error) {
        console.error("Firmalar yüklenemedi", error);
      } finally {
        setIsFirmalarLoading(false);
      }
    }
    fetchFirmalar();
  }, [currentCompanyId, isSuperAdmin]);

  const handleSearch = async () => {
    if (!selectedFirmaId) return;
    setIsLoading(true);
    try {
      const data = await listLedgerEntries(
        { companyId: currentCompanyId, isSuperAdmin },
        selectedFirmaId
      );
      // Sonuçlar desc (en yeni en üstte) geliyor
      setEntries(data);
    } catch (error) {
      console.error("Ekstre yüklenemedi", error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (n: number, currency = "TRY") =>
    n.toLocaleString("tr-TR", { style: "currency", currency });

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-2 py-4">
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <FileClock className="h-6 w-6 text-primary" />
            Cari Ekstre
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cari firmaların hesap hareketlerini ve bakiye değişimlerini inceleyin.
          </p>
        </div>
      </div>

      <div className="p-6 bg-card border border-border rounded-xl shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">Cari Firma</label>
            <Select value={selectedFirmaId} onValueChange={setSelectedFirmaId} disabled={isFirmalarLoading}>
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Ekstresi alınacak firmayı seçin" />
              </SelectTrigger>
              <SelectContent>
                {firmalar.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <Button onClick={handleSearch} disabled={!selectedFirmaId || isLoading} className="rounded-full gap-2 px-6">
            <Search className="h-4 w-4" />
            Sorgula
          </Button>
        </div>
      </div>

      {selectedFirmaId && entries.length > 0 && !isLoading && (
        <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
          <div className="p-6 border-b border-border bg-muted/20">
            <h3 className="text-base font-semibold">Hesap Hareketleri</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {firmalar.find(f => f.id === selectedFirmaId)?.name} cari hesabının geçmiş hareketleri.
            </p>
          </div>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="font-medium h-10">Tarih</TableHead>
                <TableHead className="font-medium h-10">İşlem Tipi</TableHead>
                <TableHead className="font-medium h-10">Belge No</TableHead>
                <TableHead className="font-medium h-10">Açıklama</TableHead>
                <TableHead className="font-medium h-10 text-right">Borç (Bizim Alacağımız)</TableHead>
                <TableHead className="font-medium h-10 text-right">Alacak (Karşı Alacağı)</TableHead>
                <TableHead className="font-bold h-10 text-right border-l border-border/50">Bakiye</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry, idx) => (
                <TableRow key={entry.id} className={cn("border-border/50 hover:bg-muted/30 transition-colors", idx === entries.length - 1 && "border-0")}>
                  <TableCell className="py-3 text-muted-foreground">{format(new Date(entry.entryDate), "dd.MM.yyyy")}</TableCell>
                  <TableCell className="py-3 font-medium text-foreground">{ENTRY_TYPE_LABELS[entry.entryType] || entry.entryType}</TableCell>
                  <TableCell className="py-3 font-mono text-xs">{entry.sourceDocNo || "-"}</TableCell>
                  <TableCell className="py-3 max-w-xs truncate text-muted-foreground" title={entry.description}>{entry.description}</TableCell>
                  <TableCell className="py-3 text-right font-medium text-emerald-600">
                    {entry.debitAmount > 0 ? formatCurrency(entry.debitAmount, entry.currency) : "-"}
                  </TableCell>
                  <TableCell className="py-3 text-right font-medium text-destructive">
                    {entry.creditAmount > 0 ? formatCurrency(entry.creditAmount, entry.currency) : "-"}
                  </TableCell>
                  <TableCell className={cn("py-3 text-right border-l border-border/50 font-bold", entry.balance > 0 ? "text-emerald-600" : entry.balance < 0 ? "text-destructive" : "")}>
                    {formatCurrency(entry.balance, entry.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="p-4 bg-muted/20 border-t border-border flex justify-between items-center text-xs text-muted-foreground">
            <span>* Bakiye gösterimi kronolojik sondan başa doğrudur. (Pozitif Bakiye = Müşteri Borçlu / Biz Alacaklıyız)</span>
          </div>
        </div>
      )}

      {selectedFirmaId && entries.length === 0 && !isLoading && (
        <div className="rounded-xl border border-border bg-card p-16 text-center">
          <FileClock className="h-12 w-12 mx-auto text-muted-foreground opacity-30 mb-4" />
          <p className="text-muted-foreground">Bu firma için hesap hareketi bulunamadı.</p>
        </div>
      )}
      
      {isLoading && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}
    </div>
  );
}
