/**
 * Qore Finance Module — Operational Cost Link types (Faz 3)
 */

import type { FinanceCurrency } from "./types";

export interface OperationalCostLink {
  id: string;
  sourceType: "invoice_line" | "payment" | "expense";
  sourceId: string;
  
  // Qore boyut bağlantıları
  hospitalId?: string;
  hospitalName?: string;
  
  contractId?: string;         // İhale/sözleşme bağlantısı
  productCodeId?: string;      // Ürün stok kodu
  deviceId?: string;           // Cihaz bağlantısı
  testName?: string;           // Laboratuvar test adı
  
  amount: number;
  currency: FinanceCurrency;
  
  /** YYYY-MM formatında işlem veya yansıtma dönemi */
  period: string;
  
  createdAt: Date;
  companyId?: string;
}
