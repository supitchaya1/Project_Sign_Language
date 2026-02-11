import { useEffect, useMemo, useState } from "react";
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

// function buildPoseUrl(filename: string) {
//   const clean = (filename ?? "").trim();
//   return `${BACKEND_URL}/api/pose?name=${encodeURIComponent(clean)}`;
// }

function joinUrl(base: string, path: string) {
  const b = (base ?? "").trim().replace(/\/+$/, ""); // ตัด / ท้าย
  const p = (path ?? "").trim().replace(/^\/+/, ""); // ตัด / หน้า
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
  fullUrl: string;
}

// ==========================================
// 3) Helpers: Category Priority
// ==========================================
const CATEGORY_PRIORITY: Record<string, number> = {
  คำทั่วไป: 1,
  กริยา: 2,
  สถานที่: 3,
  จำนวน: 4,
  ตัวเลข: 5,
  การเขียนสะกดนิ้วมือ: 6,
};

function isNumberToken(token: string) {
  return /^[0-9]+$/.test(token);
}

function pickBestRow(token: string, rows: WordData[]): WordData {
  return rows
    .slice()
    .sort((a, b) => {
      const pa = CATEGORY_PRIORITY[a.category] ?? 999;
      const pb = CATEGORY_PRIORITY[b.category] ?? 999;

      const boostA = isNumberToken(token) && a.category === "ตัวเลข" ? -1000 : 0;
      const boostB = isNumberToken(token) && b.category === "ตัวเลข" ? -1000 : 0;

      return pa + boostA - (pb + boostB);
    })[0];
}

// ==========================================
// 4) Rule Engine (Thai -> ThSL Order)
// ==========================================
type Role = "S" | "V" | "O" | "NEG" | "Adv(Time)" | "PP(Place)" | "Q" | "UNK";

function isNeg(w: string) {
  return ["ไม่", "ไม่มี", "ห้าม", "อย่า"].includes(w);
}
function isTimeWord(w: string) {
  return [
    "วันนี้",
    "พรุ่งนี้",
    "เมื่อวาน",
    "ตอนนี้",
    "เช้า",
    "สาย",
    "บ่าย",
    "เย็น",
    "กลางคืน",
    "เดี๋ยวนี้",
  ].includes(w);
}
function isPlaceWord(w: string) {
  return [
    "บ้าน",
    "โรงเรียน",
    "มหาวิทยาลัย",
    "ตลาด",
    "โรงพยาบาล",
    "ที่ทำงาน",
    "ห้องน้ำ",
    "ร้าน",
  ].includes(w);
}
function isPronoun(w: string) {
  return ["ฉัน", "ผม", "หนู", "เรา", "คุณ", "เขา", "เธอ", "มัน", "พวกเรา"].includes(w);
}
function isVerb(w: string) {
  return ["ไป", "มา", "กิน", "นอน", "เรียน", "ทำงาน", "ดู", "ซื้อ", "ขาย", "ชอบ", "รัก", "ช่วย", "เล่น"].includes(w);
}

function cleanTokens(tokens: string[]) {
  return (tokens || []).map((t) => (t ?? "").trim()).filter(Boolean);
}

function tagToken(w: string): Role {
  if (isNeg(w)) return "NEG";
  if (isTimeWord(w)) return "Adv(Time)";
  if (isPlaceWord(w)) return "PP(Place)";
  if (isPronoun(w)) return "S";
  if (isVerb(w)) return "V";
  if (["ไหม", "?", "หรือเปล่า"].includes(w)) return "Q";
  if (isNumberToken(w)) return "O";
  return "O";
}

