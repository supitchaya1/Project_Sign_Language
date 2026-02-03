import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Video } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNavigate, useLocation } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import PosePlayer from '@/components/PosePlayer';

// ---------------------------------------------------------
// 🛠️ ตั้งค่าชื่อ BUCKET ตรงนี้ (สำคัญมาก!) 🛠️
const STORAGE_BUCKET_NAME = 'pose';
// ---------------------------------------------------------

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

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// =====================
// ✅ เลือกหมวดที่เหมาะที่สุด เมื่อ word ซ้ำหลาย category
// =====================
const CATEGORY_PRIORITY: Record<string, number> = {
  'คำทั่วไป': 1,
  'กริยา': 2,
  'สถานที่': 3,
  'จำนวน': 4,
  'ตัวเลข': 5,
  'การเขียนสะกดนิ้วมือ': 6,
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

      // rule พิเศษ: ถ้า token เป็นเลข ให้ "ตัวเลข" ชนะเสมอ
      const boostA = isNumberToken(token) && a.category === 'ตัวเลข' ? -1000 : 0;
      const boostB = isNumberToken(token) && b.category === 'ตัวเลข' ? -1000 : 0;

      return (pa + boostA) - (pb + boostB);
    })[0];
}

// =====================
// ✅ Rule Engine แบบง่าย: Thai keywords → ThSL order
// (ทำให้ลำดับประโยค “มีความหมาย” มากขึ้น)
// =====================
type Role = 'S' | 'V' | 'O' | 'NEG' | 'Adv(Time)' | 'PP(Place)' | 'Q' | 'UNK';

function isNeg(w: string) {
  return w === 'ไม่' || w === 'ไม่มี' || w === 'ห้าม';
}

function isTimeWord(w: string) {
  return ['วันนี้', 'พรุ่งนี้', 'เมื่อวาน', 'ตอนนี้', 'เช้า', 'สาย', 'บ่าย', 'เย็น', 'กลางคืน'].includes(w);
}

function isPlaceWord(w: string) {
  return ['บ้าน', 'โรงเรียน', 'มหาวิทยาลัย', 'ตลาด', 'โรงพยาบาล', 'ที่ทำงาน', 'ห้องน้ำ'].includes(w);
}

function isPronoun(w: string) {
  return ['ฉัน', 'ผม', 'หนู', 'เรา', 'คุณ', 'เขา', 'เธอ', 'มัน', 'พวกเรา'].includes(w);
}

function isVerb(w: string) {
  return ['ไป', 'มา', 'กิน', 'นอน', 'เรียน', 'ทำงาน', 'ดู', 'ซื้อ', 'ขาย', 'ชอบ', 'รัก', 'ช่วย'].includes(w);
}

function cleanTokens(tokens: string[]) {
  // trim + เอาค่าว่างออก + ไม่ลบซ้ำ (เพราะลำดับสำคัญ)
  return (tokens || []).map(t => (t ?? '').trim()).filter(Boolean);
}

function tagToken(w: string): Role {
  if (isNeg(w)) return 'NEG';
  if (isTimeWord(w)) return 'Adv(Time)';
  if (isPlaceWord(w)) return 'PP(Place)';
  if (isPronoun(w)) return 'S';
  if (isVerb(w)) return 'V';
  if (w === 'ไหม' || w === '?' || w === 'หรือเปล่า') return 'Q';
  if (isNumberToken(w)) return 'O'; // เลขให้เป็น O แบบง่าย
  return 'O'; // ที่เหลือเดาเป็น O (เพื่อให้เข้ากฎ S V O ได้)
}

