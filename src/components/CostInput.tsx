// src/components/CostInput.tsx
'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import debounce from 'lodash.debounce';
import { EXCHANGE_RATES_CACHE_TTL, getTryRateForCurrency } from '@/lib/exchange-rates';

type Currency = 'EUR' | 'USD' | 'TRY';

type CostInputProps = {
  initialCost?: number;
  initialCurrency?: Currency;
  onCostChange: (cost: number, currency: Currency) => void;
};

const CACHE_TTL = EXCHANGE_RATES_CACHE_TTL;


export const CostInput: React.FC<CostInputProps> = ({
  initialCost = 0,
  initialCurrency = 'EUR',
  onCostChange,
}) => {
  const [cost, setCost] = useState<number>(initialCost);
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [rate, setRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const cacheKey = `rate_${currency}_TRY`;

  const loadRate = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      if (!forceRefresh) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { rate: r, ts } = JSON.parse(cached);
          if (Date.now() - ts < CACHE_TTL) {
            setRate(r);
            setLoading(false);
            return;
          }
        }
      }
      const r = await getTryRateForCurrency(currency, {
        forceRefresh,
        scopeKey: 'cost-input',
      });
      localStorage.setItem(cacheKey, JSON.stringify({ rate: r, ts: Date.now() }));
      setRate(r);
      toast({ title: "Başarılı", description: "Döviz kuru güncellendi." });

    } catch (err: any) {
      console.error('Rate fetch failed:', err);
      setError('Döviz kuru alınamadı');
      setRate(null);
      toast({ title: 'Döviz Kuru Hatası', description: 'Tüm servisler yanıt vermedi. Lütfen daha sonra tekrar deneyin.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [currency, cacheKey, toast]);

  useEffect(() => {
    setCost(initialCost);
    setCurrency(initialCurrency);
  }, [initialCost, initialCurrency]);

  useEffect(() => {
    loadRate();
  }, [loadRate]);

  const debouncedUpdate = useCallback(
    debounce((costVal: number, currencyVal: Currency) => {
      onCostChange(costVal, currencyVal);
    }, 500),
    [onCostChange]
  );

  const handleCostChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value) || 0;
    setCost(val);
    debouncedUpdate(val, currency);
  };

  const handleCurrencyChange = (newCurrency: Currency) => {
    setCurrency(newCurrency);
    debouncedUpdate(cost, newCurrency);
  };

  const converted = rate != null ? (cost * rate).toFixed(2) : '–';

  return (
    <div className="flex flex-col space-y-3">
      <div className="flex gap-2 items-center">
        <Input
          type="number"
          step="0.01"
          value={cost === 0 ? '' : cost}
          onChange={handleCostChange}
          placeholder="0.00"
          className="flex-1"
        />
        <Select value={currency} onValueChange={handleCurrencyChange}>
            <SelectTrigger className="w-[100px]">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="EUR">EUR (€)</SelectItem>
                <SelectItem value="USD">USD ($)</SelectItem>
                <SelectItem value="TRY">TRY (₺)</SelectItem>
            </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between p-2 rounded-md bg-muted/50 h-10">
        <span className="text-sm font-medium text-muted-foreground">Yaklaşık Değer:</span>
        {loading && rate === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : error ? (
          <span className="text-sm font-semibold text-destructive">{error}</span>
        ) : (
          <span className="text-base font-bold text-foreground">{converted} ₺</span>
        )}
      </div>
      <Button
        onClick={() => loadRate(true)}
        variant="ghost"
        size="sm"
        className="text-primary text-xs self-start"
        disabled={loading}
      >
        <RefreshCw className={cn("mr-2 h-3 w-3", loading && "animate-spin")} />
        Döviz Kurunu Yenile
      </Button>
    </div>
  );
};
