'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import type { Hospital, ProductCode, EfficiencyPool, LabPool, MinMaxRule } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Loader2, BarChart3, FileSpreadsheet, Save, Download, ChevronRight, Upload, Eye, EyeOff, History, Filter, ArrowUpDown, ArrowUp, ArrowDown, Search, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { collection, getDocs, query, orderBy, doc, setDoc, getDoc, Timestamp, where, collectionGroup } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import BackButton from '@/components/BackButton';
import { exportDataToExcel } from '@/lib/utils';
import Link from 'next/link';

interface TotalVerimlilikPanelProps {
  hospitals: Hospital[];
  productCodes: ProductCode[];
}

interface TableRow {
  id: string; // labId-stokKodu kombinasyonu
  labId: string;
  labName: string;
  labKod: string;
  stokKodu: string;
  stokAdi: string;
  testAdi: string;
  ambalajDegeri: number;
  cihazGrubu: string;
  // Manuel giriş alanları (Sütun 7-8)
  baslangicStokuKutu: number;
  ayBasiCihazUstuTest: number;
  // Hesaplanan alan (Sütun 9)
  totalAyBasiStok: number;
  // Phase 2 - Sütunlar 10-14
  ayBasiSevkiyatKutu: number; // Sütun 10 - Ay Başı Sevkiyat (Kutu)
  goztepeSevkiyat: number; // Sütun 11 - Göztepe Sevkiyat (Kutu)
  kurumlarArasiSevk: number; // Sütun 12 - Kurumlar Arası Sevk (Kutu)
  kurumlarArasiSevkKaynakLabId?: string; // Sütun 12 için kaynak lab
  lojistikAraTransfer: number; // Sütun 13 - Lojistik Ara Transfer (Kutu)
  sevkiyatlarSonrasiTotalTest: number; // Sütun 14 - Hesaplanan
  // Phase 3 - Sütunlar 15-19
  kumulatifTotal: number; // Sütun 15 - Kümülatif Total (Test)
  donemSonuStokKutu: number; // Sütun 16 - Dönem Sonu Stok (Kutu)
  donemSonuCihazUstuTest: number; // Sütun 17 - Dönem Sonu Cihaz Üstü (Test)
  donemSonuToplamTest: number; // Sütun 18 - Hesaplanan: (16 * ambalaj) + 17
  hakEdis: number; // Sütun 19 - Hak Ediş (Test)
  // Phase 4 - Sütunlar 20-21
  stokDogrulukFark: number; // Sütun 20 - (14-18) - 15 = Fark (Test)
  stokDogrulukYuzde: number; // Sütun 20 - Fark/15 * 100 = Sapma %
  kitVerimlilikFark: number; // Sütun 21 - 15 - 19 = Fark (Test)
  kitVerimlilikYuzde: number; // Sütun 21 - Fark/15 * 100 = Sapma %
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Date(2000, i, 1).toLocaleString('tr-TR', { month: 'long' })
}));