// ใช้เฉพาะกฎที่พบบ่อยก่อน (พอให้ “ได้ความหมาย”)
function toThslOrder(tokens: string[]) {
  const tagged = cleanTokens(tokens).map(w => ({ word: w, role: tagToken(w) }));

  const roles = tagged.map(x => x.role);

  // helper เลือกคำตัวแรกของ role ตามลำดับที่สั่ง
  const used = new Set<number>();
  const takeRole = (role: Role) => {
    const idx = tagged.findIndex((x, i) => !used.has(i) && x.role === role);
    if (idx >= 0) { used.add(idx); return tagged[idx].word; }
    return null;
  };

  // ----- match patterns -----
  // 16: S + NEG + V + O + Adv(Time) → Adv(Time) + O + S + V + NEG
  if (roles.includes('S') && roles.includes('V') && roles.includes('NEG') && roles.includes('Adv(Time)')) {
    // ถ้ามี O ด้วยให้ใช้กฎใกล้เคียง 16/14
    const out: string[] = [];
    const t = takeRole('Adv(Time)');
    if (t) out.push(t);

    // ดึง O ทั้งหมด (อาจมีหลายคำ)
    tagged.forEach((x, i) => {
      if (!used.has(i) && x.role === 'O') { used.add(i); out.push(x.word); }
    });

    const s = takeRole('S'); if (s) out.push(s);
    const v = takeRole('V'); if (v) out.push(v);
    const n = takeRole('NEG'); if (n) out.push(n);

    // เติมที่เหลือ
    tagged.forEach((x, i) => { if (!used.has(i)) out.push(x.word); });
    return out;
  }

  // 15: S + V + O + Adv(Time) → Adv(Time) + O + S + V
  if (roles.includes('S') && roles.includes('V') && roles.includes('Adv(Time)')) {
    const out: string[] = [];
    const t = takeRole('Adv(Time)'); if (t) out.push(t);

    tagged.forEach((x, i) => {
      if (!used.has(i) && x.role === 'O') { used.add(i); out.push(x.word); }
    });

    const s = takeRole('S'); if (s) out.push(s);
    const v = takeRole('V'); if (v) out.push(v);

    tagged.forEach((x, i) => { if (!used.has(i)) out.push(x.word); });
    return out;
  }

  // 12/11 (แบบง่าย): มีสถานที่ → เอาสถานที่ขึ้นก่อน: PP + O + S + V (+NEG)
  if (roles.includes('PP(Place)') && roles.includes('S') && roles.includes('V')) {
    const out: string[] = [];
    const p = takeRole('PP(Place)'); if (p) out.push(p);

    tagged.forEach((x, i) => {
      if (!used.has(i) && x.role === 'O') { used.add(i); out.push(x.word); }
    });

    const s = takeRole('S'); if (s) out.push(s);
    const v = takeRole('V'); if (v) out.push(v);
    const n = takeRole('NEG'); if (n) out.push(n);

    tagged.forEach((x, i) => { if (!used.has(i)) out.push(x.word); });
    return out;
  }

  // 4/3: S (+NEG) + V + O → O + S + V (+NEG)
  if (roles.includes('S') && roles.includes('V')) {
    const out: string[] = [];

    tagged.forEach((x, i) => {
      if (!used.has(i) && x.role === 'O') { used.add(i); out.push(x.word); }
    });

    const s = takeRole('S'); if (s) out.push(s);
    const v = takeRole('V'); if (v) out.push(v);
    const n = takeRole('NEG'); if (n) out.push(n);

    tagged.forEach((x, i) => { if (!used.has(i)) out.push(x.word); });
    return out;
  }

  // fallback: คืน token เดิม
  return tagged.map(x => x.word);
}

