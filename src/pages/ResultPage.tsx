import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Video, RefreshCw, Pause, Play } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import PosePlayer from "@/components/PosePlayer";
import { toast } from "sonner";
import { downloadCanvasAsGif } from "@/lib/downloadGif";
import { saveHistory, type HistoryRecord } from "@/services/history";

const API_BASE =
  (import.meta.env.VITE_BACKEND_BASE as string) ||
  (import.meta.env.VITE_API_BASE_URL as string) ||
  "http://127.0.0.1:8000";

function buildPoseUrl(filename: string) {
  const clean = (filename ?? "").trim();
  return `${API_BASE.replace(/\/$/, "")}/api/pose?name=${encodeURIComponent(clean)}`;
}

type Emotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "question"
  | "fear"
  | "laugh";

type PosePlaylistItem = {
  url: string;
  label: string;
  emotion: Emotion;
  role?: string;
};

interface ResultState {
  success?: boolean;
  originalText?: string;
  original_text?: string;
  inputText?: string;
  input_text?: string;
  summary?: string;
  processed_text?: string;
  thsl_fixed?: string;
  thsl_text?: string;
  keywords?: string[];
  words?: string[];
  matched_words?: string[];
  thsl_words?: string[];
  roles?: string[];
  pose_filenames?: string[];
  poseFiles?: string[];
  pose_urls?: string[];
  used_summary?: boolean;
  summary_source?: string;
  items?: Array<{
    word?: string;
    pose_filename?: string;
    pose_url?: string;
    category?: string;
    role?: string;
  }>;
  poses?: Array<{
    word?: string;
    pose_filename?: string;
    url?: string;
    category?: string;
    role?: string;
  }>;
}

interface HistoryResultState {
  fromHistory?: boolean;
  historyItem?: HistoryRecord;
  resultData?: {
    text?: string;
    summary?: string;
    translatedText?: string;
    keywords?: string[];
    sentenceVideoUrl?: string;
    thsl_fixed?: string;
    pose_filenames?: string[];
    poseFiles?: string[];
    pose_urls?: string[];
    roles?: string[];
  };
}

function normalizeThaiToken(s: string) {
  return (s ?? "").replace(/\u200B|\u200C|\u200D|\uFEFF/g, "").trim();
}

function getEmotionFromWord(word: string): Emotion {
  const w = normalizeThaiToken(word);

  const angryWords = new Set(["โกรธ", "โมโห", "ไม่พอใจ", "หงุดหงิด", "ฉุนเฉียว"]);
  const sadWords = new Set(["เสียใจ", "เศร้า", "ร้องไห้", "ทุกข์", "ผิดหวัง"]);
  const happyWords = new Set(["ดีใจ", "ยินดี", "มีความสุข", "สุข", "ชอบ"]);
  const surprisedWords = new Set(["ตกใจ", "ประหลาดใจ", "ตะลึง"]);
  const questionWords = new Set([
    "ทำไม",
    "อะไร",
    "ใคร",
    "ที่ไหน",
    "เมื่อไร",
    "เมื่อไหร่",
    "อย่างไร",
    "ยังไง",
    "ไหม",
    "หรือยัง",
    "สงสัย",
  ]);
  const fearWords = new Set(["กลัว", "หวาดกลัว", "ตกใจกลัว", "กังวล", "หวาดระแวง"]);
  const laughWords = new Set(["หัวเราะ", "ขำ", "ตลก", "ฮา"]);

  if (angryWords.has(w)) return "angry";
  if (sadWords.has(w)) return "sad";
  if (happyWords.has(w)) return "happy";
  if (surprisedWords.has(w)) return "surprised";
  if (questionWords.has(w)) return "question";
  if (fearWords.has(w)) return "fear";
  if (laughWords.has(w)) return "laugh";

  return "neutral";
}

function getEmotionLabelThai(emotion: Emotion): string {
  switch (emotion) {
    case "happy":
      return "ดีใจ";
    case "sad":
      return "เสียใจ";
    case "angry":
      return "โกรธ";
    case "surprised":
      return "ตกใจ";
    case "question":
      return "สงสัย";
    case "fear":
      return "กลัว";
    case "laugh":
      return "หัวเราะ";
    default:
      return "ปกติ";
  }
}

function uniqueKeepOrder(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of items || []) {
    const clean = normalizeThaiToken(item);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }

  return out;
}

