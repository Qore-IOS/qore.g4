/**
 * Qore Finance Module — Currency and Exchange Rate types (Faz 2)
 */

export interface ExchangeRateRecord {
  id: string;
  /** YYYY-MM-DD formatında tarih */
  date: string;
  /** Temel alınan döviz cinsi (genellikle TRY) */
  baseCurrency: "TRY";
  /** Diğer döviz kurlarının temel dövize karşılığı { USD: 38.50, EUR: 42.30, GBP: 49.10 } */
  rates: Record<string, number>;
  source: "tcmb" | "manual";
  createdAt: Date;
  companyId?: string;
}
