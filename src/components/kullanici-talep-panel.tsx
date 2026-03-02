"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
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
  TimestampLike,
} from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  done: "Tamamlandı",
};

// ─── Main Panel ─────────────────────────────────────────────
type TabView = "my-requests" | "all-requests";
type DetailSource = "my" | "admin";

export default function KullaniciTalepPanel() {
  const { currentUserProfile, isAdminDeveloper } = useAuth();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const uid = currentUserProfile?.uid || "";

  // Tab state for admin-developer
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
      />
    );
  }

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto px-3 md:px-4 py-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LifeBuoy className={cn("w-6 h-6", isDark ? "text-amber-400" : "text-amber-600")} />
          <h1 className={cn("text-xl md:text-2xl font-bold", isDark ? "text-white" : "text-gray-900")}>
            Talepler
          </h1>
        </div>
        <Button
          onClick={() => setIsCreateOpen(true)}
          className="rounded-full gap-2 bg-amber-500 hover:bg-amber-600 text-white shadow-lg"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Talep Aç</span>
        </Button>
      </div>

      {/* Admin-Developer tabs */}
      {isAdminDeveloper && (
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("my-requests")}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium transition-all",
              activeTab === "my-requests"
                ? isDark
                  ? "bg-white/15 text-white border border-white/20"
                  : "bg-white shadow-[2px_2px_6px_#bebebe,-2px_-2px_6px_#ffffff] text-gray-900"
                : isDark
                ? "text-white/60 hover:text-white/80"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            Taleplerim
          </button>
          <button
            onClick={() => setActiveTab("all-requests")}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium transition-all",
              activeTab === "all-requests"
                ? isDark
                  ? "bg-white/15 text-white border border-white/20"
                  : "bg-white shadow-[2px_2px_6px_#bebebe,-2px_-2px_6px_#ffffff] text-gray-900"
                : isDark
                ? "text-white/60 hover:text-white/80"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            Tüm Talepler
          </button>
        </div>
      )}

      {/* Content */}
      {activeTab === "my-requests" ? (
        <MyRequestsList uid={uid} isDark={isDark} onOpenDetail={(r) => openDetail(r, "my")} onCreateNew={() => setIsCreateOpen(true)} />
      ) : (
        <AllRequestsList isDark={isDark} onOpenDetail={(r) => openDetail(r, "admin")} />
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
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "userRequests"),
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
    if (filter === "done") list = list.filter((r) => r.status === "done");
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => r.title.toLowerCase().includes(q));
    }
    return list;
  }, [requests, filter, searchQuery]);

  const openCount = requests.filter((r) => r.status === "open").length;
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
      {/* Segment control + search */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="flex gap-1.5">
          {(["all", "open", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                filter === f
                  ? isDark
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : "bg-amber-100 text-amber-700 border border-amber-200"
                  : isDark
                  ? "text-white/50 hover:text-white/70"
                  : "text-gray-400 hover:text-gray-600"
              )}
            >
              {f === "all" ? `Tümü (${requests.length})` : f === "open" ? `Açık (${openCount})` : `Tamamlandı (${doneCount})`}
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
              "pl-9 h-9 rounded-full text-sm w-full sm:w-56",
              isDark ? "bg-white/5 border-white/10 text-white placeholder:text-white/40" : ""
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

// ─── All Requests List (Admin-Developer) ────────────────────
function AllRequestsList({
  isDark,
  onOpenDetail,
}: {
  isDark: boolean;
  onOpenDetail: (r: UserRequest) => void;
}) {
  const [requests, setRequests] = useState<UserRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<UserRequestCategory | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<UserRequestPriority | "all">("all");

  useEffect(() => {
    const q = query(
      collection(db, "userRequests"),
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
    return list;
  }, [requests, filter, searchQuery, categoryFilter, priorityFilter]);

  const openCount = requests.filter((r) => r.status === "open").length;
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
      {/* Status filter */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5 items-center">
          {(["all", "open", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                filter === f
                  ? isDark
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : "bg-amber-100 text-amber-700 border border-amber-200"
                  : isDark
                  ? "text-white/50 hover:text-white/70"
                  : "text-gray-400 hover:text-gray-600"
              )}
            >
              {f === "all" ? `Tümü (${requests.length})` : f === "open" ? `Açık (${openCount})` : `Tamamlandı (${doneCount})`}
            </button>
          ))}

          <div className="w-px h-5 bg-gray-300 dark:bg-white/10 mx-1" />

          {/* Category chips */}
          {(["all", "bug", "improvement", "feature", "design"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs transition-all",
                categoryFilter === c
                  ? isDark
                    ? "bg-white/10 text-white border border-white/20"
                    : "bg-gray-200 text-gray-800"
                  : isDark
                  ? "text-white/40 hover:text-white/60"
                  : "text-gray-400 hover:text-gray-600"
              )}
            >
              {c === "all" ? "Tüm Kategoriler" : CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5 items-center">
          {/* Priority chips */}
          {(["all", "low", "normal", "urgent"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs transition-all",
                priorityFilter === p
                  ? isDark
                    ? "bg-white/10 text-white border border-white/20"
                    : "bg-gray-200 text-gray-800"
                  : isDark
                  ? "text-white/40 hover:text-white/60"
                  : "text-gray-400 hover:text-gray-600"
              )}
            >
              {p === "all" ? "Tüm Öncelikler" : PRIORITY_LABELS[p]}
            </button>
          ))}

          <div className="flex-1" />

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Başlık, açıklama veya kullanıcı..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                "pl-9 h-9 rounded-full text-sm w-full sm:w-64",
                isDark ? "bg-white/5 border-white/10 text-white placeholder:text-white/40" : ""
              )}
            />
          </div>
        </div>
      </div>

      {/* Request list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <LifeBuoy className={cn("w-12 h-12", isDark ? "text-white/20" : "text-gray-300")} />
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
  const isOpen = request.status === "open";

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={cn(
        "w-full text-left p-4 rounded-2xl transition-all duration-200 group",
        isDark
          ? "bg-white/5 hover:bg-white/8 border border-white/10"
          : "bg-[#e0e0e0] shadow-[4px_4px_8px_#bebebe,-4px_-4px_8px_#ffffff] hover:shadow-[2px_2px_4px_#bebebe,-2px_-2px_4px_#ffffff]"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Thumbnail */}
        {request.images?.[0] && (
          <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-black/10">
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
              "text-xs mt-1 line-clamp-2",
              isDark ? "text-white/50" : "text-gray-500"
            )}>
              {request.description}
            </p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <CategoryChip category={request.category} isDark={isDark} />
            <PriorityChip priority={request.priority} isDark={isDark} />
            {showUser && (
              <span className={cn("text-xs", isDark ? "text-white/40" : "text-gray-400")}>
                {request.createdByName}
              </span>
            )}
            {request.assignedToName && (
              <span className={cn("text-xs px-2 py-0.5 rounded-full", isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-50 text-blue-600")}>
                Atanan: {request.assignedToName}
              </span>
            )}
            <span className={cn("text-xs ml-auto", isDark ? "text-white/30" : "text-gray-400")}>
              {formatDate(request.createdAt)}
              {request.updatedAt && request.updatedAt !== request.createdAt && (
                <> • Gncl: {formatDate(request.updatedAt)}</>
              )}
            </span>
          </div>

          {/* Unread dot */}
          {request.unreadByUser && (
            <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-amber-500" />
          )}
        </div>

        <ChevronRight className={cn(
          "w-4 h-4 shrink-0 mt-1 transition-transform group-hover:translate-x-0.5",
          isDark ? "text-white/20" : "text-gray-300"
        )} />
      </div>
    </motion.button>
  );
}

// ─── Chips ──────────────────────────────────────────────────
function StatusChip({ status, isDark }: { status: UserRequestStatus; isDark: boolean }) {
  const isOpen = status === "open";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0",
        isOpen
          ? isDark
            ? "bg-amber-500/20 text-amber-400"
            : "bg-amber-100 text-amber-700"
          : isDark
          ? "bg-emerald-500/20 text-emerald-400"
          : "bg-emerald-100 text-emerald-700"
      )}
    >
      {isOpen ? <Clock className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
      {STATUS_LABELS[status]}
    </span>
  );
}

