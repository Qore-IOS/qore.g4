
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, History, Search, ChevronRight, ArrowLeft,
  Calendar, User, MapPin, Tag, X, Filter, ChevronDown,
  Building2, TestTube,
} from 'lucide-react';
import { format, isValid } from 'date-fns';
import { tr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface SayimSessionItem {
  stokKodu: string;
  stokAdi: string;
  marka: string;
  stokAdedi: number;
  cihazUstuAdedi: number;
}

interface SayimSession {
  id: string;
  locationType: 'lab' | 'depot';
  locationId: string;
  locationName: string;
  createdAt: any;
  createdByUid?: string;
  createdByName?: string;
  items: SayimSessionItem[];
  totalBrands: number;
  totalProducts: number;
}

// ============================================================================
// HELPERS
// ============================================================================

function getSessionDate(session: SayimSession): Date | null {
  if (!session.createdAt) return null;
  if (session.createdAt.toDate) return session.createdAt.toDate();
  if (session.createdAt.seconds) return new Date(session.createdAt.seconds * 1000);
  const d = new Date(session.createdAt);
  return isValid(d) ? d : null;
}

function getBrandsFromSession(session: SayimSession): string[] {
  const set = new Set<string>();
  session.items.forEach(item => {
    if (item.marka) set.add(item.marka);
  });
  return Array.from(set).sort();
}

// ============================================================================
// FILTER DROPDOWN COMPONENT
// ============================================================================

interface FilterDropdownProps {
  label: string;
  icon: React.ElementType;
  options: string[];
  selected: string[];
  onToggle: (val: string) => void;
  onClear: () => void;
}

function FilterDropdown({ label, icon: Icon, options, selected, onToggle, onClear }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200',
          selected.length > 0
            ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
            : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
        )}
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="bg-white/20 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
            {selected.length}
          </span>
        )}
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 w-64 cihaz-card-strong rounded-2xl overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-[var(--dashboard-stroke)]">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--dashboard-surface-2)]">
              <Search className="w-3.5 h-3.5 text-[var(--dashboard-muted)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Ara..."
                className="flex-1 bg-transparent text-xs text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)] outline-none"
              />
            </div>
          </div>

          {/* Options */}
          <ScrollArea className="max-h-[200px]">
            <div className="p-1.5">
              {filtered.length === 0 ? (
                <p className="text-xs text-[var(--dashboard-muted)] text-center py-4">Sonuc bulunamadi</p>
              ) : (
                filtered.map(option => (
                  <button
                    key={option}
                    onClick={() => onToggle(option)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-left transition-colors',
                      selected.includes(option)
                        ? 'bg-[var(--dashboard-accent)]/10 text-[var(--dashboard-accent)] font-semibold'
                        : 'text-[var(--dashboard-text)] hover:bg-[var(--dashboard-surface-2)]'
                    )}
                  >
                    <span className={cn(
                      'w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors',
                      selected.includes(option)
                        ? 'border-[var(--dashboard-accent)] bg-[var(--dashboard-accent)]'
                        : 'border-[var(--dashboard-muted)]/30'
                    )}>
                      {selected.includes(option) && (
                        <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>
                      )}
                    </span>
                    <span className="truncate">{option}</span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          {selected.length > 0 && (
            <div className="p-2 border-t border-[var(--dashboard-stroke)]">
              <button
                onClick={onClear}
                className="w-full text-xs text-[var(--dashboard-muted)] hover:text-[var(--dashboard-accent)] py-1 transition-colors"
              >
                Filtreyi Temizle
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DATE RANGE FILTER
// ============================================================================

interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onStartChange: (val: string) => void;
  onEndChange: (val: string) => void;
  onClear: () => void;
}

function DateRangeFilter({ startDate, endDate, onStartChange, onEndChange, onClear }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const hasFilter = startDate || endDate;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200',
          hasFilter
            ? 'bg-[var(--dashboard-accent)] text-white shadow-md'
            : 'bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]'
        )}
      >
        <Calendar className="w-3.5 h-3.5" />
        <span>Tarih</span>
        {hasFilter && (
          <span className="bg-white/20 rounded-full w-2 h-2" />
        )}
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 w-72 cihaz-card-strong rounded-2xl overflow-hidden p-4">
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-[var(--dashboard-muted)] mb-1 block">Baslangic</label>
              <input
                type="date"
                value={startDate}
                onChange={e => onStartChange(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[var(--dashboard-surface-2)] text-xs text-[var(--dashboard-text)] border border-[var(--dashboard-stroke)] outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/30"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--dashboard-muted)] mb-1 block">Bitis</label>
              <input
                type="date"
                value={endDate}
                onChange={e => onEndChange(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[var(--dashboard-surface-2)] text-xs text-[var(--dashboard-text)] border border-[var(--dashboard-stroke)] outline-none focus:ring-2 focus:ring-[var(--dashboard-accent)]/30"
              />
            </div>
            {hasFilter && (
              <button
                onClick={onClear}
                className="w-full text-xs text-[var(--dashboard-muted)] hover:text-[var(--dashboard-accent)] py-1 transition-colors"
              >
                Tarihi Temizle
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function MaliyetSayimGecmisPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SayimSession[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Fetch sessions
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(query(collection(db, 'maliyetSayimSessions'), orderBy('createdAt', 'desc')));
        setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() } as SayimSession)));
      } catch (err) {
        console.error('Error loading sessions:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Extract unique filter options
  const filterOptions = useMemo(() => {
    const locations = new Set<string>();
    const brands = new Set<string>();
    const users = new Set<string>();
    const types = new Set<string>();

    sessions.forEach(s => {
      if (s.locationName) locations.add(s.locationName);
      if (s.createdByName) users.add(s.createdByName);
      types.add(s.locationType === 'lab' ? 'Laboratuvar' : 'Depo');
      s.items.forEach(item => {
        if (item.marka) brands.add(item.marka);
      });
    });

    return {
      locations: Array.from(locations).sort(),
      brands: Array.from(brands).sort(),
      users: Array.from(users).sort(),
      types: Array.from(types).sort(),
    };
  }, [sessions]);

  // Toggle filter helpers
  const toggleFilter = useCallback((arr: string[], setArr: React.Dispatch<React.SetStateAction<string[]>>, val: string) => {
    setArr(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  }, []);

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    return sessions.filter(session => {
      // Text search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchLocation = session.locationName?.toLowerCase().includes(q);
        const matchUser = session.createdByName?.toLowerCase().includes(q);
        const matchBrand = session.items.some(i => i.marka?.toLowerCase().includes(q));
        const matchProduct = session.items.some(i => i.stokAdi?.toLowerCase().includes(q) || i.stokKodu?.toLowerCase().includes(q));
        if (!matchLocation && !matchUser && !matchBrand && !matchProduct) return false;
      }

      // Location filter
      if (selectedLocations.length > 0 && !selectedLocations.includes(session.locationName)) return false;

      // Type filter
      if (selectedTypes.length > 0) {
        const typeLabel = session.locationType === 'lab' ? 'Laboratuvar' : 'Depo';
        if (!selectedTypes.includes(typeLabel)) return false;
      }

      // User filter
      if (selectedUsers.length > 0 && (!session.createdByName || !selectedUsers.includes(session.createdByName))) return false;

      // Brand filter
      if (selectedBrands.length > 0) {
        const sessionBrands = getBrandsFromSession(session);
        const hasMatch = selectedBrands.some(b => sessionBrands.includes(b));
        if (!hasMatch) return false;
      }

      // Date filter
      const sessionDate = getSessionDate(session);
      if (startDate && sessionDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (sessionDate < start) return false;
      }
      if (endDate && sessionDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (sessionDate > end) return false;
      }

      return true;
    });
  }, [sessions, searchQuery, selectedLocations, selectedBrands, selectedUsers, selectedTypes, startDate, endDate]);

  const activeFilterCount = [
    selectedLocations.length > 0,
    selectedBrands.length > 0,
    selectedUsers.length > 0,
    selectedTypes.length > 0,
    startDate || endDate,
    searchQuery,
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedLocations([]);
    setSelectedBrands([]);
    setSelectedUsers([]);
    setSelectedTypes([]);
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="cihaz-shell min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-24">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.push('/cost-dashboard')}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)] text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <History className="h-5 w-5 text-[var(--dashboard-accent)]" />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--dashboard-text)]">Sayim Gecmisi</h1>
              <p className="text-xs sm:text-sm text-[var(--dashboard-muted)]">
                {filteredSessions.length} / {sessions.length} sayim oturumu
              </p>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="cihaz-card-strong rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--dashboard-surface-2)] shadow-[var(--dashboard-pressed)]">
              <Search className="w-4 h-4 text-[var(--dashboard-muted)] shrink-0" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Lokasyon, kullanici, marka veya urun ara..."
                className="flex-1 bg-transparent text-sm text-[var(--dashboard-text)] placeholder:text-[var(--dashboard-muted)] outline-none"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="cihaz-card-strong rounded-2xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-[var(--dashboard-accent)]" />
            <span className="text-xs font-semibold text-[var(--dashboard-text)]">Filtreler</span>
            {activeFilterCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="ml-auto flex items-center gap-1 text-[11px] text-[var(--dashboard-accent)] hover:underline"
              >
                <X className="w-3 h-3" />
                Tumu Temizle ({activeFilterCount})
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
              onClear={() => { setStartDate(''); setEndDate(''); }}
            />
            <FilterDropdown
              label="Lokasyon"
              icon={MapPin}
              options={filterOptions.locations}
              selected={selectedLocations}
              onToggle={val => toggleFilter(selectedLocations, setSelectedLocations, val)}
              onClear={() => setSelectedLocations([])}
            />
            <FilterDropdown
              label="Tip"
              icon={Building2}
              options={filterOptions.types}
              selected={selectedTypes}
              onToggle={val => toggleFilter(selectedTypes, setSelectedTypes, val)}
              onClear={() => setSelectedTypes([])}
            />
            <FilterDropdown
              label="Sayimi Yapan"
              icon={User}
              options={filterOptions.users}
              selected={selectedUsers}
              onToggle={val => toggleFilter(selectedUsers, setSelectedUsers, val)}
              onClear={() => setSelectedUsers([])}
            />
            <FilterDropdown
              label="Marka"
              icon={Tag}
              options={filterOptions.brands}
              selected={selectedBrands}
              onToggle={val => toggleFilter(selectedBrands, setSelectedBrands, val)}
              onClear={() => setSelectedBrands([])}
            />
          </div>
        </div>

        {/* Session List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--dashboard-accent)]" />
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="cihaz-card-strong rounded-2xl p-12 text-center">
            <History className="w-12 h-12 text-[var(--dashboard-muted)] mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium text-[var(--dashboard-text)] mb-1">Sayim Bulunamadi</p>
            <p className="text-xs text-[var(--dashboard-muted)]">
              {activeFilterCount > 0 ? 'Filtreleri degistirmeyi deneyin.' : 'Henuz maliyet sayimi yapilmamis.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSessions.map(session => {
              const date = getSessionDate(session);
              const brands = getBrandsFromSession(session);

              return (
                <button
                  key={session.id}
                  onClick={() => router.push(`/cost-dashboard/gecmis/${session.id}`)}
                  className="w-full cihaz-card hover:shadow-[var(--dashboard-raised)] rounded-2xl p-4 sm:p-5 text-left transition-all duration-200 group"
                >
                  <div className="flex items-start sm:items-center justify-between gap-3">
                    {/* Left: Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider',
                          session.locationType === 'lab'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        )}>
                          {session.locationType === 'lab' ? (
                            <><TestTube className="w-3 h-3" /> Lab</>
                          ) : (
                            <><Building2 className="w-3 h-3" /> Depo</>
                          )}
                        </span>
                        <span className="text-sm font-semibold text-[var(--dashboard-text)] truncate">
                          {session.locationName}
                        </span>
                      </div>

                      {/* Meta row */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--dashboard-muted)]">
                        {date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {format(date, 'dd MMM yyyy HH:mm', { locale: tr })}
                          </span>
                        )}
                        {session.createdByName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {session.createdByName}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          {session.totalProducts || session.items.length} urun
                        </span>
                      </div>

                      {/* Brands */}
                      {brands.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {brands.slice(0, 5).map(brand => (
                            <span
                              key={brand}
                              className="inline-block px-2 py-0.5 rounded-lg bg-[var(--dashboard-surface-2)] text-[10px] font-medium text-[var(--dashboard-muted)]"
                            >
                              {brand}
                            </span>
                          ))}
                          {brands.length > 5 && (
                            <span className="inline-block px-2 py-0.5 rounded-lg bg-[var(--dashboard-surface-2)] text-[10px] font-medium text-[var(--dashboard-accent)]">
                              +{brands.length - 5}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right: Arrow */}
                    <ChevronRight className="w-5 h-5 text-[var(--dashboard-muted)] opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-200 shrink-0 mt-1 sm:mt-0" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
