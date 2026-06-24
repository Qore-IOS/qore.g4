'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, setDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { useAuth } from '@/contexts/auth-context';
import { getScopedDocs } from '@/lib/firestore-helpers';
import type { BarcodeFormat, ExpiryPattern } from '@/lib/types';
import { Loader2, PlusCircle, Check, Trash2, Edit3, SlidersHorizontal, Info, Barcode } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { normalizePos, normalizeFormat } from '@/lib/barcode/pos-utils';
import {
  C, AC, useMode, ClayPage, RaporHead, Card, SoftBtn, PrimaryBtn, IconBtn,
  ClayInput, Dropdown, Toggle, FieldLabel, StateBadge, EmptyBlock, Modal, ModalHead,
} from '@/components/raporlama/rapor-kit';

const EASE = 'cubic-bezier(.22, 1, .36, 1)';

type Pos = { start: number | string; length: number | string };

type LocalFormat = (Partial<BarcodeFormat> & {
    parseTarget?: 'reference' | 'barcodeNumber';
    trackLot?: boolean;
    trackSerial?: boolean;
    priority?: number;
    totalLength?: number | string;
    reference: Pos;
    lot: Pos;
    expiry?: (Pos & { pattern?: any }) | undefined;
    serial?: Pos;
});

const EXPIRY_PATTERNS: ExpiryPattern[] = ['YYMMDD','YYYYMMDD','DDMMYYYY','MMYY','MMYYYY', 'text'];

function Section({ title, disabled, children }: { title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: C.radiusSm, padding: 14, background: C.surface2, boxShadow: C.clayInset, opacity: disabled ? 0.5 : 1, transition: 'opacity 200ms ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13.5, fontWeight: 800, color: C.ink1 }}>
        <SlidersHorizontal size={16} style={{ color: AC.primary }} /> {title}
      </div>
      <div style={{ pointerEvents: disabled ? 'none' : 'auto' }}>
        {children}
      </div>
    </div>
  );
}

function PosInputs({ value, onChange }: { value?: Pos; onChange: (v: Pos) => void }) {
  const v = value ?? { start: 0, length: 0 };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <div>
        <FieldLabel>Başlangıç (1 bazlı)</FieldLabel>
        <ClayInput
          type="number" inputMode="numeric"
          value={Number(v.start ?? 0)}
          onChange={(val) => onChange({ ...v, start: Number(val) })}
        />
      </div>
      <div>
        <FieldLabel>Uzunluk</FieldLabel>
        <ClayInput
          type="number" inputMode="numeric"
          value={Number(v.length ?? 0)}
          onChange={(val) => onChange({ ...v, length: Number(val) })}
        />
      </div>
    </div>
  );
}

function cleanPos(p?: Pos) {
  if (!p) return undefined;
  const s = Number(p.start ?? 0);
  const l = Number(p.length ?? 0);
  if (!s || !l) return undefined;
  return { start: s, length: l };
}

function cleanExpiry(p?: any) {
  if (!p) return undefined;
  const s = Number(p.start ?? 0);
  const l = Number(p.length ?? 0);
  const pattern = p.pattern || undefined;
  if (!s || !l) return undefined;
  return { start: s, length: l, pattern };
}