function CategoryChip({ category, isDark }: { category: UserRequestCategory; isDark: boolean }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-[10px] font-medium",
        isDark ? "bg-white/8 text-white/60" : "bg-gray-200 text-gray-600"
      )}
    >
      {CATEGORY_LABELS[category] || category}
    </span>
  );
}

function PriorityChip({ priority, isDark }: { priority: UserRequestPriority; isDark: boolean }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-[10px] font-medium",
        priority === "urgent"
          ? isDark
            ? "bg-red-500/20 text-red-400"
            : "bg-red-100 text-red-600"
          : priority === "normal"
          ? isDark
            ? "bg-blue-500/15 text-blue-400"
            : "bg-blue-50 text-blue-600"
          : isDark
          ? "bg-white/5 text-white/40"
          : "bg-gray-100 text-gray-500"
      )}
    >
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

// ─── Empty State ────────────────────────────────────────────
function EmptyState({ isDark, onCreateNew }: { isDark: boolean; onCreateNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div
        className={cn(
          "w-16 h-16 rounded-full flex items-center justify-center",
          isDark ? "bg-white/5" : "bg-gray-200"
        )}
      >
        <MessageSquarePlus className={cn("w-8 h-8", isDark ? "text-white/20" : "text-gray-400")} />
      </div>
      <p className={cn("text-sm", isDark ? "text-white/40" : "text-gray-400")}>
        Henüz talep yok
      </p>
      <Button
        onClick={onCreateNew}
        className="rounded-full gap-2 bg-amber-500 hover:bg-amber-600 text-white"
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
}: {
  request: UserRequest;
  onBack: () => void;
  isAdminDeveloper: boolean;
  source: DetailSource;
  isDark: boolean;
  uid: string;
  userName: string;
}) {
  const { toast } = useToast();
  const [liveRequest, setLiveRequest] = useState<UserRequest>(request);
  const [adminNote, setAdminNote] = useState(request.adminNote || "");
  const [updating, setUpdating] = useState(false);

  // Listen to live updates
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "userRequests", request.id), (snap) => {
      if (snap.exists()) {
        setLiveRequest({ id: snap.id, ...snap.data() } as UserRequest);
      }
    });
    return () => unsub();
  }, [request.id]);

  // Mark as read if user is viewing their own request with unread update
  useEffect(() => {
    if (source === "my" && liveRequest.unreadByUser && liveRequest.createdBy === uid) {
      updateDoc(doc(db, "userRequests", request.id), { unreadByUser: false }).catch(() => {});
    }
  }, [liveRequest.unreadByUser, source, uid, request.id, liveRequest.createdBy]);

  const isAssignedAdmin = liveRequest.assignedTo === uid;

  const toggleStatus = async () => {
    if (!isAssignedAdmin) return;
    setUpdating(true);
    try {
      const newStatus: UserRequestStatus = liveRequest.status === "open" ? "done" : "open";
      const updateData: Record<string, any> = {
        status: newStatus,
        updatedAt: serverTimestamp(),
        unreadByUser: true,
      };
      if (newStatus === "done") {
        updateData.resolvedAt = serverTimestamp();
        updateData.resolvedBy = uid;
        updateData.resolvedByName = userName;
      } else {
        updateData.resolvedAt = null;
        updateData.resolvedBy = null;
        updateData.resolvedByName = null;
      }
      await updateDoc(doc(db, "userRequests", request.id), updateData);
      toast({ title: newStatus === "done" ? "Talep tamamlandı" : "Talep tekrar açıldı" });
    } catch {
      toast({ title: "Hata", description: "Durum güncellenirken hata oluştu", variant: "destructive" });
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

  return (
    <div className="flex flex-col w-full max-w-3xl mx-auto px-3 md:px-4 py-4 gap-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className={cn(
          "flex items-center gap-2 text-sm font-medium transition-colors w-fit",
          isDark ? "text-white/60 hover:text-white" : "text-gray-500 hover:text-gray-900"
        )}
      >
        <ArrowLeft className="w-4 h-4" />
        Geri
      </button>

      {/* Header */}
      <div
        className={cn(
          "p-5 rounded-2xl",
          isDark
            ? "bg-white/5 border border-white/10"
            : "bg-[#e0e0e0] shadow-[4px_4px_8px_#bebebe,-4px_-4px_8px_#ffffff]"
        )}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusChip status={liveRequest.status} isDark={isDark} />
              <button
                onClick={copyId}
                className={cn(
                  "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition-colors",
                  isDark
                    ? "bg-white/5 text-white/40 hover:text-white/60"
                    : "bg-gray-200 text-gray-400 hover:text-gray-600"
                )}
              >
                <Copy className="w-3 h-3" />
                {request.id.slice(0, 8)}
              </button>
            </div>
            <h2 className={cn("text-lg font-bold", isDark ? "text-white" : "text-gray-900")}>
              {liveRequest.title}
            </h2>
          </div>
        </div>

        {/* Meta chips */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <CategoryChip category={liveRequest.category} isDark={isDark} />
          <PriorityChip priority={liveRequest.priority} isDark={isDark} />
          {source === "admin" && (
            <span className={cn("text-xs", isDark ? "text-white/40" : "text-gray-400")}>
              {liveRequest.createdByName}
            </span>
          )}
          {liveRequest.assignedToName && (
            <span className={cn("text-xs px-2 py-0.5 rounded-full", isDark ? "bg-blue-500/15 text-blue-400" : "bg-blue-50 text-blue-600")}>
              Atanan: {liveRequest.assignedToName}
            </span>
          )}
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
                className="rounded-xl overflow-hidden aspect-video bg-black/10 hover:opacity-80 transition-opacity"
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div
        className={cn(
          "p-5 rounded-2xl",
          isDark
            ? "bg-white/5 border border-white/10"
            : "bg-[#e0e0e0] shadow-[4px_4px_8px_#bebebe,-4px_-4px_8px_#ffffff]"
        )}
      >
        <h3 className={cn("text-sm font-semibold mb-3", isDark ? "text-white/70" : "text-gray-700")}>
          Zaman Çizelgesi
        </h3>
        <div className="flex flex-col gap-3">
          <TimelineItem
            label="Oluşturuldu"
            date={formatDate(liveRequest.createdAt)}
            isDark={isDark}
            isFirst
          />
          {liveRequest.assignedToName && (
            <TimelineItem
              label={`Atanan: ${liveRequest.assignedToName}`}
              date=""
              isDark={isDark}
            />
          )}
          {liveRequest.resolvedAt && (
            <TimelineItem
              label={`Tamamlandı${liveRequest.resolvedByName ? ` (${liveRequest.resolvedByName} tarafından)` : ""}`}
              date={formatDate(liveRequest.resolvedAt)}
              isDark={isDark}
              isCompleted
            />
          )}
        </div>
      </div>

      {/* Admin actions - only assigned admin can manage */}
      {isAssignedAdmin && (
        <div
          className={cn(
            "p-5 rounded-2xl",
            isDark
              ? "bg-white/5 border border-white/10"
              : "bg-[#e0e0e0] shadow-[4px_4px_8px_#bebebe,-4px_-4px_8px_#ffffff]"
          )}
        >
          <h3 className={cn("text-sm font-semibold mb-3", isDark ? "text-white/70" : "text-gray-700")}>
            Yönetim
          </h3>

          <div className="flex flex-col gap-3">
            <Button
              onClick={toggleStatus}
              disabled={updating}
              className={cn(
                "rounded-full gap-2",
                liveRequest.status === "open"
                  ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                  : "bg-amber-500 hover:bg-amber-600 text-white"
              )}
            >
              {updating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : liveRequest.status === "open" ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Clock className="w-4 h-4" />
              )}
              {liveRequest.status === "open" ? "Tamamlandı Olarak İşaretle" : "Tekrar Aç"}
            </Button>

            {/* Admin note */}
            <div className="flex flex-col gap-2">
              <label className={cn("text-xs font-medium", isDark ? "text-white/50" : "text-gray-500")}>
                Admin Notu
              </label>
              <textarea
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="İsteğe bağlı admin notu..."
                rows={3}
                className={cn(
                  "w-full rounded-xl px-4 py-3 text-sm resize-none transition-all",
                  isDark
                    ? "bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/50"
                    : "bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-amber-400"
                )}
              />
              <Button
                onClick={saveAdminNote}
                disabled={updating}
                variant="outline"
                className="rounded-full self-end"
                size="sm"
              >
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Notu Kaydet"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Show admin note to request creator (read-only) */}
      {source === "my" && liveRequest.adminNote && (
        <div
          className={cn(
            "p-5 rounded-2xl",
            isDark
              ? "bg-white/5 border border-white/10"
              : "bg-[#e0e0e0] shadow-[4px_4px_8px_#bebebe,-4px_-4px_8px_#ffffff]"
          )}
        >
          <h3 className={cn("text-sm font-semibold mb-2", isDark ? "text-white/70" : "text-gray-700")}>
            Admin Notu
          </h3>
          <p className={cn("text-sm whitespace-pre-wrap", isDark ? "text-white/60" : "text-gray-600")}>
            {liveRequest.adminNote}
          </p>
        </div>
      )}
    </div>
  );
}

function TimelineItem({
  label,
  date,
  isDark,
  isFirst,
  isCompleted,
}: {
  label: string;
  date: string;
  isDark: boolean;
  isFirst?: boolean;
  isCompleted?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "w-3 h-3 rounded-full mt-0.5",
            isCompleted
              ? "bg-emerald-500"
              : isDark
              ? "bg-amber-500"
              : "bg-amber-400"
          )}
        />
        {!isCompleted && <div className={cn("w-px h-6", isDark ? "bg-white/10" : "bg-gray-300")} />}
      </div>
      <div className="flex-1">
        <p className={cn("text-sm font-medium", isDark ? "text-white/80" : "text-gray-800")}>{label}</p>
        <p className={cn("text-xs", isDark ? "text-white/40" : "text-gray-400")}>{date}</p>
      </div>
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<UserRequestCategory>("bug");
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
      setTitle("");
      setDescription("");
      setCategory("bug");
      setPriority("normal");
      setImages([]);
      setImagePreviews([]);
      setAssignedTo("");
    }
  }, [open]);

  // Handle clipboard paste for images
  useEffect(() => {
    if (!open) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/") && images.length < 3) {
          const file = item.getAsFile();
          if (file) {
            addImage(file);
          }
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
      if (file.type.startsWith("image/")) {
        addImage(file);
      }
    }
    // Reset input
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
    if (!assignedTo) {
      toast({ title: "İlgilenecek kişi seçilmelidir", variant: "destructive" });
      return;
    }

    const assignedAdmin = adminUsers.find((u) => u.uid === assignedTo);

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

      // Create request document
      await addDoc(collection(db, "userRequests"), {
        title: title.trim(),
        description: description.trim(),
        images: imageUrls,
        category,
        priority,
        status: "open",
        createdBy: uid,
        createdByName: userName,
        assignedTo: assignedTo,
        assignedToName: assignedAdmin?.name || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        unreadByUser: false,
      });

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
          "max-w-lg rounded-3xl p-0 overflow-hidden",
          isDark
            ? "bg-black/90 backdrop-blur-xl border-white/10"
            : "bg-[#e0e0e0] border-gray-200"
        )}
      >
        <div className="p-6 flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className={cn("text-lg font-bold", isDark ? "text-white" : "text-gray-900")}>
              Yeni Talep Aç
            </DialogTitle>
          </DialogHeader>

          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className={cn("text-xs font-medium", isDark ? "text-white/60" : "text-gray-600")}>
              Başlık <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 100))}
                placeholder="Kısa bir başlık yazın (örn: Sipariş tablosu başlık dondurma)"
                className={cn(
                  "h-11 rounded-xl pr-14",
                  isDark ? "bg-white/5 border-white/10 text-white placeholder:text-white/30" : ""
                )}
              />
              <span className={cn(
                "absolute right-3 top-1/2 -translate-y-1/2 text-[10px]",
                isDark ? "text-white/30" : "text-gray-400"
              )}>
                {title.length}/100
              </span>
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className={cn("text-xs font-medium", isDark ? "text-white/60" : "text-gray-600")}>
              Açıklama
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ne bekliyorsunuz? Nerede oluyor? Adımlar?"
              rows={4}
              className={cn(
                "w-full rounded-xl px-4 py-3 text-sm resize-none transition-all",
                isDark
                  ? "bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/50 focus:outline-none"
                  : "bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none"
              )}
            />
          </div>

          {/* Image upload */}
          <div className="flex flex-col gap-2">
            <label className={cn("text-xs font-medium", isDark ? "text-white/60" : "text-gray-600")}>
              Görsel Ekle ({images.length}/3)
            </label>
            <div className="flex gap-2 flex-wrap">
              {imagePreviews.map((preview, i) => (
                <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden group">
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
                    "w-20 h-20 rounded-xl flex flex-col items-center justify-center gap-1 transition-all",
                    isDark
                      ? "bg-white/5 border border-dashed border-white/20 hover:border-white/40 text-white/40"
                      : "bg-white border border-dashed border-gray-300 hover:border-gray-400 text-gray-400"
                  )}
                >
                  <ImagePlus className="w-5 h-5" />
                  <span className="text-[9px]">Ekle</span>
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
            <p className={cn("text-[10px]", isDark ? "text-white/30" : "text-gray-400")}>
              Yapıştır (Ctrl+V) ile de ekleyebilirsiniz
            </p>
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
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    category === c
                      ? isDark
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        : "bg-amber-100 text-amber-700 border border-amber-200"
                      : isDark
                      ? "bg-white/5 text-white/50 border border-white/10 hover:text-white/70"
                      : "bg-white text-gray-500 border border-gray-200 hover:text-gray-700"
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
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    priority === p
                      ? p === "urgent"
                        ? isDark
                          ? "bg-red-500/20 text-red-400 border border-red-500/30"
                          : "bg-red-100 text-red-600 border border-red-200"
                        : isDark
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        : "bg-amber-100 text-amber-700 border border-amber-200"
                      : isDark
                      ? "bg-white/5 text-white/50 border border-white/10 hover:text-white/70"
                      : "bg-white text-gray-500 border border-gray-200 hover:text-gray-700"
                  )}
                >
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Assigned Admin */}
          <div className="flex flex-col gap-1.5">
            <label className={cn("text-xs font-medium", isDark ? "text-white/60" : "text-gray-600")}>
              İlgilenecek Kişi <span className="text-red-500">*</span>
            </label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger
                className={cn(
                  "h-11 rounded-xl",
                  isDark ? "bg-white/5 border-white/10 text-white" : ""
                )}
              >
                <SelectValue placeholder="Bir admin seçin..." />
              </SelectTrigger>
              <SelectContent>
                {adminUsers.map((admin) => (
                  <SelectItem key={admin.uid} value={admin.uid}>
                    {admin.name} ({admin.role === "admin_developer" ? "Admin-Geliştirici" : "Admin"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-full flex-1"
              disabled={submitting}
            >
              Vazgeç
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || !title.trim() || !assignedTo}
              className="rounded-full flex-1 gap-2 bg-amber-500 hover:bg-amber-600 text-white"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Talep Gönder
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