export default function TotalVerimlilikPanel({
  hospitals = [],
  productCodes = [],
}: TotalVerimlilikPanelProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();

  const [selectedPoolId, setSelectedPoolId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [efficiencyPools, setEfficiencyPools] = useState<EfficiencyPool[]>([]);
  const [labPools, setLabPools] = useState<LabPool[]>([]);
  const [allMinMaxRules, setAllMinMaxRules] = useState<Record<string, MinMaxRule[]>>({});

  const [rows, setRows] = useState<TableRow[]>([]);

  // Phase 2 State'leri
  const [depots, setDepots] = useState<{ id: string; name: string }[]>([]);

  // Göztepe Sevkiyat Modal State'leri (Sütun 11)
  const [showGoztepeSevkiyatModal, setShowGoztepeSevkiyatModal] = useState(false);
  const [selectedLabsForSevkiyat, setSelectedLabsForSevkiyat] = useState<Set<string>>(new Set());
  const [isFetchingSevkiyat, setIsFetchingSevkiyat] = useState(false);

  // Kurumlar Arası Sevk Modal State'leri (Sütun 12)
  const [showKurumlarArasiModal, setShowKurumlarArasiModal] = useState(false);
  const [kurumlarArasiEditingRow, setKurumlarArasiEditingRow] = useState<{ rowId: string; value: number } | null>(null);

  // Kurumlar arası transfer bilgisi - hangi labdan ne kadar alındığını takip eder
  // Key: "targetRowId" -> { sourceLabId, kutuAdet }
  const [interLabTransfers, setInterLabTransfers] = useState<Record<string, { sourceLabId: string; sourceLabName: string; kutuAdet: number }>>({});

  // Phase 5 - Excel Import Modal State'leri
  const [showExcelImportModal, setShowExcelImportModal] = useState(false);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Phase 6 - Sonuç Odaklı Görünüm
  const [showResultsOnly, setShowResultsOnly] = useState(false);

  // Sütun 22 - Kutu Kayıp Görünüm Modu
  const [column22Mode, setColumn22Mode] = useState<'kumulatif' | 'hakedis'>('kumulatif');

  // Sütun 23 - Maliyet Hesabı için Para Birimi ve Döviz Kurları
  const [costCurrency, setCostCurrency] = useState<'TRY' | 'USD' | 'EUR'>('TRY');
  const [exchangeRates, setExchangeRates] = useState<{ EUR: number; USD: number; TRY: number } | null>(null);

  // Filter, Sort ve Search State'leri
  const [columnFilters, setColumnFilters] = useState<{
    labName: Set<string>;
    stokAdi: Set<string>;
    testAdi: Set<string>;
    cihazGrubu: Set<string>;
  }>({
    labName: new Set(),
    stokAdi: new Set(),
    testAdi: new Set(),
    cihazGrubu: new Set(),
  });
  const [sortConfig, setSortConfig] = useState<{
    column: 'stokDogrulukFark' | 'kitVerimlilikFark' | null;
    direction: 'asc' | 'desc';
  }>({ column: null, direction: 'asc' });
  const [searchTerm, setSearchTerm] = useState('');

  // Verimlilik havuzlarını, ortak lab havuzlarını ve depoları çek
  useEffect(() => {
    const fetchPools = async () => {
      setIsLoading(true);
      try {
        const [effPoolsSnap, labPoolsSnap, depotsSnap] = await Promise.all([
          getDocs(query(collection(db, 'efficiencyPools'), orderBy('createdAt', 'desc'))),
          getDocs(collection(db, 'labPools')),
          getDocs(collection(db, 'depots')),
        ]);
        setEfficiencyPools(effPoolsSnap.docs.map(d => ({ id: d.id, ...d.data() } as EfficiencyPool)));
        setLabPools(labPoolsSnap.docs.map(d => ({ id: d.id, ...d.data() } as LabPool)));
        setDepots(depotsSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || d.id })));
      } catch (error) {
        console.error('Error fetching pools:', error);
        toast({ title: 'Hata', description: 'Havuzlar yüklenemedi.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    fetchPools();
  }, [toast]);

  // Sütun 23 için döviz kurlarını çek
  useEffect(() => {
    const PRIMARY_API_KEY = 'e69314b14644080788775553';
    const CACHE_KEY = 'exchange_rates_cache';
    const CACHE_TTL = 1000 * 60 * 60; // 1 saat

    const fetchExchangeRates = async () => {
      // Önce cache kontrol et
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        try {
          const { rates, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_TTL) {
            setExchangeRates(rates);
            return;
          }
        } catch (e) {
          // Cache bozuksa devam et
        }
      }

      // Primary API (ExchangeRate-API)
      try {
        const res = await fetch(`https://v6.exchangerate-api.com/v6/${PRIMARY_API_KEY}/latest/EUR`);
        if (res.ok) {
          const data = await res.json();
          const rates = {
            EUR: 1,
            USD: data.conversion_rates.USD,
            TRY: data.conversion_rates.TRY,
          };
          setExchangeRates(rates);
          localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, timestamp: Date.now() }));
          return;
        }
      } catch (e) {
        console.error('Primary exchange rate API failed:', e);
      }

      // Backup API (Frankfurter)
      try {
        const res = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD,TRY');
        if (res.ok) {
          const data = await res.json();
          const rates = {
            EUR: 1,
            USD: data.rates.USD,
            TRY: data.rates.TRY,
          };
          setExchangeRates(rates);
          localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, timestamp: Date.now() }));
          return;
        }
      } catch (e) {
        console.error('Backup exchange rate API failed:', e);
      }

      // Fallback değerler
      setExchangeRates({ EUR: 1, USD: 1.08, TRY: 38.5 });
    };

    fetchExchangeRates();
  }, []);

  // Seçilen havuz değiştiğinde min-max kurallarını çek ve satırları oluştur
  useEffect(() => {
    if (!selectedPoolId) {
      setRows([]);
      return;
    }

    const fetchMinMaxAndBuildRows = async () => {
      setIsLoading(true);
      try {
        const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
        if (!selectedPool) {
          setRows([]);
          return;
        }

        // Önce skip edilecek laboratuvarları belirle
        // Eğer bir laboratuvar bir ortak stok havuzuna dahilse ve o havuzun ana laboratuvarı
        // verimlilik havuzunda ise, bu laboratuvar skip edilmeli (ana lab zaten temsil ediyor)
        const labsToSkip = new Set<string>();

        for (const labId of selectedPool.memberIds) {
          // Bu laboratuvar herhangi bir ortak stok havuzuna dahil mi?
          const sharedPool = labPools.find(p => p.memberIds.includes(labId));

          if (sharedPool && sharedPool.mainLabId) {
            // Bu ortak stok havuzunun ana laboratuvarı verimlilik havuzunda mı?
            if (selectedPool.memberIds.includes(sharedPool.mainLabId)) {
              // Eğer bu laboratuvar ana lab değilse, skip et
              if (labId !== sharedPool.mainLabId) {
                labsToSkip.add(labId);
              }
            }
          }
        }

        // Havuzdaki laboratuvarların ID'lerini al (skip edilenler hariç)
        const labIdsToProcess = new Set<string>();
        const labIdToDisplayName = new Map<string, { name: string; kod: string }>();
        const labIdToMinMaxLabIds = new Map<string, string[]>();

        for (const labId of selectedPool.memberIds) {
          // Skip listesindeki laboratuvarları atla - bunlar zaten ana lab tarafından temsil ediliyor
          if (labsToSkip.has(labId)) continue;

          const lab = hospitals.find(h => h.id === labId);
          if (!lab) continue;

          // Bu laboratuvar bir ortak havuzun ana laboratuvarı mı?
          const sharedPool = labPools.find(p => p.mainLabId === labId);
          if (sharedPool) {
            // Ana laboratuvar olarak görüntüle ama tüm havuz üyelerinin min-max'ını al
            labIdToDisplayName.set(labId, { name: lab.name, kod: lab.kod || '' });
            labIdToMinMaxLabIds.set(labId, sharedPool.memberIds);
            sharedPool.memberIds.forEach(memberId => labIdsToProcess.add(memberId));
          } else {
            labIdsToProcess.add(labId);
            labIdToDisplayName.set(labId, { name: lab.name, kod: lab.kod || '' });
            labIdToMinMaxLabIds.set(labId, [labId]);
          }
        }

        // Min-max kurallarını çek
        const rulesMap: Record<string, MinMaxRule[]> = {};
        for (const labId of labIdsToProcess) {
          try {
            const rulesSnap = await getDocs(collection(db, 'hospitals', labId, 'minMaxRules'));
            rulesMap[labId] = rulesSnap.docs.map(d => ({ stokKodu: d.id, ...d.data() } as MinMaxRule));
          } catch (e) {
            console.error(`Error fetching minMax for ${labId}:`, e);
            rulesMap[labId] = [];
          }
        }
        setAllMinMaxRules(rulesMap);

        // Her laboratuvar için benzersiz ürün listesi oluştur
        const newRows: TableRow[] = [];

        for (const labId of selectedPool.memberIds) {
          // Skip listesindeki laboratuvarları atla
          if (labsToSkip.has(labId)) continue;

          const displayInfo = labIdToDisplayName.get(labId);
          if (!displayInfo) continue;

          // Bu laboratuvar (veya ortak havuz) için tüm min-max ürünlerini topla
          const labIdsForMinMax = labIdToMinMaxLabIds.get(labId) || [labId];

          const uniqueProductCodes = new Set<string>();
          labIdsForMinMax.forEach(lid => {
            const rules = rulesMap[lid] || [];
            rules.forEach(rule => uniqueProductCodes.add(rule.stokKodu));
          });

          // Her ürün için satır oluştur
          const productCodesArray = Array.from(uniqueProductCodes);
          productCodesArray.forEach(stokKodu => {
            const product = productCodes.find(p => p.stokKodu === stokKodu);
            if (!product) return;

            newRows.push({
              id: `${labId}-${stokKodu}`,
              labId: labId,
              labName: displayInfo.name,
              labKod: displayInfo.kod,
              stokKodu: product.stokKodu,
              stokAdi: product.stokAdi,
              testAdi: product.testAdi || '',
              ambalajDegeri: product.ambalajDegeri || 0,
              cihazGrubu: product.cihazGrubu || '',
              baslangicStokuKutu: 0,
              ayBasiCihazUstuTest: 0,
              totalAyBasiStok: 0,
              // Phase 2 alanları
              ayBasiSevkiyatKutu: 0,
              goztepeSevkiyat: 0,
              kurumlarArasiSevk: 0,
              lojistikAraTransfer: 0,
              sevkiyatlarSonrasiTotalTest: 0,
              // Phase 3 alanları
              kumulatifTotal: 0,
              donemSonuStokKutu: 0,
              donemSonuCihazUstuTest: 0,
              donemSonuToplamTest: 0,
              hakEdis: 0,
              // Phase 4 alanları
              stokDogrulukFark: 0,
              stokDogrulukYuzde: 0,
              kitVerimlilikFark: 0,
              kitVerimlilikYuzde: 0,
            });
          });
        }

        // Alfabetik sıralama: önce laboratuvar adı, sonra ürün adı
        newRows.sort((a, b) => {
          const labCompare = a.labName.localeCompare(b.labName, 'tr');
          if (labCompare !== 0) return labCompare;
          return a.stokAdi.localeCompare(b.stokAdi, 'tr');
        });

        // Phase 3.5: Önceki ayın dönem sonu verilerini çek ve devret
        // Önceki ay/yıl hesapla
        let prevMonth = selectedMonth - 1;
        let prevYear = selectedYear;
        if (prevMonth < 0) {
          prevMonth = 11; // Aralık
          prevYear = selectedYear - 1;
        }

        // Önceki ayın kaydını kontrol et
        const prevDocId = `${selectedPoolId}-${prevYear}-${prevMonth}`;
        try {
          const prevDocSnap = await getDoc(doc(db, 'totalEfficiencyRecords', prevDocId));
          if (prevDocSnap.exists()) {
            const prevData = prevDocSnap.data();
            const prevRows = prevData.rows as TableRow[] || [];

            // Önceki ayın dönem sonu değerlerini bu ayın başlangıç değerlerine aktar
            newRows.forEach(row => {
              const prevRow = prevRows.find(pr => pr.id === row.id);
              if (prevRow) {
                // Sütun 16 -> Sütun 7, Sütun 17 -> Sütun 8
                row.baslangicStokuKutu = prevRow.donemSonuStokKutu || 0;
                row.ayBasiCihazUstuTest = prevRow.donemSonuCihazUstuTest || 0;
              }
            });

            toast({
              title: 'Devir Yapıldı',
              description: `${MONTHS[prevMonth]?.label} ${prevYear} döneminden stok devri alındı.`,
            });
          }
        } catch (e) {
          console.error('Error fetching previous month data:', e);
          // Hata olursa sessizce devam et, devir yapılmaz
        }

        // Hesaplanan alanları güncelle
        const computedRows = newRows.map(row => {
          const totalAyBasiStok = (row.baslangicStokuKutu * row.ambalajDegeri) + row.ayBasiCihazUstuTest;
          const sevkiyatlarKutuToplam = row.ayBasiSevkiyatKutu + row.goztepeSevkiyat + row.kurumlarArasiSevk + row.lojistikAraTransfer;
          const sevkiyatlarSonrasiTotalTest = (sevkiyatlarKutuToplam * row.ambalajDegeri) + totalAyBasiStok;
          const donemSonuToplamTest = (row.donemSonuStokKutu * row.ambalajDegeri) + row.donemSonuCihazUstuTest;

          // Phase 4 hesaplamaları
          const beklenenTuketim = sevkiyatlarSonrasiTotalTest - donemSonuToplamTest;
          const stokDogrulukFark = beklenenTuketim - row.kumulatifTotal;
          const stokDogrulukYuzde = row.kumulatifTotal !== 0 ? (stokDogrulukFark / row.kumulatifTotal) * 100 : 0;
          const kitVerimlilikFark = row.kumulatifTotal - row.hakEdis;
          const kitVerimlilikYuzde = row.kumulatifTotal !== 0 ? (kitVerimlilikFark / row.kumulatifTotal) * 100 : 0;

          return {
            ...row,
            totalAyBasiStok,
            sevkiyatlarSonrasiTotalTest,
            donemSonuToplamTest,
            stokDogrulukFark,
            stokDogrulukYuzde,
            kitVerimlilikFark,
            kitVerimlilikYuzde,
          };
        });

        setRows(computedRows);
      } catch (error) {
        console.error('Error building rows:', error);
        toast({ title: 'Hata', description: 'Veriler yüklenirken bir sorun oluştu.', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchMinMaxAndBuildRows();
  }, [selectedPoolId, selectedMonth, selectedYear, efficiencyPools, labPools, hospitals, productCodes, toast]);

  // Hesaplama fonksiyonu
  const computeRow = useCallback((row: TableRow, allRows?: TableRow[], transfers?: Record<string, { sourceLabId: string; sourceLabName: string; kutuAdet: number }>): TableRow => {
    // Total Ay Başı Stok = (Başlangıç Stoğu Kutu * Ambalaj Değeri) + Ay Başı Cihaz Üstü Test
    const totalAyBasiStok = (row.baslangicStokuKutu * row.ambalajDegeri) + row.ayBasiCihazUstuTest;

    // Sütun 14: Sevkiyatlar Sonrası Total Test Adet
    // Formül: ((10+11+12+13) * ambalaj) + 9 (Total Ay Başı Stok)
    const sevkiyatlarKutuToplam = row.ayBasiSevkiyatKutu + row.goztepeSevkiyat + row.kurumlarArasiSevk + row.lojistikAraTransfer;
    let sevkiyatlarSonrasiTotalTest = (sevkiyatlarKutuToplam * row.ambalajDegeri) + totalAyBasiStok;

    // Eğer bu satır başka bir laboratuvara ürün verdiyse, o miktarı düş
    if (transfers && allRows) {
      // Bu lab'ın bu ürününden başka lab'a transfer edilen miktarı bul
      for (const [targetRowId, transfer] of Object.entries(transfers)) {
        if (transfer.sourceLabId === row.labId) {
          // Aynı ürün mü kontrol et
          const targetRow = allRows.find(r => r.id === targetRowId);
          if (targetRow && targetRow.stokKodu === row.stokKodu) {
            // Kaynak labdan düşülecek test adedi = kutu * ambalaj
            sevkiyatlarSonrasiTotalTest -= transfer.kutuAdet * row.ambalajDegeri;
          }
        }
      }
    }

    // Phase 3 - Sütun 18: Dönem Sonu Toplam Test
    // Formül: (Dönem Sonu Stok Kutu * Ambalaj) + Dönem Sonu Cihaz Üstü Test
    const donemSonuToplamTest = (row.donemSonuStokKutu * row.ambalajDegeri) + row.donemSonuCihazUstuTest;

    // Phase 4 - Sütun 20: Stok Doğruluk
    // Beklenen tüketim: 14 - 18 = sevkiyatlarSonrasiTotalTest - donemSonuToplamTest
    // Fark: Beklenen - Kümülatif = (14-18) - 15
    const beklenenTuketim = sevkiyatlarSonrasiTotalTest - donemSonuToplamTest;
    const stokDogrulukFark = beklenenTuketim - row.kumulatifTotal;
    // Sapma yüzdesi: Fark / Kümülatif * 100 (kümülatif 0 ise 0)
    const stokDogrulukYuzde = row.kumulatifTotal !== 0 ? (stokDogrulukFark / row.kumulatifTotal) * 100 : 0;

    // Phase 4 - Sütun 21: Kit Verimlilik
    // Fark: Kümülatif - Hak Ediş = 15 - 19
    const kitVerimlilikFark = row.kumulatifTotal - row.hakEdis;
    // Sapma yüzdesi: Fark / Kümülatif * 100 (kümülatif 0 ise 0)
    const kitVerimlilikYuzde = row.kumulatifTotal !== 0 ? (kitVerimlilikFark / row.kumulatifTotal) * 100 : 0;

    return {
      ...row,
      totalAyBasiStok,
      sevkiyatlarSonrasiTotalTest,
      donemSonuToplamTest,
      stokDogrulukFark,
      stokDogrulukYuzde,
      kitVerimlilikFark,
      kitVerimlilikYuzde,
    };
  }, []);

  // Tüm satırları yeniden hesapla (inter-lab transfer değiştiğinde)
  const recomputeAllRows = useCallback((currentRows: TableRow[], transfers: Record<string, { sourceLabId: string; sourceLabName: string; kutuAdet: number }>) => {
    return currentRows.map(row => computeRow(row, currentRows, transfers));
  }, [computeRow]);

  // Değer değişikliği handler'ı
  type EditableField = 'baslangicStokuKutu' | 'ayBasiCihazUstuTest' | 'ayBasiSevkiyatKutu' | 'goztepeSevkiyat' | 'kurumlarArasiSevk' | 'lojistikAraTransfer' | 'kumulatifTotal' | 'donemSonuStokKutu' | 'donemSonuCihazUstuTest' | 'hakEdis';

  const handleValueChange = useCallback((rowId: string, field: EditableField, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    if (isNaN(numValue)) return;

    setRows(prevRows => {
      const updatedRows = prevRows.map(row => {
        if (row.id !== rowId) return row;
        return { ...row, [field]: numValue };
      });
      return recomputeAllRows(updatedRows, interLabTransfers);
    });
  }, [recomputeAllRows, interLabTransfers]);

  // Kurumlar Arası Sevk değişikliği - modal açar
  const handleKurumlarArasiSevkChange = useCallback((rowId: string, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    if (isNaN(numValue)) return;

    if (numValue > 0) {
      // Modal aç, kaynak lab seçimi için
      setKurumlarArasiEditingRow({ rowId, value: numValue });
      setShowKurumlarArasiModal(true);
    } else {
      // Sıfırlandıysa, inter-lab transfer'i de temizle
      const newTransfers = { ...interLabTransfers };
      delete newTransfers[rowId];
      setInterLabTransfers(newTransfers);

      setRows(prevRows => {
        const updatedRows = prevRows.map(row => {
          if (row.id !== rowId) return row;
          return { ...row, kurumlarArasiSevk: 0 };
        });
        return recomputeAllRows(updatedRows, newTransfers);
      });
    }
  }, [interLabTransfers, recomputeAllRows]);

  // Kaynak lab seçildikten sonra Kurumlar Arası Sevk'i uygula
  const handleConfirmKurumlarArasi = useCallback((sourceLabId: string) => {
    if (!kurumlarArasiEditingRow) return;

    const { rowId, value } = kurumlarArasiEditingRow;
    const sourceLab = hospitals.find(h => h.id === sourceLabId);

    // Inter-lab transfer bilgisini kaydet
    const newTransfers = {
      ...interLabTransfers,
      [rowId]: {
        sourceLabId,
        sourceLabName: sourceLab?.name || sourceLabId,
        kutuAdet: value,
      },
    };
    setInterLabTransfers(newTransfers);

    // Satırı güncelle
    setRows(prevRows => {
      const updatedRows = prevRows.map(row => {
        if (row.id !== rowId) return row;
        return { ...row, kurumlarArasiSevk: value, kurumlarArasiSevkKaynakLabId: sourceLabId };
      });
      return recomputeAllRows(updatedRows, newTransfers);
    });

    setShowKurumlarArasiModal(false);
    setKurumlarArasiEditingRow(null);
  }, [kurumlarArasiEditingRow, hospitals, interLabTransfers, recomputeAllRows]);

  // Göztepe Sevkiyat - depo transferlerinden çek
  const handleFetchGoztepeSevkiyat = useCallback(async () => {
    if (selectedLabsForSevkiyat.size === 0) {
      toast({ title: 'Uyarı', description: 'Lütfen en az bir laboratuvar seçin.', variant: 'destructive' });
      return;
    }

    setIsFetchingSevkiyat(true);
    try {
      // Seçilen ay için tarih aralığı oluştur
      const startDate = new Date(selectedYear, selectedMonth, 1);
      const endDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);

      // Transfer kayıtlarını çek
      const transfersQuery = query(
        collection(db, 'transfers'),
        where('timestamp', '>=', Timestamp.fromDate(startDate)),
        where('timestamp', '<=', Timestamp.fromDate(endDate))
      );
      const transfersSnap = await getDocs(transfersQuery);

      // Her transfer için item'ları çek ve lab'a göre grupla
      const labProductCounts: Record<string, Record<string, number>> = {}; // labId -> stokKodu -> kutu sayısı

      for (const transferDoc of transfersSnap.docs) {
        const transferData = transferDoc.data();
        const targetLabId = transferData.targetHospitalId;

        // Sadece seçilen lab'lara yapılan transferleri say
        if (!targetLabId || !selectedLabsForSevkiyat.has(targetLabId)) continue;

        // Transfer item'larını çek
        const itemsSnap = await getDocs(collection(db, 'transfers', transferDoc.id, 'items'));

        for (const itemDoc of itemsSnap.docs) {
          const itemData = itemDoc.data();
          const stokKodu = itemData.stokKodu;

          if (!labProductCounts[targetLabId]) {
            labProductCounts[targetLabId] = {};
          }
          if (!labProductCounts[targetLabId][stokKodu]) {
            labProductCounts[targetLabId][stokKodu] = 0;
          }
          // Her seri numarası 1 adet (1 kutu değil, ama seri bazlı transfer için adet sayısı)
          labProductCounts[targetLabId][stokKodu] += 1;
        }
      }

      // Satırları güncelle - seri sayısını kutuya çevir (ambalaj ile böl)
      setRows(prevRows => {
        const updatedRows = prevRows.map(row => {
          const counts = labProductCounts[row.labId]?.[row.stokKodu] || 0;
          // Seri sayısını kutuya çevir (ambalaj değerine böl, yuvarla)
          const kutuSayisi = row.ambalajDegeri > 0 ? Math.round(counts / row.ambalajDegeri) : counts;
          return { ...row, goztepeSevkiyat: kutuSayisi };
        });
        return recomputeAllRows(updatedRows, interLabTransfers);
      });

      toast({ title: 'Başarılı', description: 'Göztepe sevkiyat verileri çekildi.' });
    } catch (error) {
      console.error('Error fetching sevkiyat:', error);
      toast({ title: 'Hata', description: 'Sevkiyat verileri çekilirken hata oluştu.', variant: 'destructive' });
    } finally {
      setIsFetchingSevkiyat(false);
      setShowGoztepeSevkiyatModal(false);
      setSelectedLabsForSevkiyat(new Set());
    }
  }, [selectedLabsForSevkiyat, selectedYear, selectedMonth, toast, recomputeAllRows, interLabTransfers]);

  // Listedeki laboratuvarlar (verimlilik havuzundaki)
  const poolLabIds = useMemo(() => {
    const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
    return selectedPool?.memberIds || [];
  }, [selectedPoolId, efficiencyPools]);

  const poolLabs = useMemo(() => {
    return hospitals.filter(h => poolLabIds.includes(h.id));
  }, [hospitals, poolLabIds]);

  // Excel export
  const handleExportExcel = useCallback(() => {
    if (rows.length === 0) return;

    const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
    const dataToExport = rows.map(r => ({
      'Laboratuvar': r.labName,
      'Lab Kodu': r.labKod,
      'Stok Kodu': r.stokKodu,
      'Ürün Adı': r.stokAdi,
      'Test Adı': r.testAdi,
      'Ambalaj Miktarı': r.ambalajDegeri,
      'Cihaz Grubu': r.cihazGrubu,
      'Başlangıç Stoğu (Kutu)': r.baslangicStokuKutu,
      'Ay Başı Cihaz Üstü (Test)': r.ayBasiCihazUstuTest,
      'Total Ay Başı Stok (Test)': r.totalAyBasiStok,
      'Ay Başı Sevkiyat (Kutu)': r.ayBasiSevkiyatKutu,
      'Göztepe Sevkiyat (Kutu)': r.goztepeSevkiyat,
      'Kurumlar Arası Sevk (Kutu)': r.kurumlarArasiSevk,
      'Kaynak Lab': interLabTransfers[r.id]?.sourceLabName || '',
      'Lojistik Ara Transfer (Kutu)': r.lojistikAraTransfer,
      'Sevkiyatlar Sonrası Total Test': r.sevkiyatlarSonrasiTotalTest,
      // Phase 3
      'Kümülatif Total (Test)': r.kumulatifTotal,
      'Dönem Sonu Stok (Kutu)': r.donemSonuStokKutu,
      'Dönem Sonu Cihaz Üstü (Test)': r.donemSonuCihazUstuTest,
      'Dönem Sonu Toplam Test': r.donemSonuToplamTest,
      'Hak Ediş (Test)': r.hakEdis,
      // Phase 4
      'Stok Doğruluk Fark (Test)': r.stokDogrulukFark,
      'Stok Doğruluk Sapma (%)': Number(r.stokDogrulukYuzde.toFixed(2)),
      'Kit Verimlilik Fark (Test)': r.kitVerimlilikFark,
      'Kit Verimlilik Sapma (%)': Number(r.kitVerimlilikYuzde.toFixed(2)),
    }));

    const fileName = `Total_Verimlilik_${selectedPool?.name || 'Rapor'}_${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
    exportDataToExcel(dataToExport, fileName, 'Veriler', toast);
  }, [rows, selectedPoolId, efficiencyPools, selectedYear, selectedMonth, toast, interLabTransfers]);

  // Phase 5 - Excel Şablon İndir
  const handleDownloadTemplate = useCallback(() => {
    if (rows.length === 0) return;

    const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);

    // Şablonda sadece veri girilebilir alanlar olacak (11 ve 12 hariç)
    // Değerler 0 yerine boş olacak
    const templateData = rows.map(r => ({
      'Laboratuvar': r.labName,
      'Lab Kodu': r.labKod,
      'Stok Kodu': r.stokKodu,
      'Ürün Adı': r.stokAdi,
      'Test Adı': r.testAdi,
      'Ambalaj Miktarı': r.ambalajDegeri,
      '7. Başlangıç Stoğu (Kutu)': r.baslangicStokuKutu || '', // 0 yerine boş
      '8. Ay Başı Cihaz Üstü (Test)': r.ayBasiCihazUstuTest || '',
      '10. Ay Başı Sevkiyat (Kutu)': r.ayBasiSevkiyatKutu || '',
      '13. Lojistik Ara Transfer (Kutu)': r.lojistikAraTransfer || '',
      '15. Kümülatif Total (Test)': r.kumulatifTotal || '',
      '16. Dönem Sonu Stok (Kutu)': r.donemSonuStokKutu || '',
      '17. Dönem Sonu Cihaz Üstü (Test)': r.donemSonuCihazUstuTest || '',
      '19. Hak Ediş (Test)': r.hakEdis || '',
    }));

    // XLSX worksheet oluştur
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Şablon');

    // Dosyayı indir
    const fileName = `Verimlilik_Sablon_${selectedPool?.name || 'Havuz'}_${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}.xlsx`;
    XLSX.writeFile(wb, fileName);

    toast({ title: 'Şablon İndirildi', description: 'Excel şablonu indirildi. Verileri girdikten sonra yükleyebilirsiniz.' });
    setShowExcelImportModal(false);
  }, [rows, selectedPoolId, efficiencyPools, selectedYear, selectedMonth, toast]);

  // Phase 5 - Excel Dosyası Yükle ve Verileri Aktar
  const handleExcelImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImportingExcel(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];

        // Excel verilerini satırlara eşle
        let updatedCount = 0;

        setRows(prevRows => {
          const updatedRows = prevRows.map(row => {
            // Excel'de aynı stok kodunu ve lab kodunu bul
            const excelRow = jsonData.find((excelR) =>
              excelR['Stok Kodu'] === row.stokKodu &&
              (excelR['Lab Kodu'] === row.labKod || excelR['Laboratuvar'] === row.labName)
            );

            if (!excelRow) return row;

            updatedCount++;

            // Sadece belirtilen sütunları güncelle
            const getNumValue = (key: string): number => {
              const val = excelRow[key];
              if (val === '' || val === null || val === undefined) return row[key as keyof TableRow] as number || 0;
              const num = parseFloat(String(val));
              return isNaN(num) ? 0 : num;
            };

            return {
              ...row,
              baslangicStokuKutu: getNumValue('7. Başlangıç Stoğu (Kutu)'),
              ayBasiCihazUstuTest: getNumValue('8. Ay Başı Cihaz Üstü (Test)'),
              ayBasiSevkiyatKutu: getNumValue('10. Ay Başı Sevkiyat (Kutu)'),
              lojistikAraTransfer: getNumValue('13. Lojistik Ara Transfer (Kutu)'),
              kumulatifTotal: getNumValue('15. Kümülatif Total (Test)'),
              donemSonuStokKutu: getNumValue('16. Dönem Sonu Stok (Kutu)'),
              donemSonuCihazUstuTest: getNumValue('17. Dönem Sonu Cihaz Üstü (Test)'),
              hakEdis: getNumValue('19. Hak Ediş (Test)'),
            };
          });

          return recomputeAllRows(updatedRows, interLabTransfers);
        });

        toast({
          title: 'Veriler Aktarıldı',
          description: `${updatedCount} satır güncellendi.`,
        });
      } catch (error) {
        console.error('Error importing Excel:', error);
        toast({
          title: 'Hata',
          description: 'Excel dosyası okunurken bir hata oluştu.',
          variant: 'destructive',
        });
      } finally {
        setIsImportingExcel(false);
        setShowExcelImportModal(false);
        // File input'u temizle
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };

    reader.readAsBinaryString(file);
  }, [toast, recomputeAllRows, interLabTransfers]);

  // Kaydetme
  const handleSave = useCallback(async () => {
    if (!selectedPoolId || rows.length === 0) return;

    setIsSaving(true);
    try {
      const selectedPool = efficiencyPools.find(p => p.id === selectedPoolId);
      const docId = `${selectedPoolId}-${selectedYear}-${selectedMonth}`;

      // Verimlilik metriklerini hesapla
      let toplamKumulatif = 0;
      let toplamBeklenenTuketim = 0;
      let toplamHakEdis = 0;

      rows.forEach(row => {
        toplamKumulatif += row.kumulatifTotal;
        toplamBeklenenTuketim += (row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest);
        toplamHakEdis += row.hakEdis;
      });

      const stokSapmaYuzde = toplamKumulatif !== 0
        ? ((toplamBeklenenTuketim - toplamKumulatif) / toplamKumulatif) * 100
        : 0;
      const kitSapmaYuzde = toplamKumulatif !== 0
        ? ((toplamKumulatif - toplamHakEdis) / toplamKumulatif) * 100
        : 0;
      const stokDogrulukSkoru = Math.max(0, Math.min(100, 100 - Math.abs(stokSapmaYuzde)));
      const kitVerimlilikSkoru = Math.max(0, Math.min(100, 100 - Math.abs(kitSapmaYuzde)));
      const genelVerimlilik = (stokDogrulukSkoru + kitVerimlilikSkoru) / 2;

      const dataToSave = {
        poolId: selectedPoolId,
        poolName: selectedPool?.name || '',
        month: selectedMonth,
        year: selectedYear,
        rows: rows,
        // Verimlilik metrikleri
        efficiencyMetrics: {
          toplamKumulatif,
          toplamBeklenenTuketim,
          toplamHakEdis,
          stokSapmaYuzde,
          kitSapmaYuzde,
          stokDogrulukSkoru,
          kitVerimlilikSkoru,
          genelVerimlilik,
        },
        createdAt: Timestamp.now(),
        createdByUid: currentUser?.uid || '',
        createdByName: currentUser?.name || currentUser?.email || '',
        updatedAt: Timestamp.now(),
      };

      await setDoc(doc(db, 'totalEfficiencyRecords', docId), dataToSave, { merge: true });
      toast({ title: 'Kaydedildi', description: `Total verimlilik verileri kaydedildi. Genel Verimlilik: %${genelVerimlilik.toFixed(1)}` });
    } catch (error) {
      console.error('Error saving:', error);
      toast({ title: 'Hata', description: 'Kayıt sırasında bir sorun oluştu.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [selectedPoolId, rows, selectedYear, selectedMonth, currentUser, efficiencyPools, toast]);

  // Laboratuvar gruplarını hesapla (aynı laboratuvarın satırlarını gruplamak için)
  const labGroups = useMemo(() => {
    const groups: { labId: string; labName: string; startIndex: number; count: number }[] = [];
    let currentLabId = '';
    let startIndex = 0;
    let count = 0;

    rows.forEach((row, index) => {
      if (row.labId !== currentLabId) {
        if (currentLabId) {
          groups.push({ labId: currentLabId, labName: rows[startIndex].labName, startIndex, count });
        }
        currentLabId = row.labId;
        startIndex = index;
        count = 1;
      } else {
        count++;
      }
    });

    if (currentLabId) {
      groups.push({ labId: currentLabId, labName: rows[startIndex].labName, startIndex, count });
    }

    return groups;
  }, [rows]);

  // Filter için benzersiz değerleri hesapla
  const uniqueFilterValues = useMemo(() => {
    const labNames = new Set<string>();
    const stokAdlari = new Set<string>();
    const testAdlari = new Set<string>();
    const cihazGruplari = new Set<string>();

    rows.forEach(row => {
      if (row.labName) labNames.add(row.labName);
      if (row.stokAdi) stokAdlari.add(row.stokAdi);
      if (row.testAdi) testAdlari.add(row.testAdi);
      if (row.cihazGrubu) cihazGruplari.add(row.cihazGrubu);
    });

    return {
      labName: Array.from(labNames).sort((a, b) => a.localeCompare(b, 'tr')),
      stokAdi: Array.from(stokAdlari).sort((a, b) => a.localeCompare(b, 'tr')),
      testAdi: Array.from(testAdlari).sort((a, b) => a.localeCompare(b, 'tr')),
      cihazGrubu: Array.from(cihazGruplari).sort((a, b) => a.localeCompare(b, 'tr')),
    };
  }, [rows]);

  // Filtrelenmiş ve sıralanmış satırlar
  const filteredAndSortedRows = useMemo(() => {
    let result = [...rows];

    // Search filter
    if (searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(row =>
        row.labName.toLowerCase().includes(lowerSearch) ||
        row.stokKodu.toLowerCase().includes(lowerSearch) ||
        row.stokAdi.toLowerCase().includes(lowerSearch) ||
        row.testAdi.toLowerCase().includes(lowerSearch) ||
        row.cihazGrubu.toLowerCase().includes(lowerSearch)
      );
    }

    // Column filters
    if (columnFilters.labName.size > 0) {
      result = result.filter(row => columnFilters.labName.has(row.labName));
    }
    if (columnFilters.stokAdi.size > 0) {
      result = result.filter(row => columnFilters.stokAdi.has(row.stokAdi));
    }
    if (columnFilters.testAdi.size > 0) {
      result = result.filter(row => columnFilters.testAdi.has(row.testAdi));
    }
    if (columnFilters.cihazGrubu.size > 0) {
      result = result.filter(row => columnFilters.cihazGrubu.has(row.cihazGrubu));
    }

    // Sorting
    if (sortConfig.column) {
      result.sort((a, b) => {
        const aVal = Math.abs(a[sortConfig.column!]);
        const bVal = Math.abs(b[sortConfig.column!]);
        if (sortConfig.direction === 'asc') {
          return aVal - bVal;
        } else {
          return bVal - aVal;
        }
      });
    }

    return result;
  }, [rows, searchTerm, columnFilters, sortConfig]);

  // Filter toggle helper
  const toggleFilterValue = useCallback((
    filterKey: 'labName' | 'stokAdi' | 'testAdi' | 'cihazGrubu',
    value: string
  ) => {
    setColumnFilters(prev => {
      const newSet = new Set(prev[filterKey]);
      if (newSet.has(value)) {
        newSet.delete(value);
      } else {
        newSet.add(value);
      }
      return { ...prev, [filterKey]: newSet };
    });
  }, []);

  // Select all / deselect all helper
  const setAllFilterValues = useCallback((
    filterKey: 'labName' | 'stokAdi' | 'testAdi' | 'cihazGrubu',
    values: string[],
    select: boolean
  ) => {
    setColumnFilters(prev => ({
      ...prev,
      [filterKey]: select ? new Set(values) : new Set(),
    }));
  }, []);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setColumnFilters({
      labName: new Set(),
      stokAdi: new Set(),
      testAdi: new Set(),
      cihazGrubu: new Set(),
    });
    setSortConfig({ column: null, direction: 'asc' });
    setSearchTerm('');
  }, []);

  // Toggle sort
  const toggleSort = useCallback((column: 'stokDogrulukFark' | 'kitVerimlilikFark') => {
    setSortConfig(prev => {
      if (prev.column === column) {
        if (prev.direction === 'asc') {
          return { column, direction: 'desc' };
        } else {
          return { column: null, direction: 'asc' };
        }
      }
      return { column, direction: 'asc' };
    });
  }, []);

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return columnFilters.labName.size > 0 ||
      columnFilters.stokAdi.size > 0 ||
      columnFilters.testAdi.size > 0 ||
      columnFilters.cihazGrubu.size > 0 ||
      sortConfig.column !== null ||
      searchTerm.trim() !== '';
  }, [columnFilters, sortConfig, searchTerm]);

  // Genel Verimlilik Hesaplaması
  const efficiencyMetrics = useMemo(() => {
    if (rows.length === 0) {
      return {
        toplamKumulatif: 0,
        toplamBeklenenTuketim: 0,
        toplamHakEdis: 0,
        stokSapmaYuzde: 0,
        kitSapmaYuzde: 0,
        stokDogrulukSkoru: 100,
        kitVerimlilikSkoru: 100,
        genelVerimlilik: 100,
      };
    }

    // Toplam değerleri hesapla
    let toplamKumulatif = 0;
    let toplamBeklenenTuketim = 0;
    let toplamHakEdis = 0;

    rows.forEach(row => {
      toplamKumulatif += row.kumulatifTotal;
      toplamBeklenenTuketim += (row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest);
      toplamHakEdis += row.hakEdis;
    });

    // Sapma oranlarını hesapla (kümülatif 0 ise 0 sapma)
    const stokSapmaYuzde = toplamKumulatif !== 0
      ? ((toplamBeklenenTuketim - toplamKumulatif) / toplamKumulatif) * 100
      : 0;

    const kitSapmaYuzde = toplamKumulatif !== 0
      ? ((toplamKumulatif - toplamHakEdis) / toplamKumulatif) * 100
      : 0;

    // Verimlilik skorları (sapma → verimlilik dönüşümü, 0-100 arası)
    const stokDogrulukSkoru = Math.max(0, Math.min(100, 100 - Math.abs(stokSapmaYuzde)));
    const kitVerimlilikSkoru = Math.max(0, Math.min(100, 100 - Math.abs(kitSapmaYuzde)));

    // Genel verimlilik
    const genelVerimlilik = (stokDogrulukSkoru + kitVerimlilikSkoru) / 2;

    return {
      toplamKumulatif,
      toplamBeklenenTuketim,
      toplamHakEdis,
      stokSapmaYuzde,
      kitSapmaYuzde,
      stokDogrulukSkoru,
      kitVerimlilikSkoru,
      genelVerimlilik,
    };
  }, [rows]);

  // Sütun 23: Maliyet hesaplama yardımcı fonksiyonu
  const calculateRowCost = useCallback((row: TableRow): { cost: number; hasData: boolean } => {
    if (!exchangeRates) return { cost: 0, hasData: false };

    // Ürün bilgisini bul
    const product = productCodes.find(p => p.stokKodu === row.stokKodu);
    if (!product || !product.cost || product.cost === 0) {
      return { cost: 0, hasData: false };
    }

    // Dönem içi sarfiyat (test cinsinden) = Sütun 14 - Sütun 18
    const sarfiyat = row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest;
    if (sarfiyat <= 0) return { cost: 0, hasData: true };

    // Ambalaj değeri (1 kutuda kaç test var)
    const ambalaj = row.ambalajDegeri || 1;

    // Test başına maliyet = Kutu maliyeti / Ambalaj
    const productCurrency = product.currency || 'EUR';
    const productCostInEur = productCurrency === 'EUR'
      ? product.cost
      : productCurrency === 'USD'
        ? product.cost / exchangeRates.USD
        : product.cost / exchangeRates.TRY; // TRY

    const costPerTestInEur = productCostInEur / ambalaj;

    // Toplam maliyet (EUR cinsinden)
    const totalCostInEur = sarfiyat * costPerTestInEur;

    // Seçilen para birimine çevir
    let finalCost = totalCostInEur;
    if (costCurrency === 'USD') {
      finalCost = totalCostInEur * exchangeRates.USD;
    } else if (costCurrency === 'TRY') {
      finalCost = totalCostInEur * exchangeRates.TRY;
    }

    return { cost: finalCost, hasData: true };
  }, [productCodes, exchangeRates, costCurrency]);

  // Toplam maliyet hesapla
  const totalCost = useMemo(() => {
    let total = 0;
    rows.forEach(row => {
      const { cost } = calculateRowCost(row);
      total += cost;
    });
    return total;
  }, [rows, calculateRowCost]);

  return (
    <div className="p-4 space-y-6">
      <BackButton fallback="/" />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Total Verimlilik Paneli
          </CardTitle>
          <CardDescription>
            Verimlilik havuzundaki laboratuvarların stok doğruluk oranı ve hak ediş verimliliği hesaplaması.
            Tüm veriler manuel olarak girilecektir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Verimlilik Havuzu</label>
              <Select value={selectedPoolId} onValueChange={setSelectedPoolId}>
                <SelectTrigger>
                  <SelectValue placeholder="Havuz seçin..." />
                </SelectTrigger>
                <SelectContent>
                  {efficiencyPools.map(pool => (
                    <SelectItem key={pool.id} value={pool.id}>
                      {pool.name} ({pool.memberIds.length} lab)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Ay</label>
              <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={String(i)}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Yıl</label>
              <Select value={String(selectedYear)} onValueChange={v => setSelectedYear(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YEARS.map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedPoolId && (
            <div className="flex items-center justify-between gap-4 pt-4 border-t flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={handleSave} disabled={isSaving || rows.length === 0}>
                  {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Kaydet
                </Button>
                <Button variant="outline" onClick={handleExportExcel} disabled={rows.length === 0}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Excel'e Aktar
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowGoztepeSevkiyatModal(true)}
                  disabled={rows.length === 0}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Göztepe Sevkiyat Çek
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowExcelImportModal(true)}
                  disabled={rows.length === 0}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Excel ile Veri Gir
                </Button>
                <Link href="/total-verimlilik/gecmis">
                  <Button variant="outline">
                    <History className="h-4 w-4 mr-2" />
                    Geçmiş
                  </Button>
                </Link>
              </div>

              {/* Genel Verimlilik Göstergesi */}
              {rows.length > 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-3 px-4 py-2 bg-muted/50 rounded-lg cursor-help">
                        {/* Circular Progress */}
                        <div className="relative w-16 h-16">
                          <svg className="w-16 h-16 transform -rotate-90">
                            <circle
                              cx="32"
                              cy="32"
                              r="28"
                              stroke="currentColor"
                              strokeWidth="6"
                              fill="none"
                              className="text-muted"
                            />
                            <circle
                              cx="32"
                              cy="32"
                              r="28"
                              stroke="currentColor"
                              strokeWidth="6"
                              fill="none"
                              strokeDasharray={`${(efficiencyMetrics.genelVerimlilik / 100) * 175.9} 175.9`}
                              strokeLinecap="round"
                              className={
                                efficiencyMetrics.genelVerimlilik >= 90 ? 'text-green-500' :
                                efficiencyMetrics.genelVerimlilik >= 70 ? 'text-yellow-500' :
                                efficiencyMetrics.genelVerimlilik >= 50 ? 'text-orange-500' : 'text-red-500'
                              }
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className={`text-sm font-bold ${
                              efficiencyMetrics.genelVerimlilik >= 90 ? 'text-green-600' :
                              efficiencyMetrics.genelVerimlilik >= 70 ? 'text-yellow-600' :
                              efficiencyMetrics.genelVerimlilik >= 50 ? 'text-orange-600' : 'text-red-600'
                            }`}>
                              %{efficiencyMetrics.genelVerimlilik.toFixed(1)}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold">Genel Verimlilik</span>
                          <span className="text-xs text-muted-foreground">
                            {efficiencyMetrics.toplamKumulatif.toLocaleString('tr-TR')} test
                          </span>
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs">
                      <div className="space-y-2 text-sm">
                        <div className="font-semibold border-b pb-1">Verimlilik Detayları</div>
                        <div className="flex justify-between gap-4">
                          <span>Stok Doğruluk Skoru:</span>
                          <span className={`font-medium ${efficiencyMetrics.stokDogrulukSkoru >= 90 ? 'text-green-600' : efficiencyMetrics.stokDogrulukSkoru >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                            %{efficiencyMetrics.stokDogrulukSkoru.toFixed(1)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span>Kit Verimlilik Skoru:</span>
                          <span className={`font-medium ${efficiencyMetrics.kitVerimlilikSkoru >= 90 ? 'text-green-600' : efficiencyMetrics.kitVerimlilikSkoru >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                            %{efficiencyMetrics.kitVerimlilikSkoru.toFixed(1)}
                          </span>
                        </div>
                        <div className="border-t pt-1 text-xs text-muted-foreground">
                          <div>Stok Sapma: %{efficiencyMetrics.stokSapmaYuzde.toFixed(2)}</div>
                          <div>Kit Sapma: %{efficiencyMetrics.kitSapmaYuzde.toFixed(2)}</div>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedPoolId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>Veri Tablosu</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Ara..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 w-48 h-9"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {/* Clear Filters Button */}
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="text-muted-foreground"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Filtreleri Temizle
                  </Button>
                )}
                {/* Results Only Toggle */}
                <Button
                  variant={showResultsOnly ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowResultsOnly(!showResultsOnly)}
                >
                  {showResultsOnly ? (
                    <>
                      <EyeOff className="h-4 w-4 mr-2" />
                      Tüm Sütunları Göster
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-2" />
                      Sadece Sonuçları Göster
                    </>
                  )}
                </Button>
              </div>
            </div>
            <CardDescription>
              {showResultsOnly
                ? 'Sonuç odaklı görünüm - sadece özet ve hesaplama sütunları gösteriliyor.'
                : 'İlk 6 sütun otomatik doldurulur. Mavi alanlar manuel giriş, yeşil alanlar otomatik hesaplanır. Sütun 11 için "Göztepe Sevkiyat Çek" butonunu kullanın. Sütun 12 için kaynak lab seçimi yapılır.'}
              {hasActiveFilters && (
                <span className="ml-2 text-primary font-medium">
                  ({filteredAndSortedRows.length}/{rows.length} satır gösteriliyor)
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Bu havuz için min-max tanımlı ürün bulunamadı.
              </div>
            ) : (
              <ScrollArea className="w-full">
                <div className={showResultsOnly ? 'min-w-[1400px]' : 'min-w-[3400px]'}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[180px] bg-muted/50 sticky left-0 z-10">
                          <div className="flex items-center gap-1">
                            <span>1. Laboratuvar</span>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className={`p-1 rounded hover:bg-muted ${columnFilters.labName.size > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                                  <Filter className="h-3.5 w-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-64 p-2" align="start">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between pb-2 border-b">
                                    <span className="text-sm font-medium">Laboratuvar Filtrele</span>
                                    {columnFilters.labName.size > 0 && (
                                      <Badge variant="secondary" className="text-xs">
                                        {columnFilters.labName.size} seçili
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex gap-1">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-xs flex-1"
                                      onClick={() => setAllFilterValues('labName', uniqueFilterValues.labName, true)}
                                    >
                                      Tümünü Seç
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-xs flex-1"
                                      onClick={() => setAllFilterValues('labName', [], false)}
                                    >
                                      Temizle
                                    </Button>
                                  </div>
                                  <ScrollArea className="h-48">
                                    <div className="space-y-1">
                                      {uniqueFilterValues.labName.map(value => (
                                        <div key={value} className="flex items-center gap-2">
                                          <Checkbox
                                            id={`lab-${value}`}
                                            checked={columnFilters.labName.has(value)}
                                            onCheckedChange={() => toggleFilterValue('labName', value)}
                                          />
                                          <Label htmlFor={`lab-${value}`} className="text-sm cursor-pointer flex-1 truncate">
                                            {value}
                                          </Label>
                                        </div>
                                      ))}
                                    </div>
                                  </ScrollArea>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                        </TableHead>
                        <TableHead className="min-w-[120px]">2. Stok Kodu</TableHead>
                        <TableHead className="min-w-[200px]">
                          <div className="flex items-center gap-1">
                            <span>3. Ürün Adı</span>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className={`p-1 rounded hover:bg-muted ${columnFilters.stokAdi.size > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                                  <Filter className="h-3.5 w-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-72 p-2" align="start">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between pb-2 border-b">
                                    <span className="text-sm font-medium">Ürün Adı Filtrele</span>
                                    {columnFilters.stokAdi.size > 0 && (
                                      <Badge variant="secondary" className="text-xs">
                                        {columnFilters.stokAdi.size} seçili
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex gap-1">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-xs flex-1"
                                      onClick={() => setAllFilterValues('stokAdi', uniqueFilterValues.stokAdi, true)}
                                    >
                                      Tümünü Seç
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-xs flex-1"
                                      onClick={() => setAllFilterValues('stokAdi', [], false)}
                                    >
                                      Temizle
                                    </Button>
                                  </div>
                                  <ScrollArea className="h-48">
                                    <div className="space-y-1">
                                      {uniqueFilterValues.stokAdi.map(value => (
                                        <div key={value} className="flex items-center gap-2">
                                          <Checkbox
                                            id={`stok-${value}`}
                                            checked={columnFilters.stokAdi.has(value)}
                                            onCheckedChange={() => toggleFilterValue('stokAdi', value)}
                                          />
                                          <Label htmlFor={`stok-${value}`} className="text-sm cursor-pointer flex-1 truncate">
                                            {value}
                                          </Label>
                                        </div>
                                      ))}
                                    </div>
                                  </ScrollArea>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                        </TableHead>
                        {!showResultsOnly && (
                          <>
                            <TableHead className="min-w-[150px]">
                              <div className="flex items-center gap-1">
                                <span>4. Test Adı</span>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className={`p-1 rounded hover:bg-muted ${columnFilters.testAdi.size > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                                      <Filter className="h-3.5 w-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-64 p-2" align="start">
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between pb-2 border-b">
                                        <span className="text-sm font-medium">Test Adı Filtrele</span>
                                        {columnFilters.testAdi.size > 0 && (
                                          <Badge variant="secondary" className="text-xs">
                                            {columnFilters.testAdi.size} seçili
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="flex gap-1">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="text-xs flex-1"
                                          onClick={() => setAllFilterValues('testAdi', uniqueFilterValues.testAdi, true)}
                                        >
                                          Tümünü Seç
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="text-xs flex-1"
                                          onClick={() => setAllFilterValues('testAdi', [], false)}
                                        >
                                          Temizle
                                        </Button>
                                      </div>
                                      <ScrollArea className="h-48">
                                        <div className="space-y-1">
                                          {uniqueFilterValues.testAdi.map(value => (
                                            <div key={value} className="flex items-center gap-2">
                                              <Checkbox
                                                id={`test-${value}`}
                                                checked={columnFilters.testAdi.has(value)}
                                                onCheckedChange={() => toggleFilterValue('testAdi', value)}
                                              />
                                              <Label htmlFor={`test-${value}`} className="text-sm cursor-pointer flex-1 truncate">
                                                {value}
                                              </Label>
                                            </div>
                                          ))}
                                        </div>
                                      </ScrollArea>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              </div>
                            </TableHead>
                            <TableHead className="min-w-[100px] text-center">5. Ambalaj</TableHead>
                            <TableHead className="min-w-[150px]">
                              <div className="flex items-center gap-1">
                                <span>6. Cihaz Grubu</span>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className={`p-1 rounded hover:bg-muted ${columnFilters.cihazGrubu.size > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                                      <Filter className="h-3.5 w-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-64 p-2" align="start">
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between pb-2 border-b">
                                        <span className="text-sm font-medium">Cihaz Grubu Filtrele</span>
                                        {columnFilters.cihazGrubu.size > 0 && (
                                          <Badge variant="secondary" className="text-xs">
                                            {columnFilters.cihazGrubu.size} seçili
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="flex gap-1">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="text-xs flex-1"
                                          onClick={() => setAllFilterValues('cihazGrubu', uniqueFilterValues.cihazGrubu, true)}
                                        >
                                          Tümünü Seç
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="text-xs flex-1"
                                          onClick={() => setAllFilterValues('cihazGrubu', [], false)}
                                        >
                                          Temizle
                                        </Button>
                                      </div>
                                      <ScrollArea className="h-48">
                                        <div className="space-y-1">
                                          {uniqueFilterValues.cihazGrubu.map(value => (
                                            <div key={value} className="flex items-center gap-2">
                                              <Checkbox
                                                id={`cihaz-${value}`}
                                                checked={columnFilters.cihazGrubu.has(value)}
                                                onCheckedChange={() => toggleFilterValue('cihazGrubu', value)}
                                              />
                                              <Label htmlFor={`cihaz-${value}`} className="text-sm cursor-pointer flex-1 truncate">
                                                {value}
                                              </Label>
                                            </div>
                                          ))}
                                        </div>
                                      </ScrollArea>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              </div>
                            </TableHead>
                            <TableHead className="min-w-[130px] bg-blue-50 dark:bg-blue-950">
                              7. Başlangıç Stoğu (Kutu)
                            </TableHead>
                            <TableHead className="min-w-[150px] bg-blue-50 dark:bg-blue-950">
                              8. Ay Başı Cihaz Üstü (Test)
                            </TableHead>
                          </>
                        )}
                        <TableHead className="min-w-[150px] bg-green-50 dark:bg-green-950 text-center">
                          9. Total Ay Başı Stok (Test)
                        </TableHead>
                        {!showResultsOnly && (
                          <>
                            {/* Phase 2 - Sütunlar 10-14 */}
                            <TableHead className="min-w-[130px] bg-blue-50 dark:bg-blue-950">
                              10. Ay Başı Sevkiyat (Kutu)
                            </TableHead>
                            <TableHead className="min-w-[130px] bg-purple-50 dark:bg-purple-950">
                              11. Göztepe Sevkiyat (Kutu)
                            </TableHead>
                            <TableHead className="min-w-[180px] bg-orange-50 dark:bg-orange-950">
                              12. Kurumlar Arası Sevk (Kutu)
                            </TableHead>
                            <TableHead className="min-w-[140px] bg-blue-50 dark:bg-blue-950">
                              13. Lojistik Ara Transfer (Kutu)
                            </TableHead>
                          </>
                        )}
                        <TableHead className="min-w-[180px] bg-green-50 dark:bg-green-950 text-center">
                          14. Sevkiyatlar Sonrası Total Test
                        </TableHead>
                        {/* Phase 3 - Sütunlar 15-19 */}
                        <TableHead className="min-w-[140px] bg-cyan-50 dark:bg-cyan-950">
                          15. Kümülatif Total (Test)
                        </TableHead>
                        {!showResultsOnly && (
                          <>
                            <TableHead className="min-w-[140px] bg-blue-50 dark:bg-blue-950">
                              16. Dönem Sonu Stok (Kutu)
                            </TableHead>
                            <TableHead className="min-w-[160px] bg-blue-50 dark:bg-blue-950">
                              17. Dönem Sonu Cihaz Üstü (Test)
                            </TableHead>
                          </>
                        )}
                        <TableHead className="min-w-[180px] bg-green-50 dark:bg-green-950 text-center">
                          18. Dönem Sonu Toplam Test
                        </TableHead>
                        <TableHead className="min-w-[140px] bg-yellow-50 dark:bg-yellow-950">
                          19. Hak Ediş (Test)
                        </TableHead>
                        {/* Phase 4 - Sütunlar 20-21 */}
                        <TableHead className="min-w-[200px] bg-red-50 dark:bg-red-950 text-center">
                          <div className="flex flex-col items-center">
                            <div className="flex items-center gap-1">
                              <span>20. Stok Doğruluk</span>
                              <button
                                onClick={() => toggleSort('stokDogrulukFark')}
                                className={`p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 ${sortConfig.column === 'stokDogrulukFark' ? 'text-primary' : 'text-muted-foreground'}`}
                              >
                                {sortConfig.column === 'stokDogrulukFark' ? (
                                  sortConfig.direction === 'asc' ? (
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ArrowDown className="h-3.5 w-3.5" />
                                  )
                                ) : (
                                  <ArrowUpDown className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                            <span className="text-xs font-normal text-muted-foreground">(14-18) - 15</span>
                          </div>
                        </TableHead>
                        <TableHead className="min-w-[200px] bg-emerald-50 dark:bg-emerald-950 text-center">
                          <div className="flex flex-col items-center">
                            <div className="flex items-center gap-1">
                              <span>21. Kit Verimlilik</span>
                              <button
                                onClick={() => toggleSort('kitVerimlilikFark')}
                                className={`p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900 ${sortConfig.column === 'kitVerimlilikFark' ? 'text-primary' : 'text-muted-foreground'}`}
                              >
                                {sortConfig.column === 'kitVerimlilikFark' ? (
                                  sortConfig.direction === 'asc' ? (
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ArrowDown className="h-3.5 w-3.5" />
                                  )
                                ) : (
                                  <ArrowUpDown className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                            <span className="text-xs font-normal text-muted-foreground">15 - 19</span>
                          </div>
                        </TableHead>
                        {/* Sütun 22: Kutu Kayıp */}
                        <TableHead className="min-w-[180px] bg-violet-50 dark:bg-violet-950 text-center p-0">
                          <div className="flex flex-col">
                            <div className="flex">
                              <button
                                onClick={() => setColumn22Mode('kumulatif')}
                                className={`flex-1 py-1.5 px-2 text-xs font-medium transition-colors ${
                                  column22Mode === 'kumulatif'
                                    ? 'bg-violet-500 text-white'
                                    : 'bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-800'
                                }`}
                              >
                                Kümülatife Göre
                              </button>
                              <button
                                onClick={() => setColumn22Mode('hakedis')}
                                className={`flex-1 py-1.5 px-2 text-xs font-medium transition-colors ${
                                  column22Mode === 'hakedis'
                                    ? 'bg-violet-500 text-white'
                                    : 'bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-800'
                                }`}
                              >
                                Hak Edişe Göre
                              </button>
                            </div>
                            <div className="py-1.5 px-2">
                              <span>22. Kutu Kayıp</span>
                              <div className="text-xs font-normal text-muted-foreground">
                                {column22Mode === 'kumulatif' ? '((14-18)-15)/Amb' : '((14-18)-19)/Amb'}
                              </div>
                            </div>
                          </div>
                        </TableHead>
                        {/* Sütun 23: Dönem İçi Sarfiyat Maliyeti */}
                        <TableHead className="min-w-[180px] bg-emerald-50 dark:bg-emerald-950 text-center p-0">
                          <div className="flex flex-col">
                            <div className="flex">
                              <button
                                onClick={() => setCostCurrency('TRY')}
                                className={`flex-1 py-1.5 px-2 text-xs font-medium transition-colors ${
                                  costCurrency === 'TRY'
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800'
                                }`}
                              >
                                TL
                              </button>
                              <button
                                onClick={() => setCostCurrency('USD')}
                                className={`flex-1 py-1.5 px-2 text-xs font-medium transition-colors ${
                                  costCurrency === 'USD'
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800'
                                }`}
                              >
                                USD
                              </button>
                              <button
                                onClick={() => setCostCurrency('EUR')}
                                className={`flex-1 py-1.5 px-2 text-xs font-medium transition-colors ${
                                  costCurrency === 'EUR'
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800'
                                }`}
                              >
                                EUR
                              </button>
                            </div>
                            <div className="py-1.5 px-2">
                              <span>23. Sarfiyat Maliyeti</span>
                              <div className="text-xs font-normal text-muted-foreground">
                                (14-18) × (Maliyet/Amb)
                              </div>
                            </div>
                          </div>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAndSortedRows.map((row) => {
                        return (
                          <TableRow key={row.id} className="text-sm">
                            <TableCell className="font-medium bg-muted/30 sticky left-0 z-10">
                              <div>
                                <span>{row.labName}</span>
                                {row.labKod && (
                                  <span className="ml-1 text-xs font-mono text-muted-foreground">
                                    ({row.labKod})
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{row.stokKodu}</TableCell>
                            <TableCell>{row.stokAdi}</TableCell>
                            {!showResultsOnly && (
                              <>
                                <TableCell className="text-muted-foreground">{row.testAdi || '-'}</TableCell>
                                <TableCell className="text-center">{row.ambalajDegeri || '-'}</TableCell>
                                <TableCell className="text-muted-foreground">{row.cihazGrubu || '-'}</TableCell>
                                <TableCell className="bg-blue-50/50 dark:bg-blue-950/50">
                                  <Input
                                    type="number"
                                    min="0"
                                    className="h-8 w-24"
                                    value={row.baslangicStokuKutu || ''}
                                    onChange={e => handleValueChange(row.id, 'baslangicStokuKutu', e.target.value)}
                                    placeholder="0"
                                  />
                                </TableCell>
                                <TableCell className="bg-blue-50/50 dark:bg-blue-950/50">
                                  <Input
                                    type="number"
                                    min="0"
                                    className="h-8 w-28"
                                    value={row.ayBasiCihazUstuTest || ''}
                                    onChange={e => handleValueChange(row.id, 'ayBasiCihazUstuTest', e.target.value)}
                                    placeholder="0"
                                  />
                                </TableCell>
                              </>
                            )}
                            <TableCell className="bg-green-50/50 dark:bg-green-950/50 text-center font-semibold">
                              {row.totalAyBasiStok.toLocaleString('tr-TR')}
                            </TableCell>
                            {!showResultsOnly && (
                              <>
                                {/* Phase 2 - Sütunlar 10-14 */}
                                {/* Sütun 10: Ay Başı Sevkiyat (Kutu) */}
                                <TableCell className="bg-blue-50/50 dark:bg-blue-950/50">
                                  <Input
                                    type="number"
                                    min="0"
                                    className="h-8 w-24"
                                    value={row.ayBasiSevkiyatKutu || ''}
                                    onChange={e => handleValueChange(row.id, 'ayBasiSevkiyatKutu', e.target.value)}
                                    placeholder="0"
                                  />
                                </TableCell>
                                {/* Sütun 11: Göztepe Sevkiyat (Kutu) */}
                                <TableCell className="bg-purple-50/50 dark:bg-purple-950/50">
                                  <Input
                                    type="number"
                                    min="0"
                                    className="h-8 w-24"
                                    value={row.goztepeSevkiyat || ''}
                                    onChange={e => handleValueChange(row.id, 'goztepeSevkiyat', e.target.value)}
                                    placeholder="0"
                                  />
                                </TableCell>
                                {/* Sütun 12: Kurumlar Arası Sevk (Kutu) */}
                                <TableCell className="bg-orange-50/50 dark:bg-orange-950/50">
                                  <div className="flex flex-col gap-1">
                                    <Input
                                      type="number"
                                      min="0"
                                      className="h-8 w-24"
                                      value={row.kurumlarArasiSevk || ''}
                                      onChange={e => handleKurumlarArasiSevkChange(row.id, e.target.value)}
                                      placeholder="0"
                                    />
                                    {interLabTransfers[row.id] && (
                                      <span className="text-xs text-orange-600 dark:text-orange-400">
                                        ← {interLabTransfers[row.id].sourceLabName}
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                {/* Sütun 13: Lojistik Ara Transfer (Kutu) */}
                                <TableCell className="bg-blue-50/50 dark:bg-blue-950/50">
                                  <Input
                                    type="number"
                                    min="0"
                                    className="h-8 w-24"
                                    value={row.lojistikAraTransfer || ''}
                                    onChange={e => handleValueChange(row.id, 'lojistikAraTransfer', e.target.value)}
                                    placeholder="0"
                                  />
                                </TableCell>
                              </>
                            )}
                            {/* Sütun 14: Sevkiyatlar Sonrası Total Test */}
                            <TableCell className="bg-green-50/50 dark:bg-green-950/50 text-center font-semibold">
                              {row.sevkiyatlarSonrasiTotalTest.toLocaleString('tr-TR')}
                            </TableCell>
                            {/* Phase 3 - Sütunlar 15-19 */}
                            {/* Sütun 15: Kümülatif Total (Test) */}
                            <TableCell className="bg-cyan-50/50 dark:bg-cyan-950/50">
                              {showResultsOnly ? (
                                <span className="font-semibold">{row.kumulatifTotal.toLocaleString('tr-TR')}</span>
                              ) : (
                                <Input
                                  type="number"
                                  min="0"
                                  className="h-8 w-28"
                                  value={row.kumulatifTotal || ''}
                                  onChange={e => handleValueChange(row.id, 'kumulatifTotal', e.target.value)}
                                  placeholder="0"
                                />
                              )}
                            </TableCell>
                            {!showResultsOnly && (
                              <>
                                {/* Sütun 16: Dönem Sonu Stok (Kutu) */}
                                <TableCell className="bg-blue-50/50 dark:bg-blue-950/50">
                                  <Input
                                    type="number"
                                    min="0"
                                    className="h-8 w-24"
                                    value={row.donemSonuStokKutu || ''}
                                    onChange={e => handleValueChange(row.id, 'donemSonuStokKutu', e.target.value)}
                                    placeholder="0"
                                  />
                                </TableCell>
                                {/* Sütun 17: Dönem Sonu Cihaz Üstü (Test) */}
                                <TableCell className="bg-blue-50/50 dark:bg-blue-950/50">
                                  <Input
                                    type="number"
                                    min="0"
                                    className="h-8 w-28"
                                    value={row.donemSonuCihazUstuTest || ''}
                                    onChange={e => handleValueChange(row.id, 'donemSonuCihazUstuTest', e.target.value)}
                                    placeholder="0"
                                  />
                                </TableCell>
                              </>
                            )}
                            {/* Sütun 18: Dönem Sonu Toplam Test (Hesaplanan) */}
                            <TableCell className="bg-green-50/50 dark:bg-green-950/50 text-center font-semibold">
                              {row.donemSonuToplamTest.toLocaleString('tr-TR')}
                            </TableCell>
                            {/* Sütun 19: Hak Ediş (Test) */}
                            <TableCell className="bg-yellow-50/50 dark:bg-yellow-950/50">
                              {showResultsOnly ? (
                                <span className="font-semibold">{row.hakEdis.toLocaleString('tr-TR')}</span>
                              ) : (
                                <Input
                                  type="number"
                                  min="0"
                                  className="h-8 w-28"
                                  value={row.hakEdis || ''}
                                  onChange={e => handleValueChange(row.id, 'hakEdis', e.target.value)}
                                  placeholder="0"
                                />
                              )}
                            </TableCell>
                            {/* Phase 4 - Sütunlar 20-21 */}
                            {/* Sütun 20: Stok Doğruluk (Fark + Yüzde) */}
                            <TableCell className="bg-red-50/50 dark:bg-red-950/50 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className={`font-semibold ${row.stokDogrulukFark !== 0 ? (row.stokDogrulukFark > 0 ? 'text-red-600' : 'text-green-600') : ''}`}>
                                  Fark {Math.abs(row.stokDogrulukFark).toLocaleString('tr-TR')} test
                                </span>
                                <span className={`text-xs ${row.stokDogrulukYuzde !== 0 ? (row.stokDogrulukYuzde > 0 ? 'text-red-500' : 'text-green-500') : 'text-muted-foreground'}`}>
                                  {Math.abs(row.stokDogrulukFark).toLocaleString('tr-TR')}/{row.kumulatifTotal.toLocaleString('tr-TR')} = %{Math.abs(row.stokDogrulukYuzde).toFixed(1)}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  S({(row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest).toLocaleString('tr-TR')}) - K({row.kumulatifTotal.toLocaleString('tr-TR')}) = {row.stokDogrulukFark.toLocaleString('tr-TR')}
                                </span>
                              </div>
                            </TableCell>
                            {/* Sütun 21: Kit Verimlilik (Fark + Yüzde) */}
                            <TableCell className="bg-emerald-50/50 dark:bg-emerald-950/50 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className={`font-semibold ${row.kitVerimlilikFark !== 0 ? (row.kitVerimlilikFark > 0 ? 'text-orange-600' : 'text-green-600') : ''}`}>
                                  Fark {Math.abs(row.kitVerimlilikFark).toLocaleString('tr-TR')} test
                                </span>
                                <span className={`text-xs ${row.kitVerimlilikYuzde !== 0 ? (row.kitVerimlilikYuzde > 0 ? 'text-orange-500' : 'text-green-500') : 'text-muted-foreground'}`}>
                                  {Math.abs(row.kitVerimlilikFark).toLocaleString('tr-TR')}/{row.kumulatifTotal.toLocaleString('tr-TR')} = %{Math.abs(row.kitVerimlilikYuzde).toFixed(1)}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  K({row.kumulatifTotal.toLocaleString('tr-TR')}) - H({row.hakEdis.toLocaleString('tr-TR')}) = {row.kitVerimlilikFark.toLocaleString('tr-TR')}
                                </span>
                              </div>
                            </TableCell>
                            {/* Sütun 22: Kutu Kayıp */}
                            <TableCell className="bg-violet-50/50 dark:bg-violet-950/50 text-center">
                              {(() => {
                                // Kümülatife göre: (14-18) - 15 = stokDogrulukFark
                                // Hak edişe göre: (14-18) - 19 = (sevkiyatlarSonrasiTotalTest - donemSonuToplamTest) - hakEdis
                                const testFark = column22Mode === 'kumulatif'
                                  ? row.stokDogrulukFark
                                  : (row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest) - row.hakEdis;

                                const ambalaj = row.ambalajDegeri || 1;
                                const kutuFark = testFark / ambalaj;
                                const absKutuFark = Math.abs(kutuFark);

                                // 1 kutudan az ise 0 göster
                                if (absKutuFark < 1) {
                                  return (
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="text-muted-foreground">0 kutu</span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {Math.abs(testFark).toLocaleString('tr-TR')} test / {ambalaj} amb
                                      </span>
                                    </div>
                                  );
                                }

                                // Renk belirleme: 1-2 arası sarı, 2+ kırmızı
                                const colorClass = absKutuFark >= 2
                                  ? 'text-red-600 font-bold'
                                  : 'text-yellow-600 font-semibold';

                                return (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <span className={colorClass}>
                                      {kutuFark > 0 ? '+' : '-'}{absKutuFark.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kutu
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {Math.abs(testFark).toLocaleString('tr-TR')} test / {ambalaj} amb
                                    </span>
                                  </div>
                                );
                              })()}
                            </TableCell>
                            {/* Sütun 23: Sarfiyat Maliyeti */}
                            <TableCell className="bg-emerald-50/50 dark:bg-emerald-950/50 text-center">
                              {(() => {
                                const { cost, hasData } = calculateRowCost(row);

                                if (!hasData) {
                                  return (
                                    <span className="text-muted-foreground text-xs">
                                      Maliyet yok
                                    </span>
                                  );
                                }

                                if (cost === 0) {
                                  return (
                                    <span className="text-muted-foreground">-</span>
                                  );
                                }

                                const currencySymbol = costCurrency === 'TRY' ? '₺' : costCurrency === 'USD' ? '$' : '€';
                                const sarfiyat = row.sevkiyatlarSonrasiTotalTest - row.donemSonuToplamTest;

                                return (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                      {currencySymbol}{cost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {sarfiyat.toLocaleString('tr-TR')} test
                                    </span>
                                  </div>
                                );
                              })()}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}

      {selectedPoolId && rows.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {hasActiveFilters
                  ? `${filteredAndSortedRows.length}/${rows.length} satır gösteriliyor`
                  : `Toplam ${rows.length} satır`}
              </span>
              <span>{labGroups.length} laboratuvar</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Göztepe Sevkiyat Modal - Sütun 11 */}
      <Dialog open={showGoztepeSevkiyatModal} onOpenChange={setShowGoztepeSevkiyatModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Göztepe Sevkiyat Çek</DialogTitle>
            <DialogDescription>
              Seçilen laboratuvarlara {MONTHS[selectedMonth]?.label} {selectedYear} döneminde depodan yapılan transferleri çeker.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="selectAll"
                checked={selectedLabsForSevkiyat.size === poolLabs.length && poolLabs.length > 0}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedLabsForSevkiyat(new Set(poolLabs.map(l => l.id)));
                  } else {
                    setSelectedLabsForSevkiyat(new Set());
                  }
                }}
              />
              <Label htmlFor="selectAll" className="font-medium">Tümünü Seç</Label>
            </div>
            <div className="border rounded-md p-3 max-h-60 overflow-y-auto space-y-2">
              {poolLabs.map(lab => (
                <div key={lab.id} className="flex items-center gap-2">
                  <Checkbox
                    id={lab.id}
                    checked={selectedLabsForSevkiyat.has(lab.id)}
                    onCheckedChange={(checked) => {
                      const newSet = new Set(selectedLabsForSevkiyat);
                      if (checked) {
                        newSet.add(lab.id);
                      } else {
                        newSet.delete(lab.id);
                      }
                      setSelectedLabsForSevkiyat(newSet);
                    }}
                  />
                  <Label htmlFor={lab.id} className="text-sm">{lab.name}</Label>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGoztepeSevkiyatModal(false)}>
              İptal
            </Button>
            <Button onClick={handleFetchGoztepeSevkiyat} disabled={isFetchingSevkiyat}>
              {isFetchingSevkiyat ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Çekiliyor...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Verileri Çek
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kurumlar Arası Sevk Modal - Sütun 12 */}
      <Dialog open={showKurumlarArasiModal} onOpenChange={(open) => {
        if (!open) {
          setKurumlarArasiEditingRow(null);
        }
        setShowKurumlarArasiModal(open);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Kaynak Laboratuvar Seç</DialogTitle>
            <DialogDescription>
              {kurumlarArasiEditingRow && (
                <>
                  {kurumlarArasiEditingRow.value} kutu ürün hangi laboratuvardan alındı?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-md p-3 max-h-60 overflow-y-auto space-y-2">
            {poolLabs
              .filter(lab => {
                // Kendi kendine transfer yapılamaz
                if (!kurumlarArasiEditingRow) return true;
                const editingRow = rows.find(r => r.id === kurumlarArasiEditingRow.rowId);
                return lab.id !== editingRow?.labId;
              })
              .map(lab => (
                <Button
                  key={lab.id}
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handleConfirmKurumlarArasi(lab.id)}
                >
                  <ChevronRight className="h-4 w-4 mr-2" />
                  {lab.name}
                </Button>
              ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowKurumlarArasiModal(false);
              setKurumlarArasiEditingRow(null);
            }}>
              İptal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 5 - Excel Import Modal */}
      <Dialog open={showExcelImportModal} onOpenChange={setShowExcelImportModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excel ile Veri Gir</DialogTitle>
            <DialogDescription>
              Şablonu indirip verileri girdikten sonra dosyayı yükleyerek verileri aktarabilirsiniz.
              Sadece manuel giriş alanları (7, 8, 10, 13, 15, 16, 17, 19) aktarılır.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 gap-3">
              <Button
                variant="outline"
                className="h-20 flex flex-col gap-2"
                onClick={handleDownloadTemplate}
                disabled={rows.length === 0}
              >
                <Download className="h-6 w-6" />
                <span>Şablon İndir</span>
              </Button>
              <Button
                variant="default"
                className="h-20 flex flex-col gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={rows.length === 0 || isImportingExcel}
              >
                {isImportingExcel ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span>Yükleniyor...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-6 w-6" />
                    <span>Verileri Aktar</span>
                  </>
                )}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Not:</strong> Excel'de şu sütunlar aktarılacak:</p>
              <ul className="list-disc list-inside ml-2">
                <li>7. Başlangıç Stoğu (Kutu)</li>
                <li>8. Ay Başı Cihaz Üstü (Test)</li>
                <li>10. Ay Başı Sevkiyat (Kutu)</li>
                <li>13. Lojistik Ara Transfer (Kutu)</li>
                <li>15. Kümülatif Total (Test)</li>
                <li>16. Dönem Sonu Stok (Kutu)</li>
                <li>17. Dönem Sonu Cihaz Üstü (Test)</li>
                <li>19. Hak Ediş (Test)</li>
              </ul>
              <p className="text-orange-600 dark:text-orange-400 mt-2">
                11. Göztepe Sevkiyat ve 12. Kurumlar Arası Sevk sütunları sadece panel üzerinden yönetilir.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExcelImportModal(false)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden file input for Excel import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleExcelImport}
        accept=".xlsx,.xls"
        className="hidden"
      />
    </div>
  );
}