export default function SeriNoFormatPanel() {
  const { toast } = useToast();
  const router = useRouter();
  const mode = useMode();
  const mobile = mode === 'mobile';
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [formats, setFormats] = useState<BarcodeFormat[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<LocalFormat | null>(null);

  const fetchFormats = useCallback(async () => {
    setIsLoading(true);
    try {
        const docs = await getScopedDocs('barcodeFormats', currentCompanyId, isSuperAdmin);
        const rawFormats = docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setFormats(rawFormats.map(f => normalizeFormat(f) as BarcodeFormat).sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10)));
    } catch (error) {
        console.error("Format fetch error:", error);
    } finally {
        setIsLoading(false);
    }
  }, [currentCompanyId, isSuperAdmin]);

  useEffect(() => { fetchFormats(); }, [fetchFormats]);

  const openNew = () => {
    setEditing({
      name: '',
      strategy: 'positional',
      active: true,
      priority: 10,
      totalLength: 0,
      reference: { start: 1, length: 1 },
      lot: { start: 0, length: 0 },
      expiry: { start: 0, length: 0, pattern: 'YYMMDD' },
      serial: { start: 0, length: 0 },
      parseTarget: 'reference',
      trackLot: true,
      trackSerial: true,
    });
    setIsModalOpen(true);
  };

  const openEdit = (f: BarcodeFormat) => {
    setEditing(normalizeFormat(f) as LocalFormat);
    setIsModalOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    const id = editing.id || crypto.randomUUID();

    const totalLengthNum = Number(editing.totalLength ?? 0);
    const referenceClean = cleanPos(editing.reference);
    const trackLot = editing.trackLot !== false;
    const trackSerial = editing.trackSerial === true;

    if (!editing.name?.trim()) {
      toast({ title: 'Eksik Bilgi', description: 'Ad zorunlu.', variant: 'destructive' });
      return;
    }
    if (!referenceClean) {
      toast({ title: 'Eksik Dilim', description: 'Referans başlangıç ve uzunluk girin.', variant: 'destructive' });
      return;
    }

    const lotClean = trackLot ? cleanPos(editing.lot) : undefined;
    const expiryClean = trackLot ? cleanExpiry(editing.expiry) : undefined;
    const serialClean = (trackSerial && editing.strategy === 'positional') ? cleanPos(editing.serial) : undefined;

    const payload: any = {
      name: editing.name.trim(),
      active: editing.active !== false,
      priority: Number(editing.priority ?? 10),
      strategy: editing.strategy ?? 'positional',
      parseTarget: (editing.parseTarget as 'reference' | 'barcodeNumber') ?? 'reference',
      trackLot: trackLot,
      trackSerial: trackSerial,
      reference: referenceClean,
    };

    if (totalLengthNum > 0) payload.totalLength = totalLengthNum; else payload.totalLength = deleteField();

    if (trackLot) {
      if (payload.strategy === 'positional' && (!lotClean || !expiryClean)) {
        toast({ title: 'Eksik Dilim', description: 'Lot ve Miad için aralıkları girin.', variant: 'destructive' });
        return;
      }
      payload.lot = lotClean;
      payload.expiry = expiryClean;
    } else {
      payload.lot = deleteField();
      payload.expiry = deleteField();
    }

    if (trackSerial) {
       if (serialClean) {
         payload.serial = serialClean;
       } else {
         payload.serial = deleteField();
       }
    } else {
       payload.serial = deleteField();
    }

    if (!editing.id) {
      payload.companyId = currentCompanyId;
    }

    try {
      await setDoc(doc(db, 'barcodeFormats', id), payload, { merge: true });
      toast({ title: 'Kaydedildi', description: 'Barkod formatı başarıyla güncellendi.' });
      setIsModalOpen(false);
      setEditing(null);
      fetchFormats();
    } catch (e) {
      console.error(e);
      toast({ title: 'Kayıt Hatası', description: 'Format kaydedilemedi.', variant: 'destructive' });
    }
  };

  const remove = async (f: BarcodeFormat) => {
    if(!confirm(`'${f.name}' formatını silmek istediğinizden emin misiniz?`)) return;
    await deleteDoc(doc(db, 'barcodeFormats', f.id));
    toast({ title: 'Silindi', description: 'Format kaldırıldı.' });
    if (editing?.id === f.id) setEditing(null);
    fetchFormats();
  };

  const closeModal = () => { setEditing(null); setIsModalOpen(false); };

  const strategy = (editing?.strategy ?? 'positional') as string;
  const trackLotOn = editing?.trackLot !== false;
  const trackSerialOn = editing?.trackSerial === true;

  const DangerBtn = ({ onClick }: { onClick: () => void }) => (
    <SoftBtn onClick={onClick} tone={C.danger} style={{ width: 44, height: 44, padding: 0 }}>
      <Trash2 size={16} />
    </SoftBtn>
  );

  const cols = 'minmax(0,1.4fr) 120px 80px 110px 80px 80px 110px';

  return (
    <ClayPage>
      <div style={{ animation: `cyRise 360ms ${EASE} both` }}>
        <RaporHead
          icon={Barcode} mobile={mobile}
          title="Seri Numarası Format Tanımlama"
          desc="Yeni seri numaralı barkod formatları oluşturun veya mevcutları düzenleyin."
          onBack={() => router.push('/raporlama')}
          right={<PrimaryBtn onClick={openNew}><PlusCircle size={18} /> Yeni Format</PrimaryBtn>}
        />

        <Card style={{ padding: mobile ? 14 : '16px 18px' }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 6px', fontSize: 14, fontWeight: 700, color: C.ink2 }}>
              <Loader2 size={18} style={{ animation: 'cySpin 1s linear infinite', color: AC.primary }} /> Yükleniyor…
            </div>
          ) : formats.length === 0 ? (
            <EmptyBlock icon={<Barcode size={26} />} text="Henüz tanımlı bir barkod formatı yok." sub="Yeni bir seri numarası formatı oluşturmak için 'Yeni Format' butonunu kullanın." />
          ) : mobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {formats.map((f) => {
                const trackLot = (f as any).trackLot !== false;
                const trackSerial = (f as any).trackSerial === true;
                return (
                  <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayFlat }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.ink1, lineHeight: 1.25 }}>{f.name}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <MobileRow label="Strateji" value={f.strategy || 'Positional'} />
                      <MobileRow label="Öncelik" value={String(f.priority ?? 10)} />
                      <MobileRow label="Tanıma" value={f.parseTarget === 'barcodeNumber' ? 'UDI' : 'Referans'} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Lot</span>
                        <StateBadge on={trackLot} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Seri No</span>
                        <StateBadge on={trackSerial} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                      <IconBtn onClick={() => openEdit(f)}><Edit3 size={16} /></IconBtn>
                      <DangerBtn onClick={() => remove(f)} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 14, padding: '12px 16px', borderBottom: `1px solid ${C.line}` }}>
                {['Ad', 'Strateji', 'Öncelik', 'Tanıma', 'Lot', 'Seri No', 'İşlemler'].map((h, i) => (
                  <div key={h} style={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: (i >= 4 && i <= 5) ? 'center' : i === 6 ? 'right' : 'left' }}>{h}</div>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {formats.map((f) => {
                  const trackLot = (f as any).trackLot !== false;
                  const trackSerial = (f as any).trackSerial === true;
                  return (
                    <div key={f.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 14, alignItems: 'center', padding: '14px 16px', borderRadius: C.radius, background: C.surfaceHi, boxShadow: C.clayFlat }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.ink1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink2 }}>{f.strategy || 'Positional'}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.ink1 }}>{f.priority ?? 10}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: C.ink2 }}>{f.parseTarget === 'barcodeNumber' ? 'UDI' : 'Referans'}</div>
                      <div style={{ textAlign: 'center' }}><StateBadge on={trackLot} /></div>
                      <div style={{ textAlign: 'center' }}><StateBadge on={trackSerial} /></div>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <IconBtn onClick={() => openEdit(f)}><Edit3 size={16} /></IconBtn>
                        <DangerBtn onClick={() => remove(f)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      </div>

      <Modal open={isModalOpen} onClose={closeModal} width={820}>
        <ModalHead
          icon={Barcode}
          title={editing?.id ? 'Formatı Düzenle' : 'Yeni Format Oluştur'}
          desc="Barkod dilimlerini ve takip kurallarını tanımlayın."
          onClose={closeModal}
        />
        {editing && (
          <div style={{ padding: mobile ? '18px 16px' : '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Basic info: name + priority + active */}
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1.4fr 1fr', gap: 14, padding: 16, borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
              <div>
                <FieldLabel>Format Adı</FieldLabel>
                <ClayInput
                  value={editing.name || ''}
                  onChange={(val) => setEditing(prev => ({ ...prev!, name: val }))}
                  placeholder="Örn: Roche Kit Barkodu"
                />
              </div>
              <div>
                <FieldLabel>Öncelik (Küçük önce taranır)</FieldLabel>
                <ClayInput
                  type="number" inputMode="numeric"
                  value={editing.priority ?? 10}
                  onChange={(val) => setEditing(p => ({ ...p!, priority: Number(val) }))}
                />
              </div>
              <div style={{ gridColumn: mobile ? 'auto' : '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderRadius: C.radiusSm, background: C.surfaceHi, boxShadow: C.clayFlat }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.ink1 }}>Aktif</span>
                <Toggle on={editing.active !== false} onChange={(v) => setEditing(p => ({ ...p!, active: Boolean(v) }))} />
              </div>
            </div>

            {/* Strategy + Target */}
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 14 }}>
              <div>
                <FieldLabel>Okuma Stratejisi</FieldLabel>
                <Dropdown
                  value={strategy}
                  onChange={(v) => setEditing(p => ({ ...p!, strategy: v as any }))}
                  options={[
                    { value: 'positional', label: 'Pozisyonel (Karakter Sayısı)' },
                    { value: 'regex', label: 'Regex (Gelişmiş Desen)' },
                    { value: 'legacy_roche', label: 'Legacy (Roche Özel)' },
                  ]}
                />
              </div>
              <div>
                <FieldLabel>Ürün Eşleştirme Hedefi</FieldLabel>
                <Dropdown
                  value={editing.parseTarget ?? 'reference'}
                  onChange={(v) => setEditing(p => ({ ...p!, parseTarget: v as 'reference' | 'barcodeNumber' }))}
                  options={[
                    { value: 'reference', label: 'Referans No (stokKodu)' },
                    { value: 'barcodeNumber', label: 'Barkod No (UDI/GTIN)' },
                  ]}
                />
              </div>
            </div>

            {/* Track toggles */}
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.ink1 }}>Lot &amp; Miad Takibi</span>
                  <Toggle on={trackLotOn} onChange={(checked) => setEditing(p => ({ ...p!, trackLot: checked }))} />
                </div>
                <p style={{ margin: 0, fontSize: 12, color: C.ink3, fontWeight: 500, lineHeight: 1.45 }}>Ürünün lot numarası ve son kullanma tarihini içeriyorsa açın.</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: C.radiusSm, background: C.surface2, boxShadow: C.clayInset }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: C.ink1 }}>Seri No Takibi</span>
                  <Toggle on={trackSerialOn} onChange={(checked) => setEditing(p => ({ ...p!, trackSerial: checked }))} />
                </div>
                <p style={{ margin: 0, fontSize: 12, color: C.ink3, fontWeight: 500, lineHeight: 1.45 }}>Her ürünün kendine ait tekil (unique) seri numarası varsa açın.</p>
              </div>
            </div>

            {/* POSITIONAL INPUTS */}
            {strategy === 'positional' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4, borderTop: `1px solid ${C.line}`, marginTop: 2 }}>
                  <span style={{ fontSize: 15.5, fontWeight: 800, color: C.ink1, paddingTop: 12 }}>Pozisyon Ayarları</span>
                </div>

                <div style={{ maxWidth: mobile ? '100%' : 280 }}>
                  <FieldLabel>Toplam Barkod Uzunluğu</FieldLabel>
                  <ClayInput
                    type="number" inputMode="numeric"
                    value={String(editing.totalLength ?? '')}
                    onChange={(val) => setEditing(p => ({ ...p!, totalLength: Number(val) }))}
                  />
                </div>

                <Section title="Referans / Ürün Kodu">
                  <PosInputs value={editing.reference} onChange={v => setEditing(p => ({ ...p!, reference: normalizePos(v) }))} />
                </Section>

                {trackLotOn && (
                  <>
                    <Section title="Lot Numarası">
                      <PosInputs
                        value={editing.lot}
                        onChange={v => setEditing(p => ({ ...p!, lot: normalizePos(v) }))}
                      />
                    </Section>
                    <Section title="Son Kullanma Tarihi (Miad)">
                      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '2fr 1fr', gap: 12, alignItems: 'flex-end' }}>
                        <PosInputs value={editing.expiry as any} onChange={v => setEditing(p => ({ ...p!, expiry: { ...(p?.expiry as any), ...normalizePos(v) } }))} />
                        <div>
                          <FieldLabel>Format</FieldLabel>
                          <Dropdown
                            value={editing.expiry?.pattern ?? 'YYMMDD'}
                            onChange={(v) => setEditing(p => ({ ...p!, expiry: { ...(p?.expiry as any), pattern: v } }))}
                            options={EXPIRY_PATTERNS.map(p => ({ value: p, label: p }))}
                          />
                        </div>
                      </div>
                    </Section>
                  </>
                )}

                {trackSerialOn && (
                  <Section title="Seri Numarası">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <PosInputs
                        value={editing?.serial}
                        onChange={v => setEditing(p => ({ ...p!, serial: normalizePos(v) }))}
                      />
                      <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 12, background: C.amberSoft, boxShadow: C.clayInset }}>
                        <Info size={16} style={{ color: '#9A6F1E', flexShrink: 0, marginTop: 2 }} />
                        <div style={{ fontSize: 12.5, color: '#9A6F1E', fontWeight: 500, lineHeight: 1.45 }}>
                          <strong>Bilgi:</strong> Başlangıç ve Uzunluk alanlarını 0 bırakırsanız, sistem barkodun <em>geri kalanını</em> seri numarası olarak alır.
                        </div>
                      </div>
                    </div>
                  </Section>
                )}
              </>
            )}

            {/* REGEX INPUTS */}
            {editing.strategy === 'regex' && (
              <div style={{ padding: 16, borderRadius: C.radiusSm, background: 'rgba(124,168,222,0.10)', boxShadow: C.clayInset }}>
                <FieldLabel>Regex İfadesi</FieldLabel>
                <ClayInput
                  value={editing.regex ?? ''}
                  onChange={(val) => setEditing(p => ({ ...p!, regex: val }))}
                  placeholder="^(.{10})(.{5}).*$"
                  style={{ fontFamily: 'ui-monospace, monospace' }}
                />
                <p style={{ margin: '12px 0 0', fontSize: 12, color: C.ink2, fontWeight: 500, lineHeight: 1.6 }}>
                  Parantez grupları şu sırayla eşleştirilir:<br />
                  1. Referans/Barkod No<br />
                  2. Lot (Lot Takibi açıksa)<br />
                  3. Miad (Lot Takibi açıksa)<br />
                  4. Seri No (Seri No Takibi açıksa)
                </p>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: mobile ? '14px 16px' : '16px 24px', borderTop: `1px solid ${C.line}` }}>
          <SoftBtn onClick={closeModal}>Vazgeç</SoftBtn>
          <PrimaryBtn onClick={save}><Check size={18} /> Kaydet</PrimaryBtn>
        </div>
      </Modal>
    </ClayPage>
  );
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink3 }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink1, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
