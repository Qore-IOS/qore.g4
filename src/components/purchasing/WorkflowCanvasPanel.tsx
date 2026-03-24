'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/lib/firebase';
import {
  addDoc,
  collection,
  doc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type {
  PurchasingTask,
  PurchasingWorkflowEdge,
  PurchasingWorkflowNodePosition,
  PurchasingWorkflowProject,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, Link2, Maximize2, Minimize2, Palette, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { companyQuery, addCompanyFilter, companyStamp } from '@/lib/company-filter';

type Props = {
  tasks: PurchasingTask[];
  workflows: PurchasingWorkflowProject[];
  userUid?: string;
  userName?: string;
  onToggleTask?: (task: PurchasingTask) => void;
  onRequestTaskCompletion?: (task: PurchasingTask) => void;
  onRequestCreateTask?: (preset?: { workflowProjectId?: string; workflowColor?: string; x?: number; y?: number }) => void;
  onAttachFilesToTask?: (task: PurchasingTask, files: File[]) => Promise<void>;
};

const PRESET_COLORS = ['#d4ec00', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#f97316'];
const NODE_W = 236;
const NODE_H = 84;
const CANVAS_W = 4200;
const CANVAS_H = 2400;

export default function WorkflowCanvasPanel({
  tasks,
  workflows,
  userUid,
  userName,
  onToggleTask,
  onRequestTaskCompletion,
  onRequestCreateTask,
  onAttachFilesToTask,
}: Props) {
  const { currentCompanyId } = useAuth();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(workflows[0]?.id || '');
  const [newName, setNewName] = useState('Yeni Workflow');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);

  const [localNodes, setLocalNodes] = useState<PurchasingWorkflowNodePosition[]>([]);
  const [draggingNode, setDraggingNode] = useState<{ taskId: string; dx: number; dy: number; pointerId: number } | null>(null);
  const [linkingFromTaskId, setLinkingFromTaskId] = useState<string | null>(null);
  const [linkPointer, setLinkPointer] = useState<{ x: number; y: number } | null>(null);
  const [linkHoverTargetTaskId, setLinkHoverTargetTaskId] = useState<string | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [isMobileFullscreen, setIsMobileFullscreen] = useState(false);
  const [showProjectFiles, setShowProjectFiles] = useState(false);
  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null);
  const [dragHoverTaskId, setDragHoverTaskId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const canvasSectionRef = useRef<HTMLElement | null>(null);
  const localNodesRef = useRef<PurchasingWorkflowNodePosition[]>([]);
  const touchModeRef = useRef<'pan' | 'pinch' | null>(null);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null);

  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflowId),
    [workflows, selectedWorkflowId]
  );

  useEffect(() => {
    if (!selectedWorkflowId && workflows[0]?.id) setSelectedWorkflowId(workflows[0].id);
  }, [workflows, selectedWorkflowId]);

  useEffect(() => {
    setLocalNodes(selectedWorkflow?.nodes || []);
    localNodesRef.current = selectedWorkflow?.nodes || [];
    setDraggingNode(null);
    setLinkingFromTaskId(null);
    setLinkPointer(null);
    setLinkHoverTargetTaskId(null);
    setCanvasContextMenu(null);
    setCanvasScale(1);
  }, [selectedWorkflow?.id, selectedWorkflow?.nodes]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsMobileFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

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

  const workflowFiles = useMemo(() => {
    if (!selectedWorkflow) return [] as Array<{ task: PurchasingTask; attachment: NonNullable<PurchasingTask['attachments']>[number] }>;
    const rows: Array<{ task: PurchasingTask; attachment: NonNullable<PurchasingTask['attachments']>[number] }> = [];
    selectedWorkflow.taskIds.forEach((taskId) => {
      const task = workflowTaskMap.get(taskId);
      if (!task || !task.attachments?.length) return;
      task.attachments.forEach((attachment) => rows.push({ task, attachment }));
    });
    return rows;
  }, [selectedWorkflow, workflowTaskMap]);

  const nodePositionsByTask = useMemo(() => {
    const map = new Map<string, PurchasingWorkflowNodePosition>();
    localNodes.forEach((n) => map.set(n.taskId, n));
    return map;
  }, [localNodes]);

  const completedPathState = useMemo(() => {
    if (!selectedWorkflow) return { completedNodeIds: new Set<string>(), completedEdgeIds: new Set<string>() };
    const edges = selectedWorkflow.edges || [];
    const adjacency = new Map<string, PurchasingWorkflowEdge[]>();
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    selectedWorkflow.taskIds.forEach((taskId) => {
      inDegree.set(taskId, 0);
      outDegree.set(taskId, 0);
      adjacency.set(taskId, []);
    });

    for (const edge of edges) {
      adjacency.set(edge.fromTaskId, [...(adjacency.get(edge.fromTaskId) || []), edge]);
      inDegree.set(edge.toTaskId, (inDegree.get(edge.toTaskId) || 0) + 1);
      outDegree.set(edge.fromTaskId, (outDegree.get(edge.fromTaskId) || 0) + 1);
    }

    const startNodes = selectedWorkflow.taskIds.filter((id) => (inDegree.get(id) || 0) === 0);
    const endNodes = new Set(selectedWorkflow.taskIds.filter((id) => (outDegree.get(id) || 0) === 0));
    const sources = startNodes.length > 0 ? startNodes : selectedWorkflow.taskIds;

    const completedNodeIds = new Set<string>();
    const completedEdgeIds = new Set<string>();

    const dfs = (taskId: string, pathNodes: string[], pathEdges: PurchasingWorkflowEdge[], visited: Set<string>) => {
      const nextVisited = new Set(visited);
      nextVisited.add(taskId);
      const outgoing = adjacency.get(taskId) || [];
      const atEnd = outgoing.length === 0 || endNodes.has(taskId);

      if (atEnd) {
        const allCompleted = pathNodes.every((id) => !!workflowTaskMap.get(id)?.completed);
        if (allCompleted) {
          pathNodes.forEach((id) => completedNodeIds.add(id));
          pathEdges.forEach((e) => completedEdgeIds.add(e.id));
        }
        return;
      }

      for (const edge of outgoing) {
        if (nextVisited.has(edge.toTaskId)) continue;
        dfs(edge.toTaskId, [...pathNodes, edge.toTaskId], [...pathEdges, edge], nextVisited);
      }
    };

    sources.forEach((sourceId) => dfs(sourceId, [sourceId], [], new Set()));
    return { completedNodeIds, completedEdgeIds };
  }, [selectedWorkflow, workflowTaskMap]);

  const clientToCanvasCoords = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (clientX - rect.left + canvasRef.current.scrollLeft) / canvasScale;
    const y = (clientY - rect.top + canvasRef.current.scrollTop) / canvasScale;
    return { x, y };
  };

  const persistNodes = async (nodes: PurchasingWorkflowNodePosition[]) => {
    if (!selectedWorkflow) return;
    try {
      await updateDoc(doc(db, 'purchasingWorkflows', selectedWorkflow.id), { nodes, updatedAt: Timestamp.now() });
    } catch (err) {
      console.error(err);
      toast.error('Kanvas konumu kaydedilemedi');
    }
  };

  const createWorkflow = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const ref = await addDoc(collection(db, 'purchasingWorkflows'), companyStamp({
        name,
        color: newColor,
        taskIds: [],
        nodes: [],
        edges: [],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUid: userUid || null,
        createdByName: userName || null,
      }, currentCompanyId, 'purchasingWorkflows'));
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
        batch.update(doc(db, 'purchasingTasks', taskId), {
          workflowColor: color,
          workflowProjectId: selectedWorkflow.id,
          updatedAt: Timestamp.now(),
        });
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

    const nextNodes = [...(selectedWorkflow.nodes || []), { taskId, x, y }];
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
      toast.success('Görev workflow\'dan çıkarıldı');
    } catch (err) {
      console.error(err);
      toast.error('Görev çıkarılamadı');
    }
  };

  const linkTasks = async (fromTaskId: string, toTaskId: string) => {
    if (!selectedWorkflow || fromTaskId === toTaskId) return;
    const exists = selectedWorkflow.edges.some((e) => e.fromTaskId === fromTaskId && e.toTaskId === toTaskId);
    if (exists) return;
    const next: PurchasingWorkflowEdge[] = [
      ...selectedWorkflow.edges,
      { id: `we_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, fromTaskId, toTaskId },
    ];
    try {
      await updateDoc(doc(db, 'purchasingWorkflows', selectedWorkflow.id), { edges: next, updatedAt: Timestamp.now() });
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

  const startNodeDrag = (e: React.PointerEvent<HTMLDivElement>, taskId: string) => {
    if (e.pointerType === 'touch') return;
    if (!canvasRef.current) return;
    const pos = nodePositionsByTask.get(taskId);
    if (!pos) return;
    const point = clientToCanvasCoords(e.clientX, e.clientY);
    if (!point) return;
    setDraggingNode({
      taskId,
      pointerId: e.pointerId,
      dx: point.x - pos.x,
      dy: point.y - pos.y,
    });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const startLinkDrag = (e: React.PointerEvent<HTMLButtonElement>, fromTaskId: string) => {
    if (e.pointerType === 'touch') return;
    if (!canvasRef.current) return;
    const point = clientToCanvasCoords(e.clientX, e.clientY);
    if (!point) return;
    setLinkingFromTaskId(fromTaskId);
    setLinkHoverTargetTaskId(null);
    setLinkPointer(point);
    e.preventDefault();
    e.stopPropagation();
  };

  useEffect(() => {
    if (!draggingNode && !linkingFromTaskId) return;

    const onPointerMove = (ev: PointerEvent) => {
      const point = clientToCanvasCoords(ev.clientX, ev.clientY);
      if (!point) return;
      const px = point.x;
      const py = point.y;

      if (draggingNode) {
        const nextX = Math.max(8, Math.min(CANVAS_W - NODE_W - 8, px - draggingNode.dx));
        const nextY = Math.max(8, Math.min(CANVAS_H - NODE_H - 8, py - draggingNode.dy));
        setLocalNodes((prev) => {
          const next = prev.map((n) => (n.taskId === draggingNode.taskId ? { ...n, x: nextX, y: nextY } : n));
          localNodesRef.current = next;
          return next;
        });
      }

      if (linkingFromTaskId) {
        setLinkPointer({ x: px, y: py });
      }
    };

    const onPointerUp = async () => {
      if (draggingNode) {
        setDraggingNode(null);
        const snapshot = [...localNodesRef.current];
        await persistNodes(snapshot);
      }
      if (linkingFromTaskId) {
        const from = linkingFromTaskId;
        const target = linkHoverTargetTaskId;
        setLinkingFromTaskId(null);
        setLinkPointer(null);
        setLinkHoverTargetTaskId(null);
        if (target) await linkTasks(from, target);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [draggingNode, linkingFromTaskId, linkHoverTargetTaskId]);

  const handleWorkflowTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;
    if (e.touches.length >= 2) {
      touchModeRef.current = 'pinch';
      const [a, b] = [e.touches[0], e.touches[1]];
      const distance = Math.hypot((a?.clientX || 0) - (b?.clientX || 0), (a?.clientY || 0) - (b?.clientY || 0));
      pinchStartRef.current = { distance, scale: canvasScale };
      return;
    }
    if (e.touches.length === 1) {
      touchModeRef.current = 'pan';
      const t = e.touches[0];
      panStartRef.current = {
        x: t.clientX,
        y: t.clientY,
        scrollLeft: canvasRef.current.scrollLeft,
        scrollTop: canvasRef.current.scrollTop,
      };
    }
  };

  const handleWorkflowTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;
    if (touchModeRef.current === 'pinch' && e.touches.length >= 2 && pinchStartRef.current) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const distance = Math.hypot((a?.clientX || 0) - (b?.clientX || 0), (a?.clientY || 0) - (b?.clientY || 0));
      const ratio = distance / Math.max(pinchStartRef.current.distance, 1);
      const nextScale = Math.max(0.65, Math.min(2.1, pinchStartRef.current.scale * ratio));
      setCanvasScale(nextScale);
      return;
    }
    if (touchModeRef.current === 'pan' && e.touches.length === 1 && panStartRef.current) {
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - panStartRef.current.x;
      const dy = t.clientY - panStartRef.current.y;
      canvasRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      canvasRef.current.scrollTop = panStartRef.current.scrollTop - dy;
    }
  };

  const handleWorkflowTouchEnd = () => {
    touchModeRef.current = null;
    panStartRef.current = null;
    pinchStartRef.current = null;
  };

  const toggleMobileFullscreen = async () => {
    const target = canvasSectionRef.current;
    if (!target) return;
    try {
      if (!document.fullscreenElement) {
        await target.requestFullscreen();
        await (screen.orientation as any)?.lock?.('landscape').catch(() => undefined);
      } else {
        await document.exitFullscreen();
        await (screen.orientation as any)?.unlock?.();
      }
    } catch (err) {
      console.error(err);
      toast.error('Tam ekran açılamadı');
    }
  };

  const handleTaskFileDrop = async (task: PurchasingTask, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragHoverTaskId(null);
    if (!onAttachFilesToTask) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    setUploadingTaskId(task.id);
    try {
      await onAttachFilesToTask(task, files);
      toast.success(`${files.length} dosya göreve eklendi`);
    } catch (err) {
      console.error(err);
      toast.error('Dosyalar göreve eklenemedi');
    } finally {
      setUploadingTaskId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[320px,1fr] gap-3 min-w-0">
      <aside className="rounded-2xl border border-border bg-card p-3 space-y-3 shadow-sm">
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
              <button key={c} onClick={() => setNewColor(c)} className={cn('w-6 h-6 rounded-full border shadow-sm', newColor === c ? 'ring-2 ring-offset-1 ring-offset-background ring-foreground/60' : 'border-foreground/20')} style={{ backgroundColor: c }} />
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
                    className={cn('w-6 h-6 rounded-full border shadow-sm', selectedWorkflow.color === c ? 'ring-2 ring-offset-1 ring-offset-background ring-foreground/60' : 'border-foreground/20')}
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

            <button
              type="button"
              onClick={() => setShowProjectFiles(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-border bg-card hover:bg-accent"
            >
              Dosyalarım ({workflowFiles.length})
            </button>
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
                  className={cn(
                    'rounded-lg border px-2 py-1.5 text-xs transition-all',
                    inSelectedWorkflow
                      ? 'border-2 shadow-sm bg-[#d4ec00]/12 border-[#7a8a00] dark:border-[#d4ec00]'
                      : 'bg-card border-border'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {task.completed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className={cn('truncate font-medium', inSelectedWorkflow ? 'text-foreground' : 'text-foreground/85')}>{task.title}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{task.date} • {task.startTime}-{task.endTime}</p>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <section
        ref={canvasSectionRef}
        className={cn(
          'rounded-2xl border border-border bg-card p-3 min-h-[72vh] shadow-sm min-w-0 relative',
          isMobileFullscreen && 'fixed inset-0 z-[80] rounded-none border-none p-2 min-h-0'
        )}
      >
        {!selectedWorkflow ? (
          <div className="h-full min-h-[300px] flex items-center justify-center text-sm text-muted-foreground">Önce bir workflow seçin veya oluşturun.</div>
        ) : (
          <div
            ref={canvasRef}
            className="relative rounded-xl border border-border min-h-[68vh] overflow-auto w-full"
            onDragOver={(e) => e.preventDefault()}
            onContextMenu={(e) => {
              e.preventDefault();
              const point = clientToCanvasCoords(e.clientX, e.clientY);
              if (!point) return;
              setCanvasContextMenu({
                x: point.x,
                y: point.y,
              });
            }}
            onClick={() => setCanvasContextMenu(null)}
            onTouchStart={handleWorkflowTouchStart}
            onTouchMove={handleWorkflowTouchMove}
            onTouchEnd={handleWorkflowTouchEnd}
            style={{
              backgroundColor: 'hsl(var(--card))',
              backgroundImage:
                'linear-gradient(to right, rgba(0,0,0,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.12) 1px, transparent 1px)',
              backgroundSize: `${24 * canvasScale}px ${24 * canvasScale}px`,
              touchAction: 'none',
            }}
            onDrop={(e) => {
              e.preventDefault();
              const taskId = e.dataTransfer.getData('application/x-task-id');
              const point = clientToCanvasCoords(e.clientX, e.clientY);
              if (!taskId || !point) return;
              const x = point.x - NODE_W / 2;
              const y = point.y - NODE_H / 2;
              addTaskToCanvas(
                taskId,
                Math.max(12, Math.min(CANVAS_W - NODE_W - 12, x)),
                Math.max(12, Math.min(CANVAS_H - NODE_H - 12, y))
              );
              setCanvasContextMenu(null);
            }}
          >
            <button
              type="button"
              onClick={toggleMobileFullscreen}
              className="md:hidden absolute right-2 top-2 z-30 inline-flex items-center gap-1 rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-xs"
            >
              {isMobileFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />} Tam Ekran
            </button>

            <div className="relative" style={{ width: CANVAS_W * canvasScale, height: CANVAS_H * canvasScale }}>
              <div className="relative origin-top-left" style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${canvasScale})` }}>
              {canvasContextMenu && (
                <div
                  className="absolute z-40 w-48 rounded-xl border border-border bg-popover shadow-lg p-1"
                  style={{ left: Math.min(canvasContextMenu.x, CANVAS_W - 200), top: Math.min(canvasContextMenu.y, CANVAS_H - 80) }}
                >
                  <button
                    type="button"
                    className="w-full text-left px-2.5 py-2 text-xs rounded-lg hover:bg-accent"
                    onClick={() => {
                      onRequestCreateTask?.({
                        workflowProjectId: selectedWorkflow.id,
                        workflowColor: selectedWorkflow.color,
                        x: canvasContextMenu.x,
                        y: canvasContextMenu.y,
                      });
                      setCanvasContextMenu(null);
                    }}
                  >
                    + Görev Ekle
                  </button>
                </div>
              )}

              <div
                className="pointer-events-none absolute inset-0 dark:block hidden"
                style={{
                  backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(239,68,68,0.16), transparent 35%), radial-gradient(circle at 75% 60%, rgba(59,130,246,0.16), transparent 35%)',
                }}
              />

            <svg className="absolute inset-0 pointer-events-none" width={CANVAS_W} height={CANVAS_H}>
              <defs>
                <filter id="workflow-complete-glow" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="2.6" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
            {(selectedWorkflow.edges || []).map((edge) => {
                const from = nodePositionsByTask.get(edge.fromTaskId);
                const to = nodePositionsByTask.get(edge.toTaskId);
                if (!from || !to) return null;
                const isFlowCompleted = completedPathState.completedEdgeIds.has(edge.id);
                const x1 = from.x + NODE_W;
                const y1 = from.y + NODE_H / 2;
                const x2 = to.x;
                const y2 = to.y + NODE_H / 2;
                const c1 = x1 + 70;
                const c2 = x2 - 70;
                const pathD = `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
                return (
                  <g key={edge.id}>
                    {!isFlowCompleted && <path d={pathD} stroke={selectedWorkflow.color} strokeWidth="2.4" fill="none" opacity="0.95" />}
                    {isFlowCompleted && (
                      <>
                        <path d={pathD} stroke="#22c55e" strokeWidth="3.2" fill="none" opacity="0.95" filter="url(#workflow-complete-glow)" />
                        <path d={pathD} stroke="#86efac" strokeWidth="4.2" fill="none" strokeDasharray="8 15" strokeLinecap="round" opacity="0.95" filter="url(#workflow-complete-glow)">
                          <animate attributeName="stroke-dashoffset" from="0" to="-46" dur="1s" repeatCount="indefinite" />
                        </path>
                      </>
                    )}
                  </g>
                );
              })}

              {linkingFromTaskId && linkPointer && (() => {
                const from = nodePositionsByTask.get(linkingFromTaskId);
                if (!from) return null;
                const x1 = from.x + NODE_W;
                const y1 = from.y + NODE_H / 2;
                const x2 = linkPointer.x;
                const y2 = linkPointer.y;
                const c1 = x1 + 70;
                const c2 = x2 - 70;
                return (
                  <path d={`M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`} stroke={selectedWorkflow.color} strokeWidth="2.4" strokeDasharray="6 6" fill="none" opacity="0.9" />
                );
              })()}
            </svg>

            {localNodes.map((node) => {
              const task = workflowTaskMap.get(node.taskId);
              if (!task) return null;
              const isLinkFrom = linkingFromTaskId === task.id;
              const isLinkHover = linkHoverTargetTaskId === task.id;
              const isFileDragHover = dragHoverTaskId === task.id;
              return (
                <div
                  key={task.id}
                  className="absolute w-[236px]"
                  style={{ left: node.x, top: node.y }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.files?.length > 0) {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragHoverTaskId(task.id);
                    }
                  }}
                  onDragLeave={() => setDragHoverTaskId((prev) => (prev === task.id ? null : prev))}
                  onDrop={(e) => handleTaskFileDrop(task, e)}
                >
                  <div className="absolute -left-2 top-1/2 -translate-y-1/2 z-20">
                    <button
                      onPointerEnter={() => linkingFromTaskId && setLinkHoverTargetTaskId(task.id)}
                      onPointerLeave={() => setLinkHoverTargetTaskId((prev) => (prev === task.id ? null : prev))}
                      className={cn(
                        'w-5 h-5 rounded-full border-2 shadow bg-background transition-all',
                        isLinkHover ? 'border-sky-500 ring-2 ring-sky-500/30 scale-110' : 'border-foreground/40',
                        linkingFromTaskId ? 'cursor-copy' : 'cursor-default'
                      )}
                      title="Giriş pini"
                    />
                  </div>

                  <div
                    onPointerDown={(e) => startNodeDrag(e, task.id)}
                    className={cn(
                      'rounded-lg border px-2.5 py-2 shadow-sm select-none cursor-move backdrop-blur-[1px] transition-all',
                      'bg-white/95 dark:bg-zinc-900/90',
                      draggingNode?.taskId === task.id ? 'ring-2 ring-sky-500/40' : '',
                      isFileDragHover ? 'ring-2 ring-emerald-500/50 bg-emerald-500/5' : ''
                    )}
                    style={{ borderColor: completedPathState.completedNodeIds.has(task.id) ? '#22c55e' : selectedWorkflow.color }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold truncate text-zinc-800 dark:text-zinc-100">{task.title}</p>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (task.completed) onToggleTask?.(task);
                            else onRequestTaskCompletion?.(task);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={cn('text-[10px] px-1.5 py-0.5 rounded border', task.completed ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400' : 'border-amber-500/40 text-amber-700 dark:text-amber-400')}
                          title="Tamamlandı durumunu değiştir"
                        >
                          {task.completed ? 'Aç' : 'Tamamla'}
                        </button>
                        <button onClick={() => removeTaskFromWorkflow(task.id)} className="text-zinc-500 hover:text-red-500 dark:text-zinc-400" onPointerDown={(e) => e.stopPropagation()}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-zinc-600 dark:text-zinc-400 mt-1">{task.date} • {task.startTime}-{task.endTime}</p>
                    {uploadingTaskId === task.id && <p className="text-[10px] text-emerald-600 mt-1">Dosyalar yükleniyor...</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded', task.completed ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400')}>
                        {task.completed ? 'Tamamlandı' : 'Bekliyor'}
                      </span>
                      {isLinkFrom && <span className="text-[10px] text-sky-600 dark:text-sky-400 inline-flex items-center gap-1"><Link2 className="w-3 h-3" /> Bağlantı</span>}
                    </div>
                  </div>

                  <div className="absolute -right-2 top-1/2 -translate-y-1/2 z-20">
                    <button
                      onPointerDown={(e) => startLinkDrag(e, task.id)}
                      className={cn(
                        'w-5 h-5 rounded-full border-2 shadow bg-background transition-all',
                        isLinkFrom ? 'border-sky-500 ring-2 ring-sky-500/30 scale-110' : 'border-foreground/40'
                      )}
                      title="Çıkış pini"
                    />
                  </div>
                </div>
              );
            })}

            {(selectedWorkflow.edges || []).length > 0 && (
              <div className="absolute right-2 top-2 rounded-lg border border-border bg-card/85 p-2 max-w-[260px] shadow-sm">
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
            </div>
            {showProjectFiles && selectedWorkflow && (
              <div className="absolute inset-0 z-40 bg-black/50 backdrop-blur-[1px] flex items-center justify-center p-3" onClick={() => setShowProjectFiles(false)}>
                <div className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-2xl border border-border bg-card" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between p-3 border-b border-border">
                    <div>
                      <p className="text-sm font-semibold">{selectedWorkflow.name} • Dosyalarım</p>
                      <p className="text-xs text-muted-foreground">Bu projedeki görevlere eklenmiş dosyalar</p>
                    </div>
                    <button type="button" className="text-xs px-2 py-1 rounded border border-border" onClick={() => setShowProjectFiles(false)}>Kapat</button>
                  </div>
                  <div className="p-3 space-y-2 overflow-y-auto max-h-[calc(80vh-72px)]">
                    {workflowFiles.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Bu projede henüz dosya yok.</p>
                    ) : (
                      workflowFiles.map(({ task, attachment }, idx) => (
                        <div key={`${task.id}-${attachment.storagePath}-${idx}`} className="rounded-xl border border-border p-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm truncate">{attachment.name}</p>
                              <p className="text-[11px] text-muted-foreground truncate">Görev: {task.title}</p>
                            </div>
                            <a
                              href={attachment.url}
                              download={attachment.name}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs px-2 py-1 rounded border border-border hover:bg-accent shrink-0"
                            >
                              İndir
                            </a>
                          </div>
                          <div className="mt-2">
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded', task.completed ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-700')}>
                              {task.completed ? 'Tamamlandı' : 'Tamamlanmadı'}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
