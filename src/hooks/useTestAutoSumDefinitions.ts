'use client';

import { useCallback, useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getScopedDocs } from '@/lib/firestore-helpers';
import { useAuth } from '@/contexts/auth-context';
import type { TestAutoSumDefinition } from '@/lib/qore-hesaplama/auto-sum-definitions';

const COLLECTION = 'testAutoSumDefinitions';

export function useTestAutoSumDefinitions() {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [definitions, setDefinitions] = useState<TestAutoSumDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const docs = await getScopedDocs(COLLECTION, currentCompanyId, !!isSuperAdmin);
      setDefinitions(docs
        .map((d) => ({ id: d.id, ...d.data() } as TestAutoSumDefinition))
        .sort((a, b) => a.mainTestName.localeCompare(b.mainTestName, 'tr')));
    } catch (e: any) {
      setError(e?.message || 'Oto toplam tanımları yüklenemedi.');
      setDefinitions([]);
    } finally {
      setIsLoading(false);
    }
  }, [currentCompanyId, isSuperAdmin]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createDefinition = useCallback(async (data: { mainTestName: string; includeTestNames: string[] }) => {
    await addDoc(collection(db, COLLECTION), {
      mainTestName: data.mainTestName.trim(),
      includeTestNames: data.includeTestNames.map((item) => item.trim()).filter(Boolean),
      companyId: currentCompanyId || '__legacy__',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await refresh();
  }, [currentCompanyId, refresh]);

  const updateDefinition = useCallback(async (id: string, data: { mainTestName: string; includeTestNames: string[] }) => {
    await updateDoc(doc(db, COLLECTION, id), {
      mainTestName: data.mainTestName.trim(),
      includeTestNames: data.includeTestNames.map((item) => item.trim()).filter(Boolean),
      updatedAt: serverTimestamp(),
    });
    await refresh();
  }, [refresh]);

  const deleteDefinition = useCallback(async (id: string) => {
    await deleteDoc(doc(db, COLLECTION, id));
    await refresh();
  }, [refresh]);

  return { definitions, isLoading, error, refresh, createDefinition, updateDefinition, deleteDefinition };
}
