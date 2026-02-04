import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

export default function HomePage() {
  const { isAuthenticated } = useAuth();

  const steps = [
    {
      number: 1,
      title: 'บันทึกเสียง/ อัปโหลดไฟล์เสียง/ พิมพ์ข้อความ',
    },
    {
      number: 2,
      title: 'ประมวลผล',
    },
    {
      number: 3,
      title: 'ผลลัพธ์วิดีโอภาษามือ',
    },
  ];

  return (
    <div className="min-h-screen bg-[#FEFBF4] dark:bg-[#0F1F2F]">
      {/* Hero Section - Lavender gradient for light, Navy for dark */}
      <section className="bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] py-16 md:py-20">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center max-w-3xl mx-auto"
          >
            <h1 className="text-3xl md:text-5xl font-bold text-[#263F5D] dark:text-[#D8C0D0] mb-6 leading-tight">
              แปลเสียงและข้อความ
              <br />
              เป็นภาษามือ
            </h1>

            <Link to="/translate">
              <Button
                size="lg"
                className="bg-[#0F1F2F] hover:bg-[#1a2f44] text-[#C9A7E3] font-semibold text-lg px-8 py-6 rounded-full shadow-md hover:shadow-lg transition-all group"
              >
                เริ่มใช้งาน
                <ArrowRight className="ml-2 group-hover:translate-x-1 transition-transform" size={20} />
              </Button>
            </Link>

            <p className="text-[#263F5D]/70 dark:text-white/70 mt-6 text-base">
              เข้าสู่ระบบเพื่อบันทึกประวัติ หรือใช้งานได้ทันทีโดยไม่ต้องลงทะเบียน
            </p>
          </motion.div>
        </div>
      </section>

      {/* Steps Section */}
      <section className="py-12 bg-[#FEFBF4] dark:bg-[#0F1F2F]">
        <div className="container mx-auto px-4">
          {/* Steps with frame - includes header inside */}
          <div className="max-w-4xl mx-auto">
            <div className="border-2 border-[#223C55] dark:border-[#213B54] rounded-2xl bg-[#A6BFE3] p-6 md:p-8">
              <motion.h2
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                className="text-xl md:text-2xl font-bold text-center text-[#263F5D] dark:text-[#263F5D] mb-8"
              >
                ใช้งานง่ายใน 3 ขั้นตอน
              </motion.h2>

              <div className="grid md:grid-cols-3 gap-6">
                {steps.map((step, index) => (
                  <motion.div
                    key={step.number}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.2 }}
                    className="md:text-center"
                  >
                    {/* Mobile: left-aligned number + text inline, Desktop: centered */}
                    <div className="flex items-center gap-3 md:flex-col md:gap-4">
                      <div className="w-10 h-10 md:w-14 md:h-14 rounded-xl bg-[#213B54] text-white flex items-center justify-center font-bold text-lg md:text-xl flex-shrink-0">
                        {step.number}
                      </div>
                      <p className="text-[#263F5D] font-medium text-sm">
                        {step.title}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}