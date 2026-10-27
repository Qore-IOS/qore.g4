'use client';
// Personel & Gider Yönetimi — basitleştirilmiş model.
//
// Üstte tek bir "personel başına aylık gider (TL)" girilir; altta lab başına
// personel SAYISI girilir. Lab gideri = sayı × kişi başı gider. Ortak stok
// havuzuna dahil lablardan yalnızca ANA lab listelenir; ana laba girilen
// toplam gider, maliyet gözlem test hesabında havuz üyesi lablara test
// hacmi payıyla dağıtılır.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Save, Search, X, Wallet, Layers } from 'lucide-react';
import {
  collection,
  addDoc,
  doc,
  getDocs,
  orderBy,
  serverTimestamp,
  updateDoc,
} from '../../../../../lib/data/client';
import { db } from '../../../../../lib/data/client';
import { useToast } from '@/hooks/use-toast';
import type { Hospital, LabPool, PersonnelCostConfig } from '@/lib/types';
import BackButton from '@/components/BackButton';
import { useAuth } from '@/contexts/auth-context';
import { filterByCompanyScope, normalizeCompanyId } from '@/lib/company-scope';
import { scopedQuery } from '@/lib/document-helpers';

const CONFIG_COLLECTION = 'personnelCostConfig';

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtTL(v: number): string {
  return `₺${Math.round(v).toLocaleString('tr-TR')}`;
}

interface LabRow {
  labId: string;
  labName: string;
  /** Havuz ana labıysa havuz adı ve üye sayısı */
  pool?: { name: string; memberCount: number };
}

