"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <FileClock className="h-8 w-8 text-indigo-600" />
          Cari Ekstre
        </h1>
        <p className="text-muted-foreground mt-1">
          Cari firmaların hesap hareketlerini ve bakiye değişimlerini inceleyin.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium">Cari Firma</label>
              <Select value={selectedFirmaId} onValueChange={setSelectedFirmaId} disabled={isFirmalarLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Ekstresi alınacak firmayı seçin" />
                </SelectTrigger>
                <SelectContent>
                  {firmalar.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <Button onClick={handleSearch} disabled={!selectedFirmaId || isLoading} className="gap-2">
              <Search className="h-4 w-4" />
              Sorgula
            </Button>
          </div>
        </CardContent>
      </Card>

      {selectedFirmaId && entries.length > 0 && !isLoading && (
        <Card>
          <CardHeader>
            <CardTitle>Hesap Hareketleri</CardTitle>
            <CardDescription>
              {firmalar.find(f => f.id === selectedFirmaId)?.name} cari hesabının geçmiş hareketleri.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tarih</TableHead>
                    <TableHead>İşlem Tipi</TableHead>
                    <TableHead>Belge No</TableHead>
                    <TableHead>Açıklama</TableHead>
                    <TableHead className="text-right">Borç (Bizim Alacağımız)</TableHead>
                    <TableHead className="text-right">Alacak (Karşı Alacağı)</TableHead>
                    <TableHead className="text-right border-l font-bold">Bakiye</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{format(new Date(entry.entryDate), "dd.MM.yyyy")}</TableCell>
                      <TableCell>{ENTRY_TYPE_LABELS[entry.entryType] || entry.entryType}</TableCell>
                      <TableCell>{entry.sourceDocNo || "-"}</TableCell>
                      <TableCell className="max-w-xs truncate" title={entry.description}>{entry.description}</TableCell>
                      <TableCell className="text-right text-green-600">
                        {entry.debitAmount > 0 ? formatCurrency(entry.debitAmount, entry.currency) : "-"}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {entry.creditAmount > 0 ? formatCurrency(entry.creditAmount, entry.currency) : "-"}
                      </TableCell>
                      <TableCell className={cn("text-right border-l font-medium", entry.balance > 0 ? "text-green-600" : entry.balance < 0 ? "text-red-600" : "")}>
                        {formatCurrency(entry.balance, entry.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 p-4 bg-muted/50 rounded-lg flex justify-between items-center">
              <span className="text-sm text-muted-foreground">
                * Bakiye gösterimi kronolojik sondan başa doğrudur. (Pozitif Bakiye = Müşteri Borçlu / Biz Alacaklıyız)
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedFirmaId && entries.length === 0 && !isLoading && (
        <Card>
          <CardContent className="py-10 text-center">
            <FileClock className="h-12 w-12 mx-auto text-muted-foreground opacity-50 mb-4" />
            <p className="text-muted-foreground">Bu firma için hesap hareketi bulunamadı.</p>
          </CardContent>
        </Card>
      )}
      
      {isLoading && (
        <Card>
          <CardContent className="p-6 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
