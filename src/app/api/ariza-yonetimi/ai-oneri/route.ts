import { NextRequest, NextResponse } from 'next/server';
import { access, readFile } from 'fs/promises';
import path from 'path';
import { adminDb } from '@/lib/firebase-admin';

type SimilarFaultSummary = {
  id: string;
  model?: string;
  serial?: string;
  faultName?: string;
  faultType?: string;
  status?: string;
  description?: string;
  closeDescription?: string;
  openedAt?: string | null;
  closedAt?: string | null;
};

const AI_SUGGESTION_CACHE_VERSION = 3;

const FAULT_ANALYSIS_GUIDE = `
Aşağıdaki kurumsal servis rehberi, model ve arıza başlığına göre öncelikli kontrol adımlarını içerir. Bunu mevcut prompta EK bilgi olarak kullan.

TEKNİK SERVİS BAŞLIKLARI:
- Photometer Lamp: C 501/C 702 için absorbans >1.4 ise lamba değişimi + Exchange Incubation Water + Cell Blank Measurement öner. Risk: >Abs, ADC.E, test durması/hatalı sonuç.
- Vacuum Tank: C 501/C 702/E 801; sadece drain ile bırakma, filtre/kaçak valf/vakum basıncı kontrolü öner. Risk: rinse köpürme, taşma, MSB/Carriage Lifter kısa devre.
- Rinse Station & Water Bath: tıkanıklık için 0.2mm tel, vakum kontrolü, C serisinde Clean Incubation Bath Manually öner. Risk: su taşması, Rack Transport arızası, >Cuvet.
- Sample/Reagent Probe Up/Down: unclog sonrası probe seal ve Z-ekseni/sensör kontrolü öner. Risk: probe crash/kırılma ve test basımının durması.
- Carriage Lifter/Rack Transport/Carry-In/Axis: sadece resetle geçiştirme; sıvı teması, sensör oksit, kayış aşınması ve Mechanism Check öner. Risk: motor yanması.
- Reagent Bottle Shift & Cap Opener: disk encoder/sensör ayarı + Cap Opener Check öner. Risk: reagent probe kırılması.
- Tip Cup Gripper: E411/E601/E801; pad aşınması/atık yolu tıkanıklığını değerlendir. Risk: sarf düşmesi ve E-Stop.
- Voltage Error: UPS bakımını ve güç dalgalanmasını mutlaka sorgula. Risk: database corrupt, ADC.E yanması.
- Reservoir: Air Purge ve Degasser su tuzağı kontrolünü öner. Risk: air bubble/hatalı pipetleme.

APLİKASYON BAŞLIKLARI:
- Data Alarm & QC Violation: Data Alarms menüsü, taze QC/kalibratör ve bubble kontrolü öner. Risk: QCErr/Cal.E ve masking.
- Calibration Failed: Reagent Pack Changeover ve geçmiş Cal.I/Cal.E durumunu dikkate al; yeni reaktif + yeni kalibratörle baştan kalibrasyon öner.
- Reagent Loading Error & Barcode Read Error: Barcode/RFID Reader Check ve optik cam temizliği öner; E801 için masked port kontrolü.
- System Reagent Shortage (ProCell/CleanCell): warning seviyeleri ve köpük riskini değerlendir; Prime System Reagents Flow Paths öner.
- Probe Clogging: preanalitik santrifüj/pıhtı süreci denetimi ve Sample Probe Wash öner.

Cevap tonuna mutlaka iki vurgu ekle:
1) "Kök neden" adımında geçmişte atlanmış olabilecek kritik kontrolü söyle.
2) "Risk uyarısı" kısmında yüzeysel çözümün yol açabileceği olası klinik/teknik etkileri net belirt.
`;

function toIso(value: any): string | null {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value?._seconds === 'number') return new Date(value._seconds * 1000).toISOString();
  return null;
}

function parseJsonFromModelText(raw: string): any | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function classifyResolution(description?: string | null): 'kalici' | 'gecici' | 'belirsiz' {
  if (!description) return 'belirsiz';
  const d = description.toLocaleLowerCase('tr-TR');
  const permanentHints = ['kalıcı', 'değiştirildi', 'revizyon', 'modül değişimi', 'kart değişimi', 'kök neden', 'tamir edildi'];
  const temporaryHints = ['geçici', 'reset', 'yeniden başlat', 'temizlik', 'idareten', 'beklemeye alındı', 'tekrar edebilir'];

  if (permanentHints.some((x) => d.includes(x))) return 'kalici';
  if (temporaryHints.some((x) => d.includes(x))) return 'gecici';
  return 'belirsiz';
}

