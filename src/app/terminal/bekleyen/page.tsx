/**
 * @fileoverview Terminal — Bekleyen İşlemler.
 *
 * Çevrimdışı yapılan işlemler burada listelenir. Gönderme işini Firestore'un
 * kendi kuyruğu yapar — bu ekran GÖRÜNÜRLÜK sağlar, ikinci bir gönderim
 * mantığı çalıştırmaz (iki kuyruk aynı işlemi iki kez gönderebilirdi).
 *
 * Kayıtlar cihazda saklanır; uygulama kapanıp açılsa da liste durur.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Clock } from 'lucide-react';

import {
  OPERATION_LABELS,
  clearSentOperations,
  listPendingOperations,
  subscribeToPendingOperations,
  type PendingOperation,
} from '@/lib/pending-operations';
import { TerminalButton, TerminalShell, TerminalStat } from '@/components/terminal/shell';

function StatusBadge({ operation }: { operation: PendingOperation }) {
  if (operation.status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
        <Check className="h-4 w-4" /> Gönderildi
      </span>
    );
  }
  if (operation.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-300">
        <AlertTriangle className="h-4 w-4" /> Reddedildi
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">
      <Clock className="h-4 w-4" /> Bekliyor
    </span>
  );
}

export default function TerminalBekleyenPage() {
  const router = useRouter();
  const [operations, setOperations] = useState<PendingOperation[]>([]);

  useEffect(
    () => subscribeToPendingOperations(() => setOperations(listPendingOperations())),
    [],
  );

  const pendingCount = operations.filter(o => o.status === 'pending').length;
  const sentCount = operations.filter(o => o.status === 'sent').length;

  return (
    <TerminalShell
      title="Bekleyen İşlemler"
      subtitle="Bağlantı gelince otomatik gönderilir"
      onBack={() => router.push('/terminal')}
      right={<TerminalStat label="Bekleyen" value={pendingCount} />}
    >
      <div className="flex h-full min-h-0 flex-col gap-4 p-6">
        <p className="shrink-0 text-sm text-muted-foreground">
          İşlemler yapıldığı anda cihaza kaydedilir. Gönderimi uygulama kendisi
          yürütür; bu liste yalnızca durumu gösterir. Uygulamayı kapatmanız
          bekleyen işlemleri kaybettirmez.
        </p>

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
          {operations.length === 0 ? (
            <div className="flex h-full items-center justify-center px-8 text-center text-muted-foreground">
              Kayıt yok — yapılan bütün işlemler gönderilmiş durumda.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {operations.map(operation => (
                <li
                  key={operation.id}
                  className="flex flex-wrap items-center justify-between gap-4 px-6 py-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {OPERATION_LABELS[operation.kind]} · {operation.summary}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(operation.createdAt).toLocaleString('tr-TR')}
                      {operation.error ? ` · ${operation.error}` : ''}
                    </p>
                  </div>
                  <StatusBadge operation={operation} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 justify-end">
          <TerminalButton
            variant="ghost"
            onClick={clearSentOperations}
            disabled={sentCount === 0}
          >
            {`Gönderilenleri listeden kaldır (${sentCount})`}
          </TerminalButton>
        </div>
      </div>
    </TerminalShell>
  );
}
