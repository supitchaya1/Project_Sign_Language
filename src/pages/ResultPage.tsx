import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Video, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import PosePlayer from "@/components/PosePlayer";

// ==========================================
// 1) Backend URL + buildPoseUrl
// ==========================================
const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_BASE as string) || "http://127.0.0.1:8000";

function joinUrl(base: string, path: string) {
  const b = (base ?? "").trim().replace(/\/+$/, "");
  const p = (path ?? "").trim().replace(/^\/+/, "");
  return `${b}/${p}`;
}

function buildPoseUrl(filename: string) {
  const clean = (filename ?? "").trim();
  return `${joinUrl(BACKEND_URL, "api/pose")}?name=${encodeURIComponent(clean)}`;
}

// ==========================================
// 2) Interfaces
// ==========================================
interface ResultState {
  originalText?: string;
  summary?: string;
  keywords?: string[];
}

interface WordData {
  word: string;
  category: string;
  pose_filename: string;
}

interface ProcessedWordData {
  word: string;
  category: string;
  pose_filename: string;
  fullUrl: string;
}

type Role = "S" | "V" | "O" | "NEG" | "Adv(Time)" | "PP(Place)" | "Q";

interface CategoryRoleRow {
  category: string;
  role: Role;
  priority: number;
}

// ==========================================
// 3) Token utils
// ==========================================
function normalizeThaiToken(s: string) {
  return (s ?? "")
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, "") // zero-width
    .trim();
}

function cleanTokens(tokens: string[]) {
  return (tokens || []).map(normalizeThaiToken).filter(Boolean);
}

function isNumberToken(token: string) {
  return /^[0-9]+$/.test(token);
}

// ==========================================
// 4) Reorder by DB role (Thai -> ThSL Order)
// ==========================================
function toThslOrderByRole(items: { word: string; role: Role }[]) {
  // ลำดับ ThSL ที่เธอใช้: เวลา, สถานที่, ประธาน, กรรม(ทั้งหมด), กริยา, ปฏิเสธ, คำถาม, ที่เหลือ
  const used = new Set<number>();

  const takeFirst = (role: Role) => {
    const idx = items.findIndex((x, i) => !used.has(i) && x.role === role);
    if (idx >= 0) {
      used.add(idx);
      return items[idx].word;
    }
    return null;
  };

  const takeAll = (role: Role) => {
    const out: string[] = [];
    items.forEach((x, i) => {
      if (!used.has(i) && x.role === role) {
        used.add(i);
        out.push(x.word);
      }
    });
    return out;
  };

  const rest = () => items.filter((_, i) => !used.has(i)).map((x) => x.word);

  const out: string[] = [];
  const t = takeFirst("Adv(Time)");
  if (t) out.push(t);

  const p = takeFirst("PP(Place)");
  if (p) out.push(p);

  const s = takeFirst("S");
  if (s) out.push(s);

  out.push(...takeAll("O"));

  const v = takeFirst("V");
  if (v) out.push(v);

  const n = takeFirst("NEG");
  if (n) out.push(n);

  const q = takeFirst("Q");
  if (q) out.push(q);

  return [...out, ...rest()].filter(Boolean);
}

