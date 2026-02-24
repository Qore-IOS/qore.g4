import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

type SimilarFaultSummary = {
  id: string;
  model?: string;
  faultName?: string;
  faultType?: string;
  status?: string;
  description?: string;
  closeDescription?: string;
  openedAt?: string | null;
  closedAt?: string | null;
};

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

async function requestGeminiSuggestion(context: any) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Sen teknik servis ve aplikasyon ekiplerine destek veren bir arıza asistanısın.
Yalnızca JSON döndür:
{
  "summary": "kısa özet",
  "probableCauses": ["..."],
  "suggestedActions": ["..."],
  "chronicInsight": "kronik sorun yorumu",
  "resolutionAssessment": "geçmiş kapatma notlarına göre kalıcı/geçici çözüm analizi",
  "confidence": 0-100
}

Kurallar:
- Türkçe yaz.
- Teknik servis/aplikasyon için uygulanabilir ve kısa maddeler üret.
- Model/marka + açıklama + geçmiş benzer arıza + kapatma notlarını birlikte değerlendir.
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
        generationConfig: { temperature: 0.2, maxOutputTokens: 1000 },
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
    const cachedSuggestion = report?.aiSuggestion;
    if (!forceRefresh && cachedSuggestion && typeof cachedSuggestion === 'object') {
      return NextResponse.json({
        success: true,
        cached: true,
        data: cachedSuggestion,
      });
    }

    const [sameModelSnap, sameTitleCategorySnap] = await Promise.all([
      report.model
        ? adminDb.collection('deviceFaultReports').where('model', '==', report.model).orderBy('openedAt', 'desc').limit(40).get()
        : Promise.resolve(null),
      report.faultName
        ? adminDb.collection('deviceFaultReports')
          .where('faultName', '==', report.faultName)
          .where('faultType', '==', report.faultType)
          .orderBy('openedAt', 'desc')
          .limit(40)
          .get()
        : Promise.resolve(null),
    ]);

    const combined = new Map<string, SimilarFaultSummary>();
    const addDocs = (snap: FirebaseFirestore.QuerySnapshot | null) => {
      if (!snap) return;
      snap.docs.forEach((d) => {
        if (d.id === reportId) return;
        const x = d.data() as any;
        combined.set(d.id, {
          id: d.id,
          model: x.model,
          faultName: x.faultName,
          faultType: x.faultType,
          status: x.status,
          description: x.description,
          closeDescription: x.closeDescription,
          openedAt: toIso(x.openedAt),
          closedAt: toIso(x.closedAt),
        });
      });
    };

    addDocs(sameModelSnap as FirebaseFirestore.QuerySnapshot | null);
    addDocs(sameTitleCategorySnap as FirebaseFirestore.QuerySnapshot | null);

    const similarFaults = Array.from(combined.values()).slice(0, 20);

    const closeNotes = await Promise.all(similarFaults.slice(0, 12).map(async (f) => {
      const historySnap = await adminDb.collection('deviceFaultReports').doc(f.id).collection('history').get();
      const closedEntry = historySnap.docs
        .map((d) => d.data() as any)
        .filter((x) => x.type === 'closed' && x.description)
        .sort((a, b) => (b.timestamp?._seconds || 0) - (a.timestamp?._seconds || 0))[0];

      return {
        id: f.id,
        closeDescription: f.closeDescription || closedEntry?.description || '',
      };
    }));

    const resolutionStats = closeNotes.reduce(
      (acc, note) => {
        const bucket = classifyResolution(note.closeDescription);
        acc[bucket] += 1;
        return acc;
      },
      { kalici: 0, gecici: 0, belirsiz: 0 }
    );

    const context = {
      currentFault: {
        id: reportId,
        marka: report.brand || null,
        model: report.model || null,
        serial: report.serial || null,
        faultType: report.faultType || null,
        faultName: report.faultName || null,
        title: report.title || null,
        description: report.description || null,
      },
      similarFaultStats: {
        total: similarFaults.length,
        sameModelCount: sameModelSnap?.docs.filter((d) => d.id !== reportId).length || 0,
        sameTitleCategoryCount: sameTitleCategorySnap?.docs.filter((d) => d.id !== reportId).length || 0,
        resolvedCount: similarFaults.filter((f) => ['cozuldu', 'closed'].includes(f.status || '')).length,
      },
      resolutionStats,
      sampleSimilarFaults: similarFaults.slice(0, 10).map((f) => ({
        model: f.model,
        faultName: f.faultName,
        faultType: f.faultType,
        description: f.description,
        closeDescription: f.closeDescription,
        status: f.status,
      })),
      sampleCloseNotes: closeNotes.slice(0, 8),
    };

    const ai = await requestGeminiSuggestion(context);
    const suggestionPayload = {
      ...ai,
      similarFaultStats: context.similarFaultStats,
      resolutionStats,
      generatedAt: new Date().toISOString(),
    };

    await reportRef.update({
      aiSuggestion: suggestionPayload,
      aiSuggestionUpdatedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      cached: false,
      data: suggestionPayload,
    });
  } catch (error: any) {
    console.error('AI öneri oluşturma hatası:', error);
    return NextResponse.json({ success: false, error: error.message || 'AI öneri alınamadı' }, { status: 500 });
  }
}
