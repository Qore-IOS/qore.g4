'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Trash2, Wrench, FlaskConical, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, getDocs, addDoc, deleteDoc, doc, Timestamp, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import BackButton from '@/components/BackButton';
import type { FaultDefinition, FaultDefinitionType } from '@/lib/types';
import { filterByCompanyScope, withCompanyScope } from '@/lib/company-scope';

export default function ArizaTanimlamalariPage() {
  const router = useRouter();
  const { currentUserProfile, isAdmin, currentCompanyId, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [teknikFaults, setTeknikFaults] = useState<FaultDefinition[]>([]);
  const [aplikasyonFaults, setAplikasyonFaults] = useState<FaultDefinition[]>([]);

  const [newTeknikFault, setNewTeknikFault] = useState('');
  const [newAplikasyonFault, setNewAplikasyonFault] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Check access permission
  const hasAccess = currentUserProfile && (
    isAdmin ||
    currentUserProfile.role === 'teknik_servis' ||
    currentUserProfile.role === 'aplikasyon'
  );

  useEffect(() => {
    if (!hasAccess) {
      setLoading(false);
      return;
    }

    const fetchFaults = async () => {
      try {
        const snap = await getDocs(collection(db, 'faultDefinitions'));
        const faults = filterByCompanyScope(
          snap.docs.map(d => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          })) as FaultDefinition[],
          currentCompanyId,
          isSuperAdmin
        );

        setTeknikFaults(faults.filter(f => f.type === 'teknik_servis'));
        setAplikasyonFaults(faults.filter(f => f.type === 'aplikasyon'));
      } catch (err) {
        console.error('Error fetching fault definitions:', err);
        toast({ title: 'Hata', description: 'Arıza tanımlamaları yüklenemedi.', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };

    fetchFaults();
  }, [hasAccess, toast, currentCompanyId, isSuperAdmin]);

  const addFault = async (type: FaultDefinitionType) => {
    const name = type === 'teknik_servis' ? newTeknikFault.trim() : newAplikasyonFault.trim();

    if (!name) {
      toast({ title: 'Uyarı', description: 'Arıza adı boş olamaz.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const docRef = await addDoc(collection(db, 'faultDefinitions'), withCompanyScope({
        name,
        type,
        createdAt: Timestamp.now(),
        createdByUid: currentUserProfile?.uid,
        createdByName: currentUserProfile?.name || 'Bilinmeyen',
      }, currentUserProfile?.companyId));

      const newFault: FaultDefinition = {
        id: docRef.id,
        name,
        type,
        createdAt: new Date(),
        createdByUid: currentUserProfile?.uid,
        createdByName: currentUserProfile?.name || 'Bilinmeyen',
      };

      if (type === 'teknik_servis') {
        setTeknikFaults(prev => [...prev, newFault]);
        setNewTeknikFault('');
      } else {
        setAplikasyonFaults(prev => [...prev, newFault]);
        setNewAplikasyonFault('');
      }

      toast({ title: 'Eklendi', description: 'Arıza tanımı eklendi.' });
    } catch (err) {
      console.error('Error adding fault:', err);
      toast({ title: 'Hata', description: 'Arıza eklenemedi.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const removeFault = async (id: string, type: FaultDefinitionType) => {
    if (!confirm('Bu arıza tanımını silmek istediğinize emin misiniz?')) return;

    try {
      await deleteDoc(doc(db, 'faultDefinitions', id));

      if (type === 'teknik_servis') {
        setTeknikFaults(prev => prev.filter(f => f.id !== id));
      } else {
        setAplikasyonFaults(prev => prev.filter(f => f.id !== id));
      }

      toast({ title: 'Silindi', description: 'Arıza tanımı silindi.', variant: 'destructive' });
    } catch (err) {
      console.error('Error removing fault:', err);
      toast({ title: 'Hata', description: 'Arıza silinemedi.', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Yükleniyor...</span>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-bold text-destructive">Yetkisiz Erişim</h2>
        <p className="text-muted-foreground mt-2">
          Bu sayfaya sadece teknik servis, aplikasyon personelleri ve yöneticiler erişebilir.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      <BackButton fallback="/cihaz-yonetimi-ana" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6" />
            Arıza Tanımlamaları
          </CardTitle>
          <CardDescription>
            Teknik servis ve aplikasyon için standart arıza tanımları. Bu tanımlar işlem formlarında arıza seçimi için kullanılır.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Teknik Servis Column */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                <Wrench className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold text-blue-700 dark:text-blue-300">Teknik Servis Arızaları</h3>
              </div>

              {/* Add new fault */}
              <div className="flex gap-2">
                <Input
                  value={newTeknikFault}
                  onChange={(e) => setNewTeknikFault(e.target.value)}
                  placeholder="Yeni arıza adı..."
                  onKeyDown={(e) => e.key === 'Enter' && addFault('teknik_servis')}
                />
                <Button onClick={() => addFault('teknik_servis')} disabled={isSaving}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>

              {/* Fault list */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {teknikFaults.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Henüz arıza tanımı eklenmemiş.
                  </p>
                ) : (
                  teknikFaults.map(fault => (
                    <div
                      key={fault.id}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg group"
                    >
                      <span className="text-sm">{fault.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeFault(fault.id, 'teknik_servis')}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Aplikasyon Column */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg">
                <FlaskConical className="h-5 w-5 text-purple-600" />
                <h3 className="font-semibold text-purple-700 dark:text-purple-300">Aplikasyon Arızaları</h3>
              </div>

              {/* Add new fault */}
              <div className="flex gap-2">
                <Input
                  value={newAplikasyonFault}
                  onChange={(e) => setNewAplikasyonFault(e.target.value)}
                  placeholder="Yeni arıza adı..."
                  onKeyDown={(e) => e.key === 'Enter' && addFault('aplikasyon')}
                />
                <Button onClick={() => addFault('aplikasyon')} disabled={isSaving}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>

              {/* Fault list */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {aplikasyonFaults.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Henüz arıza tanımı eklenmemiş.
                  </p>
                ) : (
                  aplikasyonFaults.map(fault => (
                    <div
                      key={fault.id}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg group"
                    >
                      <span className="text-sm">{fault.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeFault(fault.id, 'aplikasyon')}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
