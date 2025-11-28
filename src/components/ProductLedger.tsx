
'use client';
import React, { useMemo, useState } from "react";
import { Card, CardHeader, CardContent, CardTitle, CardDescription, CardFooter } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";
import { X, FileSpreadsheet, ChevronRight, ChevronDown } from "lucide-react";
import type { ProductCode, LedgerData, LedgerItemRow, GroupedLedgerRow } from "@/lib/types";
import { motion } from "framer-motion";
import { cn, exportDataToExcel } from "@/lib/utils";
import { format } from "date-fns";
import { tr } from "date-fns/locale";

interface Props {
  data: LedgerData;
  type: "product" | "lot" | "serial";
  onClose?: () => void;
  productCodes?: ProductCode[];
}

// Pagination
function usePagination<T extends LedgerItemRow | GroupedLedgerRow>(rows: T[], pageSizeDefault = 20) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizeDefault);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const paged = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize]);
  const go = (p: number) => setPage(Math.min(Math.max(1, p), totalPages));
  return { page, setPage: go, pageSize, setPageSize, totalPages, rows: paged };
}

export default function ProductLedger({ data, type, onClose = () => {}, productCodes = [] }: Props) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const rows = data.rows as (LedgerItemRow | GroupedLedgerRow)[];
  const pager = usePagination(rows as any, 20);

  const handleExport = () => {
    if (type === "serial") {
      const excelData = (rows as LedgerItemRow[]).map((item) => ({
        "Tarih": item.date ? format(new Date(item.date), "dd.MM.yyyy HH:mm", { locale: tr }) : "-",
        "İşlem Tipi": item.action,
        "Kaynak": (item as any).source,
        "Hedef": (item as any).target || "-",
        "Detay": (item as any).details || "-"
      }));
      exportDataToExcel(excelData, `SeriNo_${(data.product as any).sorgu}`, "SeriNo Ekstre", () => {});
    } else {
      const excelData = (rows as GroupedLedgerRow[]).map((g) => ({
        "Tarih": g.date ? format(new Date(g.date), "dd.MM.yyyy HH:mm", { locale: tr }) : "-",
        "Stok Kodu": g.stokKodu || "-",
        "Stok Adı": g.stokAdi || "-",
        "Lot": g.lot || "-",
        "İşlem": (g as any).type,
        "Miktar": g.seriNolar?.length || 0,
        "Kaynak": g.source || "-",
        "Hedef": g.target || "-",
        "Seri No Adedi": g.seriNolar?.length || 0
      }));
      exportDataToExcel(excelData, `Urun_${(data.product as any).sorgu}`, "Ürün Ekstre", () => {});
    }
  };

  const StockChip = () => (
    <div className="flex items-center gap-3 text-xs md:text-sm bg-background/50 p-3 rounded-xl border border-white/10">
      <div className="flex items-center gap-2">
        <span className="text-white/80">Stok Kodu:</span>
        <span className="font-semibold">{data.product.stokKodu || "-"}</span>
      </div>
      <div className="h-4 w-px bg-white/20" />
      <div className="flex items-center gap-2">
        <span className="text-white/80">Stok Adı:</span>
        <span className="font-semibold">{data.product.stokAdi || "-"}</span>
      </div>
    </div>
  );

  const StockSummary = () => (
    <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 mt-3">
      {(data as any).header?.stokBilgisi?.map((s: any, i: number) => (
        <div key={i} className="text-xs md:text-sm bg-background/40 rounded-lg px-3 py-2 border border-white/10">
          <span className="text-white/70">{s.depoAdi}</span>
          <span className="mx-2">•</span>
          <span className="font-semibold">{s.adet}</span>
          <span className="ml-1">{s.birim}</span>
        </div>
      ))}
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <div className="glass-card mt-6 p-6 rounded-2xl shadow-2xl border border-white/10 backdrop-blur-lg text-white">
        <CardHeader className="flex flex-row justify-between items-start !p-0 !pb-4">
          <div>
            <CardTitle className="text-xl font-headline text-gradient-primary">Ürün Ekstresi</CardTitle>
            <CardDescription className="text-white/80">Sorgu: "{(data as any).header?.sorgu}"</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-white/70 hover:text-white hover:bg-white/10">
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>

        <CardContent className="!p-0">
          <div className="mb-4 text-sm bg-background/50 p-3 rounded-xl border border-white/10 flex flex-col gap-2">
            <StockChip />
            {(data as any).header?.stokBilgisi?.length > 0 && <StockSummary />}
          </div>

          <ScrollArea className="h-[400px] rounded-xl border border-white/10">
            <Table>
              {type === "serial" ? (
                <>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-b border-white/10">
                      <TableHead>Tarih</TableHead>
                      <TableHead>İşlem Tipi</TableHead>
                      <TableHead>Kaynak</TableHead>
                      <TableHead>Hedef</TableHead>
                      <TableHead>Detay</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(pager.rows as LedgerItemRow[]).map((r: LedgerItemRow, idx: number) => (
                      <TableRow key={idx} className="hover:bg-white/5 border-b border-white/10">
                        <TableCell>{r.date ? format(new Date(r.date), "dd.MM.yyyy - HH:mm", { locale: tr }) : "-"}</TableCell>
                        <TableCell>{r.action}</TableCell>
                        <TableCell>{(r as any).source || "-"}</TableCell>
                        <TableCell>{(r as any).target || "-"}</TableCell>
                        <TableCell className="text-white/80">{(r as any).details || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </>
              ) : (
                <>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-b border-white/10">
                      <TableHead></TableHead>
                      <TableHead>Tarih</TableHead>
                      <TableHead>Ürün</TableHead>
                      <TableHead>Lot</TableHead>
                      <TableHead>İşlem</TableHead>
                      <TableHead>Miktar</TableHead>
                      <TableHead>Kaynak</TableHead>
                      <TableHead>Hedef</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(pager.rows as GroupedLedgerRow[]).map((g: GroupedLedgerRow, idx: number) => {
                      const open = !!expanded[idx];
                      return (
                        <React.Fragment key={idx}>
                          <TableRow className="hover:bg-white/5 border-b border-white/10">
                            <TableCell className="w-10">
                              <button
                                onClick={() => setExpanded((s) => ({ ...s, [idx]: !s[idx] }))}
                                className="p-1 rounded-lg hover:bg-white/10"
                                aria-label={open ? "Kapat" : "Aç"}
                              >
                                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                            </TableCell>
                            <TableCell>{g.date ? format(new Date(g.date), "dd.MM.yyyy - HH:mm", { locale: tr }) : "-"}</TableCell>
                            <TableCell className="font-medium">{g.stokAdi || "-"}</TableCell>
                            <TableCell>Lot: {g.lot || "-"}</TableCell>
                            <TableCell>{(g as any).type}</TableCell>
                            <TableCell className="font-bold">{g.seriNolar?.length || 0} {(data as any).header?.stokBilgisi?.[0]?.birim || "Adet"}</TableCell>
                            <TableCell>{g.source || "-"}</TableCell>
                            <TableCell>{g.target || "-"}</TableCell>
                          </TableRow>
                          {open && (
                            <TableRow className="bg-black/20">
                              <TableCell />
                              <TableCell colSpan={7}>
                                {g.seriNolar?.length ? (
                                  <div className="text-xs grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 p-2">
                                    {g.seriNolar.map((s: string, i: number) => (
                                      <div key={i} className="bg-white/5 rounded-lg px-2 py-1 border border-white/10 font-mono">{s}</div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-sm text-white/70 p-2">Bu işlem için seri numarası bulunamadı.</div>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </>
              )}
            </Table>
          </ScrollArea>
        </CardContent>

        {/* Pagination */}
        <CardFooter className="!p-0 !pt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button onClick={() => pager.setPage(pager.page - 1)} disabled={pager.page <= 1} variant="outline" size="sm">Önceki</Button>
            <div className="text-sm">Sayfa {pager.page} / {pager.totalPages}</div>
            <Button onClick={() => pager.setPage(pager.page + 1)} disabled={pager.page >= pager.totalPages} variant="outline" size="sm">Sonraki</Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">Satır / Sayfa</span>
            <select
              className="bg-background/50 border border-white/10 rounded-lg px-2 py-1 text-sm text-white"
              value={pager.pageSize}
              onChange={(e) => {
                pager.setPage(1);
                pager.setPageSize(parseInt(e.target.value, 10));
              }}
            >
              {[20,30,50,100].map((n) => (<option key={n} value={n}>{n}</option>))}
            </select>
            <Button onClick={handleExport} className="ml-2">
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Excel'e Aktar
            </Button>
          </div>
        </CardFooter>
      </div>
    </motion.div>
  );
}
