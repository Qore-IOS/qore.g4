/**
 * Qore Finance Module — Invoice and Receipt types (Faz 1)
 */

import type { FinanceCurrency } from "./types";

export type InvoiceType = "alis" | "satis" | "alis_iade" | "satis_iade";
export type InvoiceStatus = "taslak" | "onaylandi" | "kismi_odendi" | "odendi" | "iptal";

export interface InvoiceLine {
  lineNo: number;
  description: string;
  quantity: number;
  unitPrice: number;
  /** KDV oranı (örn. 0.01, 0.10, 0.20) */
  taxRate: number;
  taxAmount: number;
  /** KDV dahil satır toplamı */
  lineTotal: number;
  discountRate?: number;
  discountAmount?: number;
  // Qore operasyonel bağlantı alanları (Faz 3 hazırlık)
  productCodeId?: string;
  hospitalId?: string;
  contractId?: string;
}

export interface Invoice {
  id: string;
  /** Fatura numarası (sistem veya manuel) */
  invoiceNo: string;
  type: InvoiceType;
  status: InvoiceStatus;
  cariFirmaId: string;
  /** Denormalize firma adı (hızlı liste gösterimi için) */
  cariFirmaName: string;
  /** Fatura tarihi */
  issueDate: Date;
  /** Vade tarihi */
  dueDate: Date;
  currency: FinanceCurrency;
  /** KDV hariç toplam (ara toplam) */
  subtotal: number;
  /** Toplam KDV tutarı */
  taxTotal: number;
  /** KDV dahil genel toplam */
  grandTotal: number;
  /** Şu ana kadar ödenen/tahsil edilen tutar (kısmi kapama için) */
  paidAmount: number;
  /** Kalan açık tutar (grandTotal - paidAmount) */
  remainingAmount: number;
  notes?: string;
  attachmentUrls?: string[];
  lines: InvoiceLine[];
  // Döviz alanları
  fxRate?: number;
  baseCurrencyTotal?: number;
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  companyId?: string; // Tenant tag
}

export type ReceiptType = "nakit" | "havale" | "cek" | "kredi_karti";

export interface ReceiptAllocation {
  invoiceId: string;
  invoiceNo: string;
  allocatedAmount: number;
}

/** Tahsilat Makbuzu (Müşteriden alınan veya tedarikçiden iade alınan) */
export interface Receipt {
  id: string;
  receiptNo: string;
  cariFirmaId: string;
  cariFirmaName: string;
  type: ReceiptType;
  amount: number;
  currency: FinanceCurrency;
  receiptDate: Date;
  bankAccountId?: string;
  bankName?: string;
  description?: string;
  /** Hangi faturaların kapatıldığı */
  allocations: ReceiptAllocation[];
  createdAt: Date;
  createdBy: string;
  companyId?: string;
}
