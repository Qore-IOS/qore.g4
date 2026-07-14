/**
 * Qore Finance Module — Budget Management types (Faz 2)
 */

import type { FinanceCurrency } from "./types";

export interface BudgetRevision {
  date: Date;
  previousAmount: number;
  newAmount: number;
  reason: string;
  revisedBy: string;
}

export interface BudgetPlan {
  id: string;
  fiscalYear: number;
  /** Opsiyonel: Sadece aylık takip edilmek istenirse (1-12) */
  fiscalMonth?: number;
  
  departmentId?: string;
  cariFirmaId?: string;
  
  /** Qore entegrasyonu (Faz 3) */
  contractId?: string;
  hospitalId?: string;
  
  /** Planlanan (Tahsis edilen) bütçe */
  plannedAmount: number;
  /** Taahhüt edilen (onaylanmış ama henüz ödenmemiş faturalar vs.) */
  committedAmount: number;
  /** Gerçekleşen (ödenmiş olan) */
  actualAmount: number;
  
  currency: FinanceCurrency;
  notes?: string;
  
  revisionHistory?: BudgetRevision[];
  createdAt: Date;
  companyId?: string;
}
