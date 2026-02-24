import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Video, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import PosePlayer from "@/components/PosePlayer";

import { THSL_RULES, Role as RuleRole, ThslRule } from "@/services/thslRules";

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

interface CategoryRoleRow {
  category: string;
  role: string; // role จาก DB
  priority: number;
}

// ==========================================
// 3) Utils
// ==========================================
function normalizeThaiToken(s: string) {
  return (s ?? "")
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, "")
    .trim();
}

function normalizeThaiText(s: string) {
  return (s ?? "").replace(/\u200B|\u200C|\u200D|\uFEFF/g, "");
}

function cleanTokens(tokens: string[]) {
  return (tokens || []).map(normalizeThaiToken).filter(Boolean);
}

function uniqPreserveOrder(tokens: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const x = normalizeThaiToken(t);
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function isNumberToken(token: string) {
  return /^[0-9]+$/.test(token);
}

// ✅ เรียง tokens ตามตำแหน่งที่พบในข้อความต้นฉบับ (Thai order)
function orderTokensByOriginalText(originalText: string, tokens: string[]) {
  const text = normalizeThaiText(originalText);
  return (tokens || [])
    .map((t, i) => {
      const token = normalizeThaiToken(t);
      const idx = text.indexOf(token);
      return { token, i, idx: idx >= 0 ? idx : 1e15 };
    })
    .sort((a, b) => (a.idx !== b.idx ? a.idx - b.idx : a.i - b.i))
    .map((x) => x.token)
    .filter(Boolean);
}

// ✅ ตัดคำจาก originalText (รองรับ "คุณดูโทรทัศน์" ไม่มีเว้นวรรค)
function segmentThaiWords(text: string): string[] {
  const s = normalizeThaiText(text).trim();
  if (!s) return [];

  const Seg = (globalThis as any).Intl?.Segmenter;
  if (typeof Seg === "function") {
    const segmenter = new Seg("th", { granularity: "word" });
    const out: string[] = [];
    for (const part of segmenter.segment(s)) {
      const isWordLike = (part as any).isWordLike;
      if (isWordLike === false) continue;
      const w = normalizeThaiToken((part as any).segment);
      if (w) out.push(w);
    }
    return out;
  }

  // fallback ถ้าไม่มี Segmenter
  return s.split(/\s+/).map(normalizeThaiToken).filter(Boolean);
}

// ✅ ถ้ามีคำรวมอยู่แล้ว ให้ตัดคำย่อยที่เป็น substring ออก (prefer คำยาวกว่า)
// ตัวอย่าง: มี "โทรศัพท์บ้าน" แล้วตัด "โทรศัพท์", "บ้าน"
function dropSubTokens(tokens: string[]) {
  const tks = uniqPreserveOrder(tokens.map(normalizeThaiToken).filter(Boolean));

  // เรียงยาวก่อน เพื่อให้เก็บคำรวมก่อน
  const sorted = tks.slice().sort((a, b) => b.length - a.length);

  const kept: string[] = [];
  for (const t of sorted) {
    const isSub = kept.some((k) => k.includes(t) && k !== t);
    if (!isSub) kept.push(t);
  }

  // คืนลำดับเดิม
  const keptSet = new Set(kept);
  return tks.filter((t) => keptSet.has(t));
}

// ==========================================
// 4) Rule engine (Table 1–40)
// ==========================================
function normalizeDbRoleToRuleRole(dbRole: string): RuleRole {
  const r = (dbRole ?? "").trim();

  // รองรับ DB เก่า/สั้น
  if (r === "Q") return "Q(?)";
  if (r === "What") return "What(?)";
  if (r === "Who") return "Who(?)";
  if (r === "Whose") return "Whose(?)";

  return r as RuleRole;
}

function rolesOf(tagged: { role: RuleRole | "UNK" }[]) {
  return tagged.map((t) => t.role).filter((r) => r !== "UNK") as RuleRole[];
}

function findExactRule(tagged: { role: RuleRole | "UNK" }[]): ThslRule | null {
  const pattern = rolesOf(tagged);

  for (const rule of THSL_RULES) {
    if (rule.thaiPattern.length !== pattern.length) continue;
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] !== rule.thaiPattern[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return rule;
  }
  return null;
}

function reorderByRule(
  tagged: { word: string; role: RuleRole | "UNK" }[],
  thslOrder: RuleRole[]
) {
  const used = new Set<number>();
  const out: string[] = [];

  for (const role of thslOrder) {
    // special case Age/Year (rule 27)
    if ((role as any) === "Age/Year") {
      const idxAge = tagged.findIndex(
        (t, i) => !used.has(i) && t.role === ("Age" as any)
      );
      const idxYear = tagged.findIndex(
        (t, i) => !used.has(i) && t.role === ("Year" as any)
      );
      if (idxAge >= 0) {
        out.push(tagged[idxAge].word);
        used.add(idxAge);
        continue;
      }
      if (idxYear >= 0) {
        out.push(tagged[idxYear].word);
        used.add(idxYear);
        continue;
      }
      continue;
    }

    const idx = tagged.findIndex((t, i) => !used.has(i) && t.role === role);
    if (idx >= 0) {
      out.push(tagged[idx].word);
      used.add(idx);
    }
  }

  // เติมคำที่เหลือท้ายสุด
  tagged.forEach((t, i) => {
    if (!used.has(i)) out.push(t.word);
  });

  return out.filter(Boolean);
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

  const [currentSinglePose, setCurrentSinglePose] = useState<string | null>(null);

  const [sentenceVideoUrl, setSentenceVideoUrl] = useState<string | null>(null);
  const [loadingSentenceVideo, setLoadingSentenceVideo] = useState(false);
  const prevBlobUrl = useRef<string | null>(null);

  const state = location.state as ResultState | null;

  const resultData = {
    text: state?.originalText || "ไม่มีข้อความ",
    summary: state?.summary || "ไม่มีข้อมูลสรุป",
    keywords: state?.keywords || [],
  };

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
      const kwTokens = cleanTokens(resultData.keywords || []);

      if (kwTokens.length === 0) {
        setFoundWords([]);
        setCurrentSinglePose(null);
        setNewBlobUrl(null);
        return;
      }

      setLoadingKeywords(true);
      setLoadingSentenceVideo(true);
      setNewBlobUrl(null);

      // 1) โหลด mapping category -> role, priority
      const { data: mapData, error: mapErr } = await supabase
        .from("sl_category_role")
        .select("category, role, priority");

      if (mapErr) console.error("❌ Load sl_category_role error:", mapErr);

      const roleMap = new Map<string, { role: RuleRole; priority: number }>();
      (mapData as CategoryRoleRow[] | null)?.forEach((r) => {
        roleMap.set(normalizeThaiToken(r.category), {
          role: normalizeDbRoleToRuleRole(r.role),
          priority: r.priority ?? 999,
        });
      });

      const getRole = (category: string): { role: RuleRole; priority: number } => {
        const key = normalizeThaiToken(category);
        return roleMap.get(key) ?? { role: "O", priority: 999 };
      };

      // ✅ 2) เติม “คำสำคัญจากข้อความต้นฉบับ” แบบไม่ hardcode (S/V/O/NEG/PP/Adv/Q ฯลฯ)
      const textTokens = uniqPreserveOrder(segmentThaiWords(resultData.text));
      const candidateTextTokens = textTokens.slice(0, 200);

      let extraFromText: string[] = [];

      const IMPORTANT_ROLES = new Set<RuleRole>([
        "S",
        "V",
        "O",
        "NEG",
        "PP(Place)",
        "Adv(Time)",
        "When/Why/Where/How(?)",
        "What(?)",
        "Who(?)",
        "Whose(?)",
        "Q(?)",
        "Pronoun",
        "V2B",
        "ClausalVerb",
        "Adj",
        "Adj1",
        "Adj2",
        "NP",
        "PAdj",
        "ComparativeAdj",
        "Money",
        "Number",
        "Currency",
        "Age",
        "Year",
        "Break",
      ]);

      if (candidateTextTokens.length > 0) {
        const { data: textRows, error: textErr } = await supabase
          .from("SL_word")
          .select("word, category, pose_filename")
          .in("word", candidateTextTokens);

        if (textErr) {
          console.warn("⚠️ Cannot load SL_word for originalText tokens:", textErr);
        } else {
          const rows = (textRows as WordData[]) || [];

          // เก็บ token ที่ role สำคัญ (ตามลำดับที่พบในข้อความ)
          const seen = new Set<string>();
          for (const tok of candidateTextTokens) {
            const normTok = normalizeThaiToken(tok);
            if (!normTok || seen.has(normTok)) continue;

            const candidates = rows.filter(
              (r) => normalizeThaiToken(r.word) === normTok
            );
            if (candidates.length === 0) continue;

            // เลือก candidate ที่ priority ดีสุด (อิง DB)
            const best = candidates
              .slice()
              .sort(
                (a, b) => getRole(a.category).priority - getRole(b.category).priority
              )[0];

            const role = getRole(best.category).role;
            if (IMPORTANT_ROLES.has(role)) {
              extraFromText.push(normTok);
              seen.add(normTok);
            }
          }
        }
      }

      // ✅ 3) รวม tokens: keywords + extraFromText
      const mergedTokens = uniqPreserveOrder([...kwTokens, ...extraFromText]);

      // ✅ 3.1) ตัดคำย่อยเมื่อมีคำรวม (แก้ปัญหา โทรศัพท์บ้าน + โทรศัพท์ + บ้าน)
      const mergedNoSub = dropSubTokens(mergedTokens);

      // ✅ 3.2) จัด Thai order ก่อน เพื่อ match pattern ฝั่ง "Thai"
      const tokensThai = orderTokensByOriginalText(resultData.text, mergedNoSub);

      // 4) query SL_word เฉพาะคำที่ต้องใช้
      const unique = Array.from(new Set(tokensThai));
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

      // เลือก pose ที่ดีที่สุด ต่อ token ตาม priority (ไม่ hardcode)
      const pickBestRow = (token: string, rows: WordData[]) => {
        const t = normalizeThaiToken(token);
        return rows
          .slice()
          .sort((a, b) => {
            const ra = getRole(a.category);
            const rb = getRole(b.category);

            // ถ้า token เป็นตัวเลข ให้ boost หมวดตัวเลข/จำนวน
            const boostA =
              isNumberToken(t) && (a.category === "ตัวเลข" || a.category === "จำนวน")
                ? -1000
                : 0;
            const boostB =
              isNumberToken(t) && (b.category === "ตัวเลข" || b.category === "จำนวน")
                ? -1000
                : 0;

            return ra.priority + boostA - (rb.priority + boostB);
          })[0];
      };

      // 5) สร้าง tagged tokens (ตาม Thai order)
      const tagged: { word: string; role: RuleRole | "UNK" }[] = [];
      const pickedRowsInThaiOrder: WordData[] = [];

      for (const t of tokensThai) {
        const rows = grouped.get(t) ?? [];
        if (rows.length === 0) continue;

        const best = rows.length === 1 ? rows[0] : pickBestRow(t, rows);
        const r = getRole(best.category);

        tagged.push({ word: t, role: r.role });
        pickedRowsInThaiOrder.push(best);
      }

      // token->row
      const rowsByToken = new Map<string, WordData>();
      pickedRowsInThaiOrder.forEach((r) =>
        rowsByToken.set(normalizeThaiToken(r.word), r)
      );

      // 6) match rule Table 1–40
      const rule = findExactRule(tagged);

      // 7) reorder ตาม rule ถ้ามี ไม่งั้น fallback Thai order
      const orderedTokens = rule
        ? reorderByRule(tagged, rule.thslOrder)
        : tagged.map((t) => t.word);

      // 8) map orderedTokens -> processed
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

      // 9) concat_video
      try {
        const filenames = processed
          .map((x) => (x.pose_filename ?? "").trim())
          .filter(Boolean);

        if (filenames.length === 0) {
          setLoadingSentenceVideo(false);
          setNewBlobUrl(null);
          return;
        }

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
  }, [JSON.stringify(resultData.keywords || []), resultData.text]);

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

          {/* Sentence Video */}
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
                    <span className="text-xs">กำลังสร้างวิดีโอทั้งประโยค...</span>
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

          {/* Single Pose */}
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
            <h2 className="font-semibold text-[#263F5D] mb-3 text-sm">
              # คำสำคัญ (ThSL pattern)
            </h2>

            <div className="flex flex-wrap gap-2">
              {loadingKeywords ? (
                <p className="text-[#263F5D]/60 text-sm animate-pulse">
                  กำลังเรียงตามกฎ ThSL...
                </p>
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