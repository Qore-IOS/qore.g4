'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/firebase';
import {
  addDoc,
  collection,
  doc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type { PurchasingTask, PurchasingWorkflowEdge, PurchasingWorkflowNodePosition, PurchasingWorkflowProject } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, Link2, Palette, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type Props = {
  tasks: PurchasingTask[];
  workflows: PurchasingWorkflowProject[];
  userUid?: string;
  userName?: string;
};

const PRESET_COLORS = ['#d4ec00', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#f97316'];

export default function WorkflowCanvasPanel({ tasks, workflows, userUid, userName }: Props) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(workflows[0]?.id || '');
  const [newName, setNewName] = useState('Yeni Workflow');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [linkFromTaskId, setLinkFromTaskId] = useState<string | null>(null);

  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflowId),
    [workflows, selectedWorkflowId]
  );


  useEffect(() => {
    if (!selectedWorkflowId && workflows[0]?.id) setSelectedWorkflowId(workflows[0].id);
  }, [workflows, selectedWorkflowId]);

  const orderedTasks = useMemo(
    () => [...tasks].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`)),
    [tasks]
  );

  const workflowTaskMap = useMemo(() => {
    const ids = new Set(selectedWorkflow?.taskIds || []);
    const map = new Map<string, PurchasingTask>();
    orderedTasks.forEach((t) => {
      if (ids.has(t.id)) map.set(t.id, t);
    });
    return map;
  }, [orderedTasks, selectedWorkflow]);

  const progress = useMemo(() => {
    if (!selectedWorkflow || selectedWorkflow.taskIds.length === 0) return { completed: 0, total: 0, pct: 0 };
    const total = selectedWorkflow.taskIds.length;
    const completed = selectedWorkflow.taskIds.filter((id) => workflowTaskMap.get(id)?.completed).length;
    return { completed, total, pct: Math.round((completed / total) * 100) };
  }, [selectedWorkflow, workflowTaskMap]);

  const nodePositionsByTask = useMemo(() => {
    const map = new Map<string, PurchasingWorkflowNodePosition>();
    (selectedWorkflow?.nodes || []).forEach((n) => map.set(n.taskId, n));
    return map;
  }, [selectedWorkflow]);

  const workflowTasks = useMemo(
    () => (selectedWorkflow?.taskIds || []).map((id) => workflowTaskMap.get(id)).filter(Boolean) as PurchasingTask[],
    [selectedWorkflow, workflowTaskMap]
  );

  const createWorkflow = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const ref = await addDoc(collection(db, 'purchasingWorkflows'), {
        name,
        color: newColor,
        taskIds: [],
        nodes: [],
        edges: [],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUid: userUid || null,
        createdByName: userName || null,
      });
      setSelectedWorkflowId(ref.id);
      toast.success('Workflow oluşturuldu');
    } catch (err) {
      console.error(err);
      toast.error('Workflow oluşturulamadı');
    }
  };

  const updateWorkflowColor = async (color: string) => {
    if (!selectedWorkflow) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'purchasingWorkflows', selectedWorkflow.id), { color, updatedAt: Timestamp.now() });
      selectedWorkflow.taskIds.forEach((taskId) => {
        batch.update(doc(db, 'purchasingTasks', taskId), { workflowColor: color, workflowProjectId: selectedWorkflow.id, updatedAt: Timestamp.now() });
      });
      await batch.commit();
      toast.success('Workflow rengi güncellendi');
    } catch (err) {
      console.error(err);
      toast.error('Workflow rengi güncellenemedi');
    }
  };

  const addTaskToCanvas = async (taskId: string, x: number, y: number) => {
    if (!selectedWorkflow) return;
    if (selectedWorkflow.taskIds.includes(taskId)) return;

    const nextNodes = [...selectedWorkflow.nodes, { taskId, x, y }];
    const nextTaskIds = [...selectedWorkflow.taskIds, taskId];
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'purchasingWorkflows', selectedWorkflow.id), {
        taskIds: nextTaskIds,
        nodes: nextNodes,
        updatedAt: Timestamp.now(),
      });
      batch.update(doc(db, 'purchasingTasks', taskId), {
        workflowProjectId: selectedWorkflow.id,
        workflowColor: selectedWorkflow.color,
        updatedAt: Timestamp.now(),
      });
      await batch.commit();
      toast.success('Görev workflow kanvasına eklendi');
    } catch (err) {
      console.error(err);
      toast.error('Görev workflow\'a eklenemedi');
    }
  };

  const removeTaskFromWorkflow = async (taskId: string) => {
    if (!selectedWorkflow) return;
    try {
      const nextTaskIds = selectedWorkflow.taskIds.filter((id) => id !== taskId);
      const nextNodes = selectedWorkflow.nodes.filter((n) => n.taskId !== taskId);
      const nextEdges = selectedWorkflow.edges.filter((e) => e.fromTaskId !== taskId && e.toTaskId !== taskId);
      const batch = writeBatch(db);
      batch.update(doc(db, 'purchasingWorkflows', selectedWorkflow.id), {
        taskIds: nextTaskIds,
        nodes: nextNodes,
        edges: nextEdges,
        updatedAt: Timestamp.now(),
      });
      batch.update(doc(db, 'purchasingTasks', taskId), {
        workflowProjectId: null,
        workflowColor: null,
        updatedAt: Timestamp.now(),
      });
      await batch.commit();
      setLinkFromTaskId((prev) => (prev === taskId ? null : prev));
      toast.success('Görev workflow\'dan çıkarıldı');
    } catch (err) {
      console.error(err);
      toast.error('Görev çıkarılamadı');
    }
  };

  const linkTasks = async (toTaskId: string) => {
    if (!selectedWorkflow || !linkFromTaskId || linkFromTaskId === toTaskId) return;
    const exists = selectedWorkflow.edges.some((e) => e.fromTaskId === linkFromTaskId && e.toTaskId === toTaskId);
    if (exists) {
      setLinkFromTaskId(null);
      return;
    }
    const next: PurchasingWorkflowEdge[] = [
      ...selectedWorkflow.edges,
      { id: `we_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, fromTaskId: linkFromTaskId, toTaskId },
    ];
    try {
      await updateDoc(doc(db, 'purchasingWorkflows', selectedWorkflow.id), { edges: next, updatedAt: Timestamp.now() });
      setLinkFromTaskId(null);
      toast.success('Akış bağlantısı eklendi');
    } catch (err) {
      console.error(err);
      toast.error('Bağlantı kurulamadı');
    }
  };

  const removeEdge = async (edgeId: string) => {
    if (!selectedWorkflow) return;
    const next = selectedWorkflow.edges.filter((e) => e.id !== edgeId);
    try {
      await updateDoc(doc(db, 'purchasingWorkflows', selectedWorkflow.id), { edges: next, updatedAt: Timestamp.now() });
    } catch (err) {
      console.error(err);
      toast.error('Bağlantı silinemedi');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[320px,1fr] gap-3">
      <aside className="rounded-2xl border border-border bg-card p-3 space-y-3">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Workflow Projesi</label>
          <select
            value={selectedWorkflowId}
            onChange={(e) => setSelectedWorkflowId(e.target.value)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-xl text-sm"
          >
            {workflows.length === 0 && <option value="">Henüz workflow yok</option>}
            {workflows.map((wf) => (
              <option key={wf.id} value={wf.id}>{wf.name}</option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border border-border p-2 bg-secondary/30 space-y-2">
          <p className="text-xs font-medium">Yeni workflow oluştur</p>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs" placeholder="Örn: Ekim Kurum Ziyaret Planı" />
          <div className="flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button key={c} onClick={() => setNewColor(c)} className={cn('w-5 h-5 rounded-full border', newColor === c ? 'ring-2 ring-white/60' : 'border-white/20')} style={{ backgroundColor: c }} />
            ))}
          </div>
          <button onClick={createWorkflow} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-[#d4ec00] text-zinc-900 font-medium">
            <Plus className="w-3.5 h-3.5" /> Oluştur
          </button>
        </div>

        {selectedWorkflow && (
          <>
            <div className="rounded-xl border border-border p-2 bg-secondary/30 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">Tema Rengi</p>
                <Palette className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => updateWorkflowColor(c)}
                    className={cn('w-5 h-5 rounded-full border', selectedWorkflow.color === c ? 'ring-2 ring-white/60' : 'border-white/20')}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">Bu renk workflow içindeki görevlerin tüm görünümlerde temsil rengi olur.</p>
            </div>

            <div className="rounded-xl border border-border p-2 bg-secondary/30">
              <p className="text-xs font-medium mb-1">Proje İlerlemesi</p>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${progress.pct}%`, backgroundColor: selectedWorkflow.color }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{progress.completed}/{progress.total} görev tamamlandı (%{progress.pct})</p>
            </div>
          </>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium">Görev Havuzu (kronolojik)</p>
          <div className="max-h-[52vh] overflow-y-auto space-y-1.5 pr-1">
            {orderedTasks.map((task) => {
              const inSelectedWorkflow = !!selectedWorkflow && selectedWorkflow.taskIds.includes(task.id);
              return (
                <div
                  key={task.id}
                  draggable={!!selectedWorkflow}
                  onDragStart={(e) => e.dataTransfer.setData('application/x-task-id', task.id)}
                  className={cn('rounded-lg border px-2 py-1.5 text-xs bg-card', inSelectedWorkflow ? 'border-[#d4ec00]/50' : 'border-border')}
                >
                  <div className="flex items-center gap-1.5">
                    {task.completed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className="truncate font-medium">{task.title}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{task.date} • {task.startTime}-{task.endTime}</p>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="rounded-2xl border border-border bg-card p-3 min-h-[72vh]">
        {!selectedWorkflow ? (
          <div className="h-full min-h-[300px] flex items-center justify-center text-sm text-muted-foreground">Önce bir workflow seçin veya oluşturun.</div>
        ) : (
          <div
            className="relative rounded-xl border border-border min-h-[68vh] overflow-auto"
            style={{
              backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const taskId = e.dataTransfer.getData('application/x-task-id');
              if (!taskId) return;
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              addTaskToCanvas(taskId, Math.max(12, e.clientX - rect.left - 120), Math.max(12, e.clientY - rect.top - 30));
            }}
          >
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {(selectedWorkflow.edges || []).map((edge) => {
                const from = nodePositionsByTask.get(edge.fromTaskId);
                const to = nodePositionsByTask.get(edge.toTaskId);
                if (!from || !to) return null;
                const x1 = from.x + 228;
                const y1 = from.y + 30;
                const x2 = to.x;
                const y2 = to.y + 30;
                const c1 = x1 + 70;
                const c2 = x2 - 70;
                return (
                  <path key={edge.id} d={`M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`} stroke={selectedWorkflow.color} strokeWidth="2.2" fill="none" opacity="0.9" />
                );
              })}
            </svg>

            {(selectedWorkflow.nodes || []).map((node) => {
              const task = workflowTaskMap.get(node.taskId);
              if (!task) return null;
              const isLinkFrom = linkFromTaskId === task.id;
              return (
                <div key={task.id} className="absolute w-[228px]" style={{ left: node.x, top: node.y }}>
                  <div className="absolute -left-2 top-1/2 -translate-y-1/2">
                    <button
                      onClick={() => linkTasks(task.id)}
                      className={cn('w-4 h-4 rounded-full border-2 bg-background', linkFromTaskId ? 'border-sky-400' : 'border-muted-foreground/50')}
                      title="Giriş pini"
                    />
                  </div>

                  <div className="rounded-lg border shadow-sm px-2.5 py-2" style={{ borderColor: selectedWorkflow.color, background: 'rgba(23,23,23,0.82)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold truncate">{task.title}</p>
                      <button onClick={() => removeTaskFromWorkflow(task.id)} className="text-muted-foreground hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">{task.date} • {task.startTime}-{task.endTime}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded', task.completed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400')}>
                        {task.completed ? 'Tamamlandı' : 'Bekliyor'}
                      </span>
                      {isLinkFrom && <span className="text-[10px] text-sky-400 inline-flex items-center gap-1"><Link2 className="w-3 h-3" /> Bağlantı modu</span>}
                    </div>
                  </div>

                  <div className="absolute -right-2 top-1/2 -translate-y-1/2">
                    <button
                      onClick={() => setLinkFromTaskId(task.id)}
                      className={cn('w-4 h-4 rounded-full border-2 bg-background', isLinkFrom ? 'border-sky-400' : 'border-muted-foreground/50')}
                      title="Çıkış pini"
                    />
                  </div>
                </div>
              );
            })}

            {(selectedWorkflow.edges || []).length > 0 && (
              <div className="absolute right-2 top-2 rounded-lg border border-border bg-card/80 p-2 max-w-[260px]">
                <p className="text-[11px] text-muted-foreground mb-1">Bağlantılar</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {selectedWorkflow.edges.map((edge) => (
                    <div key={edge.id} className="text-[11px] flex items-center justify-between gap-2">
                      <span className="truncate">
                        {(workflowTaskMap.get(edge.fromTaskId)?.title || 'Görev')} → {(workflowTaskMap.get(edge.toTaskId)?.title || 'Görev')}
                      </span>
                      <button onClick={() => removeEdge(edge.id)} className="text-muted-foreground hover:text-red-400">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
