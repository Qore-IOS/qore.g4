import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import type { Hospital, PurchasingTask } from '@/lib/types';

type AgentAction = {
  type: 'create_task' | 'update_task' | 'delete_task' | 'complete_task' | 'reopen_task' | 'add_assignee' | 'remove_assignee' | 'analyze';
  taskId?: string;
  selector?: string;
  data?: Record<string, any>;
};

type AgentPlan = {
  reply?: string;
  actions?: AgentAction[];
  debug?: string;
};

const WORK_START_MIN = 9 * 60;
const WORK_END_MIN = 17 * 60;

function normalize(v?: string) {
  return (v || '').toLocaleLowerCase('tr-TR');
}

function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysLocal(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function parseTimeToMin(v?: string): number {
  if (!v || !/^\d{2}:\d{2}$/.test(v)) return 0;
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}

function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  const a1 = parseTimeToMin(startA);
  const a2 = parseTimeToMin(endA);
  const b1 = parseTimeToMin(startB);
  const b2 = parseTimeToMin(endB);
  return a1 < b2 && b1 < a2;
}

function extractPersonName(message: string): string | undefined {
  const withYanim = message.match(/yanıma\s+([\p{L}][\p{L}\s'.-]{0,40}?)\s+kişisini?\s+(?:ekle|ata)/iu);
  if (withYanim?.[1]) return withYanim[1].trim();

  const withKisi = message.match(/([\p{L}][\p{L}\s'.-]{0,40}?)\s+kişisini?\s+(?:ekle|ata)/iu);
  if (withKisi?.[1]) return withKisi[1].trim();

  const withIle = message.match(/([A-ZÇĞİÖŞÜ][a-zçğıöşü]+\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+)\s+ile/u);
  if (withIle?.[1]) return withIle[1];

  const direct = message.match(/([A-ZÇĞİÖŞÜ][a-zçğıöşü]+\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+)/u);
  return direct?.[1];
}

function extractUntilDate(message: string): string | undefined {
  const m = message.match(/(.+?)\s+tarihe?\s+kadar/iu);
  if (!m?.[1]) return undefined;
  return parseRelativeOrAbsoluteDate(m[1]);
}

function extractWeeklyDay(message: string): number | undefined {
  const lower = normalize(message);
  const dayMap: Array<{ keys: string[]; value: number }> = [
    { keys: ['pazar'], value: 0 },
    { keys: ['pazartesi', 'pts'], value: 1 },
    { keys: ['salı', 'sali'], value: 2 },
    { keys: ['çarşamba', 'carsamba'], value: 3 },
    { keys: ['perşembe', 'persembe'], value: 4 },
    { keys: ['cuma'], value: 5 },
    { keys: ['cumartesi', 'cmt'], value: 6 },
  ];

  for (const day of dayMap) {
    if (day.keys.some((k) => lower.includes(`her ${k}`) || lower.includes(`${k} günü`) || lower.includes(`${k}ye`) || lower.includes(`${k}ya`))) {
      return day.value;
    }
  }
  return undefined;
}

function parseRecurrenceFromMessage(message: string): Record<string, any> | undefined {
  const lower = normalize(message);
  const endDate = extractUntilDate(message);
  const dayOfWeek = extractWeeklyDay(message);

  if (dayOfWeek !== undefined) {
    return {
      type: 'weekly',
      interval: 1,
      daysOfWeek: [dayOfWeek],
      ...(endDate ? { endDate } : {}),
    };
  }

  if (lower.includes('her gün')) return { type: 'daily', interval: 1, ...(endDate ? { endDate } : {}) };
  if (lower.includes('her ay')) return { type: 'monthly', interval: 1, ...(endDate ? { endDate } : {}) };

  return undefined;
}

function parseISODate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function generateRecurringDates(startDate: string, recurring: Record<string, any>, max = 160): string[] {
  const out: string[] = [];
  const start = parseISODate(startDate);
  const end = recurring.endDate ? parseISODate(recurring.endDate) : addDaysLocal(start, 60);
  const interval = Math.max(1, Number(recurring.interval) || 1);

  if (recurring.type === 'weekly' && Array.isArray(recurring.daysOfWeek) && recurring.daysOfWeek.length > 0) {
    let cursor = new Date(start);
    while (cursor <= end && out.length < max) {
      const day = cursor.getDay();
      const diffWeeks = Math.floor((cursor.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
      if (recurring.daysOfWeek.includes(day) && diffWeeks % interval === 0) out.push(formatLocalDate(cursor));
      cursor = addDaysLocal(cursor, 1);
    }
    return out;
  }

  let cursor = new Date(start);
  while (cursor <= end && out.length < max) {
    out.push(formatLocalDate(cursor));
    if (recurring.type === 'daily') cursor = addDaysLocal(cursor, interval);
    else if (recurring.type === 'monthly') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + interval, cursor.getDate());
    else cursor = addDaysLocal(cursor, 7 * interval);
  }
  return out;
}

function assigneeTargetSelector(message: string): string {
  return message
    .replace(/yanıma\s+[\p{L}\s'.-]+\s+kişisini?\s+(?:ekle|ata)/giu, '')
    .replace(/[\p{L}\s'.-]+\s+kişisini?\s+(?:ekle|ata)/giu, '')
    .replace(/\b(ekle|ata|yanıma|kişi|kişisini|görevime|göreve)\b/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRelativeOrAbsoluteDate(input: string): string | undefined {
  const lower = normalize(input);
  const now = new Date();

  if (lower.includes('yarından sonraki gün') || lower.includes('öbür gün')) {
    return formatLocalDate(addDaysLocal(now, 2));
  }
  if (lower.includes('yarın')) return formatLocalDate(addDaysLocal(now, 1));
  if (lower.includes('bugün')) return formatLocalDate(now);

  const monthMap: Record<string, number> = {
    ocak: 0,
    şubat: 1,
    mart: 2,
    nisan: 3,
    mayıs: 4,
    haziran: 5,
    temmuz: 6,
    ağustos: 7,
    eylül: 8,
    ekim: 9,
    kasım: 10,
    aralık: 11,
  };

  const m = lower.match(/(\d{1,2})\s*(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)(?:[a-zçğıöşü]{0,4})?(?:\s*(\d{4}))?/u);
  if (m) {
    const day = Number(m[1]);
    const month = monthMap[m[2]];
    const year = m[3] ? Number(m[3]) : now.getFullYear();
    if (month >= 0 && day >= 1 && day <= 31) {
      return formatLocalDate(new Date(year, month, day));
    }
  }

  return undefined;
}

function extractTimeHint(input: string): string | undefined {
  const lower = normalize(input);
  const direct = input.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (direct) return `${direct[1].padStart(2, '0')}:${direct[2]}`;

  if (lower.includes('sabah')) return '09:00';
  if (lower.includes('öğlen')) return '13:00';
  if (lower.includes('akşam')) return '18:00';
  return undefined;
}

function inferEndTime(startTime: string): string {
  const [h, m] = startTime.split(':').map(Number);
  const endH = String(Math.min(h + 1, 23)).padStart(2, '0');
  return `${endH}:${String(m).padStart(2, '0')}`;
}

function parseJsonFromModelText(text: string): AgentPlan | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as AgentPlan;
  } catch {
    // try fallback parsing
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]) as AgentPlan;
    } catch {
      // continue
    }
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as AgentPlan;
    } catch {
      return null;
    }
  }

  return null;
}

function candidateGeminiModels(): string[] {
  const fromEnv = [
    process.env.GEMINI_MODEL,
    process.env.GOOGLE_GENAI_MODEL,
    process.env.NEXT_PUBLIC_GEMINI_MODEL,
  ].filter(Boolean) as string[];

  const defaults = [
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
  ];

  return Array.from(new Set([...fromEnv, ...defaults]));
}

function matchTask(tasks: PurchasingTask[], action: AgentAction): PurchasingTask | undefined {
  if (action.taskId) return tasks.find((t) => t.id === action.taskId);

  const selector = normalize(action.selector || '');
  const dateHint = parseRelativeOrAbsoluteDate(selector);
  const timeHint = extractTimeHint(selector);

  let pool = [...tasks];
  if (dateHint) pool = pool.filter((t) => t.date === dateHint);
  if (timeHint) pool = pool.filter((t) => t.startTime === timeHint || t.endTime === timeHint);

  if (!selector) return pool[0];

  const scored = pool
    .map((t) => {
      const hay = normalize([
        t.title,
        t.description,
        t.laboratoryName,
        t.startTime,
        t.endTime,
        t.date,
        ...(t.assignedPersonnel || []).map((p) => p.name),
      ].join(' '));

      let score = 0;
      if (hay.includes(selector)) score += 7;
      if (selector.includes('öğlen') && t.startTime >= '12:00' && t.startTime <= '15:59') score += 3;
      if (selector.includes('sabah') && t.startTime < '12:00') score += 3;
      if (selector.includes('akşam') && t.startTime >= '17:00') score += 3;
      return { t, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.t;
}

function matchTasksByDate(tasks: PurchasingTask[], date: string): PurchasingTask[] {
  return tasks.filter((t) => t.date === date);
}

function resolveHospitalFromText(message: string, hospitals: Hospital[]): Hospital | undefined {
  const lower = normalize(message);

  // direct contains check
  const direct = hospitals.find((h) => normalize(h.name).includes(lower) || lower.includes(normalize(h.name)));
  if (direct) return direct;

  // token overlap (for short/partial names: "Haydarpaşa" vs "Haydarpaşa Numune EAH")
  const tokens = lower.split(/\s+/).filter((t) => t.length >= 3);
  let best: { h: Hospital; score: number } | null = null;
  for (const h of hospitals) {
    const hname = normalize(h.name || '');
    let score = 0;
    for (const tk of tokens) {
      if (hname.includes(tk)) score += 1;
    }
    if (!best || score > best.score) best = { h, score };
  }

  return best && best.score >= 1 ? best.h : undefined;
}

function hasMutationIntent(message: string): boolean {
  const lower = normalize(message);
  return ['ekle', 'oluştur', 'planla', 'sil', 'iptal', 'tamamla', 'yeniden aç', 'güncelle', 'değiştir', 'ata', 'çıkar']
    .some((k) => lower.includes(k));
}

async function geminiPlan(message: string, tasks: PurchasingTask[]): Promise<AgentPlan | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) return null;

  const compactTasks = tasks.slice(0, 160).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    date: t.date,
    startTime: t.startTime,
    endTime: t.endTime,
    priority: t.priority,
    completed: t.completed,
    taskType: t.taskType,
    laboratoryName: t.laboratoryName,
    assignedPersonnel: t.assignedPersonnel || [],
  }));

  const prompt = `Sen Satın Alma paneli için görev ajanısın. Kullanıcı mesajını yorumlayıp JSON action plan döndür.
Sadece JSON döndür:
{
  "reply": "kısa doğal Türkçe cevap",
  "actions": [
    {
      "type": "create_task|update_task|delete_task|complete_task|reopen_task|add_assignee|remove_assignee|analyze",
      "taskId": "opsiyonel",
      "selector": "opsiyonel doğal dil hedefi",
      "data": {}
    }
  ]
}

Kurallar:
- Mutasyon niyeti varsa (sil/iptal/ekle/güncelle/ata vb.) analyze dönme.
- "yarınki bütün işleri iptal et" gibi komutlarda tek tek action üret veya delete_task içinde scope/date ver.
- "20 şubat sabah 9 ahmet yılmazla toplantım var kurum ziyareti ..." gibi cümleleri create_task + add_assignee gibi action'lara böl.
- Tarihleri YYYY-MM-DD, saatleri HH:mm formatında ver.
- "X tarihe kadar her cuma ..." gibi tekrar isteklerinde create_task.data.recurring ver. Örnek: {"type":"weekly","interval":1,"daysOfWeek":[5],"endDate":"YYYY-MM-DD"}
- "yanıma C kişisini ekle" gibi komutlarda add_assignee için data.name doldur ve mümkünse selector içinde hedef görevi bırak.
- Tekrar: yalnızca JSON.

Kullanıcı mesajı: ${message}
Görevler: ${JSON.stringify(compactTasks)}`;

  const models = candidateGeminiModels();
  let lastDebug = 'gemini_no_attempt';

  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: 1400 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      lastDebug = `gemini_http_${res.status}:${model}:${errText.slice(0, 180)}`;
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
      lastDebug = `gemini_parse_failed:${model}:${text.slice(0, 180)}`;
      continue;
    }

    return parsed;
  }

  return { debug: lastDebug };
}

function fallbackPlan(message: string, tasks: PurchasingTask[], hospitals: Hospital[]): AgentPlan {
  const lower = normalize(message);
  const actions: AgentAction[] = [];
  const inferredDate = parseRelativeOrAbsoluteDate(message);
  const inferredTime = extractTimeHint(message);
  const person = extractPersonName(message);
  const recurring = parseRecurrenceFromMessage(message);
  const hospital = resolveHospitalFromText(message, hospitals);

  // bulk cancellation
  if ((lower.includes('bütün') || lower.includes('hepsini') || lower.includes('tüm')) && (lower.includes('iptal') || lower.includes('sil'))) {
    const date = inferredDate || formatLocalDate(addDaysLocal(new Date(), 1));
    actions.push({ type: 'delete_task', selector: message, data: { scope: 'all_on_date', date } });
  }

  // create
  if ((lower.includes('ekle') || lower.includes('oluştur') || lower.includes('planla') || lower.includes('toplantım var') || lower.includes('ata')) && (lower.includes('görev') || lower.includes('toplantı') || lower.includes('ziyaret'))) {
    const start = inferredTime || (lower.includes('sabah') ? '09:00' : lower.includes('öğlen') ? '13:00' : '09:00');
    const date = inferredDate || formatLocalDate(new Date());
    const isVisit = lower.includes('ziyaret') || !!hospital;
    const title = isVisit
      ? `${hospital?.name || 'Kurum'} Ziyareti`
      : lower.includes('toplantı')
        ? `${person || ''} Toplantısı`.trim() || 'Toplantı'
        : 'Yeni Görev';

    actions.push({
      type: 'create_task',
      selector: message,
      data: {
        title,
        description: message,
        date,
        startTime: start,
        endTime: inferEndTime(start),
        taskType: isVisit ? 'kurum_ziyareti' : 'custom',
        taskTypeLabel: isVisit ? 'Kurum Ziyareti' : 'Agent Görevi',
        ...(hospital ? { laboratoryId: hospital.id, laboratoryName: hospital.name } : {}),
        ...(recurring ? { recurring } : {}),
      },
    });
  }

  // delete single
  if (actions.length === 0 && (lower.includes('iptal et') || lower.includes('sil'))) {
    actions.push({ type: 'delete_task', selector: message });
  }

  // complete/reopen
  if (lower.includes('tamamla')) actions.push({ type: 'complete_task', selector: message });
  if (lower.includes('yeniden aç')) actions.push({ type: 'reopen_task', selector: message });

  // assignee
  if ((lower.includes('ekle') || lower.includes('ata')) && person) {
    actions.push({ type: 'add_assignee', selector: assigneeTargetSelector(message), data: { name: person } });
  }
  if (lower.includes('çıkar') && person) {
    actions.push({ type: 'remove_assignee', selector: message, data: { name: person } });
  }

  // analysis intent
  if (actions.length === 0 && (lower.includes('?') || lower.includes('yoğun') || lower.includes('müsait') || lower.includes('var mı'))) {
    const date = inferredDate || formatLocalDate(new Date());
    const dayTasks = tasks.filter((t) => t.date === date && !t.completed);
    const totalMinutes = dayTasks.reduce((sum, t) => {
      const start = Math.max(parseTimeToMin(t.startTime), WORK_START_MIN);
      const end = Math.min(parseTimeToMin(t.endTime), WORK_END_MIN);
      return end > start ? sum + (end - start) : sum;
    }, 0);
    const occupancy = Math.round((totalMinutes / (WORK_END_MIN - WORK_START_MIN)) * 100);

    const requestedTime = inferredTime || (lower.includes('saat 4') ? '16:00' : undefined);
    let suggestion = '';
    if (requestedTime) {
      const proposedEnd = inferEndTime(requestedTime);
      const hasConflict = dayTasks.some((t) => overlaps(requestedTime, proposedEnd, t.startTime, t.endTime));
      suggestion = hasConflict
        ? `Saat ${requestedTime} için çakışma görünüyor.`
        : `Saat ${requestedTime} için uygun bir boşluk görünüyor.`;
    }

    return {
      reply: `${date} için ${dayTasks.length} açık görev var, doluluk yaklaşık %${occupancy}. ${suggestion}`.trim(),
      actions: [{ type: 'analyze' }],
    };
  }

  if (actions.length === 0) {
    return {
      reply: 'Komutu işleyemedim. Örn: “yarınki bütün işleri iptal et”, “20 Şubat sabah 09:00 Ahmet Yılmaz ile toplantı ekle”.',
      actions: [{ type: 'analyze' }],
    };
  }

  return {
    reply: 'Komutun işlendi, uygun görevlerde değişiklik uyguluyorum.',
    actions,
  };
}

function activityLog(action: string, message: string, uid?: string, name?: string) {
  return {
    id: `al_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action,
    message,
    createdAt: new Date(),
    createdByUid: uid || 'agent',
    createdByName: name || 'Satın Alma Agent',
  };
}

export async function POST(req: NextRequest) {
  try {
    const { message, userUid, userName } = await req.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ ok: false, error: 'Mesaj boş olamaz' }, { status: 400 });
    }
    if (!userUid || typeof userUid !== 'string') {
      return NextResponse.json({ ok: false, error: 'Kullanıcı kimliği bulunamadı. Lütfen tekrar giriş yapın.' }, { status: 401 });
    }

    const [taskSnap, hospitalSnap] = await Promise.all([
      adminDb.collection('purchasingTasks').orderBy('date', 'asc').get(),
      adminDb.collection('hospitals').get(),
    ]);

    const tasks = taskSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PurchasingTask, 'id'>) })) as PurchasingTask[];
    const hospitals = hospitalSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Hospital, 'id'>) })) as Hospital[];

    const gemini = await geminiPlan(message, tasks);
    const geminiHasActions = !!(gemini?.actions && gemini.actions.length > 0);
    const geminiIsAnalyzeOnly = geminiHasActions && gemini!.actions!.every((a) => a.type === 'analyze');

    const planned = geminiHasActions && !(geminiIsAnalyzeOnly && hasMutationIntent(message))
      ? gemini!
      : fallbackPlan(message, tasks, hospitals);

    const actions = planned.actions || [];

    let actionsApplied = 0;
    const actionNotes: string[] = [];
    let lastCreatedTask: PurchasingTask | undefined;

    for (const action of actions) {
      if (action.type === 'analyze') continue;

      if (action.type === 'delete_task' && action.data?.scope === 'all_on_date' && action.data?.date) {
        const targets = matchTasksByDate(tasks, action.data.date);
        for (const t of targets) {
          await adminDb.collection('purchasingTasks').doc(t.id).delete();
          actionsApplied += 1;
        }
        actionNotes.push(`${action.data.date} tarihindeki ${targets.length} görev silindi`);
        continue;
      }

      const target = matchTask(tasks, action);

      if (action.type === 'create_task') {
        const recurring = action.data?.recurring as Record<string, any> | undefined;
        const baseDate = action.data?.date || parseRelativeOrAbsoluteDate(message) || formatLocalDate(new Date());
        const dates = recurring ? generateRecurringDates(baseDate, recurring) : [baseDate];
        const startTime = action.data?.startTime || extractTimeHint(message) || '09:00';
        const endTime = action.data?.endTime || inferEndTime(startTime);
        const title = action.data?.title || action.data?.taskTitle || 'Agent Görevi';
        const recurringGroupId = dates.length > 1 ? `rg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : undefined;

        for (const date of dates) {
          const created = {
            title,
            description: action.data?.description || message,
            taskType: action.data?.taskType || 'custom',
            taskTypeLabel: action.data?.taskTypeLabel || 'Agent Görevi',
            date,
            startTime,
            endTime,
            priority: action.data?.priority || 'normal',
            completed: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdByUid: userUid,
            createdByName: userName || 'Kullanıcı',
            assignedPersonnel: [{ uid: userUid, name: userName || 'Kullanıcı' }],
            ...(action.data?.laboratoryId ? { laboratoryId: action.data.laboratoryId } : {}),
            ...(action.data?.laboratoryName ? { laboratoryName: action.data.laboratoryName } : {}),
            ...(recurring ? { recurring } : {}),
            ...(recurringGroupId ? { recurringGroupId } : {}),
            activityLogs: [activityLog('created', 'Agent tarafından oluşturuldu', userUid, userName)],
          };

          const docRef = await adminDb.collection('purchasingTasks').add(created);
          const createdTask = { id: docRef.id, ...(created as Omit<PurchasingTask, 'id'>) } as PurchasingTask;
          tasks.push(createdTask);
          lastCreatedTask = createdTask;
          actionsApplied += 1;
        }

        actionNotes.push(`${dates.length} görev oluşturuldu`);
        continue;
      }

      const effectiveTarget = target || lastCreatedTask;
      if (!effectiveTarget) {
        actionNotes.push(`Eşleşme bulunamadı: ${action.selector || action.taskId || action.type}`);
        continue;
      }

      const ref = adminDb.collection('purchasingTasks').doc(effectiveTarget.id);

      if (action.type === 'delete_task') {
        await ref.delete();
        actionsApplied += 1;
        actionNotes.push(`Silindi: ${effectiveTarget.title}`);
        continue;
      }

      if (action.type === 'complete_task' || action.type === 'reopen_task') {
        const nextCompleted = action.type === 'complete_task';
        await ref.update({
          completed: nextCompleted,
          updatedAt: new Date(),
          activityLogs: [
            ...((effectiveTarget.activityLogs || []) as any[]),
            activityLog(nextCompleted ? 'completed' : 'reopened', nextCompleted ? 'Agent görevi tamamladı' : 'Agent görevi yeniden açtı', userUid, userName),
          ],
        });
        actionsApplied += 1;
        actionNotes.push(`${nextCompleted ? 'Tamamlandı' : 'Yeniden açıldı'}: ${effectiveTarget.title}`);
        continue;
      }

      if (action.type === 'add_assignee') {
        const personName = action.data?.name || action.data?.person || action.data?.assigneeName || 'Belirtilen Personel';
        const prev = effectiveTarget.assignedPersonnel || [];
        const exists = prev.some((p) => normalize(p.name) === normalize(personName));
        if (!exists) {
          await ref.update({
            assignedPersonnel: [...prev, { uid: `agent_${personName}`, name: personName }],
            updatedAt: new Date(),
            activityLogs: [...((effectiveTarget.activityLogs || []) as any[]), activityLog('updated', `${personName} göreve eklendi`, userUid, userName)],
          });
          actionsApplied += 1;
          actionNotes.push(`Personel eklendi: ${personName} -> ${effectiveTarget.title}`);
        }
        continue;
      }

      if (action.type === 'remove_assignee') {
        const personName = action.data?.name || action.data?.person || action.data?.assigneeName;
        if (!personName) continue;
        const next = (effectiveTarget.assignedPersonnel || []).filter((p) => normalize(p.name) !== normalize(personName));
        await ref.update({
          assignedPersonnel: next,
          updatedAt: new Date(),
          activityLogs: [...((effectiveTarget.activityLogs || []) as any[]), activityLog('updated', `${personName} görevden çıkarıldı`, userUid, userName)],
        });
        actionsApplied += 1;
        actionNotes.push(`Personel çıkarıldı: ${personName} -> ${effectiveTarget.title}`);
        continue;
      }

      if (action.type === 'update_task') {
        const updates: Record<string, any> = { updatedAt: new Date() };
        if (action.data?.title) updates.title = action.data.title;
        if (action.data?.description) updates.description = action.data.description;
        if (action.data?.date) updates.date = action.data.date;
        if (action.data?.startTime) updates.startTime = action.data.startTime;
        if (action.data?.endTime) updates.endTime = action.data.endTime;
        if (action.data?.priority) updates.priority = action.data.priority;
        updates.activityLogs = [...((effectiveTarget.activityLogs || []) as any[]), activityLog('updated', 'Agent görev güncellemesi yaptı', userUid, userName)];
        await ref.update(updates);
        actionsApplied += 1;
        actionNotes.push(`Güncellendi: ${effectiveTarget.title}`);
      }
    }

    const debug = gemini?.debug ? ` (${gemini.debug})` : '';
    const summary = actionNotes.length > 0 ? actionNotes.join(' • ') : `Sadece analiz yanıtı üretildi${debug}`;

    return NextResponse.json({
      ok: true,
      reply: planned.reply || 'İşlem tamamlandı.',
      actionsApplied,
      summary,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Agent işlem hatası' }, { status: 500 });
  }
}
