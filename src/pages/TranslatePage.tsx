import { useState, useRef, useEffect } from 'react';
import { Mic, Upload, X, FileAudio, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

declare namespace Intl {
  interface SegmentData {
    segment: string;
    isWordLike?: boolean;
  }

  interface Segmenter {
    segment(input: string): Iterable<SegmentData>;
  }

  interface SegmenterConstructor {
    new (
      locales?: string | string[],
      options?: { granularity?: 'word' | 'sentence' | 'grapheme' }
    ): Segmenter;
  }

  const Segmenter: SegmenterConstructor;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

type TranslatePageLocationState = {
  originalText?: string;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '';

export default function TranslatePage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isRecording, setIsRecording] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [text, setText] = useState('');

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showTranslateErrorModal, setShowTranslateErrorModal] = useState(false);
  const [translateErrorMessage, setTranslateErrorMessage] = useState(
    'ไม่พบคำศัพท์ภาษามือที่รองรับในฐานข้อมูล'
  );

  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const state = (location.state as TranslatePageLocationState | null) ?? null;

  const segmenter =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('th', { granularity: 'word' })
      : null;

  const maxWords = 150;

  const getWordCount = (str: string) => {
    const s = str.trim();
    if (!s) return 0;

    if (segmenter) {
      let count = 0;
      for (const part of segmenter.segment(s)) {
        if (part.isWordLike) count++;
      }
      return count;
    }

    return s.split(/\s+/).filter(Boolean).length;
  };

  const clampToMaxWords = (input: string, limit: number) => {
    const s = input.trim();
    if (!s) return '';

    if (segmenter) {
      let out = '';
      let count = 0;

      for (const part of segmenter.segment(s)) {
        const isWord = !!part.isWordLike;
        if (isWord) {
          if (count >= limit) break;
          count++;
        }
        out += part.segment;
      }

      return out.trim();
    }

    return s.split(/\s+/).slice(0, limit).join(' ');
  };

  const wordCount = getWordCount(text);

  useEffect(() => {
    const incomingText = state?.originalText?.trim();
    if (!incomingText) return;

    const clamped = clampToMaxWords(incomingText, maxWords);
    setText(clamped);

    navigate(location.pathname, { replace: true, state: null });
  }, [state?.originalText, navigate, location.pathname]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    const clamped = clampToMaxWords(newText, maxWords);

    if (clamped !== newText) {
      toast.warning(`เกินขีดจำกัด ${maxWords} คำ`);
    }

    setText(clamped);
  };

  useEffect(() => {
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognitionAPI) {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'th-TH';

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          }
        }

        if (finalTranscript) {
          setText((prev) => {
            const separator = prev && !prev.endsWith(' ') ? ' ' : '';
            const next = prev + separator + finalTranscript.trim();
            const clamped = clampToMaxWords(next, maxWords);

            if (clamped !== next) {
              toast.warning(`เกินขีดจำกัด ${maxWords} คำ`);
            }

            return clamped;
          });
        }
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);

        if (event.error === 'not-allowed') {
          toast.error('กรุณาอนุญาตการใช้งานไมโครโฟน');
        } else {
          toast.error('เกิดข้อผิดพลาดในการรับเสียง');
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const handleStartRecording = () => {
    if (!recognitionRef.current) {
      toast.error('เบราว์เซอร์ของคุณไม่รองรับการรับเสียง');
      return;
    }

    try {
      recognitionRef.current.start();
      setIsRecording(true);
      toast.success('เริ่มบันทึกเสียงแล้ว');
    } catch (error) {
      console.error('Error starting recognition:', error);
      toast.error('ไม่สามารถเริ่มบันทึกเสียงได้');
    }
  };

  const handleStopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
      toast.success('หยุดบันทึกเสียงแล้ว');
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAudioFile(file);
    setShowUploadModal(false);
    await transcribeAudioFile(file);
  };

  const transcribeAudioFile = async (file: File) => {
    setIsProcessingFile(true);
    toast.info('กำลังประมวลผลไฟล์เสียงด้วย Whisper AI...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE_URL}/api/transcribe-audio`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.detail || 'แปลงไฟล์เสียงไม่สำเร็จ');
      }

      if (data?.text) {
        setText((prev) => {
          const next = prev + (prev ? ' ' : '') + data.text;
          const clamped = clampToMaxWords(next, maxWords);

          if (clamped !== next) {
            toast.warning(`เกินขีดจำกัด ${maxWords} คำ`);
          }

          return clamped;
        });

        toast.success('แปลงไฟล์เสียงเป็นข้อความสำเร็จ');
      } else {
        toast.warning('ไม่พบข้อความในไฟล์เสียง');
      }
    } catch (error) {
      console.error('Error transcribing file:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      toast.error(`เกิดข้อผิดพลาด: ${errorMessage}`);
    } finally {
      setIsProcessingFile(false);
    }
  };

  const handleSubmit = async () => {
    const raw = text.trim();

    if (!raw) {
      toast.error('กรุณาบันทึกเสียงหรือพิมพ์ข้อความก่อน');
      return;
    }

    setIsSubmitting(true);
    toast.info('กำลังตรวจคำศัพท์และสร้างภาษามือ...');

    try {
      const res = await fetch(`${API_BASE_URL}/api/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: raw }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        const message =
          data?.detail ||
          'ไม่พบคำศัพท์ภาษามือที่รองรับในฐานข้อมูล จึงไม่สามารถแสดงผลได้';

        setTranslateErrorMessage(message);
        setShowTranslateErrorModal(true);
        return;
      }

      const poseFiles = data.pose_filenames || data.poseFiles || [];
      const words = data.words || data.keywords || [];

      if (!Array.isArray(poseFiles) || poseFiles.length === 0) {
        setTranslateErrorMessage(
          'ไม่พบไฟล์ภาษามือที่สามารถแสดงผลได้ กรุณาลองข้อความอื่น'
        );
        setShowTranslateErrorModal(true);
        return;
      }

      navigate('/result', {
        state: {
          ...data,
          originalText: data.original_text || raw,
          inputText: data.input_text || raw,
          summary: data.summary || data.processed_text || raw,
          thsl_fixed: data.thsl_text || words.join(' '),
          keywords: words,
          words,
          pose_filenames: poseFiles,
          poseFiles,
          pose_urls: data.pose_urls || [],
          used_summary: !!data.used_summary,
        },
      });
    } catch (error) {
      console.error('Error translating:', error);
      setTranslateErrorMessage(
        'เชื่อมต่อ backend ไม่สำเร็จ กรุณาตรวจสอบว่า backend เปิดอยู่'
      );
      setShowTranslateErrorModal(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] py-8 md:py-12">
      <div className="container mx-auto px-4 max-w-xl">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl md:text-3xl font-bold text-[#263F5D] dark:text-[#D8C0D0] text-center mb-8"
        >
          แปลเสียงและข้อความเป็นภาษามือ
        </motion.h1>

        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <div className="flex items-center gap-2 mb-4">
              <Mic size={18} className="text-white" />
              <h2 className="font-semibold text-[#263F5D] text-sm">บันทึกเสียง</h2>
            </div>

            <div className="flex flex-col items-center py-6">
              {isRecording ? (
                <div className="relative">
                  <motion.div
                    className="w-14 h-14 rounded-full bg-[#213B54] flex items-center justify-center cursor-pointer"
                    onClick={handleStopRecording}
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                  >
                    <div className="flex gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-0.5 bg-white rounded-full"
                          animate={{ height: [8, 20, 8] }}
                          transition={{
                            repeat: Infinity,
                            duration: 0.5,
                            delay: i * 0.1,
                          }}
                        />
                      ))}
                    </div>
                  </motion.div>
                </div>
              ) : (
                <button
                  onClick={handleStartRecording}
                  className="w-14 h-14 rounded-full bg-[#213B54] flex items-center justify-center hover:bg-[#213B54]/80 transition-colors"
                >
                  <Mic size={24} className="text-white" />
                </button>
              )}

              <p className="text-[#263F5D] mt-3 text-sm">
                {isRecording ? 'กำลังบันทึก... คลิกเพื่อหยุด' : 'บันทึกเสียง'}
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <div className="flex items-center gap-2 mb-4">
              <FileAudio size={18} className="text-white" />
              <h2 className="font-semibold text-[#263F5D] text-sm">อัปโหลดไฟล์เสียง</h2>
            </div>

            <div className="flex flex-col items-center">
              {audioFile ? (
                <div className="flex items-center gap-2 p-2.5 bg-white/50 rounded-lg w-full">
                  {isProcessingFile ? (
                    <Loader2 size={18} className="text-[#263F5D] animate-spin" />
                  ) : (
                    <FileAudio size={18} className="text-[#263F5D]" />
                  )}

                  <span className="text-[#263F5D] text-sm flex-1 truncate">
                    {isProcessingFile ? 'กำลังประมวลผล...' : audioFile.name}
                  </span>

                  <button
                    onClick={() => setAudioFile(null)}
                    className="p-1 hover:bg-white/50 rounded"
                    disabled={isProcessingFile}
                  >
                    <X size={14} className="text-[#263F5D]" />
                  </button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setShowUploadModal(true)}
                  className="w-full border-2 border-[#223C55] text-[#263F5D] bg-white/50 hover:bg-white/70 text-sm"
                >
                  <Upload size={16} className="mr-2" />
                  เลือกไฟล์เสียง
                </Button>
              )}

              <p className="text-xs text-[#263F5D]/70 mt-2">
                *ไฟล์เสียงของคุณจะถูกใช้เพื่อการแปลเท่านั้น และจะถูกลบโดยอัตโนมัติหลังเสร็จสิ้นการแปล
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-[#263F5D] text-sm">
                ข้อความที่ได้ / พิมพ์ข้อความ
              </h2>
              <span
                className={`text-xs font-medium ${
                  wordCount >= maxWords ? 'text-red-500' : 'text-[#263F5D]/70'
                }`}
              >
                {wordCount}/{maxWords}
              </span>
            </div>

            <Textarea
              value={text}
              onChange={handleTextChange}
              placeholder="ข้อความจะแสดงที่นี่หลังบันทึกเสียง หรือคุณสามารถพิมพ์ข้อความที่ต้องการได้"
              className="min-h-[100px] resize-none bg-white/50 border-2 border-[#223C55] text-[#263F5D] placeholder:text-[#263F5D]/50 text-sm"
            />

            <Button
              onClick={handleSubmit}
              size="lg"
              className="w-full mt-4 bg-[#0F1F2F] hover:bg-[#1a2f44] text-[#C9A7E3] font-semibold py-5 rounded-xl text-sm"
              disabled={isProcessingFile || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  กำลังประมวลผล...
                </>
              ) : (
                'สร้างสรุป คำสำคัญ และวิดีโอภาษามือ'
              )}
            </Button>
          </motion.div>
        </div>
      </div>

      <Dialog open={showUploadModal} onOpenChange={setShowUploadModal}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-[#1a2f44]">
          <DialogHeader>
            <DialogTitle className="text-[#263F5D] dark:text-white">
              อัพโหลดไฟล์
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col items-center py-8 border-2 border-dashed border-[#223C55] dark:border-white/20 rounded-lg bg-[#A6BFE3]/30">
            <Upload size={40} className="text-[#263F5D]/40 mb-4" />
            <p className="text-[#263F5D]/60 mb-2 text-sm">วางไฟล์ที่นี่ หรือ</p>
            <Button
              variant="link"
              onClick={() => fileInputRef.current?.click()}
              className="text-[#FEC530]"
            >
              อัพโหลดไฟล์
            </Button>

            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showTranslateErrorModal}
        onOpenChange={setShowTranslateErrorModal}
      >
        <DialogContent className="sm:max-w-md text-center bg-white dark:bg-[#1a2f44]">
          <div className="py-6">
            <div className="text-5xl mb-4">🤟</div>
            <h2 className="text-lg font-bold text-[#263F5D] dark:text-white mb-2">
              ไม่สามารถแสดงผลภาษามือได้
            </h2>
            <p className="text-[#263F5D]/60 dark:text-white/60 mb-6 text-sm">
              {translateErrorMessage}
            </p>
            <Button
              onClick={() => setShowTranslateErrorModal(false)}
              className="bg-[#0F1F2F] hover:bg-[#1a2f44] text-[#C9A7E3]"
            >
              ลองใหม่อีกครั้ง
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}