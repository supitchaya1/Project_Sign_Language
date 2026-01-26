import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { fetchMyHistory, type HistoryRecord } from '@/services/history';

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetchMyHistory()
      .then((data) => {
        if (!isMounted) return;
        setItems(data);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : 'โหลดประวัติไม่สำเร็จ';
        setErrorMessage(message);
      })
      .finally(() => {
        if (!isMounted) return;
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

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

        {isLoading ? (
          <div className="text-center text-[#263F5D]/70">กำลังโหลด...</div>
        ) : items.length === 0 ? (
          <div className="text-center text-[#263F5D]/70">ยังไม่มีประวัติการแปล</div>
        ) : (
          <div className="space-y-3">
            {items.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
              >
                <p className="text-xs text-[#263F5D]/60 mb-2">
                  {new Date(item.created_at).toLocaleString()}
                </p>
                <p className="text-[#263F5D] text-sm mb-2">
                  {item.input_text}
                </p>
                <p className="text-[#263F5D]/80 text-xs">
                  {item.translated_result}
                </p>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
