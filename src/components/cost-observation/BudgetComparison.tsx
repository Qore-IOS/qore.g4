'use client';

interface BudgetComparisonProps {
  actual: number;
  budget: number;
  symbol: string;
}

export default function BudgetComparison({ actual, budget, symbol }: BudgetComparisonProps) {
  const variance = actual - budget;
  const pct = budget > 0 ? (variance / budget) * 100 : 0;
  const progress = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
  const over = variance > 0;

  return (
    <div className="cihaz-card-strong p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-[var(--dashboard-text)] mb-3">Bütçe vs Gerçekleşen</h3>
      <p className="text-xs text-[var(--dashboard-muted)] mb-1">Gerçekleşen: {symbol}{actual.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
      <p className="text-xs text-[var(--dashboard-muted)] mb-3">Bütçe: {symbol}{budget.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
      <div className="h-2 rounded-full bg-[var(--dashboard-surface-2)] overflow-hidden mb-3">
        <div className={`h-full ${over ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${progress}%` }} />
      </div>
      <p className={`text-sm font-semibold ${over ? 'text-red-500' : 'text-emerald-600'}`}>
        {over ? 'Bütçe aşımı' : 'Bütçe içinde'} · %{Math.abs(pct).toFixed(1)}
      </p>
    </div>
  );
}
