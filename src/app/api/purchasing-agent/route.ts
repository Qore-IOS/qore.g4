import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import type { PurchasingTask } from '@/lib/types';

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

function normalize(v?: string) {
  return (v || '').toLocaleLowerCase('tr-TR');
}

function parseRelativeDate(input: string): string | undefined {
  const lower = normalize(input);
  const now = new Date();
  if (lower.includes('yarın')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (lower.includes('bugün')) return now.toISOString().slice(0, 10);
  return undefined;
}

function extractTimeHint(input: string): string | undefined {
  const m = input.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (!m) return undefined;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function parseJsonFromModelText(text: string): AgentPlan | null {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed) as AgentPlan;
  } catch {
    // try markdown fenced json
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
    const raw = trimmed.slice(first, last + 1);
    try {
      return JSON.parse(raw) as AgentPlan;
    } catch {
      return null;
    }
  }

  return null;
}

function matchTask(tasks: PurchasingTask[], action: AgentAction): PurchasingTask | undefined {
  if (action.taskId) return tasks.find((t) => t.id === action.taskId);

  const selector = normalize(action.selector || '');
  const dateHint = parseRelativeDate(selector);
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
      if (hay.includes(selector)) score += 5;
      if (selector.includes('öğlen') && t.startTime >= '12:00' && t.startTime <= '15:59') score += 3;
      if (selector.includes('sabah') && t.startTime < '12:00') score += 3;
      return { t, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.t;
}

async function geminiPlan(message: string, tasks: PurchasingTask[]): Promise<AgentPlan | null> {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const compactTasks = tasks.slice(0, 120).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    date: t.date,
    startTime: t.startTime,
    endTime: t.endTime,
    priority: t.priority,
    completed: t.completed,
    assignedPersonnel: t.assignedPersonnel || [],
  }));

  const prompt = `Sen satın alma paneli görev ajanısın. Kullanıcı doğal dilde yazar, sen JSON action plan üretirsin.

Sadece şu JSON'u döndür:
{
  "reply": "kullanıcıya kısa Türkçe yanıt",
  "actions": [
    {
      "type": "create_task|update_task|delete_task|complete_task|reopen_task|add_assignee|remove_assignee|analyze",
      "taskId": "opsiyonel",
      "selector": "opsiyonel",
      "data": {}
    }
  ]
}

Kritik kurallar:
- Kullanıcı görev eklemek istiyorsa create_task üret.
- Zaman/değişiklik/iptal/personel ekleme gibi çoklu komutlarda actions dizisini sıralı doldur.
- Belirsizse selector kullan ama analyze ile kaçma; mutasyon niyeti varsa mutasyon action üret.
- Cevapta kesinlikle markdown yazma.

Kullanıcı komutu: ${message}
Görevler: ${JSON.stringify(compactTasks)}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1200,
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { debug: `gemini_http_${res.status}:${errText.slice(0, 180)}` };
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { debug: 'gemini_empty_response' };

  const parsed = parseJsonFromModelText(text);
  if (!parsed) {
    return { debug: `gemini_parse_failed:${text.slice(0, 180)}` };
  }

  return parsed;
}

function fallbackPlan(message: string, tasks: PurchasingTask[]): AgentPlan {
  const lower = normalize(message);
  const actions: AgentAction[] = [];

  // create intents
  if ((lower.includes('ekle') || lower.includes('oluştur') || lower.includes('planla')) && (lower.includes('görev') || lower.includes('toplantı'))) {
    const time = extractTimeHint(message) || (lower.includes('sabah') ? '10:00' : lower.includes('öğlen') ? '13:00' : '09:00');
    const endHour = String(Math.min(parseInt(time.slice(0, 2), 10) + 1, 23)).padStart(2, '0');
    actions.push({
      type: 'create_task',
      selector: message,
      data: {
        title: lower.includes('toplantı') ? 'Toplantı' : 'Yeni Görev',
        description: message,
        date: parseRelativeDate(message) || new Date().toISOString().slice(0, 10),
        startTime: time,
        endTime: `${endHour}:${time.slice(3)}`,
      },
    });
  }

  // delete/cancel
  if (lower.includes('iptal et') || lower.includes('sil')) {
    actions.push({ type: 'delete_task', selector: message });
  }

  // completion
  if (lower.includes('tamamla')) {
    actions.push({ type: 'complete_task', selector: message });
  }
  if (lower.includes('yeniden aç')) {
    actions.push({ type: 'reopen_task', selector: message });
  }

  // simple updates
  if (lower.includes('güncelle') || lower.includes('değiştir')) {
    const time = extractTimeHint(message);
    actions.push({ type: 'update_task', selector: message, data: { ...(time ? { startTime: time } : {}) } });
  }

  // assignee add/remove
  const personMatch = message.match(/([A-ZÇĞİÖŞÜ][a-zçğıöşü]+\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+)/);
  if (lower.includes('ekle') && (lower.includes('personel') || lower.includes('ata') || !!personMatch)) {
    actions.push({
      type: 'add_assignee',
      selector: message,
      data: { name: personMatch?.[1] || 'Belirtilen Personel' },
    });
  }
  if (lower.includes('çıkar')) {
    actions.push({
      type: 'remove_assignee',
      selector: message,
      data: { name: personMatch?.[1] || '' },
    });
  }

  // analysis / question intents
  if (actions.length === 0 && (lower.includes('?') || lower.includes('var mı') || lower.includes('analiz'))) {
    const date = parseRelativeDate(message);
    const pool = date ? tasks.filter((t) => t.date === date) : tasks;
    const open = pool.filter((t) => !t.completed).length;
    const total = pool.length;
    return {
      reply: `${date ? `${date} için` : 'Genel'} toplam ${total} görev var, ${open} tanesi açık görünüyor. İstersen bunu saat/öncelik bazında da yorumlayabilirim.`,
      actions: [{ type: 'analyze' }],
    };
  }

  if (actions.length === 0) {
    return {
      reply:
        'Komutu işleyemedim. Örn: “yarın 10:00 toplantı ekle”, “yarın öğlen görevini sil”, “bu göreve Ahmet Yılmaz ekle”.',
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

    const snap = await adminDb.collection('purchasingTasks').orderBy('date', 'asc').get();
    const tasks = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PurchasingTask, 'id'>) })) as PurchasingTask[];

    const gemini = await geminiPlan(message, tasks);
    const planned = gemini?.actions && gemini.actions.length > 0 ? gemini : fallbackPlan(message, tasks);
    const actions = planned.actions || [];

    let actionsApplied = 0;
    const actionNotes: string[] = [];

    for (const action of actions) {
      if (action.type === 'analyze') continue;

      const target = matchTask(tasks, action);

      if (action.type === 'create_task') {
        const date = action.data?.date || parseRelativeDate(message) || new Date().toISOString().slice(0, 10);
        const startTime = action.data?.startTime || extractTimeHint(message) || '09:00';
        const endTime = action.data?.endTime || '10:00';
        const title = action.data?.title || action.data?.taskTitle || 'Agent Görevi';

        await adminDb.collection('purchasingTasks').add({
          title,
          description: action.data?.description || message,
          taskType: 'custom',
          taskTypeLabel: 'Agent Görevi',
          date,
          startTime,
          endTime,
          priority: action.data?.priority || 'normal',
          completed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdByUid: userUid || 'agent',
          createdByName: userName || 'Satın Alma Agent',
          activityLogs: [activityLog('created', 'Agent tarafından oluşturuldu', userUid, userName)],
        });
        actionsApplied += 1;
        actionNotes.push('1 görev oluşturuldu');
        continue;
      }

      if (!target) {
        actionNotes.push(`Eşleşme bulunamadı: ${action.selector || action.taskId || action.type}`);
        continue;
      }

      const ref = adminDb.collection('purchasingTasks').doc(target.id);

      if (action.type === 'delete_task') {
        await ref.delete();
        actionsApplied += 1;
        actionNotes.push(`Silindi: ${target.title}`);
        continue;
      }

      if (action.type === 'complete_task' || action.type === 'reopen_task') {
        const nextCompleted = action.type === 'complete_task';
        await ref.update({
          completed: nextCompleted,
          updatedAt: new Date(),
          activityLogs: [
            ...((target.activityLogs || []) as any[]),
            activityLog(
              nextCompleted ? 'completed' : 'reopened',
              nextCompleted ? 'Agent görevi tamamladı' : 'Agent görevi yeniden açtı',
              userUid,
              userName
            ),
          ],
        });
        actionsApplied += 1;
        actionNotes.push(`${nextCompleted ? 'Tamamlandı' : 'Yeniden açıldı'}: ${target.title}`);
        continue;
      }

      if (action.type === 'add_assignee') {
        const personName = action.data?.name || action.data?.person || action.data?.assigneeName || 'Belirtilen Personel';
        const prev = target.assignedPersonnel || [];
        const exists = prev.some((p) => normalize(p.name) === normalize(personName));
        if (!exists) {
          await ref.update({
            assignedPersonnel: [...prev, { uid: `agent_${personName}`, name: personName }],
            updatedAt: new Date(),
            activityLogs: [...((target.activityLogs || []) as any[]), activityLog('updated', `${personName} göreve eklendi`, userUid, userName)],
          });
          actionsApplied += 1;
          actionNotes.push(`Personel eklendi: ${personName} -> ${target.title}`);
        }
        continue;
      }

      if (action.type === 'remove_assignee') {
        const personName = action.data?.name || action.data?.person || action.data?.assigneeName;
        if (!personName) continue;
        const next = (target.assignedPersonnel || []).filter((p) => normalize(p.name) !== normalize(personName));
        await ref.update({
          assignedPersonnel: next,
          updatedAt: new Date(),
          activityLogs: [...((target.activityLogs || []) as any[]), activityLog('updated', `${personName} görevden çıkarıldı`, userUid, userName)],
        });
        actionsApplied += 1;
        actionNotes.push(`Personel çıkarıldı: ${personName} -> ${target.title}`);
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
        updates.activityLogs = [...((target.activityLogs || []) as any[]), activityLog('updated', 'Agent görev güncellemesi yaptı', userUid, userName)];
        await ref.update(updates);
        actionsApplied += 1;
        actionNotes.push(`Güncellendi: ${target.title}`);
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