function toThslOrder(tokens: string[]) {
  const tagged = cleanTokens(tokens).map((w) => ({ word: w, role: tagToken(w) }));
  const roles = tagged.map((x) => x.role);
  const used = new Set<number>();

  const takeRole = (role: Role) => {
    const idx = tagged.findIndex((x, i) => !used.has(i) && x.role === role);
    if (idx >= 0) {
      used.add(idx);
      return tagged[idx].word;
    }
    return null;
  };

  const takeAllRole = (role: Role) => {
    const out: string[] = [];
    tagged.forEach((x, i) => {
      if (!used.has(i) && x.role === role) {
        used.add(i);
        out.push(x.word);
      }
    });
    return out;
  };

  const collectRest = () => tagged.filter((_, i) => !used.has(i)).map((x) => x.word);

  if (roles.includes("V")) {
    const out: string[] = [];

    const t = takeRole("Adv(Time)");
    if (t) out.push(t);

    const p = takeRole("PP(Place)");
    if (p) out.push(p);

    const s = takeRole("S");
    if (s) out.push(s);

    out.push(...takeAllRole("O"));

    const v = takeRole("V");
    if (v) out.push(v);

    const n = takeRole("NEG");
    if (n) out.push(n);

    const q = takeRole("Q");
    if (q) out.push(q);

    return [...out, ...collectRest()];
  }

  return tagged.map((x) => x.word);
}

// ==========================================
// 5) Main Component
// ==========================================
export default function ResultPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [foundWords, setFoundWords] = useState<ProcessedWordData[]>([]);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [currentSinglePose, setCurrentSinglePose] = useState<string | null>(null);

  const state = location.state as ResultState | null;

  const resultData = {
    text: state?.originalText || "ไม่มีข้อความ",
    summary: state?.summary || "ไม่มีข้อมูลสรุป",
    keywords: state?.keywords || [],
  };

  const thslKeywords = useMemo(() => {
    const tokens = cleanTokens(resultData.keywords || []);
    return toThslOrder(tokens);
  }, [resultData.keywords]);

  useEffect(() => {
    const fetchKeywordsFromDB = async () => {
      if (thslKeywords.length === 0) {
        setFoundWords([]);
        setCurrentSinglePose(null);
        return;
      }

      setLoadingKeywords(true);

      const { data, error } = await supabase
        .from("SL_word")
        .select("word, category, pose_filename")
        .in("word", Array.from(new Set(thslKeywords)));

      if (error) {
        console.error("Fetch keywords error:", error);
        setFoundWords([]);
        setCurrentSinglePose(null);
        setLoadingKeywords(false);
        return;
      }

      const rawData = (data as WordData[]) || [];

      const grouped = new Map<string, WordData[]>();
      for (const row of rawData) {
        if (!grouped.has(row.word)) grouped.set(row.word, []);
        grouped.get(row.word)!.push(row);
      }

      const picked: WordData[] = thslKeywords
        .map((w) => {
          const rows = grouped.get(w) ?? [];
          if (rows.length === 0) return null;
          if (rows.length === 1) return rows[0];
          return pickBestRow(w, rows);
        })
        .filter(Boolean) as WordData[];

      const processed: ProcessedWordData[] = picked.map((item) => ({
        word: item.word,
        category: item.category,
        fullUrl: buildPoseUrl(item.pose_filename),
      }));

      setFoundWords(processed);
      setCurrentSinglePose(processed.length > 0 ? processed[0].fullUrl : null);
      setLoadingKeywords(false);
    };

    fetchKeywordsFromDB();
  }, [thslKeywords]);

  const handleDownload = () => {
    if (currentSinglePose) window.open(currentSinglePose, "_blank");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] py-8 md:py-12">
      <div className="container mx-auto px-4 max-w-xl">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl md:text-3xl font-bold text-[#263F5D] dark:text-[#D8C0D0] text-center mb-8"
        >
          ผลลัพธ์การแปล
        </motion.h1>

        <div className="space-y-4">
          {/* Pose Player */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Video size={18} className="text-[#263F5D]" />
                <h2 className="font-semibold text-[#263F5D] text-sm">วิดีโอภาษามือ</h2>
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

            <Button
              disabled={!currentSinglePose}
              className="w-full bg-[#0F1F2F] hover:bg-[#1a2f44] text-white text-sm disabled:opacity-50 transition-colors"
              onClick={handleDownload}
            >
              <Download size={16} className="mr-2" />
              ดาวน์โหลดไฟล์ .pose
            </Button>
          </motion.div>

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
                      onClick={() => setCurrentSinglePose(item.fullUrl)}
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
