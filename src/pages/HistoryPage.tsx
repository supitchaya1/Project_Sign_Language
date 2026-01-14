import { useState } from 'react';
import { Search, Calendar, Eye, Edit, Trash2, Filter } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface HistoryItem {
  id: string;
  date: string;
  text: string;
}

export default function HistoryPage() {
  const { isAuthenticated } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const mockHistory: HistoryItem[] = [
    {
      id: '1',
      date: '2/9/2568',
      text: 'AI เป็นเทคโนโลยีหน่วยมาช่วยในการเรียนรู้สายพันธุ์นกที่เราไม่รู้จักและสามารถบอกแหล่งน้ำที่นกอาศัยอยู่ได้',
    },
    {
      id: '2',
      date: '30/8/2568',
      text: 'แมว เป็นสัตว์เลี้ยงลูกด้วยนมสัตว์เนื้อขนาดเล็ก โดยแมวบ้านปัจจุบันสืบเชื้อสายในวงศ์เสือและแมว',
    },
  ];

  const handleDelete = (id: string) => {
    setItemToDelete(id);
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    setShowDeleteModal(false);
    setItemToDelete(null);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] py-8 md:py-12">
        <div className="container mx-auto px-4 max-w-xl">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl md:text-3xl font-bold text-[#263F5D] dark:text-[#D8C0D0] text-center mb-8"
          >
            ประวัติการแปล
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-8 bg-[#A6BFE3] text-center"
          >
            <div className="text-5xl mb-4">🔒</div>
            <h2 className="text-lg font-bold text-[#263F5D] mb-2">
              เข้าสู่ระบบเพื่อดูประวัติ
            </h2>
            <p className="text-[#263F5D]/70 mb-6 text-sm">
              กรุณาเข้าสู่ระบบเพื่อดูประวัติการแปลเสียงของคุณ
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/login">
                <Button className="bg-[#0F1F2F] hover:bg-[#1a2f44] text-[#C9A7E3]">เข้าสู่ระบบ</Button>
              </Link>
              <Link to="/register">
                <Button variant="outline" className="border-2 border-[#223C55] text-[#263F5D] bg-white/50 hover:bg-white/70">สร้างบัญชี</Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

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

        {/* Search and Filter */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3] mb-4"
        >
          <h2 className="font-semibold text-[#263F5D] mb-3 text-sm">ค้นหาและคัดกรอง</h2>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#263F5D]/40"
              />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาข้อความ หรือคำสำคัญ"
                className="pl-9 bg-white/50 border-2 border-[#223C55] text-[#263F5D] placeholder:text-[#263F5D]/40 text-sm"
              />
            </div>
            <Button variant="outline" size="icon" className="border-2 border-[#223C55] text-[#263F5D] bg-white/50 hover:bg-white/70">
              <Filter size={16} />
            </Button>
          </div>
        </motion.div>

        {/* History List */}
        <div className="space-y-3">
          {mockHistory.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-5 bg-[#A6BFE3]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar size={14} className="text-[#263F5D]/40" />
                    <span className="text-xs text-[#263F5D]/60">
                      {item.date}
                    </span>
                  </div>
                  <p className="text-[#263F5D] text-sm line-clamp-2">{item.text}</p>
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
      </div>

      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-[#1a2f44]">
          <DialogHeader>
            <DialogTitle className="text-center text-[#263F5D] dark:text-white">ยืนยันการลบประวัติ</DialogTitle>
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
            <Button variant="outline" onClick={() => setShowDeleteModal(false)} className="border-2 border-[#223C55] dark:border-white/30">
              ยกเลิก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}