export default function PersonelGiderYonetimiPage() {
  const { toast } = useToast();
  const { currentCompanyId, isSuperAdmin, currentUserProfile } = useAuth();

  const [labs, setLabs] = useState<Hospital[]>([]);
  const [pools, setPools] = useState<LabPool[]>([]);
  const [configId, setConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Form state — string tutulur ki boş bırakılabilsin
  const [costPerPerson, setCostPerPerson] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});

  // ------------------------------------------------------------------
  // Veri yükleme: lablar, havuzlar, mevcut konfigürasyon
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [labsSnap, poolsSnap, cfgSnap] = await Promise.all([
          getDocs(scopedQuery('hospitals', currentCompanyId, isSuperAdmin, orderBy('name', 'asc'))),
          getDocs(scopedQuery('labPools', currentCompanyId, isSuperAdmin)).catch(() => null),
          getDocs(scopedQuery(CONFIG_COLLECTION, currentCompanyId, isSuperAdmin)).catch(() => null),
        ]);
        if (cancelled) return;

        setLabs(
          filterByCompanyScope(
            labsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Hospital)),
            currentCompanyId,
            isSuperAdmin,
          ),
        );
        if (poolsSnap) {
          setPools(
            filterByCompanyScope(
              poolsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as LabPool)),
              currentCompanyId,
              isSuperAdmin,
            ),
          );
        }
        if (cfgSnap && !cfgSnap.empty) {
          const docSnap = filterByCompanyScope(
            cfgSnap.docs.map((d) => ({ id: d.id, ...d.data() } as PersonnelCostConfig)),
            currentCompanyId,
            isSuperAdmin,
          )[0];
          if (docSnap) {
            setConfigId(docSnap.id ?? null);
            setCostPerPerson(docSnap.costPerPersonTL > 0 ? String(docSnap.costPerPersonTL) : '');
            const next: Record<string, string> = {};
            Object.entries(docSnap.labCounts || {}).forEach(([labId, n]) => {
              if (Number(n) > 0) next[labId] = String(n);
            });
            setCounts(next);
          }
        }
      } catch (e) {
        console.error('Personel gider konfigürasyonu yüklenemedi', e);
        toast({ title: 'Hata', description: 'Veriler yüklenemedi.', variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentCompanyId, isSuperAdmin, toast]);

  // ------------------------------------------------------------------
  // Lab listesi: havuz üyeleri gizlenir, yalnızca ana lab (rozetle) görünür
  // ------------------------------------------------------------------
  const labRows = useMemo<LabRow[]>(() => {
    const labById = new Map(labs.map((l) => [l.id, l]));
    const hiddenMemberIds = new Set<string>();
    const poolByMainLab = new Map<string, { name: string; memberCount: number }>();

    pools.forEach((pool) => {
      if (pool.active === false || !pool.mainLabId) return;
      const memberIds = Array.from(new Set([...(pool.memberIds || []), pool.mainLabId]));
      const presentMembers = memberIds.filter((id) => labById.has(id));
      if (presentMembers.length === 0) return;
      poolByMainLab.set(pool.mainLabId, { name: pool.name, memberCount: presentMembers.length });
      presentMembers.forEach((id) => {
        if (id !== pool.mainLabId) hiddenMemberIds.add(id);
      });
    });

    return labs
      .filter((l) => !hiddenMemberIds.has(l.id))
      .map((l) => ({
        labId: l.id,
        labName: l.name,
        pool: poolByMainLab.get(l.id),
      }));
  }, [labs, pools]);

  const visibleRows = useMemo(() => {
    if (!searchTerm.trim()) return labRows;
    const q = normalizeText(searchTerm);
    return labRows.filter((r) => normalizeText(r.labName).includes(q));
  }, [labRows, searchTerm]);

  const costPerPersonNum = parseFloat(costPerPerson.replace(',', '.')) || 0;

  const totals = useMemo(() => {
    let people = 0;
    labRows.forEach((r) => {
      people += parseInt(counts[r.labId] || '0', 10) || 0;
    });
    return { people, monthly: people * costPerPersonNum };
  }, [labRows, counts, costPerPersonNum]);

  // ------------------------------------------------------------------
  // Kaydet
  // ------------------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (isSaving) return;
    if (costPerPersonNum <= 0) {
      toast({ title: 'Eksik bilgi', description: 'Personel başına aylık gider (TL) girilmelidir.', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const labCounts: Record<string, number> = {};
      labRows.forEach((r) => {
        const n = parseInt(counts[r.labId] || '0', 10) || 0;
        if (n > 0) labCounts[r.labId] = n;
      });

      const payload = {
        costPerPersonTL: costPerPersonNum,
        labCounts,
        companyId: normalizeCompanyId(currentCompanyId),
        updatedAt: serverTimestamp(),
        updatedByUid: currentUserProfile?.uid ?? '',
        updatedByName: currentUserProfile?.name ?? '',
      };

      if (configId) {
        await updateDoc(doc(db, CONFIG_COLLECTION, configId), payload);
      } else {
        const ref = await addDoc(collection(db, CONFIG_COLLECTION), payload);
        setConfigId(ref.id);
      }

      toast({
        title: 'Kaydedildi',
        description: `${totals.people} personel · aylık toplam ${fmtTL(totals.monthly)}. Test maliyetlerine hacim payıyla dağıtılacak.`,
      });
    } catch (e) {
      console.error('Personel gider konfigürasyonu kaydedilemedi', e);
      toast({ title: 'Hata', description: 'Kaydedilemedi. Lütfen tekrar deneyin.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, costPerPersonNum, labRows, counts, configId, currentCompanyId, currentUserProfile, totals, toast]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <BackButton fallback="/yonetim/personel-yonetimi" />

      {/* Başlık + kişi başı gider */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Personel &amp; Gider Yönetimi
          </CardTitle>
          <CardDescription>
            Personel başına aylık gideri ve lab başına personel sayısını tanımlayın. Bu veriler
            maliyet gözlem panelinde test başına maliyete, testlerin hacim payına göre dağıtılarak
            yansıtılır. Ortak stok havuzlarında sayı yalnızca ana laba girilir; toplam gider havuz
            üyesi lablara test hacmine göre paylaştırılır.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                Personel Başına Aylık Gider (TL)
              </label>
              <Input
                type="number"
                min="0"
                inputMode="decimal"
                placeholder="örn. 45000"
                value={costPerPerson}
                onChange={(e) => setCostPerPerson(e.target.value)}
                className="w-56 text-base font-semibold"
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              <Badge variant="secondary" className="h-9 px-3 text-sm">
                {totals.people} personel
              </Badge>
              <Badge variant="secondary" className="h-9 px-3 text-sm text-emerald-600">
                Aylık Toplam: {fmtTL(totals.monthly)}
              </Badge>
            </div>

            <div className="ml-auto">
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Kaydet
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lab başına personel sayısı */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lab Başına Personel Sayısı</CardTitle>
          <CardDescription>
            Havuz üyesi lablar listelenmez — havuzun tüm personeli ana laba yazılır ve gider, test
            hacmine göre üye lablara dağıtılır.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Laboratuvar ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {visibleRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {searchTerm ? 'Aramayla eşleşen laboratuvar yok.' : 'Tanımlı laboratuvar bulunamadı.'}
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {visibleRows.map((row) => {
                const n = parseInt(counts[row.labId] || '0', 10) || 0;
                const rowTotal = n * costPerPersonNum;
                return (
                  <div key={row.labId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-[180px]">
                      <p className="text-sm font-semibold">{row.labName}</p>
                      {row.pool && (
                        <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          <Layers className="h-2.5 w-2.5" />
                          {row.pool.name} · gider {row.pool.memberCount} laba hacimle dağıtılır
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Personel
                      </label>
                      <Input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        placeholder="0"
                        value={counts[row.labId] ?? ''}
                        onChange={(e) =>
                          setCounts((prev) => ({ ...prev, [row.labId]: e.target.value }))
                        }
                        className="h-9 w-20 text-center"
                      />
                    </div>
                    <div className="w-32 text-right">
                      <span className={n > 0 ? 'text-sm font-bold text-emerald-600' : 'text-sm text-muted-foreground'}>
                        {n > 0 ? `${fmtTL(rowTotal)}/ay` : '—'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
