'use client';

import React from 'react';
import {
  PL_PRI, PL_PRI_ORDER, PLIco, PlModal, PlModalHead, PlBtn,
  plToday, plAddMin, plToMin, plDurLabel, plWorkMinutes, isoOffset,
  type Task, type Mode, type Accent, type Priority, type TaskInvite,
} from './pl-primitives';

type LaboratoryOption = { id: string; name: string; lat?: number; lng?: number };
type PersonnelOption = { uid: string; name: string; role: string };

interface Props {
  ac: Accent; mode: Mode; open: boolean;
  task: any; onClose: () => void; onSave: (data: any) => void; onDelete: (id: string) => void;
  laboratories: LaboratoryOption[]; personnel: PersonnelOption[];
}

const FieldLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>{children}</div>
);
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', height: 50, padding: '0 16px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-1)', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', outline: 'none' };

const PlTaskModal: React.FC<Props> = ({ ac, mode, open, task, onClose, onSave, onDelete, laboratories, personnel }) => {
  const mobile = mode === 'mobile';
  const editing = task && task.id;
  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const [pri, setPri] = React.useState<Priority>('mid');
  const [date, setDate] = React.useState(plToday());
  const [time, setTime] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [labVisit, setLabVisit] = React.useState(false);
  const [laboratoryId, setLaboratoryId] = React.useState('');
  const [invitees, setInvitees] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (open) {
      setTitle((task && task.title) || '');
      setNote((task && task.note) || '');
      setPri((task && task.pri) || 'mid');
      setDate((task && task.date) || (task && task.presetDate) || plToday());
      setTime((task && task.time) || '');
      setEnd((task && task.end) || '');
      setLabVisit(!!task?.labVisit);
      setLaboratoryId(task?.laboratoryId || '');
      setInvitees((task?.invitations || []).filter((invite: TaskInvite) => invite.status !== 'declined').map((invite: TaskInvite) => invite.uid));
    }
  }, [open, task]);

  if (!open) return null;
  const valid = title.trim().length > 0;
  const selectedLab = laboratories.find((laboratory) => laboratory.id === laboratoryId);
  const invitations: TaskInvite[] = personnel.filter((person) => invitees.includes(person.uid)).map((person) => {
    const existing = (task?.invitations || []).find((invite: TaskInvite) => invite.uid === person.uid);
    return existing || { uid: person.uid, name: person.name, status: 'pending' };
  });
  const save = () => {
    if (!valid || (labVisit && !selectedLab)) return;
    onSave({ id: editing ? task.id : null, title: title.trim(), note: note.trim(), pri, date, time, end,
      labVisit, laboratoryId: labVisit ? selectedLab?.id : '', laboratoryName: labVisit ? selectedLab?.name : '',
      laboratoryLat: labVisit ? selectedLab?.lat : undefined, laboratoryLng: labVisit ? selectedLab?.lng : undefined, invitations });
    onClose();
  };

  return (
    <PlModal open={open} onClose={onClose} width={560} sheet={mobile}>
      <PlModalHead ico={editing ? 'edit' : 'plus'} title={editing ? 'Görevi Düzenle' : 'Yeni Görev'} onClose={onClose} ac={ac} />
      <div style={{ padding: 'clamp(16px,3vw,22px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <FieldLabel>Görev Başlığı</FieldLabel>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ne yapılacak?" autoFocus style={inputStyle} />
        </div>
        <div style={{ padding: 14, borderRadius: 'var(--radius)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, fontWeight: 800, color: 'var(--ink-1)' }}>
            <input type="checkbox" checked={labVisit} onChange={(e) => { setLabVisit(e.target.checked); if (!e.target.checked) setLaboratoryId(''); }} />
            Laboratuvar ziyareti
          </label>
          {labVisit && <div style={{ marginTop: 12 }}>
            <FieldLabel>Laboratuvar</FieldLabel>
            <select value={laboratoryId} onChange={(e) => setLaboratoryId(e.target.value)} style={inputStyle}>
              <option value="">Laboratuvar seçin</option>
              {laboratories.map((laboratory) => <option key={laboratory.id} value={laboratory.id}>{laboratory.name}</option>)}
            </select>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', marginTop: 8 }}>Tamamlama sırasında seçilen laboratuvarın konumunda olduğunuz doğrulanır.</div>
          </div>}
        </div>
        <div>
          <FieldLabel>Eşlik edecek kişiler</FieldLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 156, overflowY: 'auto', padding: 2 }}>
            {personnel.length ? personnel.map((person) => <label key={person.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', cursor: 'pointer' }}>
              <input type="checkbox" checked={invitees.includes(person.uid)} onChange={() => setInvitees((current) => current.includes(person.uid) ? current.filter((uid) => uid !== person.uid) : [...current, person.uid])} />
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: 'var(--ink-1)' }}>{person.name}</span><span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>{person.role.replaceAll('_', ' ')}</span>
            </label>) : <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Uygun personel bulunamadı.</span>}
          </div>
        </div>
        <div>
          <FieldLabel>Not (isteğe bağlı)</FieldLabel>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Detay ekle…" rows={2} style={{ ...inputStyle, height: 'auto', padding: '12px 16px', resize: 'vertical', lineHeight: 1.5 }} />
        </div>
        <div>
          <FieldLabel>Önem Derecesi</FieldLabel>
          <div style={{ display: 'flex', gap: 9 }}>
            {PL_PRI_ORDER.map(pk => {
              const p = PL_PRI[pk], on = pri === pk;
              return (
                <button key={pk} onClick={() => setPri(pk)} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '14px 8px', borderRadius: 'var(--radius)',
                  background: on ? p.card : 'var(--surface-hi)', boxShadow: on ? `inset 0 0 0 2px ${p.solid}, var(--clay-flat)` : 'var(--clay-flat)', transition: 'all 200ms var(--ease-fluid)', transform: on ? 'translateY(-2px)' : 'none' }}>
                  <span style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', background: p.solid, boxShadow: `0 5px 11px -4px ${p.solid}88` }}>{pk === 'high' ? <PLIco.bolt s={15} /> : <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#fff' }} />}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: on ? p.ink : 'var(--ink-2)' }}>{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <FieldLabel>Tarih</FieldLabel>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Başlangıç</FieldLabel>
            <input type="time" value={time} onChange={(e) => { setTime(e.target.value); if (e.target.value && (!end || end <= e.target.value)) setEnd(plAddMin(e.target.value, 30)); }} style={inputStyle} />
          </div>
          <div>
            <FieldLabel>Bitiş</FieldLabel>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} />
          </div>
        </div>
        {time && end && plToMin(end) > plToMin(time) && (
          <div style={{ marginTop: -6, fontSize: 12.5, fontWeight: 700, color: 'var(--ink-2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><PLIco.clock s={13} /> Süre: {plDurLabel(time, end)} · mesai doluluğu {plWorkMinutes(time, end)} dk</div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[{ l: 'Bugün', d: 0 }, { l: 'Yarın', d: 1 }, { l: '+3 gün', d: 3 }, { l: 'Gelecek hafta', d: 7 }].map(q => (
            <button key={q.l} onClick={() => setDate(isoOffset(q.d))} style={{ all: 'unset', cursor: 'pointer', padding: '7px 14px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-2)', boxShadow: 'var(--clay-inset)', color: 'var(--ink-2)', fontSize: 12.5, fontWeight: 700 }}>{q.l}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, padding: '16px clamp(16px,3vw,24px)', borderTop: '1px solid var(--line)' }}>
        {editing && <button onClick={() => { onDelete(task.id); onClose(); }} aria-label="Sil" style={{ all: 'unset', cursor: 'pointer', width: 46, height: 46, borderRadius: 'var(--radius-sm)', display: 'grid', placeItems: 'center', color: 'var(--danger)', background: 'linear-gradient(180deg, var(--surface-hi), var(--surface-2))', boxShadow: 'var(--clay)' }}><PLIco.trash s={18} /></button>}
        <div style={{ flex: 1 }} />
        <PlBtn variant="ghost" ac={ac} onClick={onClose}>Vazgeç</PlBtn>
        <PlBtn variant="primary" ico="check" ac={ac} onClick={save} style={{ opacity: valid ? 1 : 0.5, pointerEvents: valid ? 'auto' : 'none' }}>{editing ? 'Kaydet' : 'Ekle'}</PlBtn>
      </div>
    </PlModal>
  );
};

export default PlTaskModal;
