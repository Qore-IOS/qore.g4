import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { adminDb } from '../../../../lib/firebase-admin';
import * as admin from 'firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FaultType = 'teknik_servis' | 'aplikasyon';
type Priority = 'dusuk' | 'normal' | 'yuksek' | 'kritik';

type IncomingMessage = {
  messageId: string;
  groupId: string;
  sender?: string | null;
  caption: string;
  imageUrl?: string | null;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  raw: any;
};

type AiExtraction = {
  moduleCode?: string | null;
  alarmCode?: string | null;
  alarmName?: string | null;
  faultLevel?: string | null;
  description?: string | null;
  remedy?: string[];
  faultType?: FaultType | null;
  priority?: Priority | null;
  confidence?: number | null;
  summary?: string | null;
  technicalReasoning?: string | null;
};

type DeviceMatch = {
  deviceId: string;
  data: FirebaseFirestore.DocumentData;
  score: number;
  reasons: string[];
};

const SOURCE_GROUP_ID = '905362840155-1615537145@g.us';
const SOURCE_GROUP_NAME = 'Göztepe Merkez lab Line';
const DEFAULT_HOSPITAL_NAME = 'Göztepe Merkez';
const BOT_ACTOR_UID = 'whatsapp-ai';
const BOT_ACTOR_NAME = 'WhatsApp AI';
const DOC_CHAR_LIMIT = 70_000;

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactText(text: string): string {
  return text.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractLineNo(text: string): number | null {
  const normalized = normalizeText(text);
  const match = normalized.match(/(?:line|hat|l)\s*([0-9]{1,2})\b/) || normalized.match(/\b([0-9]{1,2})\s*(?:line|hat)\b/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeModuleCode(value?: string | null): string | null {
  const text = normalizeText(value || '').toUpperCase();
  const match = text.match(/\b(AU\s*[0-9]+|E\s*[0-9]+|C\s*[0-9]+|ISE|SU|MSB\s*[0-9]*|CONTROL\s*UNIT)\b/);
  return match ? match[1].replace(/\s+/g, '') : null;
}

function parseJsonObject(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function getFirstString(payload: any, paths: string[][]): string | null {
  for (const pathParts of paths) {
    let current = payload;
    for (const part of pathParts) current = current?.[part];
    if (typeof current === 'string' && current.trim()) return current.trim();
  }
  return null;
}

function isImagePayload(payload: any): boolean {
  const type = String(payload?.type || payload?.message?.type || payload?.data?.type || payload?.media?.type || '').toLowerCase();
  const mime = String(payload?.mime_type || payload?.mimetype || payload?.mimeType || payload?.media?.mime_type || payload?.media?.mimetype || '').toLowerCase();
  return type.includes('image') || mime.startsWith('image/');
}

function parseIncomingPayload(payload: any): IncomingMessage {
  const messageId = getFirstString(payload, [
    ['messageId'], ['id'], ['message_id'], ['data', 'id'], ['data', 'messageId'], ['message', 'id'], ['message', 'messageId'],
  ]) || `manual-${Date.now()}`;

  const groupId = getFirstString(payload, [
    ['groupId'], ['chatId'], ['from'], ['to'], ['data', 'from'], ['data', 'chatId'], ['message', 'from'], ['message', 'chatId'],
  ]) || '';

  const caption = getFirstString(payload, [
    ['caption'], ['body'], ['text'], ['message'], ['data', 'caption'], ['data', 'body'], ['data', 'text'], ['message', 'caption'], ['message', 'body'],
  ]) || '';

  const imageUrl = getFirstString(payload, [
    ['imageUrl'], ['mediaUrl'], ['media'], ['url'], ['data', 'media'], ['data', 'mediaUrl'], ['data', 'imageUrl'], ['media', 'url'], ['message', 'media'], ['message', 'mediaUrl'],
  ]);

  const imageBase64 = getFirstString(payload, [
    ['imageBase64'], ['base64'], ['data', 'base64'], ['media', 'base64'], ['message', 'base64'],
  ]);

  const imageMimeType = getFirstString(payload, [
    ['imageMimeType'], ['mimeType'], ['mimetype'], ['mime_type'], ['data', 'mimeType'], ['data', 'mimetype'], ['media', 'mime_type'], ['media', 'mimetype'],
  ]) || 'image/jpeg';

  return {
    messageId,
    groupId,
    sender: getFirstString(payload, [['sender'], ['author'], ['from'], ['data', 'author'], ['message', 'author']]),
    caption,
    imageUrl: isImagePayload(payload) ? imageUrl : imageUrl,
    imageBase64,
    imageMimeType,
    raw: payload,
  };
}

async function readLocalKnowledgeDocs(): Promise<{ master: string; teknikDoc: string }> {
  const cwd = process.cwd();
  const [masterRaw, teknikRaw] = await Promise.all([
    readFile(path.join(cwd, 'docs', 'whatsapp-fault-ai-master.md'), 'utf8'),
    readFile(path.join(cwd, 'public', 'teknik-doc-2.txt'), 'utf8'),
  ]);

  return {
    master: compactText(masterRaw).slice(0, DOC_CHAR_LIMIT),
    teknikDoc: compactText(teknikRaw).slice(0, DOC_CHAR_LIMIT),
  };
}

async function downloadImageAsBase64(imageUrl?: string | null): Promise<{ base64: string; mimeType: string } | null> {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Görsel indirilemedi (${res.status}).`);
  const mimeType = res.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await res.arrayBuffer();
  return { base64: Buffer.from(arrayBuffer).toString('base64'), mimeType };
}

function candidateGeminiModels(): string[] {
  const fromEnv = [process.env.GEMINI_MODEL, process.env.GOOGLE_GENAI_MODEL, process.env.NEXT_PUBLIC_GEMINI_MODEL].filter(Boolean) as string[];
  return Array.from(new Set([...fromEnv, 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.5-flash-lite']));
}

async function extractAlarmWithAi(input: IncomingMessage, lineNo: number, docs: { master: string; teknikDoc: string }): Promise<AiExtraction> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY veya GOOGLE_API_KEY tanımlı değil; görsel/teknik doküman yorumlanamaz.');
  }

  const downloaded = input.imageBase64 ? null : await downloadImageAsBase64(input.imageUrl);
  const imageBase64 = input.imageBase64 || downloaded?.base64;
  const imageMimeType = input.imageMimeType || downloaded?.mimeType || 'image/jpeg';

  const prompt = `
Sen Qore için WhatsApp kaynaklı Roche cihaz arıza alım motorusun.

Zorunlu kurallar:
- Sadece verilen WhatsApp mesajını, fotoğrafı ve aşağıdaki iki teknik dokümanı kullan.
- Master doküman: WhatsApp line/module eşleştirme ve AI karar kurallarıdır.
- Teknik doküman: /public/teknik-doc-2.txt içeriğidir; somut prosedür, menü, alarm ve parça adlarını buradan al.
- Uydurma seri numarası, cihaz adı, tarih, parça kodu veya menü adı üretme.
- moduleCode alanını ekrandaki Module kolonundan veya alarm detayından oku: AU1, AU2, AU3, AU4, SU, MSB1, Control Unit vb.
- alarmCode, alarmName, faultLevel, description ve remedy alanlarını ekrandan oku.
- faultType teknik_servis veya aplikasyon olmalı. Stop/E.Stop/S.Stop, mekanik hareket, probe, rack/line taşıma, wash/pressure tekrarları teknik_servis eğilimlidir; QC, cell blank, reagent, kalibrasyon, preanalitik ve assay yorumu aplikasyon eğilimlidir.
- priority dusuk, normal, yuksek veya kritik olmalı. E.Stop/S.Stop kritik; Stop yuksek; Caution normal veya bağlama göre yuksek.
- JSON dışında metin döndürme.

WhatsApp caption: ${JSON.stringify(input.caption)}
Normalize lineNo: ${lineNo}

MASTER_DOKUMAN:
${docs.master}

TEKNIK_DOC_2:
${docs.teknikDoc}

Beklenen JSON şeması:
{
  "moduleCode": "AU3",
  "alarmCode": "006-000012",
  "alarmName": "Sample Probe",
  "faultLevel": "E.Stop",
  "description": "...",
  "remedy": ["..."],
  "faultType": "teknik_servis",
  "priority": "kritik",
  "confidence": 0.0,
  "summary": "kısa teknik özet",
  "technicalReasoning": "master.md ve teknik-doc-2.txt dayanaklı kısa gerekçe"
}`.trim();

  const parts: any[] = [{ text: prompt }];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: imageMimeType, data: imageBase64 } });
  }

  let lastError = 'gemini_no_attempt';
  for (const model of candidateGeminiModels()) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2400, responseMimeType: 'application/json' },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      lastError = `gemini_http_${res.status}:${model}:${errText.slice(0, 160)}`;
      if (res.status === 400 || res.status === 404) continue;
      continue;
    }

    const payload = await res.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = typeof text === 'string' ? parseJsonObject(text) : null;
    if (parsed) {
      const moduleCode = normalizeModuleCode(parsed.moduleCode);
      return {
        moduleCode,
        alarmCode: parsed.alarmCode || null,
        alarmName: parsed.alarmName || null,
        faultLevel: parsed.faultLevel || null,
        description: parsed.description || null,
        remedy: Array.isArray(parsed.remedy) ? parsed.remedy.map((x: any) => String(x)).filter(Boolean).slice(0, 8) : [],
        faultType: parsed.faultType === 'aplikasyon' ? 'aplikasyon' : 'teknik_servis',
        priority: ['dusuk', 'normal', 'yuksek', 'kritik'].includes(parsed.priority) ? parsed.priority : 'normal',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        summary: parsed.summary || null,
        technicalReasoning: parsed.technicalReasoning || null,
      };
    }
    lastError = `gemini_invalid_json:${model}`;
  }

  throw new Error(`AI alarm ayrıştırması başarısız (${lastError}).`);
}

async function resolveHospital() {
  const snap = await adminDb.collection('hospitals').get();
  const target = normalizeText(DEFAULT_HOSPITAL_NAME);
  const doc = snap.docs.find((d) => normalizeText((d.data() as any).name || d.id).includes(target) || target.includes(normalizeText((d.data() as any).name || d.id)));
  if (doc) return { id: doc.id, data: doc.data() };
  return { id: '', data: { name: DEFAULT_HOSPITAL_NAME } };
}

function deviceMatchesLine(data: FirebaseFirestore.DocumentData, lineNo: number): boolean {
  const candidates = [data.lineNo, data.line, data.lineName, data.labLine, data.hatNo, data.hat, data.cihazAdi, data.model, data.name, data.deviceName]
    .filter((x) => x !== undefined && x !== null)
    .map(String);
  return candidates.some((candidate) => extractLineNo(candidate) === lineNo || normalizeText(candidate).includes(`line ${lineNo}`) || normalizeText(candidate).includes(`hat ${lineNo}`));
}

function deviceMatchesModule(data: FirebaseFirestore.DocumentData, moduleCode: string): boolean {
  const normalizedModule = normalizeModuleCode(moduleCode);
  if (!normalizedModule) return false;
  const candidates = [data.moduleCode, data.module, data.modul, data.modulKodu, data.cihazAdi, data.model, data.name, data.deviceName]
    .filter((x) => x !== undefined && x !== null)
    .map((x) => normalizeModuleCode(String(x)) || normalizeText(x).toUpperCase().replace(/\s+/g, ''));
  return candidates.some((candidate) => candidate.includes(normalizedModule));
}

async function matchDevice(hospitalId: string, lineNo: number, moduleCode: string): Promise<DeviceMatch | null> {
  let snap = hospitalId
    ? await adminDb.collection('devices').where('hospitalId', '==', hospitalId).get()
    : await adminDb.collection('devices').limit(1000).get();

  if (snap.empty) snap = await adminDb.collection('devices').limit(1000).get();

  const matches: DeviceMatch[] = [];
  snap.docs.forEach((doc) => {
    const data = doc.data();
    let score = 0;
    const reasons: string[] = [];
    if (hospitalId && data.hospitalId === hospitalId) { score += 4; reasons.push('hospitalId'); }
    if (deviceMatchesLine(data, lineNo)) { score += 5; reasons.push('lineNo'); }
    if (deviceMatchesModule(data, moduleCode)) { score += 6; reasons.push('moduleCode'); }
    if (score >= 10) matches.push({ deviceId: doc.id, data, score, reasons });
  });

  matches.sort((a, b) => b.score - a.score);
  return matches[0] || null;
}

async function sendWhatsAppText(to: string, body: string): Promise<{ success: boolean; error?: string }> {
  const instanceId = process.env.ULTRAMSG_INSTANCE_ID || process.env.WHATSAPP_INSTANCE_ID || process.env.WHATSAPP_ULTRAMSG_INSTANCE_ID;
  const token = process.env.ULTRAMSG_TOKEN || process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ULTRAMSG_TOKEN;
  if (!instanceId || !token) return { success: false, error: 'WhatsApp env config eksik' };

  const res = await fetch(`https://api.ultramsg.com/${instanceId}/messages/chat?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, body }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && (data.sent === true || data.sent === 'true' || data.id)) return { success: true };
  return { success: false, error: data.error ? String(data.error) : JSON.stringify(data).slice(0, 300) };
}

function buildFaultDescription(ai: AiExtraction, input: IncomingMessage, lineNo: number): string {
  const remedy = ai.remedy?.length ? `\n\nRemedy:\n- ${ai.remedy.join('\n- ')}` : '';
  return [
    `WhatsApp AI otomatik arıza alımı`,
    `Line: ${lineNo}`,
    ai.moduleCode ? `Modül: ${ai.moduleCode}` : null,
    ai.alarmCode ? `Kod: ${ai.alarmCode}` : null,
    ai.faultLevel ? `Seviye: ${ai.faultLevel}` : null,
    ai.alarmName ? `Alarm: ${ai.alarmName}` : null,
    ai.description ? `Açıklama: ${ai.description}` : null,
    ai.summary ? `Özet: ${ai.summary}` : null,
    ai.technicalReasoning ? `AI gerekçe: ${ai.technicalReasoning}` : null,
    input.caption ? `WhatsApp mesajı: ${input.caption}` : null,
  ].filter(Boolean).join('\n') + remedy;
}

async function createFaultReport(input: IncomingMessage, lineNo: number, ai: AiExtraction, hospital: { id: string; data: any }, device: DeviceMatch | null) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const description = buildFaultDescription(ai, input, lineNo);
  const deviceData = device?.data || {};
  const hospitalName = hospital.data?.name || DEFAULT_HOSPITAL_NAME;
  const faultType: FaultType = ai.faultType || 'teknik_servis';

  const report = {
    source: 'whatsapp_ai',
    sourceGroupId: SOURCE_GROUP_ID,
    sourceGroupName: SOURCE_GROUP_NAME,
    incomingWhatsAppMessageId: input.messageId,
    incomingSender: input.sender || null,
    incomingCaption: input.caption || null,
    incomingImageUrl: input.imageUrl || null,
    hospitalId: hospital.id || deviceData.hospitalId || null,
    labName: hospitalName,
    lineNo,
    moduleCode: ai.moduleCode || null,
    deviceId: device?.deviceId || null,
    model: deviceData.cihazAdi || deviceData.model || deviceData.name || `${hospitalName} Line ${lineNo} ${ai.moduleCode || ''}`.trim(),
    serial: deviceData.seriNumarasi || deviceData.serial || null,
    faultType,
    faultDefinitionId: null,
    faultName: ai.alarmName || ai.alarmCode || 'WhatsApp AI arıza',
    description,
    status: 'atama_bekliyor',
    title: `${hospitalName} • Line ${lineNo}${ai.moduleCode ? ` • ${ai.moduleCode}` : ''} • ${ai.alarmName || ai.alarmCode || 'WhatsApp AI Arıza'}`,
    openedAt: now,
    openedByUid: BOT_ACTOR_UID,
    openedByName: BOT_ACTOR_NAME,
    assignedAt: null,
    assignedToUid: null,
    assignedToName: null,
    interventionType: null,
    interventionStartedAt: null,
    locationVerifiedAt: null,
    relatedTests: [],
    stopLevel: ai.faultLevel || null,
    aiExtraction: ai,
    aiConfidence: ai.confidence ?? null,
    autoMatchedDevice: !!device,
    deviceMatchReasons: device?.reasons || [],
    createdAt: now,
  };

  const existing = await adminDb.collection('whatsappFaultIntakeLogs').doc(input.messageId).get();
  if (existing.exists && existing.data()?.faultReportId) {
    return { reportId: existing.data()?.faultReportId as string, duplicate: true, report };
  }

  const reportRef = await adminDb.collection('deviceFaultReports').add(report);
  await reportRef.collection('history').add({
    type: 'opened',
    actorUid: BOT_ACTOR_UID,
    actorName: BOT_ACTOR_NAME,
    description,
    timestamp: now,
    source: 'whatsapp_ai',
  });

  if (device?.deviceId) {
    await adminDb.collection('devices').doc(device.deviceId).set({
      arizaDurumu: faultType,
      arizaAciklamasi: description,
      lastWhatsappAiFaultId: reportRef.id,
    }, { merge: true });
  }

  await adminDb.collection('whatsappFaultIntakeLogs').doc(input.messageId).set({
    status: 'created',
    faultReportId: reportRef.id,
    sourceGroupId: input.groupId,
    lineNo,
    moduleCode: ai.moduleCode || null,
    deviceId: device?.deviceId || null,
    aiExtraction: ai,
    raw: input.raw,
    createdAt: now,
  }, { merge: true });

  return { reportId: reportRef.id, duplicate: false, report };
}

function buildSuccessReply(reportId: string, lineNo: number, ai: AiExtraction, device: DeviceMatch | null, duplicate: boolean): string {
  return [
    duplicate ? 'ℹ️ Bu WhatsApp mesajı için arıza kaydı zaten oluşturulmuş.' : '✅ WhatsApp AI arıza kaydı oluşturuldu.',
    '',
    `Kurum: ${DEFAULT_HOSPITAL_NAME}`,
    `Line: ${lineNo}`,
    ai.moduleCode ? `Modül: ${ai.moduleCode}` : null,
    device?.data?.cihazAdi || device?.data?.model ? `Cihaz: ${device.data.cihazAdi || device.data.model}` : null,
    device?.data?.seriNumarasi || device?.data?.serial ? `Seri No: ${device.data.seriNumarasi || device.data.serial}` : null,
    ai.alarmCode ? `Kod: ${ai.alarmCode}` : null,
    ai.alarmName ? `Alarm: ${ai.alarmName}` : null,
    ai.faultLevel ? `Seviye: ${ai.faultLevel}` : null,
    `Birim: ${(ai.faultType || 'teknik_servis') === 'teknik_servis' ? 'Teknik Servis' : 'Aplikasyon'}`,
    `Öncelik: ${ai.priority || 'normal'}`,
    '',
    `Arıza ID: ${reportId}`,
  ].filter(Boolean).join('\n');
}

export async function GET() {
  const docs = await Promise.allSettled([
    readFile(path.join(process.cwd(), 'docs', 'whatsapp-fault-ai-master.md'), 'utf8'),
    readFile(path.join(process.cwd(), 'public', 'teknik-doc-2.txt'), 'utf8'),
  ]);

  return NextResponse.json({
    success: true,
    service: 'whatsapp-fault-intake',
    message: 'Endpoint aktif. WhatsApp webhooklari icin POST kullanilmalidir.',
    accepts: ['POST'],
    sourceGroupId: SOURCE_GROUP_ID,
    sourceGroupName: SOURCE_GROUP_NAME,
    docs: {
      master: docs[0].status === 'fulfilled',
      teknikDoc2: docs[1].status === 'fulfilled',
    },
    env: {
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY),
      ultraMsgConfigured: Boolean(
        (process.env.ULTRAMSG_INSTANCE_ID || process.env.WHATSAPP_INSTANCE_ID || process.env.WHATSAPP_ULTRAMSG_INSTANCE_ID) &&
        (process.env.ULTRAMSG_TOKEN || process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ULTRAMSG_TOKEN)
      ),
    },
  });
}

export async function POST(request: NextRequest) {
  const rawPayload = await request.json().catch(() => null);
  if (!rawPayload) return NextResponse.json({ success: false, error: 'JSON webhook payload gerekli.' }, { status: 400 });

  const incoming = parseIncomingPayload(rawPayload);
  if (incoming.groupId !== SOURCE_GROUP_ID) {
    await adminDb.collection('whatsappFaultIntakeLogs').doc(incoming.messageId).set({
      status: 'ignored_wrong_group',
      sourceGroupId: incoming.groupId || null,
      raw: rawPayload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return NextResponse.json({ success: true, ignored: true, reason: 'wrong_group' });
  }

  const lineNo = extractLineNo(incoming.caption);
  if (!lineNo) {
    const body = '⚠️ Fotoğraf alındı ancak Line bilgisi bulunamadı. Lütfen fotoğraf açıklamasına örn. "Line 7" yazın.';
    const wa = await sendWhatsAppText(SOURCE_GROUP_ID, body).catch((error: any) => ({ success: false, error: error?.message || String(error) }));
    await adminDb.collection('whatsappFaultIntakeLogs').doc(incoming.messageId).set({
      status: 'missing_line',
      sourceGroupId: incoming.groupId,
      raw: rawPayload,
      whatsappReply: wa,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return NextResponse.json({ success: false, error: 'Line bilgisi gerekli.', whatsappReply: wa }, { status: 422 });
  }

  try {
    const docs = await readLocalKnowledgeDocs();
    const ai = await extractAlarmWithAi(incoming, lineNo, docs);
    if (!ai.moduleCode) {
      const body = `⚠️ Line ${lineNo} bilgisi alındı ancak fotoğraftan modül kodu okunamadı. Lütfen AU1/AU2/AU3/AU4 bilgisini yazın.`;
      const wa = await sendWhatsAppText(SOURCE_GROUP_ID, body).catch((error: any) => ({ success: false, error: error?.message || String(error) }));
      await adminDb.collection('whatsappFaultIntakeLogs').doc(incoming.messageId).set({
        status: 'missing_module', lineNo, aiExtraction: ai, raw: rawPayload, whatsappReply: wa, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return NextResponse.json({ success: false, error: 'Modül kodu okunamadı.', ai, whatsappReply: wa }, { status: 422 });
    }

    const hospital = await resolveHospital();
    const device = await matchDevice(hospital.id, lineNo, ai.moduleCode);
    if (!device) {
      const body = `⚠️ Line ${lineNo} ve ${ai.moduleCode} okundu ancak Göztepe Merkez cihaz eşleşmesi bulunamadı. Lütfen cihaz eşleştirme kaydını kontrol edin.`;
      const wa = await sendWhatsAppText(SOURCE_GROUP_ID, body).catch((error: any) => ({ success: false, error: error?.message || String(error) }));
      await adminDb.collection('whatsappFaultIntakeLogs').doc(incoming.messageId).set({
        status: 'device_not_matched', lineNo, moduleCode: ai.moduleCode, aiExtraction: ai, raw: rawPayload, whatsappReply: wa, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return NextResponse.json({ success: false, error: 'Cihaz eşleşmesi bulunamadı.', ai, whatsappReply: wa }, { status: 422 });
    }

    const created = await createFaultReport(incoming, lineNo, ai, hospital, device);
    const reply = buildSuccessReply(created.reportId, lineNo, ai, device, created.duplicate);
    const wa = await sendWhatsAppText(SOURCE_GROUP_ID, reply).catch((error: any) => ({ success: false, error: error?.message || String(error) }));
    await adminDb.collection('whatsappFaultIntakeLogs').doc(incoming.messageId).set({ whatsappReply: wa, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    return NextResponse.json({ success: true, data: { faultReportId: created.reportId, duplicate: created.duplicate, lineNo, moduleCode: ai.moduleCode, deviceId: device.deviceId, whatsappReply: wa } });
  } catch (error: any) {
    await adminDb.collection('whatsappFaultIntakeLogs').doc(incoming.messageId).set({
      status: 'error',
      error: error?.message || String(error),
      raw: rawPayload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return NextResponse.json({ success: false, error: error?.message || 'WhatsApp arıza alımı başarısız.' }, { status: 500 });
  }
}
