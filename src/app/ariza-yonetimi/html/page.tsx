'use client';
import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { DeviceFaultReport } from '@/lib/types';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

export default function ArizaRaporuHtmlPage() {
  const [reports, setReports] = useState<DeviceFaultReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOpenFaults = async () => {
      setLoading(true);
      try {
        const reportsQuery = query(
          collection(db, 'deviceFaultReports'),
          where('status', '==', 'open'),
          orderBy('openedAt', 'desc')
        );
        const snapshot = await getDocs(reportsQuery);
        const fetchedReports = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            openedAt: (data.openedAt as Timestamp)?.toDate() || null,
            closedAt: (data.closedAt as Timestamp)?.toDate() || null,
          } as DeviceFaultReport;
        });
        setReports(fetchedReports);
        setError(null);
      } catch (e: any) {
        console.error("Failed to fetch open fault reports:", e);
        setError("Veri çekilemedi: " + e.message + ". Firestore kurallarını veya koleksiyon adını kontrol edin.");
      } finally {
        setLoading(false);
      }
    };

    fetchOpenFaults();
  }, []);

  if (loading) {
    return <div>Rapor yükleniyor...</div>;
  }

  return (
    <div>
      <h1>Açık Arıza Kayıtları</h1>
      <p>Bu sayfanın URL'sini kopyalayıp Excel'in "Web'den Veri Al" özelliğinde kullanabilirsiniz.</p>
      
      {error ? (
        <div style={{ color: 'red', marginTop: '20px', border: '1px solid red', padding: '10px' }}>
          <h2>Hata</h2>
          <p>{error}</p>
        </div>
      ) : (
        <table id="ariza_raporu" border="1" cellPadding="5" cellSpacing="0" style={{ marginTop: '20px', borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th>Rapor ID</th>
              <th>Laboratuvar</th>
              <th>Cihaz Modeli</th>
              <th>Seri No</th>
              <th>Arıza Tipi</th>
              <th>Durum</th>
              <th>Açıklama</th>
              <th>Açan Personel</th>
              <th>Açılış Tarihi</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id}>
                <td>{report.id}</td>
                <td>{report.labName || ''}</td>
                <td>{report.model || ''}</td>
                <td>{report.serial || ''}</td>
                <td>{report.faultType?.replace('_', ' ') || ''}</td>
                <td>{report.status || ''}</td>
                <td>{report.description || ''}</td>
                <td>{report.openedByName || ''}</td>
                <td>{report.openedAt ? format(report.openedAt, 'dd.MM.yyyy HH:mm', { locale: tr }) : '-'}</td>
              </tr>
            ))}
            {reports.length === 0 && !loading && (
                <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '20px' }}>Açık arıza kaydı bulunamadı.</td>
                </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
