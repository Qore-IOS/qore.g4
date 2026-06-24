'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  CartesianGrid, LineChart, Line,
} from 'recharts';
import { X, TrendingUp, BarChart2 } from 'lucide-react';

export interface FlatTask {
  id: string;
  title: string;
  completed: boolean;
  parentId: string | null;
  userId: string;
  companyId: string;
  createdAt: any;
  dueDate: string | null;
  priority?: 'low' | 'medium' | 'high' | null;
  order?: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  flatTasks: FlatTask[];
  themeColor: string;
}

export default function NoxStatsOverlay({ isOpen, onClose, flatTasks, themeColor }: Props) {
  const stats = useMemo(() => {
    const total = flatTasks.length;
    const completed = flatTasks.filter(t => t.completed).length;
    const pending = total - completed;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const highCompleted = flatTasks.filter(t => t.priority === 'high' && t.completed).length;
    const highPending = flatTasks.filter(t => t.priority === 'high' && !t.completed).length;
    const mediumCompleted = flatTasks.filter(t => t.priority === 'medium' && t.completed).length;
    const mediumPending = flatTasks.filter(t => t.priority === 'medium' && !t.completed).length;
    const lowCompleted = flatTasks.filter(t => t.priority === 'low' && t.completed).length;
    const lowPending = flatTasks.filter(t => t.priority === 'low' && !t.completed).length;
    const noneCompleted = flatTasks.filter(t => (!t.priority || t.priority === null) && t.completed).length;
    const nonePending = flatTasks.filter(t => (!t.priority || t.priority === null) && !t.completed).length;

    const chartData = [
      { name: 'Yüksek', 'Tamamlanan': highCompleted, 'Bekleyen': highPending },
      { name: 'Orta', 'Tamamlanan': mediumCompleted, 'Bekleyen': mediumPending },
      { name: 'Düşük', 'Tamamlanan': lowCompleted, 'Bekleyen': lowPending },
      { name: 'Belirsiz', 'Tamamlanan': noneCompleted, 'Bekleyen': nonePending },
    ];

    const now = new Date();
    const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

    const densityData = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayTasks = flatTasks.filter(t => t.dueDate?.trim() === dateStr);
      return {
        name: `${d.getDate()} ${months[d.getMonth()]}`,
        'Tamamlanan': dayTasks.filter(t => t.completed).length,
        'Bekleyen': dayTasks.filter(t => !t.completed).length,
      };
    });

    const trendData = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - (6 - i));
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return {
        name: `${d.getDate()} ${months[d.getMonth()]}`,
        'Tamamlanan': flatTasks.filter(t => t.completed && t.dueDate?.trim() === dateStr).length,
      };
    });

    return { total, completed, pending, completionRate, chartData, densityData, trendData };
  }, [flatTasks]);

  if (!isOpen) return null;

  const tooltipStyle = {
    backgroundColor: 'var(--bg-color, #000000)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: '1rem',
    color: 'var(--theme-color, #ffffff)',
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 bg-brand-bg/60 backdrop-blur-md z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.7, y: 40, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.8, y: 20, opacity: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 400, mass: 0.8 }}
        className="bg-brand-bg border border-brand-fg/10 p-6 md:p-8 w-full max-w-4xl rounded-[2rem] shadow-2xl overflow-y-auto max-h-[90vh] flex flex-col gap-6 relative"
        onClick={e => e.stopPropagation()}
      >
        <div className="absolute top-4 right-4">
          <button onClick={onClose} className="p-2 opacity-50 hover:opacity-100 rounded-full bg-brand-fg/5">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <BarChart2 className="w-6 h-6" style={{ color: themeColor }} />
          <h3 className="text-xl md:text-2xl font-bold tracking-tight">GÖREV ANALİZİ</h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Toplam Görev', value: stats.total, cls: '' },
            { label: 'Tamamlanan', value: stats.completed, cls: 'text-green-400' },
            { label: 'Bekleyen', value: stats.pending, cls: 'opacity-80' },
            { label: 'Başarı Oranı', value: `%${stats.completionRate}`, cls: '', style: { color: themeColor } },
          ].map(({ label, value, cls, style }) => (
            <div key={label} className="p-4 bg-brand-fg/5 rounded-2xl flex flex-col gap-1">
              <span className={`text-[10px] uppercase tracking-wider opacity-40 ${cls}`}>{label}</span>
              <span className={`text-2xl font-bold font-mono ${cls}`} style={style}>{value}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-widest opacity-40 font-semibold">ÖNCELİK DAĞILIMI</span>
            <div className="h-60 w-full mt-2 font-mono text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" tickLine={false} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.4)" tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: '10px' }} />
                  <Bar dataKey="Tamamlanan" stackId="a" fill={themeColor} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Bekleyen" stackId="a" fill="rgba(255,255,255,0.15)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-widest opacity-40 font-semibold">ÖNÜMÜZDEKİ 7 GÜNÜN GÖREV YOĞUNLUĞU</span>
            <div className="h-60 w-full mt-2 font-mono text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.densityData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" tickLine={false} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.4)" tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: '10px' }} />
                  <Bar dataKey="Tamamlanan" stackId="b" fill="rgba(34,197,94,0.85)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Bekleyen" stackId="b" fill={themeColor} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="col-span-1 md:col-span-2 flex flex-col gap-2 border-t border-brand-fg/10 pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-400" />
              <span className="text-xs uppercase tracking-widest opacity-50 font-semibold text-green-400">
                HAFTALIK TAMAMLANAN GÖREV TRENDİ (SON 7 GÜN)
              </span>
            </div>
            <div className="h-60 w-full mt-2 font-mono text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.trendData} margin={{ top: 10, right: 15, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" tickLine={false} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.4)" tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ ...tooltipStyle, color: 'rgba(255,255,255,0.9)' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: '10px' }} />
                  <Line
                    type="monotone"
                    dataKey="Tamamlanan"
                    stroke={themeColor}
                    strokeWidth={3}
                    dot={{ r: 4, stroke: themeColor, strokeWidth: 2, fill: '#111111' }}
                    activeDot={{ r: 7 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