// ==========================================
// 5) Main Component
// ==========================================
export default function ResultPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [foundWords, setFoundWords] = useState<ProcessedWordData[]>([]);
  const [loadingKeywords, setLoadingKeywords] = useState(false);

  type ViewMode = "sentence" | "single";
  const [viewMode, setViewMode] = useState<ViewMode>("sentence");

  // ✅ single pose preview
  const [currentSinglePose, setCurrentSinglePose] = useState<string | null>(null);

  // ✅ sentence mp4 url (blob)
  const [sentenceVideoUrl, setSentenceVideoUrl] = useState<string | null>(null);
  const [loadingSentenceVideo, setLoadingSentenceVideo] = useState(false);
  const prevBlobUrl = useRef<string | null>(null);

  const state = location.state as ResultState | null;

  const resultData = {
    text: state?.originalText || "ไม่มีข้อความ",
    summary: state?.summary || "ไม่มีข้อมูลสรุป",
    keywords: state?.keywords || [],
  };

  // helper: cleanup blob url
  const setNewBlobUrl = (url: string | null) => {
    if (prevBlobUrl.current) {
      URL.revokeObjectURL(prevBlobUrl.current);
      prevBlobUrl.current = null;
    }
    if (url) prevBlobUrl.current = url;
    setSentenceVideoUrl(url);
  };

  useEffect(() => {
    const run = async () => {
      const tokens = cleanTokens(resultData.keywords || []);
      if (tokens.length === 0) {
        setFoundWords([]);
        setCurrentSinglePose(null);
        setNewBlobUrl(null);
        return;
      }

      setLoadingKeywords(true);
      setLoadingSentenceVideo(true);
      setNewBlobUrl(null);

      // 1) โหลด mapping: category -> role, priority
      const { data: mapData, error: mapErr } = await supabase
        .from("sl_category_role")
        .select("category, role, priority");

      if (mapErr) {
        console.error("❌ Load sl_category_role error:", mapErr);
        // ถ้า mapping ไม่มี/ผิดพลาด: treat ทุกคำเป็น O เพื่อให้ระบบยังทำงานได้
      }

      const roleMap = new Map<string, { role: Role; priority: number }>();
      (mapData as CategoryRoleRow[] | null)?.forEach((r) => {
        roleMap.set(normalizeThaiToken(r.category), { role: r.role, priority: r.priority ?? 999 });
      });

      const getRole = (category: string): { role: Role; priority: number } => {
        const key = normalizeThaiToken(category);
        return roleMap.get(key) ?? { role: "O", priority: 999 };
      };

      // 2) query SL_word เฉพาะคำที่ต้องใช้
      const unique = Array.from(new Set(tokens));

      const { data, error } = await supabase
        .from("SL_word")
        .select("word, category, pose_filename")
        .in("word", unique);

      if (error) {
        console.error("Fetch SL_word error:", error);
        setFoundWords([]);
        setCurrentSinglePose(null);
        setLoadingKeywords(false);
        setLoadingSentenceVideo(false);
        return;
      }

      const raw = (data as WordData[]) || [];

      // group: word -> rows[]
      const grouped = new Map<string, WordData[]>();
      raw.forEach((row) => {
        const w = normalizeThaiToken(row.word);
        if (!grouped.has(w)) grouped.set(w, []);
        grouped.get(w)!.push(row);
      });

      // 3) เลือก pose ที่ “ดีที่สุด” ต่อ token โดยใช้ priority จาก sl_category_role (ไม่ hardcode)
      const pickBestRow = (token: string, rows: WordData[]) => {
        const t = normalizeThaiToken(token);

        return rows
          .slice()
          .sort((a, b) => {
            const ra = getRole(a.category);
            const rb = getRole(b.category);

            // ถ้า token เป็นตัวเลข ให้เอา category ตัวเลขก่อน
            const boostA = isNumberToken(t) && a.category === "ตัวเลข" ? -1000 : 0;
            const boostB = isNumberToken(t) && b.category === "ตัวเลข" ? -1000 : 0;

            return (ra.priority + boostA) - (rb.priority + boostB);
          })[0];
      };

      // 4) สร้าง list ที่มี role ของแต่ละ token (ตามลำดับ tokens เดิมก่อน)
      const tokenWithRole: { word: string; role: Role }[] = [];
      const pickedRowsInTokenOrder: WordData[] = [];

      for (const t of tokens) {
        const rows = grouped.get(t) ?? [];
        if (rows.length === 0) continue; // ไม่เจอใน DB
        const best = rows.length === 1 ? rows[0] : pickBestRow(t, rows);
        const r = getRole(best.category);
        tokenWithRole.push({ word: t, role: r.role });
        pickedRowsInTokenOrder.push(best);
      }

      // log คำที่ไม่เจอใน DB
      const foundSet = new Set(tokenWithRole.map((x) => x.word));
      const notFound = tokens.filter((t) => !foundSet.has(t));
      if (notFound.length) console.warn("❌ Not found in SL_word:", notFound);

      // 5) เรียงลำดับใหม่ด้วย role จาก DB
      const orderedTokens = toThslOrderByRole(tokenWithRole);

      // 6) เอา orderedTokens ไป map กลับเป็น row ที่เลือกไว้
      const rowsByToken = new Map<string, WordData>();
      pickedRowsInTokenOrder.forEach((r) => rowsByToken.set(normalizeThaiToken(r.word), r));

      const orderedPickedRows: WordData[] = orderedTokens
        .map((t) => rowsByToken.get(normalizeThaiToken(t)) ?? null)
        .filter(Boolean) as WordData[];

      const processed: ProcessedWordData[] = orderedPickedRows.map((item) => ({
        word: normalizeThaiToken(item.word),
        category: item.category,
        pose_filename: item.pose_filename,
        fullUrl: buildPoseUrl(item.pose_filename),
      }));

      setFoundWords(processed);
      setCurrentSinglePose(processed.length > 0 ? processed[0].fullUrl : null);
      setLoadingKeywords(false);

      // 7) concat_video
      try {
        if (processed.length === 0) {
          setLoadingSentenceVideo(false);
          setNewBlobUrl(null);
          return;
        }

        const filenames = processed
          .map((x) => (x.pose_filename ?? "").trim())
          .filter(Boolean);

        const resp = await fetch(joinUrl(BACKEND_URL, "api/concat_video"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pose_filenames: filenames,
            output_name: "sentence.mp4",
          }),
        });

        if (!resp.ok) {
          const text = await resp.text();
          console.error("concat_video failed:", resp.status, text);
          setLoadingSentenceVideo(false);
          setNewBlobUrl(null);
          return;
        }

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        setNewBlobUrl(url);
        setLoadingSentenceVideo(false);
      } catch (e) {
        console.error("concat_video error:", e);
        setLoadingSentenceVideo(false);
        setNewBlobUrl(null);
      }
    };

    run();

    return () => {
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(resultData.keywords || [])]);

  const handleDownloadPose = () => {
    if (currentSinglePose) window.open(currentSinglePose, "_blank");
  };

  const handleDownloadSentenceVideo = () => {
    if (!sentenceVideoUrl) return;
    const a = document.createElement("a");
    a.href = sentenceVideoUrl;
    a.download = "sentence.mp4";
    a.click();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] pt-20 pb-8 md:pt-24 md:pb-12">
      <div className="container mx-auto px-4 max-w-xl">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl md:text-3xl font-bold text-[#263F5D] dark:text-[#D8C0D0] text-center mb-8"
        >
          ผลลัพธ์การแปล
        </motion.h1>

        <div className="space-y-4">
          {/* View Mode Tabs */}
            <div className="flex gap-2 rounded-xl border-2 border-[#223C55] bg-white/60 p-2">
              <button
                type="button"
                onClick={() => setViewMode("sentence")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
                  viewMode === "sentence"
                    ? "bg-[#0F1F2F] text-white shadow"
                    : "bg-transparent text-[#263F5D] hover:bg-white/60"
                }`}
              >
                วิดีโอภาษามือ (ทั้งประโยค)
              </button>

              <button
                type="button"
                onClick={() => setViewMode("single")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-all ${
                  viewMode === "single"
                    ? "bg-[#0F1F2F] text-white shadow"
                    : "bg-transparent text-[#263F5D] hover:bg-white/60"
                }`}
              >
                ดูทีละคำ (Pose)
              </button>
            </div>

          {/* Sentence Video (mp4) */}
          {viewMode === "sentence" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Video size={18} className="text-[#263F5D]" />
                  <h2 className="font-semibold text-[#263F5D] text-sm">
                    วิดีโอภาษามือ (ทั้งประโยค)
                  </h2>
                </div>
              </div>

              <div className="relative aspect-video bg-[#0F1F2F] rounded-lg overflow-hidden mb-4 border border-white/10 shadow-inner">
                {loadingKeywords || loadingSentenceVideo ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
                    <RefreshCw className="animate-spin mb-2" />
                    <span className="text-xs">
                      กำลังสร้างวิดีโอทั้งประโยค...
                    </span>
                  </div>
                ) : sentenceVideoUrl ? (
                  <video
                    className="w-full h-full object-contain"
                    src={sentenceVideoUrl}
                    controls
                    playsInline
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
                    <span className="text-3xl mb-2">🚫</span>
                    <span className="text-xs">
                      สร้างวิดีโอไม่สำเร็จ (เช็ค backend / pose_concat)
                    </span>
                  </div>
                )}
              </div>

              <Button
                disabled={!sentenceVideoUrl}
                className="w-full bg-[#0F1F2F] hover:bg-[#1a2f44] text-white text-sm disabled:opacity-50 transition-colors"
                onClick={handleDownloadSentenceVideo}
              >
                <Download size={16} className="mr-2" />
                ดาวน์โหลดวิดีโอทั้งประโยค (.mp4)
              </Button>
            </motion.div>
          )}

          {/* Single Pose Preview (PosePlayer) */}
          {viewMode === "single" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Video size={18} className="text-[#263F5D]" />
                  <h2 className="font-semibold text-[#263F5D] text-sm">ดูทีละคำ</h2>
                </div>
              </div>

              <div className="relative aspect-video bg-[#0F1F2F] rounded-lg overflow-hidden mb-4 border border-white/10 shadow-inner">
                {loadingKeywords ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
                    <RefreshCw className="animate-spin mb-2" />
                    <span className="text-xs">กำลังค้นหาท่าภาษามือ...</span>
                  </div>
                ) : currentSinglePose ? (
                  <PosePlayer
                    key={currentSinglePose}
                    poseUrl={currentSinglePose}
                    width={640}
                    height={360}
                    fps={24}
                    confThreshold={0.05}
                    flipY={false}
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
                    <span className="text-3xl mb-2">🚫</span>
                    <span className="text-xs">ไม่พบไฟล์ท่าทาง หรือยังไม่ได้เลือกคำศัพท์</span>
                  </div>
                )}
              </div>
              
              {/* ปุ่มดาวน์โหลดไฟล์ .pose ทีละคำ */}
              {/* <Button
                disabled={!currentSinglePose}
                className="w-full bg-[#0F1F2F] hover:bg-[#1a2f44] text-white text-sm disabled:opacity-50 transition-colors"
                onClick={handleDownloadPose}
              >
                <Download size={16} className="mr-2" />
                ดาวน์โหลดไฟล์ .pose
              </Button> */}
            </motion.div>
          )}

          {/* Text + Summary */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid gap-4"
          >
            <div className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]">
              <h2 className="font-semibold text-[#263F5D] mb-2 text-sm">ข้อความต้นฉบับ</h2>
              <p className="text-[#263F5D] leading-relaxed text-sm">{resultData.text}</p>
            </div>

            <div className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]">
              <h2 className="font-semibold text-[#263F5D] mb-2 text-sm">สรุปใจความ</h2>
              <p className="text-[#263F5D] leading-relaxed text-sm">{resultData.summary}</p>
            </div>
          </motion.div>

          {/* Keywords */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <h2 className="font-semibold text-[#263F5D] mb-3 text-sm"># คำสำคัญ</h2>

            <div className="flex flex-wrap gap-2">
              {loadingKeywords ? (
                <p className="text-[#263F5D]/60 text-sm animate-pulse">กำลังเรียบเรียงประโยค...</p>
              ) : foundWords.length > 0 ? (
                foundWords.map((item, idx) => {
                  const isActive = currentSinglePose === item.fullUrl;
                  return (
                    <Badge
                      key={`${item.word}-${idx}`}
                      onClick={() => {
                        setCurrentSinglePose(item.fullUrl);
                        setViewMode("single");
                      }}
                      className={`cursor-pointer px-3 py-1.5 text-xs transition-all border border-transparent ${
                        isActive
                          ? "bg-[#FEC530] text-[#0F1F2F] scale-105 shadow-md border-white/20"
                          : "bg-[#0F1F2F] text-[#C9A7E3] hover:bg-[#1a2f44] hover:scale-105"
                      }`}
                      title={`หมวดหมู่: ${item.category}`}
                    >
                      {item.word}
                    </Badge>
                  );
                })
              ) : (
                <p className="text-[#263F5D]/60 text-sm">ไม่พบคำสำคัญในฐานข้อมูล</p>
              )}
            </div>
          </motion.div>

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="grid grid-cols-2 gap-3 pt-4"
          >
            <Button
              variant="outline"
              onClick={() => navigate("/translate")}
              className="py-6 text-[#263F5D] border-2 border-[#223C55] bg-white/50 hover:bg-white/80 text-sm font-medium"
            >
              <ArrowLeft size={16} className="mr-2" />
              ย้อนกลับแก้ไข
            </Button>

            <Button
              onClick={() => navigate("/translate")}
              className="bg-[#0F1F2F] hover:bg-[#1a2f44] text-[#C9A7E3] py-6 text-sm font-medium shadow-lg shadow-[#0F1F2F]/20"
            >
              สร้างเสียงใหม่
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