function candidateGeminiModels(): string[] {
  const fromEnv = [
    process.env.GEMINI_MODEL,
    process.env.GOOGLE_GENAI_MODEL,
    process.env.NEXT_PUBLIC_GEMINI_MODEL,
  ].filter(Boolean) as string[];

  const defaults = ['gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-1.5-flash-latest', 'gemini-1.5-flash'];
  return Array.from(new Set([...fromEnv, ...defaults]));
}


const MASTER_DOC_FILES = ['teknik-doc-2.txt', 'teknik_doc.txt'];

function candidateMasterDocPaths(): string[] {
  const fromEnv = process.env.AI_MASTER_DOC_PATH?.trim();
  const cwd = process.cwd();

  const baseDirs = [
    path.join(cwd, 'public'),
    '/home/user/studio/public',
    '/home/user/qore.g4/public',
    '/workspace/qore.g4/public',
  ];

  const candidates: string[] = [];
  if (fromEnv) candidates.push(fromEnv);
  for (const file of MASTER_DOC_FILES) {
    for (const dir of baseDirs) {
      candidates.push(path.join(dir, file));
    }
  }
  return candidates;
}

async function resolveMasterDocPath(): Promise<string> {
  const candidates = candidateMasterDocPaths();
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch {
      // continue
    }
  }

  throw new Error(`Master teknik dokümanı bulunamadı. Denenen yollar: ${candidates.join(' | ')}`);
}

async function loadMasterKnowledgeDoc() {
  const sourcePath = await resolveMasterDocPath();
  const text = await readFile(sourcePath, 'utf-8');
  const normalized = text.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    throw new Error(`Master teknik dokümanı boş: ${sourcePath}`);
  }
  // Prompt boyutu için üst limit
  return { text: normalized.slice(0, 60_000), sourcePath };
}

function buildKnowledgeSignature(masterDocText: string, sourcePath: string): string {
  return `master_doc_v2:${path.basename(sourcePath)}:${masterDocText.length}`;
}


function hasUsableAiSuggestion(ai: any): boolean {
  if (!ai || typeof ai !== 'object') return false;
  const hasBrief = typeof ai.briefExplanation === 'string' && ai.briefExplanation.trim().length > 0;
  const hasSummary = typeof ai.summary === 'string' && ai.summary.trim().length > 0;
  const hasCauses = Array.isArray(ai.probableCauses) && ai.probableCauses.length > 0;
  const hasActions = Array.isArray(ai.suggestedActions) && ai.suggestedActions.length > 0;
  const hasEvidence = typeof ai.evidenceBasedRecommendation === 'string' && ai.evidenceBasedRecommendation.trim().length > 0;
  return hasBrief || hasSummary || hasCauses || hasActions || hasEvidence;
}

