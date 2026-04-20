import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';

let _fontBase64: string | null = null;
let _headerLogo: string | null = null;
let _sysLogo: string | null = null;
let _labPools: { data: any[]; ts: number } | null = null;
const LAB_POOLS_TTL = 5 * 60_000;

async function fetchDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function loadTurkishFont(): Promise<string | null> {
  if (_fontBase64) return _fontBase64;
  try {
    const resp = await fetch('https://fonts.gstatic.com/s/notosans/v36/o-0IIpQlx3QUlC5A4PNr5TRA.ttf');
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => {
        _fontBase64 = (reader.result as string).split(',')[1];
        resolve(_fontBase64);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function loadHeaderLogo(): Promise<string | null> {
  if (_headerLogo) return _headerLogo;
  _headerLogo = await fetchDataUrl('/invlogo.png');
  if (!_headerLogo) _headerLogo = await fetchDataUrl('/invitrolab_LOGO__-_Kopya__1_-removebg.png');
  return _headerLogo;
}

export async function loadSysLogo(): Promise<string | null> {
  if (_sysLogo) return _sysLogo;
  _sysLogo = await fetchDataUrl('/newlogoblk.png');
  return _sysLogo;
}

async function loadLabPools(): Promise<any[]> {
  if (_labPools && Date.now() - _labPools.ts < LAB_POOLS_TTL) return _labPools.data;
  const snap = await getDocs(collection(db, 'labPools'));
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _labPools = { data, ts: Date.now() };
  return data;
}

export async function resolveLabDisplayName(hospitalId: string | undefined, hospitalName: string): Promise<string> {
  if (!hospitalId) return hospitalName;
  try {
    const allPools = await loadLabPools();
    const match = allPools.find((p: any) => p.active && p.memberIds?.includes(hospitalId));
    if (match) {
      const pool = match as any;
      if (pool.mainLabId && pool.mainLabId !== hospitalId) {
        const mainLabDoc = await getDoc(doc(db, 'hospitals', pool.mainLabId));
        if (mainLabDoc.exists()) {
          return `${mainLabDoc.data().name} - ${hospitalName}`;
        }
      }
    }
  } catch (e) {
    console.error('Could not resolve pool main lab:', e);
  }
  return hospitalName;
}

export async function computeFormNo(
  collectionName: string,
  uidField: string,
  uid: string,
  currentDocId: string,
  personName: string,
  typeChar: string,
  timestampField: string = 'createdAt'
): Promise<string> {
  try {
    const initials = personName.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase()).join('');
    const q = query(collection(db, collectionName), where(uidField, '==', uid));
    const snap = await getDocs(q);
    const sorted = snap.docs.slice().sort((a, b) => {
      const ta = a.data()[timestampField]?.toMillis?.() || 0;
      const tb = b.data()[timestampField]?.toMillis?.() || 0;
      return ta - tb;
    });
    const idx = sorted.findIndex(d => d.id === currentDocId);
    const ordinal = idx >= 0 ? idx + 1 : sorted.length + 1;
    return `${initials}-${typeChar}${String(ordinal).padStart(4, '0')}`;
  } catch (e) {
    console.error('Could not compute formNo:', e);
    return currentDocId;
  }
}

export type PdfAssets = {
  fontBase64: string | null;
  headerLogo: string | null;
  sysLogo: string | null;
};

export async function prefetchPdfAssets(): Promise<PdfAssets> {
  const [fontBase64, headerLogo, sysLogo] = await Promise.all([
    loadTurkishFont(),
    loadHeaderLogo(),
    loadSysLogo(),
  ]);
  return { fontBase64, headerLogo, sysLogo };
}
