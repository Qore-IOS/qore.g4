"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { withCompanyScope } from "@/lib/company-scope";
import { scopedQuery } from "@/lib/firestore-helpers";
import { db, storage } from "@/lib/firebase";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Search,
  ArrowLeft,
  X,
  ImagePlus,
  Trash2,
  Loader2,
  CheckCircle2,
  Clock,
  Copy,
  ChevronRight,
  Filter,
  Download,
  MessageSquarePlus,
  LifeBuoy,
  AlertCircle,
  Eye,
  Send,
  RotateCcw,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  User as AppUser,
  UserRequest,
  UserRequestCategory,
  UserRequestPriority,
  UserRequestStatus,
  UserRequestComment,
  TimestampLike,
} from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  emitUserRequestCreated,
  emitUserRequestCompleted,
} from "@/lib/notifications";

// ─── Helpers ────────────────────────────────────────────────
function tsToDate(ts: TimestampLike): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === "number") return new Date(ts);
  if (typeof ts === "string") return new Date(ts);
  if (typeof ts === "object" && "toDate" in ts && ts.toDate)
    return ts.toDate();
  if (typeof ts === "object" && "seconds" in ts && ts.seconds)
    return new Date(ts.seconds * 1000);
  return null;
}

function formatDate(ts: TimestampLike): string {
  const d = tsToDate(ts);
  if (!d) return "-";
  const day = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${day}.${month} ${hours}:${minutes}`;
}

const CATEGORY_LABELS: Record<UserRequestCategory, string> = {
  bug: "Hata",
  improvement: "İyileştirme",
  feature: "Yeni Özellik",
  design: "Tasarım",
};

const PRIORITY_LABELS: Record<UserRequestPriority, string> = {
  low: "Düşük",
  normal: "Normal",
  urgent: "Acil",
};

const STATUS_LABELS: Record<UserRequestStatus, string> = {
  open: "Açık",
  reviewing: "İnceleniyor",
  done: "Tamamlandı",
};

const PRIORITY_SORT_ORDER: Record<UserRequestPriority, number> = {
  urgent: 0,
  normal: 1,
  low: 2,
};

// ─── Main Panel ─────────────────────────────────────────────
type TabView = "my-requests" | "all-requests";
type DetailSource = "my" | "admin";

export default function KullaniciTalepPanel() {
  const { currentUserProfile, isAdminDeveloper } = useAuth();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const uid = currentUserProfile?.uid || "";

  // Tab state
  const [activeTab, setActiveTab] = useState<TabView>("my-requests");

  // Detail view state
  const [selectedRequest, setSelectedRequest] = useState<UserRequest | null>(null);
  const [detailSource, setDetailSource] = useState<DetailSource>("my");

  // Create modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const openDetail = (req: UserRequest, source: DetailSource) => {
    setSelectedRequest(req);
    setDetailSource(source);
  };

  const closeDetail = () => setSelectedRequest(null);

  if (selectedRequest) {
    return (
      <RequestDetail
        request={selectedRequest}
        onBack={closeDetail}
        isAdminDeveloper={isAdminDeveloper}
        source={detailSource}
        isDark={isDark}
        uid={uid}
        userName={currentUserProfile?.name || ""}
        userRole={currentUserProfile?.role || "user"}
      />
    );
  }

  return (
    <div className="flex flex-col w-full max-w-5xl mx-auto px-3 md:px-4 py-4 gap-4">
      {/* Header - matches orders/transfer panel style */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            isDark ? "bg-amber-500/15" : "bg-amber-50 border border-amber-200/50"
          )}>
            <LifeBuoy className={cn("w-5 h-5", isDark ? "text-amber-400" : "text-amber-600")} />
          </div>
          <div>
            <h1 className={cn("text-xl md:text-2xl font-bold tracking-tight", isDark ? "text-white" : "text-gray-900")}>
              Talepler
            </h1>
          </div>
        </div>
        <Button
          onClick={() => setIsCreateOpen(true)}
          className="rounded-xl gap-2 bg-amber-500 hover:bg-amber-600 text-white shadow-md hover:shadow-lg transition-all h-10 px-4"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Talep Aç</span>
        </Button>
      </div>

      {/* Tabs - consistent with orders panel tabs */}
      <div className={cn(
        "flex rounded-xl p-1 gap-1",
        isDark ? "bg-white/5 border border-white/10" : "bg-gray-100 border border-gray-200/50"
      )}>
        <button
          onClick={() => setActiveTab("my-requests")}
          className={cn(
            "flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
            activeTab === "my-requests"
              ? isDark
                ? "bg-white/10 text-white shadow-sm"
                : "bg-white text-gray-900 shadow-sm"
              : isDark
              ? "text-white/50 hover:text-white/70"
              : "text-gray-500 hover:text-gray-700"
          )}
        >
          Taleplerim
        </button>
        <button
          onClick={() => setActiveTab("all-requests")}
          className={cn(
            "flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
            activeTab === "all-requests"
              ? isDark
                ? "bg-white/10 text-white shadow-sm"
                : "bg-white text-gray-900 shadow-sm"
              : isDark
              ? "text-white/50 hover:text-white/70"
              : "text-gray-500 hover:text-gray-700"
          )}
        >
          Tüm Talepler
        </button>
      </div>

      {/* Content */}
      {activeTab === "my-requests" ? (
        <MyRequestsList uid={uid} isDark={isDark} onOpenDetail={(r) => openDetail(r, "my")} onCreateNew={() => setIsCreateOpen(true)} />
      ) : (
        <AllRequestsList uid={uid} isDark={isDark} onOpenDetail={(r) => openDetail(r, "admin")} isAdminDeveloper={isAdminDeveloper} />
      )}

      {/* Create Modal */}
      <CreateRequestModal
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        uid={uid}
        userName={currentUserProfile?.name || "Kullanıcı"}
        isDark={isDark}
      />
    </div>
  );
}

// ─── KPI Stats Bar ─────────────────────────────────────────
function KpiStats({
  requests,
  isDark,
}: {
  requests: UserRequest[];
  isDark: boolean;
}) {
  const openCount = requests.filter((r) => r.status === "open").length;
  const reviewingCount = requests.filter((r) => r.status === "reviewing").length;
  const doneCount = requests.filter((r) => r.status === "done").length;
  const urgentCount = requests.filter((r) => r.priority === "urgent" && r.status !== "done").length;

  const stats = [
    { label: "Açık", value: openCount, color: isDark ? "text-amber-400" : "text-amber-600", bg: isDark ? "bg-amber-500/10" : "bg-amber-50" },
    { label: "İnceleniyor", value: reviewingCount, color: isDark ? "text-blue-400" : "text-blue-600", bg: isDark ? "bg-blue-500/10" : "bg-blue-50" },
    { label: "Tamamlandı", value: doneCount, color: isDark ? "text-emerald-400" : "text-emerald-600", bg: isDark ? "bg-emerald-500/10" : "bg-emerald-50" },
  ];

  if (urgentCount > 0) {
    stats.push({ label: "Acil", value: urgentCount, color: isDark ? "text-red-400" : "text-red-600", bg: isDark ? "bg-red-500/10" : "bg-red-50" });
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {stats.map((s) => (
        <div
          key={s.label}
          className={cn(
            "flex flex-col items-center justify-center py-3 rounded-xl border",
            s.bg,
            isDark ? "border-white/5" : "border-gray-200/50"
          )}
        >
          <span className={cn("text-xl font-bold tabular-nums", s.color)}>{s.value}</span>
          <span className={cn("text-[11px] font-medium mt-0.5", isDark ? "text-white/50" : "text-gray-500")}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── My Requests List ───────────────────────────────────────
function MyRequestsList({
  uid,
  isDark,
  onOpenDetail,
  onCreateNew,
}: {
  uid: string;
  isDark: boolean;
  onOpenDetail: (r: UserRequest) => void;
  onCreateNew: () => void;
}) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "reviewing" | "done">("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!uid) return;
    const q = scopedQuery(
      "userRequests",
      currentCompanyId,
      isSuperAdmin,
      where("createdBy", "==", uid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserRequest));
      setRequests(items);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [uid]);

  const filtered = useMemo(() => {
    let list = requests;
    if (filter === "open") list = list.filter((r) => r.status === "open");
    if (filter === "reviewing") list = list.filter((r) => r.status === "reviewing");
    if (filter === "done") list = list.filter((r) => r.status === "done");
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => r.title.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q));
    }
    return list;
  }, [requests, filter, searchQuery]);

  const openCount = requests.filter((r) => r.status === "open").length;
  const reviewingCount = requests.filter((r) => r.status === "reviewing").length;
  const doneCount = requests.filter((r) => r.status === "done").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* KPI Stats */}
      <KpiStats requests={requests} isDark={isDark} />

      {/* Segment control + search */}
      <div className={cn(
        "flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between p-3 rounded-xl",
        isDark ? "bg-white/[0.03] border border-white/5" : "bg-white/50 border border-gray-200/50"
      )}>
        <div className="flex gap-1.5 flex-wrap">
          {([
            { key: "all" as const, label: `Tümü (${requests.length})` },
            { key: "open" as const, label: `Açık (${openCount})` },
            { key: "reviewing" as const, label: `İnceleniyor (${reviewingCount})` },
            { key: "done" as const, label: `Tamamlandı (${doneCount})` },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                filter === key
                  ? isDark
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : "bg-amber-100 text-amber-700 border border-amber-200"
                  : isDark
                  ? "text-white/50 hover:text-white/70 hover:bg-white/5"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Başlıkta ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "pl-9 h-9 rounded-lg text-sm w-full sm:w-56 border-0",
              isDark ? "bg-white/5 text-white placeholder:text-white/40" : "bg-gray-100 placeholder:text-gray-400"
            )}
          />
        </div>
      </div>

      {/* Request list */}
      {filtered.length === 0 ? (
        <EmptyState isDark={isDark} onCreateNew={onCreateNew} />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              isDark={isDark}
              onClick={() => onOpenDetail(req)}
              showUser={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── All Requests List ──────────────────────────────────────
function AllRequestsList({
  uid,
  isDark,
  onOpenDetail,
  isAdminDeveloper,
}: {
  uid: string;
  isDark: boolean;
  onOpenDetail: (r: UserRequest) => void;
  isAdminDeveloper: boolean;
}) {
  const { currentCompanyId, isSuperAdmin } = useAuth();
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "reviewing" | "done">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<UserRequestCategory | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<UserRequestPriority | "all">("all");

  useEffect(() => {
    const q = scopedQuery(
      "userRequests",
      currentCompanyId,
      isSuperAdmin,
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as UserRequest));
      setRequests(items);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    let list = requests;
    if (filter === "open") list = list.filter((r) => r.status === "open");
    if (filter === "reviewing") list = list.filter((r) => r.status === "reviewing");
    if (filter === "done") list = list.filter((r) => r.status === "done");
    if (categoryFilter !== "all") list = list.filter((r) => r.category === categoryFilter);
    if (priorityFilter !== "all") list = list.filter((r) => r.priority === priorityFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q) ||
          r.createdByName?.toLowerCase().includes(q)
      );
    }
    // Sort: open requests by priority (urgent first), then by date
    list = [...list].sort((a, b) => {
      if (a.status !== "done" && b.status === "done") return -1;
      if (a.status === "done" && b.status !== "done") return 1;
      if (a.status !== "done" && b.status !== "done") {
        const pa = PRIORITY_SORT_ORDER[a.priority] ?? 1;
        const pb = PRIORITY_SORT_ORDER[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
      }
      const dateA = tsToDate(a.createdAt)?.getTime() ?? 0;
      const dateB = tsToDate(b.createdAt)?.getTime() ?? 0;
      return dateB - dateA;
    });
    return list;
  }, [requests, filter, searchQuery, categoryFilter, priorityFilter]);

  const openCount = requests.filter((r) => r.status === "open").length;
  const reviewingCount = requests.filter((r) => r.status === "reviewing").length;
  const doneCount = requests.filter((r) => r.status === "done").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* KPI Stats */}
      <KpiStats requests={requests} isDark={isDark} />

      {/* Primary filters */}
      <div className={cn(
        "flex flex-col gap-2 p-3 rounded-xl",
        isDark ? "bg-white/[0.03] border border-white/5" : "bg-white/50 border border-gray-200/50"
      )}>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div className="flex gap-1.5 flex-wrap">
            {([
              { key: "all" as const, label: `Tümü (${requests.length})` },
              { key: "open" as const, label: `Açık (${openCount})` },
              { key: "reviewing" as const, label: `İnceleniyor (${reviewingCount})` },
              { key: "done" as const, label: `Tamamlandı (${doneCount})` },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  filter === key
                    ? isDark
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "bg-amber-100 text-amber-700 border border-amber-200"
                    : isDark
                    ? "text-white/50 hover:text-white/70 hover:bg-white/5"
                    : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Başlık, açıklama veya kullanıcı..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={cn(
                  "pl-9 h-9 rounded-lg text-sm w-full sm:w-64 border-0",
                  isDark ? "bg-white/5 text-white placeholder:text-white/40" : "bg-gray-100 placeholder:text-gray-400"
                )}
              />
            </div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all",
                showAdvanced
                  ? isDark
                    ? "bg-white/10 text-white"
                    : "bg-gray-200 text-gray-800"
                  : isDark
                  ? "text-white/40 hover:text-white/60 hover:bg-white/5"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              )}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filtre
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Advanced filters */}
        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className={cn(
                "flex flex-col gap-2 pt-2 mt-2",
                isDark ? "border-t border-white/5" : "border-t border-gray-200/50"
              )}>
                {/* Category */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("text-[11px] font-medium w-16 shrink-0", isDark ? "text-white/40" : "text-gray-400")}>
                    Kategori
                  </span>
                  {(["all", "bug", "improvement", "feature", "design"] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setCategoryFilter(c)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all",
                        categoryFilter === c
                          ? isDark
                            ? "bg-white/10 text-white border border-white/20"
                            : "bg-gray-800 text-white"
                          : isDark
                          ? "text-white/40 hover:text-white/60 hover:bg-white/5"
                          : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      {c === "all" ? "Tümü" : CATEGORY_LABELS[c]}
                    </button>
                  ))}
                </div>

                {/* Priority */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("text-[11px] font-medium w-16 shrink-0", isDark ? "text-white/40" : "text-gray-400")}>
                    Öncelik
                  </span>
                  {(["all", "low", "normal", "urgent"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPriorityFilter(p)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all",
                        priorityFilter === p
                          ? isDark
                            ? "bg-white/10 text-white border border-white/20"
                            : "bg-gray-800 text-white"
                          : isDark
                          ? "text-white/40 hover:text-white/60 hover:bg-white/5"
                          : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      {p === "all" ? "Tümü" : PRIORITY_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Request list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className={cn(
            "w-14 h-14 rounded-xl flex items-center justify-center",
            isDark ? "bg-white/5" : "bg-gray-100"
          )}>
            <Search className={cn("w-6 h-6", isDark ? "text-white/20" : "text-gray-300")} />
          </div>
          <p className={cn("text-sm", isDark ? "text-white/40" : "text-gray-400")}>
            Talep bulunamadı
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              isDark={isDark}
              onClick={() => onOpenDetail(req)}
              showUser
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Request Card ───────────────────────────────────────────
function RequestCard({
  request,
  isDark,
  onClick,
  showUser,
}: {
  request: UserRequest;
  isDark: boolean;
  onClick: () => void;
  showUser: boolean;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={cn(
        "w-full text-left p-4 rounded-xl transition-all duration-200 group relative",
        isDark
          ? "bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08]"
          : "bg-white hover:bg-gray-50 border border-gray-200/70 shadow-sm hover:shadow-md"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Thumbnail */}
        {request.images?.[0] && (
          <div className={cn(
            "w-12 h-12 rounded-lg overflow-hidden shrink-0",
            isDark ? "bg-white/5" : "bg-gray-100"
          )}>
            <img
              src={request.images[0]}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <h3 className={cn(
              "font-semibold text-sm truncate",
              isDark ? "text-white" : "text-gray-900"
            )}>
              {request.title}
            </h3>
            <StatusChip status={request.status} isDark={isDark} />
          </div>

          {/* Description preview */}
          {request.description && (
            <p className={cn(
              "text-xs mt-1 line-clamp-1",
              isDark ? "text-white/50" : "text-gray-500"
            )}>
              {request.description}
            </p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <CategoryChip category={request.category} isDark={isDark} />
            <PriorityChip priority={request.priority} isDark={isDark} />
            {showUser && request.createdByName && (
              <span className={cn(
                "text-[11px] px-2 py-0.5 rounded-md",
                isDark ? "bg-white/5 text-white/50" : "bg-gray-100 text-gray-500"
              )}>
                {request.createdByName}
              </span>
            )}
            {request.assignedToName && (
              <span className={cn(
                "text-[11px] px-2 py-0.5 rounded-md",
                isDark ? "bg-blue-500/10 text-blue-400" : "bg-blue-50 text-blue-600"
              )}>
                Sorumlu: {request.assignedToName}
              </span>
            )}
            <span className={cn("text-[11px] ml-auto tabular-nums", isDark ? "text-white/30" : "text-gray-400")}>
              {formatDate(request.createdAt)}
            </span>
          </div>
        </div>

        <ChevronRight className={cn(
          "w-4 h-4 shrink-0 mt-1 transition-transform group-hover:translate-x-0.5",
          isDark ? "text-white/15" : "text-gray-300"
        )} />
      </div>

      {/* Unread indicator */}
      {request.unreadByUser && (
        <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
      )}
    </motion.button>
  );
}

// ─── Chips ──────────────────────────────────────────────────
function StatusChip({ status, isDark }: { status: UserRequestStatus; isDark: boolean }) {
  const config = {
    open: {
      icon: <Clock className="w-3 h-3" />,
      dark: "bg-amber-500/15 text-amber-400 border-amber-500/20",
      light: "bg-amber-50 text-amber-700 border-amber-200",
    },
    reviewing: {
      icon: <Eye className="w-3 h-3" />,
      dark: "bg-blue-500/15 text-blue-400 border-blue-500/20",
      light: "bg-blue-50 text-blue-700 border-blue-200",
    },
    done: {
      icon: <CheckCircle2 className="w-3 h-3" />,
      dark: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
      light: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
  }[status];

  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium shrink-0 border",
      isDark ? config.dark : config.light
    )}>
      {config.icon}
      {STATUS_LABELS[status]}
    </span>
  );
}

function CategoryChip({ category, isDark }: { category: UserRequestCategory; isDark: boolean }) {
  return (
    <span className={cn(
      "px-2 py-0.5 rounded-md text-[10px] font-medium",
      isDark ? "bg-white/[0.06] text-white/60 border border-white/[0.08]" : "bg-gray-100 text-gray-600 border border-gray-200/50"
    )}>
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

function PriorityChip({ priority, isDark }: { priority: UserRequestPriority; isDark: boolean }) {
  const config = {
    urgent: {
      dark: "bg-red-500/15 text-red-400 border-red-500/20",
      light: "bg-red-50 text-red-600 border-red-200",
    },
    normal: {
      dark: "bg-blue-500/10 text-blue-400 border-blue-500/15",
      light: "bg-blue-50 text-blue-600 border-blue-200",
    },
    low: {
      dark: "bg-white/[0.04] text-white/40 border-white/[0.06]",
      light: "bg-gray-50 text-gray-500 border-gray-200",
    },
  }[priority];

  return (
    <span className={cn(
      "px-2 py-0.5 rounded-md text-[10px] font-medium border",
      isDark ? config.dark : config.light
    )}>
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

// ─── Empty State ────────────────────────────────────────────
function EmptyState({ isDark, onCreateNew }: { isDark: boolean; onCreateNew: () => void }) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center py-16 gap-4 rounded-xl",
      isDark ? "bg-white/[0.02] border border-white/5" : "bg-gray-50/50 border border-gray-200/30"
    )}>
      <div className={cn(
        "w-16 h-16 rounded-xl flex items-center justify-center",
        isDark ? "bg-white/5" : "bg-gray-100"
      )}>
        <MessageSquarePlus className={cn("w-8 h-8", isDark ? "text-white/20" : "text-gray-300")} />
      </div>
      <div className="text-center">
        <p className={cn("text-sm font-medium", isDark ? "text-white/50" : "text-gray-500")}>
          Henüz talebin yok
        </p>
        <p className={cn("text-xs mt-1", isDark ? "text-white/30" : "text-gray-400")}>
          Bir hata, iyileştirme veya özellik talebi oluşturun
        </p>
      </div>
      <Button
        onClick={onCreateNew}
        className="rounded-xl gap-2 bg-amber-500 hover:bg-amber-600 text-white mt-1"
      >
        <Plus className="w-4 h-4" />
        Talep Aç
      </Button>
    </div>
  );
}

// ─── Request Detail ─────────────────────────────────────────
function RequestDetail({
  request,
  onBack,
  isAdminDeveloper,
  source,
  isDark,
  uid,
  userName,
  userRole,
}: {
  request: UserRequest;
  onBack: () => void;
  isAdminDeveloper: boolean;
  source: DetailSource;
  isDark: boolean;
  uid: string;
  userName: string;
  userRole: string;
}) {
  const { toast } = useToast();
  const [liveRequest, setLiveRequest] = useState<UserRequest>(request);
  const [adminNote, setAdminNote] = useState(request.adminNote || "");
  const [updating, setUpdating] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  // Listen to live updates
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "userRequests", request.id), (snap) => {
      if (snap.exists()) {
        setLiveRequest({ id: snap.id, ...snap.data() } as UserRequest);
      }
    });
    return () => unsub();
  }, [request.id]);

  // Mark as read
  useEffect(() => {
    if (source === "my" && liveRequest.unreadByUser && liveRequest.createdBy === uid) {
      updateDoc(doc(db, "userRequests", request.id), { unreadByUser: false }).catch(() => {});
    }
  }, [liveRequest.unreadByUser, source, uid, request.id, liveRequest.createdBy]);

  const isAssignedAdmin = liveRequest.assignedTo === uid;
  const canMarkAsDone =
    liveRequest.status !== "done" &&
    (isAssignedAdmin || isAdminDeveloper || liveRequest.createdBy === uid);

  const changeStatus = async (newStatus: UserRequestStatus) => {
    setUpdating(true);
    try {
      const updateData: Record<string, any> = {
        status: newStatus,
        updatedAt: serverTimestamp(),
        unreadByUser: true,
      };
      if (newStatus === "done") {
        updateData.resolvedAt = serverTimestamp();
        updateData.resolvedBy = uid;
        updateData.resolvedByName = userName;
      } else if (newStatus === "open") {
        updateData.resolvedAt = null;
        updateData.resolvedBy = null;
        updateData.resolvedByName = null;
      }
      await updateDoc(doc(db, "userRequests", request.id), updateData);

      if (newStatus === "done" && liveRequest.createdBy) {
        emitUserRequestCompleted({
          actor: { uid, name: userName },
          requestId: request.id,
          title: liveRequest.title,
          requestCreatorUid: liveRequest.createdBy,
          requestCreatorName: liveRequest.createdByName || "",
        }).catch(console.error);
      }

      toast({ title: STATUS_LABELS[newStatus] + " olarak güncellendi" });
    } catch {
      toast({ title: "Hata", description: "Durum güncellenirken hata oluştu", variant: "destructive" });
    }
    setUpdating(false);
  };

  const handleReopenRequest = async () => {
    if (!reopenReason.trim()) {
      toast({ title: "Lütfen bir sebep yazın", variant: "destructive" });
      return;
    }
    setUpdating(true);
    try {
      // Add reopen to comments
      const newComment: UserRequestComment = {
        id: Date.now().toString(),
        text: `Tekrar açma sebebi: ${reopenReason.trim()}`,
        authorUid: uid,
        authorName: userName,
        authorRole: userRole as any,
        createdAt: new Date(),
      };
      const existingComments = liveRequest.comments || [];
      await updateDoc(doc(db, "userRequests", request.id), {
        status: "open",
        reopenReason: reopenReason.trim(),
        resolvedAt: null,
        resolvedBy: null,
        resolvedByName: null,
        updatedAt: serverTimestamp(),
        unreadByUser: source !== "my",
        comments: [...existingComments, newComment],
      });
      toast({ title: "Talep tekrar açıldı" });
      setShowReopenModal(false);
      setReopenReason("");
    } catch {
      toast({ title: "Hata", variant: "destructive" });
    }
    setUpdating(false);
  };

  const addComment = async () => {
    if (!commentText.trim()) return;
    setUpdating(true);
    try {
      const newComment: UserRequestComment = {
        id: Date.now().toString(),
        text: commentText.trim(),
        authorUid: uid,
        authorName: userName,
        authorRole: userRole as any,
        createdAt: new Date(),
      };
      const existingComments = liveRequest.comments || [];
      const shouldAutoComplete = isAssignedAdmin && liveRequest.status !== "done";
      const updateData: Record<string, any> = {
        comments: [...existingComments, newComment],
        updatedAt: serverTimestamp(),
        unreadByUser: source !== "my",
      };

      if (shouldAutoComplete) {
        updateData.status = "done";
        updateData.resolvedAt = serverTimestamp();
        updateData.resolvedBy = uid;
        updateData.resolvedByName = userName;
        updateData.unreadByUser = true;
      }

      await updateDoc(doc(db, "userRequests", request.id), updateData);
      setCommentText("");

      if (shouldAutoComplete && liveRequest.createdBy) {
        emitUserRequestCompleted({
          actor: { uid, name: userName },
          requestId: request.id,
          title: liveRequest.title,
          requestCreatorUid: liveRequest.createdBy,
          requestCreatorName: liveRequest.createdByName || "",
        }).catch(console.error);
      }

      toast({ title: shouldAutoComplete ? "Yanıt eklendi ve talep tamamlandı" : "Yorum eklendi" });
    } catch {
      toast({ title: "Hata", variant: "destructive" });
    }
    setUpdating(false);
  };

  const saveAdminNote = async () => {
    setUpdating(true);
    try {
      await updateDoc(doc(db, "userRequests", request.id), {
        adminNote,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Not kaydedildi" });
    } catch {
      toast({ title: "Hata", variant: "destructive" });
    }
    setUpdating(false);
  };

  const copyId = () => {
    navigator.clipboard.writeText(request.id).then(() => {
      toast({ title: "ID kopyalandı" });
    });
  };

  // Build activity feed
  const activityItems = useMemo(() => {
    const items: { type: string; label: string; date: string; icon: React.ReactNode; color: string }[] = [];

    items.push({
      type: "created",
      label: `${liveRequest.createdByName || "Kullanıcı"} tarafından oluşturuldu`,
      date: formatDate(liveRequest.createdAt),
      icon: <Plus className="w-3 h-3" />,
      color: "amber",
    });

    if (liveRequest.assignedToName) {
      items.push({
        type: "assigned",
        label: `${liveRequest.assignedToName} kişisine atandı`,
        date: "",
        icon: <ChevronRight className="w-3 h-3" />,
        color: "blue",
      });
    }

    // Comments
    if (liveRequest.comments?.length) {
      for (const comment of liveRequest.comments) {
        items.push({
          type: "comment",
          label: `${comment.authorName}: ${comment.text}`,
          date: formatDate(comment.createdAt),
          icon: <MessageSquarePlus className="w-3 h-3" />,
          color: comment.authorRole === "user" ? "gray" : "purple",
        });
      }
    }

    if (liveRequest.status === "reviewing") {
      items.push({
        type: "reviewing",
        label: "İnceleniyor",
        date: "",
        icon: <Eye className="w-3 h-3" />,
        color: "blue",
      });
    }

    if (liveRequest.resolvedAt) {
      items.push({
        type: "resolved",
        label: `Tamamlandı${liveRequest.resolvedByName ? ` (${liveRequest.resolvedByName})` : ""}`,
        date: formatDate(liveRequest.resolvedAt),
        icon: <CheckCircle2 className="w-3 h-3" />,
        color: "emerald",
      });
    }

    if (liveRequest.reopenReason) {
      items.push({
        type: "reopened",
        label: `Tekrar açıldı: ${liveRequest.reopenReason}`,
        date: "",
        icon: <RotateCcw className="w-3 h-3" />,
        color: "orange",
      });
    }

    return items;
  }, [liveRequest]);

  const cardClass = cn(
    "p-5 rounded-xl",
    isDark
      ? "bg-white/[0.04] border border-white/[0.08]"
      : "bg-white border border-gray-200/70 shadow-sm"
  );

  return (
    <div className="flex flex-col w-full max-w-3xl mx-auto px-3 md:px-4 py-4 gap-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className={cn(
          "flex items-center gap-2 text-sm font-medium transition-colors w-fit rounded-lg px-3 py-2 -ml-3",
          isDark ? "text-white/60 hover:text-white hover:bg-white/5" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
        )}
      >
        <ArrowLeft className="w-4 h-4" />
        Geri
      </button>

      {/* Header Card */}
      <div className={cardClass}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <StatusChip status={liveRequest.status} isDark={isDark} />
              <PriorityChip priority={liveRequest.priority} isDark={isDark} />
              <button
                onClick={copyId}
                className={cn(
                  "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md transition-colors",
                  isDark
                    ? "bg-white/5 text-white/40 hover:text-white/60"
                    : "bg-gray-100 text-gray-400 hover:text-gray-600"
                )}
              >
                <Copy className="w-3 h-3" />
                {request.id.slice(0, 8)}
              </button>
            </div>
            <h2 className={cn("text-lg font-bold leading-snug", isDark ? "text-white" : "text-gray-900")}>
              {liveRequest.title}
            </h2>
          </div>
        </div>

        {/* Meta info */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <CategoryChip category={liveRequest.category} isDark={isDark} />
          <span className={cn("text-xs", isDark ? "text-white/40" : "text-gray-400")}>
            Açan: {liveRequest.createdByName}
          </span>
          {liveRequest.assignedToName && (
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-md",
              isDark ? "bg-blue-500/10 text-blue-400" : "bg-blue-50 text-blue-600"
            )}>
              Sorumlu: {liveRequest.assignedToName}
            </span>
          )}
          <span className={cn("text-xs ml-auto tabular-nums", isDark ? "text-white/30" : "text-gray-400")}>
            {formatDate(liveRequest.createdAt)}
            {liveRequest.updatedAt && liveRequest.updatedAt !== liveRequest.createdAt && (
              <> &middot; Gncl: {formatDate(liveRequest.updatedAt)}</>
            )}
          </span>
        </div>

        {/* Description */}
        {liveRequest.description && (
          <p className={cn("text-sm whitespace-pre-wrap leading-relaxed", isDark ? "text-white/70" : "text-gray-700")}>
            {liveRequest.description}
          </p>
        )}

        {/* Images */}
        {liveRequest.images?.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
            {liveRequest.images.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "rounded-lg overflow-hidden aspect-video hover:opacity-80 transition-opacity",
                  isDark ? "bg-white/5" : "bg-gray-100"
                )}
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Activity Feed */}
      <div className={cardClass}>
        <h3 className={cn("text-sm font-semibold mb-4", isDark ? "text-white/70" : "text-gray-700")}>
          Aktivite Akışı
        </h3>
        <div className="flex flex-col gap-0">
          {activityItems.map((item, i) => {
            const isLast = i === activityItems.length - 1;
            const colorMap: Record<string, string> = {
              amber: isDark ? "bg-amber-500 text-amber-950" : "bg-amber-400 text-white",
              blue: isDark ? "bg-blue-500 text-blue-950" : "bg-blue-400 text-white",
              emerald: isDark ? "bg-emerald-500 text-emerald-950" : "bg-emerald-400 text-white",
              purple: isDark ? "bg-purple-500 text-purple-950" : "bg-purple-400 text-white",
              gray: isDark ? "bg-gray-500 text-gray-950" : "bg-gray-400 text-white",
              orange: isDark ? "bg-orange-500 text-orange-950" : "bg-orange-400 text-white",
            };

            return (
              <div key={i} className="flex gap-3 relative">
                {/* Timeline line */}
                {!isLast && (
                  <div className={cn(
                    "absolute left-[11px] top-[22px] bottom-0 w-px",
                    isDark ? "bg-white/10" : "bg-gray-200"
                  )} />
                )}
                {/* Dot */}
                <div className={cn(
                  "w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 mt-0.5 z-10",
                  colorMap[item.color] || colorMap.gray
                )}>
                  {item.icon}
                </div>
                {/* Content */}
                <div className={cn("flex-1 pb-4", isLast && "pb-0")}>
                  <p className={cn("text-sm", isDark ? "text-white/80" : "text-gray-800")}>
                    {item.label}
                  </p>
                  {item.date && (
                    <p className={cn("text-[11px] mt-0.5 tabular-nums", isDark ? "text-white/30" : "text-gray-400")}>
                      {item.date}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add comment */}
        <div className={cn(
          "mt-4 pt-4",
          isDark ? "border-t border-white/5" : "border-t border-gray-100"
        )}>
          <div className="flex gap-2">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Yorum ekle..."
              rows={2}
              className={cn(
                "flex-1 rounded-lg px-3 py-2 text-sm resize-none transition-all",
                isDark
                  ? "bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/50 focus:outline-none"
                  : "bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none"
              )}
            />
            <Button
              onClick={addComment}
              disabled={updating || !commentText.trim()}
              size="sm"
              className="rounded-lg self-end bg-amber-500 hover:bg-amber-600 text-white h-9 px-3"
            >
              {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
            {canMarkAsDone && (
              <Button
                onClick={() => changeStatus("done")}
                disabled={updating}
                size="sm"
                className="rounded-lg self-end bg-emerald-500 hover:bg-emerald-600 text-white h-9 px-3 gap-1.5"
              >
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Tamamlandı
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Admin actions */}
      {isAssignedAdmin && (
        <div className={cardClass}>
          <h3 className={cn("text-sm font-semibold mb-4", isDark ? "text-white/70" : "text-gray-700")}>
            Yönetim
          </h3>

          <div className="flex flex-col gap-3">
            {/* Status change */}
            <div className="flex flex-col gap-2">
              <label className={cn("text-[11px] font-medium", isDark ? "text-white/40" : "text-gray-500")}>
                Durum Değiştir
              </label>
              <div className="flex gap-2 flex-wrap">
                {(["open", "reviewing", "done"] as UserRequestStatus[]).map((s) => (
                  <Button
                    key={s}
                    onClick={() => changeStatus(s)}
                    disabled={updating || liveRequest.status === s}
                    variant={liveRequest.status === s ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "rounded-lg gap-1.5",
                      liveRequest.status === s && s === "open" && "bg-amber-500 text-white",
                      liveRequest.status === s && s === "reviewing" && "bg-blue-500 text-white",
                      liveRequest.status === s && s === "done" && "bg-emerald-500 text-white",
                    )}
                  >
                    {s === "open" && <Clock className="w-3.5 h-3.5" />}
                    {s === "reviewing" && <Eye className="w-3.5 h-3.5" />}
                    {s === "done" && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {STATUS_LABELS[s]}
                  </Button>
                ))}
              </div>
            </div>

            {/* Admin note */}
            <div className="flex flex-col gap-2">
              <label className={cn("text-[11px] font-medium", isDark ? "text-white/40" : "text-gray-500")}>
                Admin Notu
              </label>
              <textarea
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="İsteğe bağlı admin notu..."
                rows={3}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-sm resize-none transition-all",
                  isDark
                    ? "bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/50 focus:outline-none"
                    : "bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none"
                )}
              />
              <Button
                onClick={saveAdminNote}
                disabled={updating}
                variant="outline"
                className="rounded-lg self-end"
                size="sm"
              >
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Notu Kaydet"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* User actions for completed requests */}
      {source === "my" && liveRequest.status === "done" && (
        <div className={cardClass}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className={cn("text-sm font-semibold", isDark ? "text-white/70" : "text-gray-700")}>
                Talep tamamlandı
              </h3>
              <p className={cn("text-xs mt-0.5", isDark ? "text-white/40" : "text-gray-400")}>
                Sorun devam ediyorsa tekrar açabilirsiniz
              </p>
            </div>
            <Button
              onClick={() => setShowReopenModal(true)}
              variant="outline"
              size="sm"
              className="rounded-lg gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Tekrar Aç
            </Button>
          </div>
        </div>
      )}

      {/* Show admin note to user */}
      {source === "my" && liveRequest.adminNote && (
        <div className={cardClass}>
          <h3 className={cn("text-sm font-semibold mb-2", isDark ? "text-white/70" : "text-gray-700")}>
            Admin Notu
          </h3>
          <p className={cn("text-sm whitespace-pre-wrap", isDark ? "text-white/60" : "text-gray-600")}>
            {liveRequest.adminNote}
          </p>
        </div>
      )}

      {/* Reopen Modal */}
      <Dialog open={showReopenModal} onOpenChange={setShowReopenModal}>
        <DialogContent className={cn(
          "max-w-md rounded-xl",
          isDark ? "bg-gray-900 border-white/10" : ""
        )}>
          <DialogHeader>
            <DialogTitle className={cn("text-base", isDark ? "text-white" : "")}>
              Talebi Tekrar Aç
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className={cn("text-xs font-medium", isDark ? "text-white/60" : "text-gray-600")}>
              Neden tekrar açıyorsunuz? <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Sorun devam ediyor çünkü..."
              rows={3}
              className={cn(
                "w-full rounded-lg px-3 py-2 text-sm resize-none transition-all",
                isDark
                  ? "bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/50 focus:outline-none"
                  : "bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none"
              )}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowReopenModal(false)} className="rounded-lg" size="sm">
                Vazgeç
              </Button>
              <Button
                onClick={handleReopenRequest}
                disabled={updating || !reopenReason.trim()}
                className="rounded-lg bg-amber-500 hover:bg-amber-600 text-white gap-1.5"
                size="sm"
              >
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                Tekrar Aç
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Create Request Modal ───────────────────────────────────
function CreateRequestModal({
  open,
  onOpenChange,
  uid,
  userName,
  isDark,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  uid: string;
  userName: string;
  isDark: boolean;
}) {
  const { toast } = useToast();
  const { currentCompanyId } = useAuth();
  const [mode, setMode] = useState<"quick" | "detail">("quick");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<UserRequestCategory>("improvement");
  const [priority, setPriority] = useState<UserRequestPriority>("normal");
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [adminUsers, setAdminUsers] = useState<AppUser[]>([]);
  const [assignedTo, setAssignedTo] = useState("");

  // Fetch admin users
  useEffect(() => {
    getDocs(collection(db, "users")).then((snap) => {
      const admins = snap.docs
        .map((d) => ({ ...d.data(), uid: d.id } as AppUser))
        .filter((u) => u.role === "admin" || u.role === "admin_developer");
      setAdminUsers(admins);
    });
  }, []);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setMode("quick");
      setTitle("");
      setDescription("");
      setCategory("improvement");
      setPriority("normal");
      setImages([]);
      setImagePreviews([]);
      setAssignedTo("");
    }
  }, [open]);

  // Handle clipboard paste
  useEffect(() => {
    if (!open) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/") && images.length < 3) {
          const file = item.getAsFile();
          if (file) addImage(file);
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [open, images.length]);

  const addImage = (file: File) => {
    if (images.length >= 3) return;
    setImages((prev) => [...prev, file]);
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreviews((prev) => [...prev, e.target?.result as string]);
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of files) {
      if (images.length >= 3) break;
      if (file.type.startsWith("image/")) addImage(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast({ title: "Başlık zorunludur", variant: "destructive" });
      return;
    }
    if (title.trim().length > 100) {
      toast({ title: "Başlık en fazla 100 karakter olabilir", variant: "destructive" });
      return;
    }

    const assignedAdmin = assignedTo ? adminUsers.find((u) => u.uid === assignedTo) : null;

    setSubmitting(true);
    try {
      // Upload images
      const imageUrls: string[] = [];
      for (const file of images) {
        const fileName = `${Date.now()}_${file.name}`;
        const storageRef = ref(storage, `user-requests/${uid}/${fileName}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        imageUrls.push(url);
      }

      const docRef = await addDoc(collection(db, "userRequests"), withCompanyScope({
        title: title.trim(),
        description: description.trim(),
        images: imageUrls,
        category,
        priority,
        status: "open",
        createdBy: uid,
        createdByName: userName,
        assignedTo: assignedTo || "",
        assignedToName: assignedAdmin?.name || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        unreadByUser: false,
        comments: [],
      }, currentCompanyId));

      // Notify assigned admin if one was selected
      if (assignedTo) {
        emitUserRequestCreated({
          actor: { uid, name: userName },
          requestId: docRef.id,
          title: title.trim(),
          assignedToUid: assignedTo,
          assignedToName: assignedAdmin?.name || "",
          category,
          priority,
        }).catch(console.error);
      }

      toast({ title: "Talebin alındı" });
      onOpenChange(false);
    } catch (err) {
      console.error("Error creating request:", err);
      toast({ title: "Talep oluşturulurken hata oluştu", variant: "destructive" });
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-lg rounded-xl p-0 overflow-hidden",
          isDark
            ? "bg-gray-900 border-white/10"
            : "bg-white border-gray-200"
        )}
      >
        <div className="p-5 flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className={cn("text-lg font-bold", isDark ? "text-white" : "text-gray-900")}>
              Yeni Talep Aç
            </DialogTitle>
          </DialogHeader>

          {/* Mode toggle */}
          <div className={cn(
            "flex rounded-lg p-0.5",
            isDark ? "bg-white/5" : "bg-gray-100"
          )}>
            <button
              onClick={() => setMode("quick")}
              className={cn(
                "flex-1 px-3 py-2 rounded-md text-xs font-medium transition-all",
                mode === "quick"
                  ? isDark
                    ? "bg-white/10 text-white shadow-sm"
                    : "bg-white text-gray-900 shadow-sm"
                  : isDark
                  ? "text-white/50"
                  : "text-gray-500"
              )}
            >
              Hızlı
            </button>
            <button
              onClick={() => setMode("detail")}
              className={cn(
                "flex-1 px-3 py-2 rounded-md text-xs font-medium transition-all",
                mode === "detail"
                  ? isDark
                    ? "bg-white/10 text-white shadow-sm"
                    : "bg-white text-gray-900 shadow-sm"
                  : isDark
                  ? "text-white/50"
                  : "text-gray-500"
              )}
            >
              Detaylı
            </button>
          </div>

          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className={cn("text-xs font-medium", isDark ? "text-white/60" : "text-gray-600")}>
              Başlık <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 100))}
                placeholder="Kısa bir başlık yazın"
                className={cn(
                  "h-11 rounded-lg pr-14",
                  isDark ? "bg-white/5 border-white/10 text-white placeholder:text-white/30" : "border-gray-200"
                )}
              />
              <span className={cn(
                "absolute right-3 top-1/2 -translate-y-1/2 text-[10px] tabular-nums",
                isDark ? "text-white/30" : "text-gray-400"
              )}>
                {title.length}/100
              </span>
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className={cn("text-xs font-medium", isDark ? "text-white/60" : "text-gray-600")}>
              Açıklama {mode === "quick" && <span className={cn("text-[10px]", isDark ? "text-white/30" : "text-gray-400")}>(opsiyonel)</span>}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`Beklenen: ...\nOlan: ...\nAdımlar: 1) ...`}
              rows={mode === "quick" ? 3 : 5}
              className={cn(
                "w-full rounded-lg px-3 py-2.5 text-sm resize-none transition-all",
                isDark
                  ? "bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/50 focus:outline-none"
                  : "bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none"
              )}
            />
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <label className={cn("text-xs font-medium", isDark ? "text-white/60" : "text-gray-600")}>
              Kategori
            </label>
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(CATEGORY_LABELS) as UserRequestCategory[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                    category === c
                      ? isDark
                        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                      : isDark
                      ? "bg-white/[0.03] text-white/50 border-white/10 hover:text-white/70"
                      : "bg-gray-50 text-gray-500 border-gray-200 hover:text-gray-700"
                  )}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div className="flex flex-col gap-1.5">
            <label className={cn("text-xs font-medium", isDark ? "text-white/60" : "text-gray-600")}>
              Öncelik
            </label>
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(PRIORITY_LABELS) as UserRequestPriority[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                    priority === p
                      ? p === "urgent"
                        ? isDark
                          ? "bg-red-500/20 text-red-400 border-red-500/30"
                          : "bg-red-50 text-red-600 border-red-200"
                        : isDark
                        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                      : isDark
                      ? "bg-white/[0.03] text-white/50 border-white/10 hover:text-white/70"
                      : "bg-gray-50 text-gray-500 border-gray-200 hover:text-gray-700"
                  )}
                >
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Detail mode fields */}
          <AnimatePresence>
            {mode === "detail" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden flex flex-col gap-4"
              >
                {/* Image upload */}
                <div className="flex flex-col gap-2">
                  <label className={cn("text-xs font-medium", isDark ? "text-white/60" : "text-gray-600")}>
                    Görsel Ekle ({images.length}/3)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {imagePreviews.map((preview, i) => (
                      <div key={i} className="relative rounded-lg overflow-hidden aspect-video group">
                        <img src={preview} alt="" className="w-full h-full object-cover" />
                        <button
                          onClick={() => removeImage(i)}
                          className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4 text-white" />
                        </button>
                      </div>
                    ))}
                    {images.length < 3 && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          "rounded-lg flex flex-col items-center justify-center gap-1 transition-all aspect-video",
                          isDark
                            ? "bg-white/[0.03] border border-dashed border-white/15 hover:border-white/30 text-white/30"
                            : "bg-gray-50 border border-dashed border-gray-300 hover:border-gray-400 text-gray-400"
                        )}
                      >
                        <ImagePlus className="w-5 h-5" />
                        <span className="text-[9px]">Sürükle / Yapıştır / Seç</span>
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <p className={cn("text-[10px]", isDark ? "text-white/25" : "text-gray-400")}>
                    Ctrl+V ile de ekleyebilirsiniz
                  </p>
                </div>

                {/* Assigned Admin */}
                <div className="flex flex-col gap-1.5">
                  <label className={cn("text-xs font-medium", isDark ? "text-white/60" : "text-gray-600")}>
                    Kime iletilecek? <span className={cn("text-[10px]", isDark ? "text-white/30" : "text-gray-400")}>(opsiyonel)</span>
                  </label>
                  <Select value={assignedTo} onValueChange={setAssignedTo}>
                    <SelectTrigger className={cn(
                      "h-10 rounded-lg",
                      isDark ? "bg-white/5 border-white/10 text-white" : "border-gray-200"
                    )}>
                      <SelectValue placeholder="Sistem belirlesin" />
                    </SelectTrigger>
                    <SelectContent>
                      {adminUsers.map((admin) => (
                        <SelectItem key={admin.uid} value={admin.uid}>
                          {admin.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-lg flex-1"
              disabled={submitting}
            >
              Vazgeç
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !title.trim()}
              className="rounded-lg flex-1 gap-2 bg-amber-500 hover:bg-amber-600 text-white"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Gönderiliyor...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Talep Gönder
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