function buildDeterministicFallbackSuggestion(params: {
  report: any;
  sameFaultGroup: SimilarFaultSummary[];
  closeNotes: Array<{ openedAt?: string | null; description?: string; closeDescription?: string; resolutionClass: 'kalici' | 'gecici' | 'belirsiz' }>;
  resolutionStats: { kalici: number; gecici: number; belirsiz: number };
  debug?: string;
}) {
  const { report, sameFaultGroup, closeNotes, resolutionStats, debug } = params;

  const recent = sameFaultGroup.slice(0, 3).map((f) => f.openedAt).filter(Boolean) as string[];
  const recentText = recent.length > 0
    ? `Bu arıza aynı cihazda daha önce de görüldü (son kayıtlar: ${recent.join(', ')}).`
    : 'Bu arıza için aynı cihazda birebir geçmiş eşleşme sınırlı.';

  const topResolution = resolutionStats.gecici > resolutionStats.kalici
    ? 'geçici çözümler ağırlıkta'
    : resolutionStats.kalici > 0
      ? 'kalıcı çözümler mevcut'
      : 'çözüm tipi belirsiz';

  const closeHints = closeNotes
    .map((n) => (n.closeDescription || '').trim())
    .filter(Boolean)
    .slice(0, 2);

  const actions = [
    'Aynı seri numaradaki geçmiş kapanış notlarında tekrar eden adımı doğrulayın ve sadece reset/temizlik ile kapatmayın.',
    'Master teknik dokümandaki ilgili başlık için önerilen kontrol/check menüsünü eksiksiz uygulayın.',
    'Geçmişte geçici kapanmış vakalarda ilgili parça değişimi veya mekanik sensör kontrolünü değerlendirin.',
  ];

  const freqText = sameFaultGroup.length > 0
    ? `Bu seri numaradaki cihazda aynı/benzer kategorideki arıza geçmişte ${sameFaultGroup.length} kez kayıt altına alındı (toplam ${resolutionStats.kalici + resolutionStats.gecici + resolutionStats.belirsiz} kapanmış kayıt).`
    : 'Bu seri numaradaki cihazda aynı kategoride birebir geçmiş kayıt bulunamadı.';
  const resolutionText = resolutionStats.gecici > resolutionStats.kalici
    ? 'Geçmiş kapanışlar daha çok geçici müdahalelerle (reset/temizlik) sonuçlanmış görünüyor.'
    : resolutionStats.kalici > 0
      ? 'Geçmiş kapanışlarda parça değişimi/revizyon gibi kalıcı çözümler uygulanmış.'
      : 'Geçmiş kapanış notları, çözüm tipini netleştirmek için yeterli detayda değil.';
  const docHint = 'Master teknik dokümandaki ilgili başlığa göre önerilen kontrol/check menüsünü ve sensör/parça kontrollerini eksiksiz uygulayın; sadece yüzeysel reset ile kapatmayın.';

  return {
    briefExplanation: `${freqText} ${resolutionText} ${docHint}`,
    summary: `${report.model || 'Cihaz'} (${report.serial || '-'}) için ${report.faultName || report.description || 'arıza'} analiz edildi. ${recentText}`,
    probableCauses: [
      'Geçmişte benzer semptomlarda kök neden adımı atlanmış olabilir.',
      'Aynı seri geçmişinde tekrarlayan hata örüntüsü olabilir.',
    ],
    suggestedActions: actions,
    chronicInsight: `Aynı seri geçmişine göre bu arıza için ${topResolution}.`,
    resolutionAssessment: `Geçmiş kapanış dağılımı — Kalıcı: ${resolutionStats.kalici}, Geçici: ${resolutionStats.gecici}, Belirsiz: ${resolutionStats.belirsiz}.`,
    evidenceBasedRecommendation: closeHints.length
      ? `Geçmiş kapanış notu örnekleri: ${closeHints.join(' | ')}. Bu nedenle sadece yüzeysel müdahale yerine kök neden adımını tamamlayın.`
      : 'Kapanış notu kanıtı sınırlı; bir sonraki müdahalede yapılan adımları detaylı kaydederek kalıcı/geçici etkiyi netleştirin.',
    confidence: 62,
    debug: debug ? `fallback_used:${debug}` : 'fallback_used:no_structured_ai',
  };
}

async function requestGeminiSuggestion(context: any) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Sen teknik servis ve aplikasyon ekiplerine destek veren bir arıza asistanısın.
Yalnızca JSON döndür:
{
  "briefExplanation": "Tek paragraf, en fazla 5 cümle. Aşağıdaki kuralları uygula.",
  "summary": "kısa özet",
  "probableCauses": ["..."],
  "suggestedActions": ["..."],
  "chronicInsight": "kronik sorun yorumu",
  "resolutionAssessment": "geçmiş kapatma notlarına göre kalıcı/geçici çözüm analizi",
  "evidenceBasedRecommendation": "ör: X cihazı bu arızayı şu tarihlerde yaşamış, temizlik geçici kalmış; Y parça kontrol/değişim öner",
  "confidence": 0-100
}

briefExplanation kuralları (en kritik alan, müdahale eden personel arıza detayına girer girmez bunu okuyacak):
- Türkçe, tek paragraf, en fazla 5 cümle, akıcı ve teknik bir dil.
- 1. cümle: ilgili seri numaralı cihazın geçmişinde bu arıza başlığı ile aynı veya benzer kategorideki arızaların ne kadar sık görüldüğünü sameFaultCount ve totalPastFaultsForThisDevice değerlerine dayanarak söyle (örn: "bu seri numaradaki cihazda son N kayıtta X kez gözlemlendi" gibi).
- 2-3. cümle: geçmiş kapanış notlarındaki kalıcı/geçici örüntüyü kısa şekilde özetle (kalıcı çözüm yapılmış mı, sadece reset/temizlik mi vb.).
- 4-5. cümle: knowledgeDocs içindeki master teknik dokümandan ilgili başlık için somut çözüm/kontrol adımlarını teknik şekilde anlat (parça, sensör, menü, prosedür ismini ver). Aynı laboratuvarda birlikte çalışan komşu cihazlar arasında risk olabilecek bir durum varsa kısaca belirt.
- Selamlama, doldurma cümleleri ya da "bu arıza için" gibi gevşek başlangıçlar kullanma; ilk cümleden itibaren bilgiye gir.
- Bağlamda olmayan tarih, sayı, parça adı veya prosedür uydurma.

