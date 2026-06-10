'use client';

/* Sarf Dağıtım — transfer kartı (demo sarf-transfers.jsx TransferCard karşılığı). */

import React from 'react';
import type { SarfTransfer } from '@/lib/types';
import { sarfQrPayload, formatSarfStamp } from '@/lib/sarf-transfer';
import { QrBox, ItemChips, Meta, PendingPill, DeliveredPill, SARF_AC, sarfMono } from './sarf-ui';
import { IconQr, IconPrinter } from './sarf-icons';

export function SarfTransferCard({
  tr, actionLabel, onAction, onPrint, pendingLabel,
}: {
  tr: SarfTransfer;
  /** Bekleyen kartta sağ alttaki birincil aksiyon (örn. "Teslimatı Doğrula" / "Teslim Et"). */
  actionLabel?: string;
  onAction?: (tr: SarfTransfer) => void;
  /** Paket etiketini yazdırma aksiyonu (yalnızca bekleyenlerde gösterilir). */
  onPrint?: (tr: SarfTransfer) => void;
  /** Bekleyen rozetinin metnini özelleştir (örn. "Üzerimde"). */
  pendingLabel?: string;
}) {
  const delivered = tr.status === 'delivered';
  const [printPressed, setPrintPressed] = React.useState(false);

  return (
    <div className="sarf-transfer-card" style={{
      display: 'flex', gap: 22, alignItems: 'stretch',
      padding: 20, borderRadius: 'var(--sarf-radius)',
      background: 'linear-gradient(180deg, var(--sarf-surface) 0%, var(--sarf-surface-2) 100%)',
      boxShadow: delivered ? 'var(--sarf-clay)' : `var(--sarf-clay), 0 0 0 1.5px ${SARF_AC.primary}33`,
    }}>
      {/* QR bloğu */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <QrBox value={sarfQrPayload(tr)} size={120} dim={delivered} />
        <span style={{
          fontSize: 12, fontWeight: 800, color: delivered ? 'var(--sarf-ink-3)' : SARF_AC.primary,
          fontFamily: sarfMono, letterSpacing: '0.02em',
        }}>{tr.code}</span>
      </div>

      {/* gövde */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--sarf-ink-1)', letterSpacing: '-0.01em' }}>{tr.kurumAdi}</div>
            <div style={{ fontSize: 13, color: 'var(--sarf-ink-2)', fontWeight: 600, fontFamily: sarfMono, marginTop: 2 }}>
              Mahal: {tr.mahalKodu || '—'}
            </div>
          </div>
          {delivered
            ? <DeliveredPill />
            : <PendingPill label={pendingLabel || (tr.receivedById ? 'Taşımada' : 'Kabul Bekliyor')} />}
        </div>

        <ItemChips items={tr.items || []} />

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Meta label="Toplam" value={`${tr.total} adet`} />
          <Meta label="Oluşturuldu" value={formatSarfStamp(tr.createdAt)} mono />
          {!delivered && tr.receivedBy && <Meta label="Teslim Alan" value={tr.receivedBy} />}
          {delivered && <Meta label="Teslim" value={formatSarfStamp(tr.deliveredAt)} mono />}
          {!delivered && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              {onPrint && (
                <button
                  onClick={() => onPrint(tr)}
                  onMouseDown={() => setPrintPressed(true)}
                  onMouseUp={() => setPrintPressed(false)}
                  onMouseLeave={() => setPrintPressed(false)}
                  aria-label="Paket etiketini yazdır"
                  style={{
                    all: 'unset', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    height: 46, padding: '0 18px', borderRadius: 'var(--sarf-radius-pill)',
                    background: 'linear-gradient(180deg, var(--sarf-surface-hi), var(--sarf-surface-2))',
                    boxShadow: printPressed ? 'var(--sarf-clay-press)' : 'var(--sarf-clay)',
                    color: 'var(--sarf-ink-1)', fontWeight: 700, fontSize: 13.5,
                  }}
                >
                  <IconPrinter /> Yazdır
                </button>
              )}
              {onAction && actionLabel && (
                <button onClick={() => onAction(tr)} style={{
                  all: 'unset', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  height: 46, padding: '0 22px', borderRadius: 'var(--sarf-radius-pill)',
                  background: `radial-gradient(130% 150% at 30% 20%, ${SARF_AC.accent} 0%, ${SARF_AC.primary} 75%)`,
                  boxShadow: `inset 0 2px 2px rgba(255,255,255,0.4), 0 12px 22px -8px ${SARF_AC.glow}`,
                  color: '#fff', fontWeight: 800, fontSize: 14,
                }}>
                  <IconQr s={16} /> {actionLabel}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