export default function ResultPage() {
  const navigate = useNavigate();
  const location = useLocation();

  type ViewMode = "sentence" | "single";

  const [viewMode, setViewMode] = useState<ViewMode>("sentence");
  const [currentSingleIndex, setCurrentSingleIndex] = useState(0);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [sentencePlaying, setSentencePlaying] = useState(true);
  const [singlePlaying, setSinglePlaying] = useState(true);
  const [loadingSentenceVideo, setLoadingSentenceVideo] = useState(false);
  const [exportNonce, setExportNonce] = useState(0);

  const savedOnceRef = useRef(false);

  const state = (location.state as (ResultState & HistoryResultState) | null) ?? null;
  const isFromHistory = Boolean(state?.fromHistory);

  const resultData = useMemo(() => {
    if (state?.fromHistory && state?.resultData) {
      const historyKeywords =
        state.resultData.keywords ||
        (state.historyItem?.keywords
          ? state.historyItem.keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean)
          : []);

      return {
        text: state.resultData.text || state.historyItem?.input_text || "ไม่มีข้อความ",
        summary:
          state.resultData.summary ||
          state.historyItem?.summary_text ||
          state.resultData.translatedText ||
          state.historyItem?.translated_result ||
          "ไม่มีข้อมูลสรุป",
        thslText:
          state.resultData.thsl_fixed ||
          state.resultData.translatedText ||
          state.historyItem?.translated_result ||
          "",
        keywords: uniqueKeepOrder(historyKeywords),
        poseFilenames: state.resultData.pose_filenames || state.resultData.poseFiles || [],
        poseUrls: state.resultData.pose_urls || [],
        roles: state.resultData.roles || [],
        usedSummary: false,
      };
    }

    const words = uniqueKeepOrder(
      state?.words ||
        state?.keywords ||
        state?.matched_words ||
        state?.thsl_words ||
        []
    );

    const poseFilenames = state?.pose_filenames || state?.poseFiles || [];
    const poseUrls = state?.pose_urls || [];

    return {
      text:
        state?.originalText ||
        state?.original_text ||
        state?.inputText ||
        state?.input_text ||
        "ไม่มีข้อความ",
      summary: state?.summary || state?.processed_text || "ไม่มีข้อมูลสรุป",
      thslText: state?.thsl_fixed || state?.thsl_text || words.join(" "),
      keywords: words,
      poseFilenames,
      poseUrls,
      roles: state?.roles || [],
      usedSummary: Boolean(state?.used_summary),
    };
  }, [state]);

  const poseItems = useMemo<PosePlaylistItem[]>(() => {
    const fromItems =
      state?.items?.map((item) => ({
        label: item.word || "",
        filename: item.pose_filename || "",
        url: item.pose_url || "",
        role: item.role || "",
      })) || [];

    const fromPoses =
      state?.poses?.map((item) => ({
        label: item.word || "",
        filename: item.pose_filename || "",
        url: item.url || "",
        role: item.role || "",
      })) || [];

    const fromArrays = resultData.poseFilenames.map((filename, index) => ({
      label: resultData.keywords[index] || filename.replace(/\.pose$/i, ""),
      filename,
      url: resultData.poseUrls[index] || "",
      role: resultData.roles[index] || "",
    }));

    const raw = [...fromItems, ...fromPoses, ...fromArrays];

    const seen = new Set<string>();
    const out: PosePlaylistItem[] = [];

    for (const item of raw) {
      const label = normalizeThaiToken(item.label);
      const filename = normalizeThaiToken(item.filename);
      const url = normalizeThaiToken(item.url) || (filename ? buildPoseUrl(filename) : "");

      if (!url) continue;

      const key = `${label}-${url}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        url,
        label: label || filename.replace(/\.pose$/i, ""),
        emotion: getEmotionFromWord(label || filename.replace(/\.pose$/i, "")),
        role: item.role,
      });
    }

    return out;
  }, [state, resultData]);

  const currentSingleItem =
    poseItems.length > 0
      ? poseItems[Math.min(currentSingleIndex, poseItems.length - 1)]
      : null;

  const currentSentenceItem =
    poseItems.length > 0
      ? poseItems[Math.min(currentSentenceIndex, poseItems.length - 1)]
      : null;

  useEffect(() => {
    setSentencePlaying(true);
    setCurrentSentenceIndex(0);
  }, [poseItems.length, resultData.summary]);

  useEffect(() => {
    setSinglePlaying(true);
  }, [currentSingleIndex, currentSingleItem?.label]);

  useEffect(() => {
    if (savedOnceRef.current) return;
    if (isFromHistory) return;

    const inputText = (resultData.text ?? "").trim();
    const summary = (resultData.summary ?? "").trim();
    const translated = poseItems.map((p) => p.label).join(" ").trim();

    if (!inputText || inputText === "ไม่มีข้อความ") return;
    if (!translated && poseItems.length === 0) return;

    savedOnceRef.current = true;

    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          console.log("skip saveHistory: no auth");
          return;
        }

        await saveHistory({
          input_text: inputText,
          translated_result: translated,
          summary_text: summary,
          keywords: poseItems.map((p) => p.label).join(", "),
          video_url: undefined,
        });
      } catch (e) {
        console.warn("saveHistory failed:", e);
        toast.warning("บันทึกประวัติไม่สำเร็จ (ตรวจสอบการล็อกอิน / RLS)");
      }
    })();
  }, [isFromHistory, resultData, poseItems]);

  const handleDownloadSentenceVideo = async () => {
    try {
      setViewMode("sentence");
      setCurrentSentenceIndex(0);
      setSentencePlaying(true);
      setExportNonce((n) => n + 1);

      setLoadingSentenceVideo(true);
      toast.info("กำลังสร้าง GIF ทั้งประโยค...");

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;

      if (!canvas) {
        toast.error("ไม่พบ canvas สำหรับบันทึก GIF");
        return;
      }

      const gifDurationMs = Math.max(poseItems.length * 4500, 8000);

      await downloadCanvasAsGif(
        canvas,
        `${resultData.summary || "sentence"}.gif`,
        gifDurationMs,
        6
      );

      toast.success("ดาวน์โหลด GIF สำเร็จ");
    } catch (error) {
      console.error("download gif error:", error);
      toast.error("ดาวน์โหลด GIF ไม่สำเร็จ");
    } finally {
      setLoadingSentenceVideo(false);
    }
  };

  const handleBackToTranslate = () => {
    navigate("/translate", {
      state: {
        originalText: resultData.text,
      },
    });
  };

  const noData =
    !state ||
    (!resultData.text &&
      !resultData.summary &&
      resultData.keywords.length === 0 &&
      poseItems.length === 0);

  if (noData) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] pt-20 pb-8 md:pt-24 md:pb-12">
        <div className="container mx-auto px-4 max-w-xl">
          <div className="border-2 border-[#223C55] rounded-xl p-6 bg-[#A6BFE3] text-center">
            <h1 className="text-xl font-bold text-[#263F5D] mb-3">ไม่พบข้อมูลผลลัพธ์</h1>
            <p className="text-[#263F5D]/70 mb-4 text-sm">
              กรุณากลับไปหน้าแปลเสียงหรือเลือกดูจากหน้าประวัติอีกครั้ง
            </p>
            <Button
              onClick={() => navigate("/translate")}
              className="bg-[#0F1F2F] hover:bg-[#1a2f44] text-[#C9A7E3]"
            >
              ไปหน้าแปลเสียง
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
              ดูทีละคำ (คำสำคัญ)
            </button>
          </div>

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

              {poseItems.length > 0 ? (
                <>
                  <div className="relative aspect-video bg-[#0F1F2F] rounded-lg overflow-hidden border border-white/10 shadow-inner">
                    <PosePlayer
                      key={`sentence-${poseItems.length}-${resultData.summary}-${exportNonce}`}
                      items={poseItems}
                      width={640}
                      height={360}
                      fps={42}
                      confThreshold={0.05}
                      flipY={false}
                      loopPlaylist={false}
                      loopPose={false}
                      playing={sentencePlaying}
                      onSequenceStepChange={setCurrentSentenceIndex}
                      onSequenceEnd={() => setSentencePlaying(false)}
                    />
                  </div>

                  <div className="mt-3 mb-4 rounded-2xl border border-white/40 bg-gradient-to-r from-[#F8FAFC] to-[#EEF2FF] px-4 py-3 shadow-[0_8px_20px_rgba(15,31,47,0.12)] backdrop-blur">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        onClick={() => setSentencePlaying((v) => !v)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#2563EB] to-[#1E40AF] text-white shadow-md hover:scale-105 active:scale-95 transition-all"
                        aria-label={sentencePlaying ? "Pause" : "Play"}
                      >
                        {sentencePlaying ? <Pause size={14} /> : <Play size={14} />}
                      </button>

                      <span className="rounded-xl border border-[#94A3B8] bg-[#F8FAFC] px-3 py-2 text-[11px] font-medium text-[#0F1F2F] shadow-sm">
                        ลำดับคำที่แสดง: {currentSentenceIndex + 1}/{poseItems.length}
                      </span>

                      <span className="rounded-lg border border-[#94A3B8] bg-[#F8FAFC] px-3 py-2 text-[11px] font-medium text-[#0F1F2F] shadow-sm">
                        คำที่กำลังแสดง: {currentSentenceItem?.label ?? "-"}
                      </span>

                      <span className="rounded-lg border border-[#94A3B8] bg-[#F8FAFC] px-3 py-2 text-[11px] font-medium text-[#0F1F2F] shadow-sm">
                        สีหน้า: {getEmotionLabelThai(currentSentenceItem?.emotion ?? "neutral")}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="relative aspect-video bg-[#0F1F2F] rounded-lg overflow-hidden mb-4 border border-white/10 shadow-inner">
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
                    <span className="text-3xl mb-2">🚫</span>
                    <span className="text-xs">ไม่พบท่าภาษามือสำหรับประโยคนี้</span>
                  </div>
                </div>
              )}

              <Button
                disabled={loadingSentenceVideo || poseItems.length === 0}
                className="w-full bg-[#0F1F2F] hover:bg-[#1a2f44] text-white text-sm disabled:opacity-50 transition-colors"
                onClick={handleDownloadSentenceVideo}
              >
                {loadingSentenceVideo ? (
                  <>
                    <RefreshCw size={16} className="mr-2 animate-spin" />
                    กำลังสร้างไฟล์ GIF...
                  </>
                ) : (
                  <>
                    <Download size={16} className="mr-2" />
                    ดาวน์โหลดวิดีโอทั้งประโยค (.GIF)
                  </>
                )}
              </Button>
            </motion.div>
          )}

          {viewMode === "single" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
            >
              <div className="flex items-center gap-2 mb-4">
                <Video size={18} className="text-[#263F5D]" />
                <h2 className="font-semibold text-[#263F5D] text-sm">ดูทีละคำ</h2>
              </div>

              {currentSingleItem ? (
                <>
                  <div className="relative aspect-video bg-[#0F1F2F] rounded-lg overflow-hidden border border-white/10 shadow-inner">
                    <PosePlayer
                      key={`single-${currentSingleIndex}-${currentSingleItem.label}`}
                      poseUrl={currentSingleItem.url}
                      width={640}
                      height={360}
                      fps={24}
                      confThreshold={0.05}
                      flipY={false}
                      emotion={currentSingleItem.emotion}
                      playing={singlePlaying}
                      onSequenceEnd={() => setSinglePlaying(false)}
                    />
                  </div>

                  <div className="mt-3 mb-4 rounded-2xl border border-white/40 bg-gradient-to-r from-[#F8FAFC] to-[#EEF2FF] px-4 py-3 shadow-[0_8px_20px_rgba(15,31,47,0.12)] backdrop-blur">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        onClick={() => setSinglePlaying((v) => !v)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#2563EB] to-[#1E40AF] text-white shadow-md hover:scale-105 active:scale-95 transition-all"
                        aria-label={singlePlaying ? "Pause" : "Play"}
                      >
                        {singlePlaying ? <Pause size={14} /> : <Play size={14} />}
                      </button>

                      <span className="rounded-lg border border-[#94A3B8] bg-[#F8FAFC] px-3 py-2 text-[11px] font-medium text-[#0F1F2F] shadow-sm">
                        คำ: {currentSingleItem.label}
                      </span>

                      <span className="rounded-lg border border-[#94A3B8] bg-[#F8FAFC] px-3 py-2 text-[11px] font-medium text-[#0F1F2F] shadow-sm">
                        สีหน้า: {getEmotionLabelThai(currentSingleItem.emotion)}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="relative aspect-video bg-[#0F1F2F] rounded-lg overflow-hidden mb-4 border border-white/10 shadow-inner">
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
                    <span className="text-3xl mb-2">🚫</span>
                    <span className="text-xs">ไม่พบไฟล์ท่าทาง หรือยังไม่ได้เลือกคำศัพท์</span>
                  </div>
                </div>
              )}
            </motion.div>
          )}

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
              <p className="text-xs text-[#263F5D]/60 mt-2">
                *สรุปใจความจะแสดงเฉพาะคำสำคัญที่พบในฐานข้อมูลคำศัพท์ภาษามือและมีไฟล์ท่าทางรองรับ
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <h2 className="font-semibold text-[#263F5D] mb-3 text-sm">
              # คำสำคัญ (ThSL Pattern)
            </h2>

            <div className="flex flex-wrap gap-2">
              {poseItems.length > 0 ? (
                poseItems.map((item, idx) => {
                  const isActive = currentSingleIndex === idx;

                  return (
                    <Badge
                      key={`${item.label}-${idx}`}
                      onClick={() => {
                        setCurrentSingleIndex(idx);
                        setViewMode("single");
                      }}
                      className={`cursor-pointer px-3 py-1.5 text-xs transition-all border border-transparent ${
                        isActive
                          ? "bg-[#FEC530] text-[#0F1F2F] scale-105 shadow-md border-white/20"
                          : "bg-[#0F1F2F] text-[#C9A7E3] hover:bg-[#1a2f44] hover:scale-105"
                      }`}
                      title={item.role ? `role: ${item.role} | emotion: ${item.emotion}` : `emotion: ${item.emotion}`}
                    >
                      {item.label}
                    </Badge>
                  );
                })
              ) : (
                <p className="text-[#263F5D]/60 text-sm">ไม่พบคำสำคัญในฐานข้อมูล</p>
              )}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="grid grid-cols-2 gap-3 pt-4"
          >
            <Button
              variant="outline"
              onClick={handleBackToTranslate}
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
