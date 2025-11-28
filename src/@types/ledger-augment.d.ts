
// src/@types/ledger-augment.d.ts
// Ensures the compiler sees these extra exports on "@/lib/types" without editing the original file.
declare module '@/lib/types' {
  export type LedgerOpType = 'IN' | 'OUT' | 'TRANSFER' | string;

  export interface LedgerItemRow {
    id?: string;
    date?: string | number | Date;
    type: LedgerOpType;
    source?: string;
    target?: string;
    details?: string;
  }

  export interface GroupedLedgerRow {
    date?: string | number | Date;
    stokKodu?: string;
    stokAdi?: string;
    lot?: string;
    type: LedgerOpType;
    seriNolar?: string[];
    source?: string;
    target?: string;
  }

  export interface LedgerHeaderStockInfo {
    depoAdi: string;
    adet: number;
    birim: string;
  }

  export interface LedgerHeader {
    sorgu: string;
    stokKodu?: string;
    stokAdi?: string;
    stokBilgisi?: LedgerHeaderStockInfo[];
  }

  export interface LedgerData {
    header: LedgerHeader;
    // For "serial" screens we use LedgerItemRow, for grouped views we use GroupedLedgerRow
    items: Array<LedgerItemRow | GroupedLedgerRow>;
  }
}
