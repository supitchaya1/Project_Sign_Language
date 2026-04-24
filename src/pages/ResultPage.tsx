import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Video, RefreshCw, Pause, Play } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import PosePlayer from "@/components/PosePlayer";
import { toast } from "sonner";

import { THSL_RULES, Role as RuleRole, ThslRule } from "@/services/thslRules";
import { saveHistory, type HistoryRecord } from "@/services/history";

const API_BASE =
  (import.meta.env.VITE_BACKEND_BASE as string) ||
  "http://127.0.0.1:8000/api";

function joinUrl(base: string, path: string) {
  const b = (base ?? "").trim().replace(/\/+$/, "");
  const p = (path ?? "").trim().replace(/^\/+/, "");
  return `${b}/${p}`;
}

function buildApiUrl(path: string) {
  return joinUrl(API_BASE, path);
}

function buildPoseUrl(filename: string) {
  const clean = (filename ?? "").trim();
  return `${buildApiUrl("pose")}?name=${encodeURIComponent(clean)}`;
}

interface ResultState {
  originalText?: string;
  summary?: string;
  keywords?: string[];
  thsl_fixed?: string;
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
  };
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
  role: string;
  priority: number;
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
};

function normalizeThaiToken(s: string) {
  return (s ?? "").replace(/\u200B|\u200C|\u200D|\uFEFF/g, "").trim();
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

  return s.split(/\s+/).map(normalizeThaiToken).filter(Boolean);
}

function dropSubTokens(tokens: string[]) {
  const tks = uniqPreserveOrder(tokens.map(normalizeThaiToken).filter(Boolean));
  const sorted = tks.slice().sort((a, b) => b.length - a.length);

  const kept: string[] = [];
  for (const t of sorted) {
    const isSub = kept.some((k) => k.includes(t) && k !== t);
    if (!isSub) kept.push(t);
  }

  const keptSet = new Set(kept);
  return tks.filter((t) => keptSet.has(t));
}

function normalizeDbRoleToRuleRole(dbRole: string): RuleRole {
  const r = (dbRole ?? "").trim();
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

  tagged.forEach((t, i) => {
    if (!used.has(i)) out.push(t.word);
  });

  return out.filter(Boolean);
}

