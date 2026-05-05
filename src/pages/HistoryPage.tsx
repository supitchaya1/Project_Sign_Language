import { useEffect, useMemo, useState } from "react";
import { Search, Calendar, Eye, Trash2, Filter, Check } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchMyHistory,
  deleteHistory,
  deleteManyHistory,
  deleteAllHistory,
  type HistoryRecord,
} from "@/services/history";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SortOrder = "newest" | "oldest";
type DeleteMode = "single" | "selected" | "all";

function safeTime(s?: string | null) {
  if (!s) return 0;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

function normalizeText(s?: string | null) {
  return (s ?? "").trim();
}

function makeDuplicateKey(item: HistoryRecord) {
  return `${normalizeText(item.input_text)}|||${normalizeText(item.translated_result)}`;
}

export default function HistoryPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<HistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("single");
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsLoading(false);
      setItems([]);
      setErrorMessage(null);
      setSelectedIds([]);
      return;
    }

    let isMounted = true;

    const loadHistory = async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);

        const data = await fetchMyHistory();
        if (!isMounted) return;

        setItems(data);
      } catch (error: unknown) {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : "โหลดประวัติไม่สำเร็จ";
        setErrorMessage(message);
      } finally {
        if (!isMounted) return;
        setIsLoading(false);
      }
    };

    loadHistory();

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    let list = items;

    if (q) {
      list = list.filter((it) => {
        const input = normalizeText(it.input_text).toLowerCase();
        const translated = normalizeText(it.translated_result).toLowerCase();
        const summary = normalizeText(it.summary_text).toLowerCase();
        const keywords = normalizeText(it.keywords).toLowerCase();

        return (
          input.includes(q) ||
          translated.includes(q) ||
          summary.includes(q) ||
          keywords.includes(q)
        );
      });
    }

    const sorted = [...list].sort((a, b) => {
      const ta = safeTime(a.created_at);
      const tb = safeTime(b.created_at);
      return sortOrder === "newest" ? tb - ta : ta - tb;
    });

    const seen = new Set<string>();
    const deduped: HistoryRecord[] = [];

    for (const item of sorted) {
      const key = makeDuplicateKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    return deduped;
  }, [items, searchQuery, sortOrder]);

  const filteredIds = useMemo(() => filteredItems.map((item) => item.id), [filteredItems]);

  const selectedCount = selectedIds.length;
  const hasSelection = selectedCount > 0;

  const isAllFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      if (isAllFilteredSelected) {
        return prev.filter((id) => !filteredIds.includes(id));
      }

      const merged = new Set([...prev, ...filteredIds]);
      return Array.from(merged);
    });
  };

  const handleDelete = (id: string) => {
    setDeleteMode("single");
    setItemToDelete(id);
    setShowDeleteModal(true);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) {
      toast.error("กรุณาเลือกรายการที่ต้องการลบ");
      return;
    }

    setDeleteMode("selected");
    setItemToDelete(null);
    setShowDeleteModal(true);
  };

  const handleDeleteAll = () => {
    if (items.length === 0) {
      toast.error("ยังไม่มีประวัติให้ลบ");
      return;
    }

    setDeleteMode("all");
    setItemToDelete(null);
    setShowDeleteModal(true);
  };

  const handleBulkDelete = () => {
    if (hasSelection) {
      handleDeleteSelected();
      return;
    }

    handleDeleteAll();
  };

  const confirmDelete = async () => {
    setIsDeleting(true);

    try {
      if (deleteMode === "single") {
        if (!itemToDelete) return;

        await deleteHistory(itemToDelete);
        setItems((prev) => prev.filter((x) => x.id !== itemToDelete));
        setSelectedIds((prev) => prev.filter((id) => id !== itemToDelete));
        toast.success("ลบประวัติสำเร็จ");
      }

      if (deleteMode === "selected") {
        if (selectedIds.length === 0) return;

        await deleteManyHistory(selectedIds);
        setItems((prev) => prev.filter((x) => !selectedIds.includes(x.id)));
        setSelectedIds([]);
        toast.success(`ลบประวัติที่เลือก ${selectedIds.length} รายการสำเร็จ`);
      }

      if (deleteMode === "all") {
        await deleteAllHistory();
        setItems([]);
        setSelectedIds([]);
        toast.success("ลบประวัติทั้งหมดสำเร็จ");
      }

      setShowDeleteModal(false);
      setItemToDelete(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "ลบไม่สำเร็จ (ตรวจสอบสิทธิ์ RLS / ตาราง)";
      toast.error(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleViewVideo = async (item: HistoryRecord) => {
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: item.input_text,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        toast.error("ไม่สามารถโหลดวิดีโอจากประวัติได้");
        return;
      }

      navigate("/result", {
        state: data, // 🔥 ส่งทั้งก้อนเลย
      });
    } catch (err) {
      toast.error("เกิดข้อผิดพลาดในการโหลดวิดีโอ");
    }
  };

  const getDeleteDialogText = () => {
    if (deleteMode === "single") {
      return "คุณต้องการลบประวัตินี้หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้";
    }

    if (deleteMode === "selected") {
      return `คุณต้องการลบประวัติที่เลือก ${selectedCount} รายการหรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้`;
    }

    return "คุณต้องการลบประวัติทั้งหมดหรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้";
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] py-10 md:py-14">
        <div className="container mx-auto px-4 max-w-3xl">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl md:text-4xl font-bold text-[#263F5D] dark:text-[#D8C0D0] text-center mb-10"
          >
            ประวัติการแปล
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-2xl border-2 border-[#223C55] dark:border-[#213B54] rounded-2xl p-10 bg-[#A6BFE3] text-center"
          >
            <div className="text-5xl mb-5">🔒</div>

            <h2 className="text-xl md:text-2xl font-bold text-[#263F5D] mb-2">
              เข้าสู่ระบบเพื่อดูประวัติ
            </h2>

            <p className="text-[#263F5D]/70 mb-7 text-sm md:text-base">
              กรุณาเข้าสู่ระบบเพื่อดูประวัติการแปลเสียงของคุณ
            </p>

            <div className="flex gap-4 justify-center">
              <Link to="/login">
                <Button className="bg-[#0F1F2F] hover:bg-[#1a2f44] text-[#C9A7E3] px-7 rounded-xl">
                  เข้าสู่ระบบ
                </Button>
              </Link>

              <Link to="/register">
                <Button
                  variant="outline"
                  className="border-2 border-[#223C55] text-[#263F5D] bg-white/60 hover:bg-white/80 px-7 rounded-xl"
                >
                  สร้างบัญชี
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] py-8 md:py-12">
      <div className="container mx-auto px-4 max-w-2xl">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl md:text-3xl font-bold text-[#263F5D] dark:text-[#D8C0D0] text-center mb-8"
        >
          ประวัติการแปล
        </motion.h1>

        {errorMessage && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 mb-4">
            {errorMessage}
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3] mb-4"
        >
          <h2 className="font-semibold text-[#263F5D] mb-3 text-sm">ค้นหาและคัดกรอง</h2>

          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#263F5D]/40"
              />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาข้อความ คำแปล คำสำคัญ"
                className="pl-9 bg-white/50 border-2 border-[#223C55] text-[#263F5D] placeholder:text-[#263F5D]/40 text-sm"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="border-2 border-[#223C55] text-[#263F5D] bg-white/50 hover:bg-white/70 shrink-0"
                  aria-label="Filter"
                >
                  <Filter size={16} />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>เรียงตาม</DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={() => setSortOrder("newest")}>
                  <span className="mr-2 inline-flex w-4">
                    {sortOrder === "newest" ? <Check size={14} /> : null}
                  </span>
                  ล่าสุด
                </DropdownMenuItem>

                <DropdownMenuItem onClick={() => setSortOrder("oldest")}>
                  <span className="mr-2 inline-flex w-4">
                    {sortOrder === "oldest" ? <Check size={14} /> : null}
                  </span>
                  เก่าสุด
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={toggleSelectAllFiltered}
              disabled={filteredIds.length === 0}
              className="border-2 border-[#223C55] text-[#263F5D] bg-white/50 hover:bg-white/70 disabled:opacity-50"
            >
              {isAllFilteredSelected ? "ยกเลิกเลือกทั้งหมด" : "เลือกทั้งหมด"}
            </Button>

            <div className="h-6 w-px bg-[#223C55]/20 mx-1 hidden sm:block" />

            <Button
              type="button"
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={!hasSelection && items.length === 0}
              className="disabled:opacity-50"
            >
              {hasSelection ? `ลบที่เลือก (${selectedCount})` : "ลบทั้งหมด"}
            </Button>
          </div>
        </motion.div>

        {isLoading ? (
          <div className="text-center text-[#263F5D]/70">กำลังโหลด...</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center text-[#263F5D]/70">
            {items.length === 0 ? "ยังไม่มีประวัติการแปล" : "ไม่พบผลลัพธ์ที่ค้นหา"}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item, index) => {
              const isChecked = selectedIds.includes(item.id);

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`border-2 rounded-xl p-5 bg-[#A6BFE3] ${
                    isChecked
                      ? "border-[#0F1F2F] dark:border-white"
                      : "border-[#223C55] dark:border-[#213B54]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelectOne(item.id)}
                        className="mt-1 h-4 w-4 shrink-0 accent-[#0F1F2F] cursor-pointer"
                        aria-label={`เลือกรายการ ${item.id}`}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Calendar size={14} className="text-[#263F5D]/40 shrink-0" />
                          <span className="text-xs text-[#263F5D]/60 break-all">
                            {item.created_at ? new Date(item.created_at).toLocaleString() : "-"}
                          </span>
                        </div>

                        <p className="text-[#263F5D] text-sm line-clamp-2 break-words">
                          {item.input_text || "-"}
                        </p>

                        {!!item.translated_result && (
                          <p className="text-xs mt-2 text-[#263F5D]/80 break-words">
                            <span className="font-semibold">สรุปใจความ:</span>{" "}
                            {normalizeText(item.translated_result).replace(/\s+/g, "")}
                          </p>
                        )}

                        {!!item.keywords && (
                          <p className="text-xs mt-1 text-[#263F5D]/70 break-words">
                            <span className="font-semibold">คำสำคัญ:</span> {item.keywords}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="flex items-center gap-1 bg-[#0F1F2F] hover:bg-[#1a2f44] text-[#C9A7E3] text-xs px-3"
                        onClick={() => handleViewVideo(item)}
                      >
                        <Eye size={12} />
                        <span className="hidden sm:inline">ดูวิดีโอ</span>
                      </Button>

                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(item.id)}
                        className="flex items-center gap-1 text-xs px-3"
                      >
                        <Trash2 size={12} />
                        <span className="hidden sm:inline">ลบ</span>
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showDeleteModal} onOpenChange={(open) => !isDeleting && setShowDeleteModal(open)}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-[#1a2f44]">
          <DialogHeader>
            <DialogTitle className="text-center text-[#263F5D] dark:text-white">
              ยืนยันการลบประวัติ
            </DialogTitle>
          </DialogHeader>

          <div className="py-4 text-center">
            <p className="text-[#263F5D]/60 dark:text-white/60 text-sm">
              {getDeleteDialogText()}
            </p>
          </div>

          <DialogFooter className="flex gap-2 sm:justify-center">
            <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? "กำลังลบ..." : "ลบ"}
            </Button>

            <Button
              variant="outline"
              onClick={() => setShowDeleteModal(false)}
              disabled={isDeleting}
              className="border-2 border-[#223C55] dark:border-white/30"
            >
              ยกเลิก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}