Genel kurallar:
- Türkçe yaz.
- Sadece verilen bağlamı kullan. Bağlamda olmayan sayı/tarih/olgu uydurma.
- "benzer arıza sayısı" söylerken sadece bağlamdaki sameFaultCount değerini esas al.
- Öneriler cihazın TEKİL SERİ NUMARALI geçmişine dayanmalı.
- Teknik servis/aplikasyon için uygulanabilir ve kısa maddeler üret.
- Genel-geçer cümlelerden kaçın; mümkünse tarih ve geçmiş çözüm notundan kanıt ver.
- Emin olmadığında bunu açıkça belirt.

Ek kurumsal rapor/yönergeler:
${FAULT_ANALYSIS_GUIDE}

Bağlam:
${JSON.stringify(context)}`;

  let lastDebug = 'gemini_no_attempt';
  for (const model of candidateGeminiModels()) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1100 },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      lastDebug = `gemini_http_${res.status}:${model}:${err.slice(0, 120)}`;
      if (res.status === 400 || res.status === 404) continue;
      return { debug: lastDebug };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      lastDebug = `gemini_empty_response:${model}`;
      continue;
    }

    const parsed = parseJsonFromModelText(text);
    if (!parsed) {
      lastDebug = `gemini_parse_failed:${model}`;
      continue;
    }

    return parsed;
  }

  return { debug: lastDebug };
}

async function loadDeviceHistoryBySerial(serial: string, reportId: string) {
  const snap = await adminDb.collection('deviceFaultReports').where('serial', '==', serial).orderBy('openedAt', 'desc').limit(120).get();

  const allForDevice: SimilarFaultSummary[] = snap.docs.map((d) => {
    const x = d.data() as any;
    return {
      id: d.id,
      model: x.model,
      serial: x.serial,
      faultName: x.faultName,
      faultType: x.faultType,
      status: x.status,
      description: x.description,
      closeDescription: x.closeDescription,
      openedAt: toIso(x.openedAt),
      closedAt: toIso(x.closedAt),
    };
  });

  return {
    currentDeviceFaults: allForDevice,
    otherFaultsOfSameDevice: allForDevice.filter((f) => f.id !== reportId),
  };
}

type SiblingDevice = {
  id: string;
  brand?: string;
  model?: string;
  cihazAdi?: string;
  seriNumarasi?: string;
  order?: number;
  arizaDurumu?: string;
};

async function loadSiblingDevicesInLab(hospitalId: string, currentDeviceId: string): Promise<SiblingDevice[]> {
  if (!hospitalId) return [];
  try {
    const snap = await adminDb.collection('devices').where('hospitalId', '==', hospitalId).get();
    const list: SiblingDevice[] = snap.docs
      .filter((d) => d.id !== currentDeviceId)
      .map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          brand: x.brand,
          model: x.model,
          cihazAdi: x.cihazAdi,
          seriNumarasi: x.seriNumarasi,
          order: typeof x.order === 'number' ? x.order : Number(x.order) || undefined,
          arizaDurumu: x.arizaDurumu,
        };
      });
    list.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
    return list;
  } catch (err) {
    console.error('Sibling devices alınamadı:', err);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get('reportId');
    const forceRefresh = searchParams.get('force') === '1';

    if (!reportId) {
      return NextResponse.json({ success: false, error: 'reportId gerekli' }, { status: 400 });
    }

    const reportRef = adminDb.collection('deviceFaultReports').doc(reportId);
    const reportSnap = await reportRef.get();
    if (!reportSnap.exists) {
      return NextResponse.json({ success: false, error: 'Arıza kaydı bulunamadı' }, { status: 404 });
    }

    const report = reportSnap.data() as any;
    const serial = (report?.serial || '').trim();
    if (!serial) {
      return NextResponse.json({ success: false, error: 'Arıza kaydında seri numarası bulunamadı' }, { status: 400 });
    }

    const { text: masterDocText, sourcePath: masterDocPath } = await loadMasterKnowledgeDoc();
    const knowledgeSignature = buildKnowledgeSignature(masterDocText, masterDocPath);

    const cachedSuggestion = report?.aiSuggestion;
    const cacheVersionMatches = Number(cachedSuggestion?.cacheVersion || 0) === AI_SUGGESTION_CACHE_VERSION;
    const knowledgeMatches = (cachedSuggestion?.knowledgeSignature || '') === knowledgeSignature;
    if (!forceRefresh && cachedSuggestion && typeof cachedSuggestion === 'object' && cacheVersionMatches && knowledgeMatches) {
      return NextResponse.json({ success: true, cached: true, data: cachedSuggestion });
    }

    const [{ otherFaultsOfSameDevice }, siblingDevices] = await Promise.all([
      loadDeviceHistoryBySerial(serial, reportId),
      loadSiblingDevicesInLab(report?.hospitalId || '', report?.deviceId || ''),
    ]);

    const sameFaultGroup = otherFaultsOfSameDevice.filter((f) => (f.faultName || null) === (report.faultName || null) && (f.faultType || null) === (report.faultType || null));

    const closeNotes = await Promise.all(otherFaultsOfSameDevice.slice(0, 40).map(async (f) => {
      const historySnap = await adminDb.collection('deviceFaultReports').doc(f.id).collection('history').get();
      const closedEntry = historySnap.docs
        .map((d) => d.data() as any)
        .filter((x) => x.type === 'closed' && x.description)
        .sort((a, b) => (b.timestamp?._seconds || 0) - (a.timestamp?._seconds || 0))[0];

      return {
        id: f.id,
        openedAt: f.openedAt,
        faultName: f.faultName,
        faultType: f.faultType,
        description: f.description || '',
        closeDescription: f.closeDescription || closedEntry?.description || '',
        resolutionClass: classifyResolution(f.closeDescription || closedEntry?.description || ''),
      };
    }));

    const resolutionStats = closeNotes.reduce(
      (acc, note) => {
        acc[note.resolutionClass] += 1;
        return acc;
      },
      { kalici: 0, gecici: 0, belirsiz: 0 }
    );

    const context = {
      constraints: {
        deviceScopedBy: 'serial',
        serial,
        sameFaultCount: sameFaultGroup.length,
        totalPastFaultsForThisDevice: otherFaultsOfSameDevice.length,
        siblingDeviceCount: siblingDevices.length,
      },
      currentFault: {
        id: reportId,
        model: report.model || null,
        serial,
        faultType: report.faultType || null,
        faultName: report.faultName || null,
        title: report.title || null,
        description: report.description || null,
        openedAt: toIso(report.openedAt),
        labName: report.labName || null,
        hospitalId: report.hospitalId || null,
      },
      siblingDevicesInSameLab: siblingDevices.slice(0, 30).map((s) => ({
        brand: s.brand || null,
        model: s.model || null,
        cihazAdi: s.cihazAdi || null,
        seriNumarasi: s.seriNumarasi || null,
        order: s.order ?? null,
        arizaDurumu: s.arizaDurumu || 'yok',
      })),
      sameFaultHistory: sameFaultGroup.slice(0, 20).map((f) => ({
        id: f.id,
        openedAt: f.openedAt,
        closedAt: f.closedAt,
        description: f.description,
        closeDescription: f.closeDescription,
      })),
      otherFaultHistorySameDevice: otherFaultsOfSameDevice.slice(0, 25).map((f) => ({
        id: f.id,
        faultName: f.faultName,
        faultType: f.faultType,
        openedAt: f.openedAt,
        description: f.description,
        closeDescription: f.closeDescription,
      })),
      closeNotes,
      resolutionStats,
      knowledgeDocs: [{
        name: 'Master Teknik Doküman',
        type: 'txt',
        source: masterDocPath,
        text: masterDocText,
      }],
    };

    const ai = await requestGeminiSuggestion(context);
    const normalizedAi = hasUsableAiSuggestion(ai)
      ? ai
      : buildDeterministicFallbackSuggestion({
          report,
          sameFaultGroup,
          closeNotes,
          resolutionStats,
          debug: ai?.debug,
        });

    const suggestionPayload = {
      ...normalizedAi,
      similarFaultStats: {
        total: otherFaultsOfSameDevice.length,
        sameModelCount: otherFaultsOfSameDevice.filter((f) => (f.model || null) === (report.model || null)).length,
        sameTitleCategoryCount: sameFaultGroup.length,
        resolvedCount: otherFaultsOfSameDevice.filter((f) => ['cozuldu', 'closed'].includes(f.status || '')).length,
      },
      resolutionStats,
      generatedAt: new Date().toISOString(),
      cacheVersion: AI_SUGGESTION_CACHE_VERSION,
      scopeSerial: serial,
      knowledgeSignature,
    };

    await reportRef.update({
      aiSuggestion: suggestionPayload,
      aiSuggestionUpdatedAt: new Date(),
    });

    return NextResponse.json({ success: true, cached: false, data: suggestionPayload });
  } catch (error: any) {
    console.error('AI öneri oluşturma hatası:', error);
    return NextResponse.json({ success: false, error: error.message || 'AI öneri alınamadı' }, { status: 500 });
  }
}