function getEmotionFromWord(word: string): Emotion {
  const w = normalizeThaiToken(word);

  const angryWords = new Set([
    "โกรธ",
    "โมโห",
    "ไม่พอใจ",
    "หงุดหงิด",
    "ฉุนเฉียว",
  ]);

  const sadWords = new Set([
    "เสียใจ",
    "เศร้า",
    "ร้องไห้",
    "ทุกข์",
    "ผิดหวัง",
  ]);

  const happyWords = new Set([
    "ดีใจ",
    "ยินดี",
    "มีความสุข",
    "สุข",
    "ชอบ",
  ]);

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

  const fearWords = new Set([
    "กลัว",
    "หวาดกลัว",
    "ตกใจกลัว",
    "กังวล",
    "หวาดระแวง",
  ]);

  const laughWords = new Set([
    "หัวเราะ",
    "ขำ",
    "ตลก",
    "ฮา",
  ]);

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

export default function ResultPage() {
  const navigate = useNavigate();
  const location = useLocation();

  type ViewMode = "sentence" | "single";

  const [foundWords, setFoundWords] = useState<ProcessedWordData[]>([]);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("sentence");
  const [currentSingleIndex, setCurrentSingleIndex] = useState(0);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [sentencePlaying, setSentencePlaying] = useState(true);
  const [singlePlaying, setSinglePlaying] = useState(true);

  const [loadingSentenceVideo, setLoadingSentenceVideo] = useState(false);
  const [sentenceVideoUrl, setSentenceVideoUrl] = useState<string | null>(null);

  const prevBlobUrl = useRef<string | null>(null);
  const savedOnceRef = useRef(false);

  const state = (location.state as (ResultState & HistoryResultState) | null) ?? null;
  const isFromHistory = Boolean(state?.fromHistory);

  const resultData = useMemo(() => {
    if (state?.fromHistory && state?.resultData) {
      return {
        text: state.resultData.text || state.historyItem?.input_text || "ไม่มีข้อความ",
        summary:
          state.resultData.summary ||
          state.resultData.translatedText ||
          state.historyItem?.summary_text ||
          state.historyItem?.translated_result ||
          "ไม่มีข้อมูลสรุป",
        translatedText:
          state.resultData.translatedText ||
          state.historyItem?.translated_result ||
          "",
        keywords:
          state.resultData.keywords ||
          (state.historyItem?.keywords
            ? state.historyItem.keywords
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean)
            : []),
        thsl_fixed: state.resultData.thsl_fixed || "",
        historyVideoUrl:
          state.resultData.sentenceVideoUrl || state.historyItem?.video_url || "",
      };
    }

    return {
      text: state?.originalText || "ไม่มีข้อความ",
      summary: state?.summary || "ไม่มีข้อมูลสรุป",
      translatedText: state?.summary || "",
      keywords: state?.keywords || [],
      thsl_fixed: state?.thsl_fixed || "",
      historyVideoUrl: "",
    };
  }, [state]);

  const setNewBlobUrl = (url: string | null) => {
    if (prevBlobUrl.current && prevBlobUrl.current.startsWith("blob:")) {
      URL.revokeObjectURL(prevBlobUrl.current);
      prevBlobUrl.current = null;
    }
    if (url && url.startsWith("blob:")) prevBlobUrl.current = url;
    setSentenceVideoUrl(url);
  };

  useEffect(() => {
    return () => {
      if (prevBlobUrl.current && prevBlobUrl.current.startsWith("blob:")) {
        URL.revokeObjectURL(prevBlobUrl.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isFromHistory && resultData.historyVideoUrl) {
      setSentenceVideoUrl(resultData.historyVideoUrl);
    }
  }, [isFromHistory, resultData.historyVideoUrl]);

  useEffect(() => {
    if (savedOnceRef.current) return;
    if (isFromHistory) return;

    const inputText = (resultData.text ?? "").trim();
    const translated = (resultData.summary ?? "").replace(/\s+/g, "").trim();

    if (!inputText || inputText === "ไม่มีข้อความ") return;
    if (!translated || translated === "ไม่มีข้อมูลสรุป") return;

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
          summary_text: (resultData.summary ?? "").replace(/\s+/g, "").trim(),
          keywords: Array.isArray(resultData.keywords)
            ? resultData.keywords.join(", ")
            : "",
          video_url: resultData.historyVideoUrl || undefined,
        });
      } catch (e) {
        console.warn("saveHistory failed:", e);
        toast.warning("บันทึกประวัติไม่สำเร็จ (ตรวจสอบการล็อกอิน / RLS)");
      }
    })();
  }, [isFromHistory, resultData]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const summaryText = (resultData.summary ?? "").replace(/\s+/g, "").trim();

      const kwTokens = uniqPreserveOrder(
        Array.isArray(resultData.keywords) && resultData.keywords.length > 0
          ? resultData.keywords
          : segmentThaiWords(summaryText)
      );

      const fixedTokens = resultData.thsl_fixed?.trim()
        ? cleanTokens(
            /\s/.test(resultData.thsl_fixed.trim())
              ? resultData.thsl_fixed.trim().split(/\s+/)
              : Array.isArray(resultData.keywords) && resultData.keywords.length > 0
              ? resultData.keywords
              : [resultData.thsl_fixed.trim()]
          )
        : [];

      if (fixedTokens.length === 0 && kwTokens.length === 0 && !summaryText) {
        if (cancelled) return;
        setFoundWords([]);
        setCurrentSingleIndex(0);
        setLoadingKeywords(false);
        return;
      }

      if (cancelled) return;
      setLoadingKeywords(true);

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

      let finalOrderedTokens: string[] = [];

      if (fixedTokens.length > 0) {
        finalOrderedTokens = dropSubTokens(uniqPreserveOrder(fixedTokens));
      } else {
        const textTokens = uniqPreserveOrder(segmentThaiWords(summaryText));
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
            console.warn("⚠️ Cannot load SL_word for summary tokens:", textErr);
          } else {
            const rows = (textRows as WordData[]) || [];
            const seen = new Set<string>();

            for (const tok of candidateTextTokens) {
              const normTok = normalizeThaiToken(tok);
              if (!normTok || seen.has(normTok)) continue;

              const candidates = rows.filter(
                (r) => normalizeThaiToken(r.word) === normTok
              );
              if (candidates.length === 0) continue;

              const best = candidates
                .slice()
                .sort(
                  (a, b) =>
                    getRole(a.category).priority - getRole(b.category).priority
                )[0];

              const role = getRole(best.category).role;
              if (IMPORTANT_ROLES.has(role)) {
                extraFromText.push(normTok);
                seen.add(normTok);
              }
            }
          }
        }

        const mergedTokens = uniqPreserveOrder([...kwTokens, ...extraFromText]);
        const mergedNoSub = dropSubTokens(mergedTokens);
        const tokensThai = orderTokensByOriginalText(summaryText, mergedNoSub);

        const unique = Array.from(new Set(tokensThai));
        const { data, error } = await supabase
          .from("SL_word")
          .select("word, category, pose_filename")
          .in("word", unique);

        if (error) {
          console.error("Fetch SL_word error:", error);
          if (cancelled) return;
          setFoundWords([]);
          setCurrentSingleIndex(0);
          setLoadingKeywords(false);
          return;
        }

        const raw = (data as WordData[]) || [];
        const grouped = new Map<string, WordData[]>();
        raw.forEach((row) => {
          const w = normalizeThaiToken(row.word);
          if (!grouped.has(w)) grouped.set(w, []);
          grouped.get(w)!.push(row);
        });

        const pickBestRow = (token: string, rows: WordData[]) => {
          const t = normalizeThaiToken(token);
          return rows
            .slice()
            .sort((a, b) => {
              const ra = getRole(a.category);
              const rb = getRole(b.category);

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

        const tagged: { word: string; role: RuleRole | "UNK" }[] = [];

        for (const t of tokensThai) {
          const rows = grouped.get(t) ?? [];
          if (rows.length === 0) continue;

          const best = rows.length === 1 ? rows[0] : pickBestRow(t, rows);
          const r = getRole(best.category);
          tagged.push({ word: t, role: r.role });
        }

        const rule = findExactRule(tagged);
        finalOrderedTokens = rule
          ? reorderByRule(tagged, rule.thslOrder)
          : tagged.map((t) => t.word);
      }

      const { data: dataFinal, error: errFinal } = await supabase
        .from("SL_word")
        .select("word, category, pose_filename")
        .in("word", Array.from(new Set(finalOrderedTokens)));

      if (errFinal) {
        console.error("Fetch SL_word (final) error:", errFinal);
        if (cancelled) return;
        setFoundWords([]);
        setCurrentSingleIndex(0);
        setLoadingKeywords(false);
        return;
      }

      const rawFinal = (dataFinal as WordData[]) || [];
      const groupedFinal = new Map<string, WordData[]>();
      rawFinal.forEach((row) => {
        const w = normalizeThaiToken(row.word);
        if (!groupedFinal.has(w)) groupedFinal.set(w, []);
        groupedFinal.get(w)!.push(row);
      });

      const pickBestRowFinal = (token: string, rows: WordData[]) => {
        const t = normalizeThaiToken(token);
        return rows
          .slice()
          .sort((a, b) => {
            const ra = getRole(a.category);
            const rb = getRole(b.category);

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

      const orderedPickedRows: WordData[] = [];
      for (const tok of finalOrderedTokens) {
        const rows = groupedFinal.get(normalizeThaiToken(tok)) ?? [];
        if (rows.length === 0) continue;
        const best = rows.length === 1 ? rows[0] : pickBestRowFinal(tok, rows);
        orderedPickedRows.push(best);
      }

      const processed: ProcessedWordData[] = orderedPickedRows.map((item) => ({
        word: normalizeThaiToken(item.word),
        category: item.category,
        pose_filename: item.pose_filename,
        fullUrl: buildPoseUrl(item.pose_filename),
      }));

      if (cancelled) return;

      setFoundWords(processed);
      setCurrentSingleIndex(0);
      setLoadingKeywords(false);
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [
    resultData.summary,
    resultData.thsl_fixed,
    resultData.keywords,
  ]);

  const poseItems = useMemo<PosePlaylistItem[]>(() => {
    return foundWords.map((item) => ({
      url: item.fullUrl,
      label: item.word,
      emotion: getEmotionFromWord(item.word),
    }));
  }, [foundWords]);

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

  const handleDownloadSentenceVideo = async () => {
    try {
      if (isFromHistory && resultData.historyVideoUrl) {
        const a = document.createElement("a");
        a.href = resultData.historyVideoUrl;
        a.download = "sentence.mp4";
        a.click();
        return;
      }

      const filenames = foundWords
        .map((x) => (x.pose_filename ?? "").trim())
        .filter(Boolean);

      if (filenames.length === 0) {
        toast.error("ไม่พบไฟล์ pose สำหรับสร้างวิดีโอ");
        return;
      }

      setLoadingSentenceVideo(true);

      const resp = await fetch(buildApiUrl("render_sentence_mp4"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pose_filenames: filenames,
          output_name: "sentence.mp4",
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error("render_sentence_mp4 failed:", resp.status, text);
        throw new Error(text || "render_sentence_mp4 failed");
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);

      setNewBlobUrl(url);

      const a = document.createElement("a");
      a.href = url;
      a.download = "sentence.mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();

      toast.success("ดาวน์โหลดวิดีโอทั้งประโยคสำเร็จ");
    } catch (e) {
      console.error("download mp4 error:", e);
      toast.error("ดาวน์โหลดวิดีโอทั้งประโยคไม่สำเร็จ");
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
      (!resultData.keywords || resultData.keywords.length === 0));

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

              {loadingKeywords ? (
                <div className="relative aspect-video bg-[#0F1F2F] rounded-lg overflow-hidden mb-4 border border-white/10 shadow-inner">
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
                    <RefreshCw className="animate-spin mb-2" />
                    <span className="text-xs">กำลังเตรียมท่าภาษามือ...</span>
                  </div>
                </div>
              ) : poseItems.length > 0 ? (
                <>
                  <div className="relative aspect-video bg-[#0F1F2F] rounded-lg overflow-hidden border border-white/10 shadow-inner">
                    <PosePlayer
                      key={`sentence-${poseItems.length}-${resultData.summary ?? ""}`}
                      items={poseItems}
                      width={640}
                      height={360}
                      fps={46}
                      confThreshold={0.05}
                      flipY={false}
                      loopPlaylist={false}
                      loopPose={false}
                      playing={sentencePlaying}
                      onSequenceStepChange={setCurrentSentenceIndex}
                      onSequenceEnd={() => setSentencePlaying(false)}
                    />
                  </div>

                  <div className="mt-3 mb-4 rounded-2xl border border-white/40 
                    bg-gradient-to-r from-[#F8FAFC] to-[#EEF2FF] 
                    px-4 py-3 shadow-[0_8px_20px_rgba(15,31,47,0.12)] backdrop-blur">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        onClick={() => setSentencePlaying((v) => !v)}
                        className="inline-flex h-9 w-9 items-center justify-center 
                          rounded-full 
                          bg-gradient-to-br from-[#2563EB] to-[#1E40AF] 
                          text-white shadow-md 
                          hover:scale-105 active:scale-95 
                          transition-all"
                        aria-label={sentencePlaying ? "Pause" : "Play"}
                      >
                        {sentencePlaying ? <Pause size={14} /> : <Play size={14} />}
                      </button>

                      {poseItems.length > 0 && (
                        <span className="rounded-xl border border-[#94A3B8] bg-[#F8FAFC] px-3 py-2 text-[11px] font-medium text-[#0F1F2F] shadow-sm">
                          ลำดับคำที่แสดง: {currentSentenceIndex + 1}/{poseItems.length}
                        </span>
                      )}

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
                    กำลังสร้างไฟล์ mp4...
                  </>
                ) : (
                  <>
                    <Download size={16} className="mr-2" />
                    ดาวน์โหลดวิดีโอทั้งประโยค (.mp4)
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
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Video size={18} className="text-[#263F5D]" />
                  <h2 className="font-semibold text-[#263F5D] text-sm">ดูทีละคำ</h2>
                </div>
              </div>

              {loadingKeywords ? (
                <div className="relative aspect-video bg-[#0F1F2F] rounded-lg overflow-hidden mb-4 border border-white/10 shadow-inner">
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
                    <RefreshCw className="animate-spin mb-2" />
                    <span className="text-xs">กำลังค้นหาท่าภาษามือ...</span>
                  </div>
                </div>
              ) : currentSingleItem ? (
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

                  <div className="mt-3 mb-4 rounded-2xl border border-white/40 
                    bg-gradient-to-r from-[#F8FAFC] to-[#EEF2FF] 
                    px-4 py-3 shadow-[0_8px_20px_rgba(15,31,47,0.12)] backdrop-blur">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        onClick={() => setSentencePlaying((v) => !v)}
                        className="inline-flex h-9 w-9 items-center justify-center 
                          rounded-full 
                          bg-gradient-to-br from-[#2563EB] to-[#1E40AF] 
                          text-white shadow-md 
                          hover:scale-105 active:scale-95 
                          transition-all"
                        aria-label={sentencePlaying ? "Pause" : "Play"}
                      >
                        {sentencePlaying ? <Pause size={14} /> : <Play size={14} />}
                      </button>

                      <span className="rounded-lg border border-[#94A3B8] bg-[#F8FAFC] px-3 py-2 text-[11px] font-medium text-[#0F1F2F] shadow-sm">
                        คำ: {currentSingleItem.label}
                      </span>

                      <span className="rounded-lg border border-[#94A3B8] bg-[#F8FAFC] px-3 py-2 text-[11px] font-medium text-[#0F1F2F] shadow-sm">
                        สีหน้า: {getEmotionLabelThai(currentSingleItem.emotion ?? "neutral")}
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
              <p className="text-[#263F5D] leading-relaxed text-sm">
                {(resultData.summary ?? "").replace(/\s+/g, "").trim()}
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <h2 className="font-semibold text-[#263F5D] mb-3 text-sm"># คำสำคัญ (ThSL pattern)</h2>

            <div className="flex flex-wrap gap-2">
              {loadingKeywords ? (
                <p className="text-[#263F5D]/60 text-sm animate-pulse">กำลังเรียงตามกฎ ThSL...</p>
              ) : foundWords.length > 0 ? (
                foundWords.map((item, idx) => {
                  const isActive = currentSingleIndex === idx;
                  const emo = getEmotionFromWord(item.word);

                  return (
                    <Badge
                      key={`${item.word}-${idx}`}
                      onClick={() => {
                        setCurrentSingleIndex(idx);
                        setViewMode("single");
                      }}
                      className={`cursor-pointer px-3 py-1.5 text-xs transition-all border border-transparent ${
                        isActive
                          ? "bg-[#FEC530] text-[#0F1F2F] scale-105 shadow-md border-white/20"
                          : "bg-[#0F1F2F] text-[#C9A7E3] hover:bg-[#1a2f44] hover:scale-105"
                      }`}
                      title={`หมวดหมู่: ${item.category} | emotion: ${emo}`}
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