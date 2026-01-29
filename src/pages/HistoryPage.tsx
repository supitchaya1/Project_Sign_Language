import { useEffect, useMemo, useState } from 'react';
import { Search, Calendar, Eye, Edit, Trash2, Filter } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { fetchMyHistory, type HistoryRecord } from '@/services/history';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export default function HistoryPage() {
  const { isAuthenticated } = useAuth();

  const [items, setItems] = useState<HistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  useEffect(() => {
    // ✅ ยังไม่ล็อกอิน: ไม่ต้อง fetch
    if (!isAuthenticated) {
      setIsLoading(false);
      setItems([]);
      setErrorMessage(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setErrorMessage(null);

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
  }, [isAuthenticated]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const a = (it.input_text || '').toLowerCase();
      const b = (it.translated_result || '').toLowerCase();
      return a.includes(q) || b.includes(q);
    });
  }, [items, searchQuery]);

  const handleDelete = (id: string) => {
    setItemToDelete(id);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;

    // ลบจาก UI ก่อน (ถ้ามี API ลบจริงค่อยต่อเพิ่ม)
    setItems((prev) => prev.filter((x) => x.id !== itemToDelete));

    setShowDeleteModal(false);
    setItemToDelete(null);
  };

  // ✅ หน้าที่ต้องการก่อน login (ข้อความตามที่คุณระบุ)
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

  // ✅ หลัง login: แสดงประวัติจริง
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
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#263F5D]/40" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาข้อความ หรือคำสำคัญ"
                className="pl-9 bg-white/50 border-2 border-[#223C55] text-[#263F5D] placeholder:text-[#263F5D]/40 text-sm"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="border-2 border-[#223C55] text-[#263F5D] bg-white/50 hover:bg-white/70"
              aria-label="Filter"
            >
              <Filter size={16} />
            </Button>
          </div>
        </motion.div>

        {isLoading ? (
          <div className="text-center text-[#263F5D]/70">กำลังโหลด...</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center text-[#263F5D]/70">
            {items.length === 0 ? 'ยังไม่มีประวัติการแปล' : 'ไม่พบผลลัพธ์ที่ค้นหา'}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar size={14} className="text-[#263F5D]/40" />
                      <span className="text-xs text-[#263F5D]/60">
                        {item.created_at ? new Date(item.created_at).toLocaleString() : '-'}
                      </span>
                    </div>

                    <p className="text-[#263F5D] text-sm line-clamp-2">{item.input_text}</p>

                    {item.translated_result && (
                      <p className="text-[#263F5D]/70 text-xs mt-2 line-clamp-2">
                        {item.translated_result}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex items-center gap-1 bg-[#0F1F2F] hover:bg-[#1a2f44] text-[#C9A7E3] text-xs px-3"
                    >
                      <Eye size={12} />
                      <span className="hidden sm:inline">ดูวิดีโอ</span>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-1 border-2 border-[#223C55] text-[#263F5D] bg-white/50 hover:bg-white/70 text-xs px-3"
                    >
                      <Edit size={12} />
                      <span className="hidden sm:inline">แก้ไข</span>
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
            ))}
          </div>
        )}
      </div>

      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-[#1a2f44]">
          <DialogHeader>
            <DialogTitle className="text-center text-[#263F5D] dark:text-white">
              ยืนยันการลบประวัติ
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 text-center">
            <p className="text-[#263F5D]/60 dark:text-white/60 text-sm">
              คุณต้องการลบประวัตินี้หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้
            </p>
          </div>
          <DialogFooter className="flex gap-2 sm:justify-center">
            <Button variant="destructive" onClick={confirmDelete}>
              ลบ
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowDeleteModal(false)}
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



// import { useEffect, useState } from 'react';
// import { motion } from 'framer-motion';
// import { fetchMyHistory, type HistoryRecord } from '@/services/history';

// export default function HistoryPage() {
//   const [items, setItems] = useState<HistoryRecord[]>([]);
//   const [isLoading, setIsLoading] = useState(true);
//   const [errorMessage, setErrorMessage] = useState<string | null>(null);

//   useEffect(() => {
//     let isMounted = true;
//     fetchMyHistory()
//       .then((data) => {
//         if (!isMounted) return;
//         setItems(data);
//       })
//       .catch((error: unknown) => {
//         if (!isMounted) return;
//         const message = error instanceof Error ? error.message : 'โหลดประวัติไม่สำเร็จ';
//         setErrorMessage(message);
//       })
//       .finally(() => {
//         if (!isMounted) return;
//         setIsLoading(false);
//       });

//     return () => {
//       isMounted = false;
//     };
//   }, []);

//   return (
//     <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] py-8 md:py-12">
//       <div className="container mx-auto px-4 max-w-2xl">
//         <motion.h1
//           initial={{ opacity: 0, y: -20 }}
//           animate={{ opacity: 1, y: 0 }}
//           className="text-2xl md:text-3xl font-bold text-[#263F5D] dark:text-[#D8C0D0] text-center mb-8"
//         >
//           ประวัติการแปล
//         </motion.h1>

//         {errorMessage && (
//           <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 mb-4">
//             {errorMessage}
//           </div>
//         )}

//         {isLoading ? (
//           <div className="text-center text-[#263F5D]/70">กำลังโหลด...</div>
//         ) : items.length === 0 ? (
//           <div className="text-center text-[#263F5D]/70">ยังไม่มีประวัติการแปล</div>
//         ) : (
//           <div className="space-y-3">
//             {items.map((item, index) => (
//               <motion.div
//                 key={item.id}
//                 initial={{ opacity: 0, y: 10 }}
//                 animate={{ opacity: 1, y: 0 }}
//                 transition={{ delay: index * 0.05 }}
//                 className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
//               >
//                 <p className="text-xs text-[#263F5D]/60 mb-2">
//                   {new Date(item.created_at).toLocaleString()}
//                 </p>
//                 <p className="text-[#263F5D] text-sm mb-2">
//                   {item.input_text}
//                 </p>
//                 <p className="text-[#263F5D]/80 text-xs">
//                   {item.translated_result}
//                 </p>
//               </motion.div>
//             ))}
//           </div>
//         )}
//       </div>
//     </div>
//   );
// }