export default function ResultPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [foundWords, setFoundWords] = useState<ProcessedWordData[]>([]);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [currentPoseUrl, setCurrentPoseUrl] = useState<string>('');

  const state = location.state as ResultState | null;

  const resultData = {
    text: state?.originalText || 'ไม่มีข้อความ',
    summary: state?.summary || 'ไม่มีข้อมูลสรุป',
    keywords: state?.keywords || [],
  };

  // ✅ 1) แปลง keywords → ลำดับ ThSL (สำคัญมาก: อย่า Set เพราะทำลำดับพัง)
  const thslKeywords = useMemo(() => {
    const tokens = cleanTokens(resultData.keywords || []);
    return toThslOrder(tokens);
  }, [resultData.keywords]);

  useEffect(() => {
    const fetchKeywordsFromDB = async () => {
      if (thslKeywords.length === 0) {
        setFoundWords([]);
        setCurrentPoseUrl('');
        return;
      }

      setLoadingKeywords(true);

      // ✅ query ด้วยคำทั้งหมด (แม้ซ้ำหมวด) แล้วเราจะ pick 1 แถวต่อ word เอง
      const { data, error } = await supabase
        .from('SL_word')
        .select('word, category, pose_filename')
        .in('word', Array.from(new Set(thslKeywords))); // query ให้สั้นลง แต่ยังคงลำดับตอนจัดผลลัพธ์ทีหลัง

      if (error) {
        console.error('Fetch keywords error:', error);
        setFoundWords([]);
        setCurrentPoseUrl('');
        setLoadingKeywords(false);
        return;
      }

      const rawData = (data as WordData[]) || [];

      // group by word
      const grouped = new Map<string, WordData[]>();
      for (const row of rawData) {
        if (!grouped.has(row.word)) grouped.set(row.word, []);
        grouped.get(row.word)!.push(row);
      }

      // ✅ จัดลำดับผลลัพธ์ตาม thslKeywords (สำคัญ: ให้เล่นท่าตามประโยค)
      const picked: WordData[] = thslKeywords
        .map((w) => {
          const rows = grouped.get(w) ?? [];
          if (rows.length === 0) return null;
          if (rows.length === 1) return rows[0];
          return pickBestRow(w, rows);
        })
        .filter(Boolean) as WordData[];

      // create public url
      const processed: ProcessedWordData[] = picked.map((item) => {
        const { data: urlData } = supabase.storage
          .from(STORAGE_BUCKET_NAME)
          .getPublicUrl(item.pose_filename);

        return {
          word: item.word,
          category: item.category,
          fullUrl: urlData.publicUrl,
        };
      });

      setFoundWords(processed);

      if (processed.length > 0 && processed[0].fullUrl) {
        setCurrentPoseUrl(processed[0].fullUrl);
      } else {
        setCurrentPoseUrl('');
      }

      setLoadingKeywords(false);
    };

    fetchKeywordsFromDB();
  }, [thslKeywords]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] py-8 md:py-12">
      <div className="container mx-auto px-4 max-w-xl">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl md:text-3xl font-bold text-[#263F5D] dark:text-[#D8C0D0] text-center mb-8"
        >
          ผลลัพธ์
        </motion.h1>

        <div className="space-y-4">
          {/* Pose Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <div className="flex items-center gap-2 mb-4">
              <Video size={18} className="text-[#263F5D]" />
              <h2 className="font-semibold text-[#263F5D] text-sm">
                วิดีโอภาษามือ
              </h2>
            </div>

            <div className="relative aspect-video bg-[#213B54] rounded-lg overflow-hidden mb-4 border border-white/10">
              {currentPoseUrl ? (
                <PosePlayer
                  poseUrl={currentPoseUrl}
                  width={640}
                  height={360}
                  autoPlay={true}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50">
                  <span className="text-3xl mb-2">🚫</span>
                  <span className="text-xs">
                    {loadingKeywords
                      ? 'กำลังโหลด...'
                      : 'ไม่พบไฟล์ท่าทาง หรือยังไม่ได้เลือกคำศัพท์'}
                  </span>
                </div>
              )}
            </div>

            <Button
              disabled={!currentPoseUrl}
              className="w-full bg-[#0F1F2F] hover:bg-[#1a2f44] text-white text-sm disabled:opacity-50"
              onClick={() => {
                if (currentPoseUrl) window.open(currentPoseUrl, '_blank');
              }}
            >
              <Download size={16} className="mr-2" />
              ดาวน์โหลดวิดีโอ
            </Button>
          </motion.div>

          {/* Text Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <h2 className="font-semibold text-[#263F5D] mb-3 text-sm">
              ข้อความ
            </h2>
            <p className="text-[#263F5D] leading-relaxed text-sm">
              {resultData.text}
            </p>
          </motion.div>

          {/* Summary Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <h2 className="font-semibold text-[#263F5D] mb-3 text-sm">สรุป</h2>
            <p className="text-[#263F5D] leading-relaxed text-sm">
              {resultData.summary}
            </p>
          </motion.div>

          {/* Keywords Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <h2 className="font-semibold text-[#263F5D] mb-3 text-sm">
              # คำสำคัญ (เรียงแบบ ThSL)
            </h2>

            <div className="flex flex-wrap gap-2">
              {loadingKeywords ? (
                <p className="text-[#263F5D]/60 text-sm">
                  กำลังโหลดคำสำคัญ...
                </p>
              ) : foundWords.length > 0 ? (
                foundWords.map((item, idx) => (
                  <Badge
                    key={`${item.word}-${item.category}-${idx}`}
                    onClick={() => {
                      if (item.fullUrl) setCurrentPoseUrl(item.fullUrl);
                    }}
                    className={`cursor-pointer px-3 py-1 text-xs transition-all ${
                      currentPoseUrl === item.fullUrl
                        ? 'bg-[#FEC530] text-[#0F1F2F] hover:bg-[#FEC530]/80'
                        : 'bg-[#0F1F2F] text-[#C9A7E3] hover:bg-[#1a2f44]'
                    }`}
                    title={item.category}
                  >
                    {item.word}{' '}
                    <span className="opacity-70">({item.category})</span>
                  </Badge>
                ))
              ) : (
                <p className="text-[#263F5D]/60 text-sm">
                  ไม่พบคำสำคัญในฐานข้อมูล
                </p>
              )}
            </div>
          </motion.div>

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="grid grid-cols-2 gap-3"
          >
            <Button
              variant="outline"
              onClick={() => navigate('/translate')}
              className="py-5 text-[#263F5D] border-2 border-[#223C55] bg-white/50 hover:bg-white/70 text-sm"
            >
              <ArrowLeft size={16} className="mr-2" />
              ย้อนกลับแก้ไข
            </Button>

            <Button
              onClick={() => navigate('/translate')}
              className="bg-[#0F1F2F] hover:bg-[#1a2f44] text-[#C9A7E3] py-5 text-sm"
            >
              สร้างเสียงใหม่
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
