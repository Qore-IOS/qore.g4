'use client';

interface CapitalEfficiencyProps {
  capitalTied: number;
  turnoverRatio: number;
  dio: number;
  symbol: string;
}

export default function CapitalEfficiency({ capitalTied, turnoverRatio, dio, symbol }: CapitalEfficiencyProps) {
  return (
    <div className="cihaz-card-strong p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-[var(--dashboard-text)] mb-3">Sermaye Verimliliği</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="cihaz-pressed p-3">
          <p className="text-[var(--dashboard-muted)] text-xs">Bağlanan Sermaye</p>
          <p className="font-bold text-[var(--dashboard-accent)]">{symbol}{capitalTied.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="cihaz-pressed p-3">
          <p className="text-[var(--dashboard-muted)] text-xs">Stok Devir Hızı (Q)</p>
          <p className="font-bold text-[var(--dashboard-accent)]">{turnoverRatio.toFixed(2)}x</p>
        </div>
        <div className="cihaz-pressed p-3">
          <p className="text-[var(--dashboard-muted)] text-xs">DIO (gün)</p>
          <p className="font-bold text-[var(--dashboard-accent)]">{Number.isFinite(dio) ? dio.toFixed(0) : '—'}</p>
        </div>
      </div>
    </div>
  );
}
