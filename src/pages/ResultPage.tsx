// src/pages/ResultPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Play, Download, Video } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNavigate, useLocation } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

interface ResultState {
  originalText?: string;
  summary?: string;
  keywords?: string[];
}

// ✅ Supabase client (แนะนำย้ายไป src/lib/supabase.ts แล้ว import มาใช้)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // จะช่วยให้รู้ทันทีว่า env ไม่ถูกต้อง
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function ResultPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isPlaying, setIsPlaying] = useState(false);

  // ✅ คำสำคัญที่ "มีอยู่จริงใน Supabase" เท่านั้น
  const [dbKeywords, setDbKeywords] = useState<string[]>([]);
  const [loadingKeywords, setLoadingKeywords] = useState(false);

  // Get data from navigation state or use defaults
  const state = location.state as ResultState | null;

  const resultData = {
    text: state?.originalText || 'ไม่มีข้อความ',
    summary: state?.summary || 'ไม่มีข้อมูลสรุป',
    keywords: state?.keywords || [],
  };

  // ✅ ทำความสะอาด + ตัดซ้ำ ก่อน query (ลดโหลด)
  const uniqueKeywords = useMemo(() => {
    return Array.from(
      new Set(
        (resultData.keywords || [])
          .map((k) => (k ?? '').trim())
          .filter(Boolean)
      )
    );
  }, [resultData.keywords]);

  useEffect(() => {
    const fetchKeywordsFromDB = async () => {
      // ถ้าไม่มี keywords ก็ไม่ต้องยิง DB
      if (uniqueKeywords.length === 0) {
        setDbKeywords([]);
        return;
      }

      setLoadingKeywords(true);

      // ✅ Query: เอาเฉพาะคำที่มีอยู่จริงในตาราง SL_word
      const { data, error } = await supabase
        .from('SL_word')
        .select('word')
        .in('word', uniqueKeywords);

      if (error) {
        console.error('Fetch keywords error:', error);
        setDbKeywords([]); // requirement: แสดงเฉพาะที่อยู่ใน supabase -> ถ้า error ก็แสดงว่าง
      } else {
        const words = (data ?? [])
          .map((row: { word: string }) => row.word)
          .filter(Boolean);

        // (กันซ้ำอีกชั้น เผื่อ DB มีซ้ำ)
        setDbKeywords(Array.from(new Set(words)));
      }

      setLoadingKeywords(false);
    };

    fetchKeywordsFromDB();
  }, [uniqueKeywords]);

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
          {/* Video Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <div className="flex items-center gap-2 mb-4">
              <Video size={18} className="text-[#263F5D]" />
              <h2 className="font-semibold text-[#263F5D] text-sm">วิดีโอภาษามือ</h2>
            </div>

            <div className="relative aspect-video bg-[#213B54] rounded-lg overflow-hidden mb-4">
              <div className="absolute inset-0 flex items-center justify-center">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
                >
                  <Play size={24} className="text-white ml-1" />
                </button>
              </div>
            </div>

            <Button className="w-full bg-[#0F1F2F] hover:bg-[#1a2f44] text-white text-sm">
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
            <h2 className="font-semibold text-[#263F5D] mb-3 text-sm">ข้อความ</h2>
            <p className="text-[#263F5D] leading-relaxed text-sm">{resultData.text}</p>
          </motion.div>

          {/* Summary Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <h2 className="font-semibold text-[#263F5D] mb-3 text-sm">สรุป</h2>
            <p className="text-[#263F5D] leading-relaxed text-sm">{resultData.summary}</p>
          </motion.div>

          {/* Keywords Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <h2 className="font-semibold text-[#263F5D] mb-3 text-sm"># คำสำคัญ</h2>

            <div className="flex flex-wrap gap-2">
              {loadingKeywords ? (
                <p className="text-[#263F5D]/60 text-sm">กำลังโหลดคำสำคัญ...</p>
              ) : dbKeywords.length > 0 ? (
                dbKeywords.map((keyword) => (
                  <Badge
                    key={keyword}
                    className="bg-[#0F1F2F] text-[#C9A7E3] px-3 py-1 text-xs"
                  >
                    {keyword}
                  </Badge>
                ))
              ) : (
                <p className="text-[#263F5D]/60 text-sm">ไม่พบคำสำคัญในฐานข้อมูล</p>
              )}
            </div>

            {/* (optional) debug: ดู keywords ที่ส่งมา */}
            {/* <pre className="text-xs mt-3 text-[#263F5D]/70">{JSON.stringify(uniqueKeywords, null, 2)}</pre> */}
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
