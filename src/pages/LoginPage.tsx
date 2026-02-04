import { useState } from 'react';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'เข้าสู่ระบบไม่สำเร็จ';
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] flex items-center justify-center py-12 px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="border-2 border-[#223C55] dark:border-[#213B54] rounded-xl p-6 bg-[#A6BFE3]">
          <h1 className="text-2xl font-bold text-[#263F5D] dark:text-white text-center mb-6">
            เข้าสู่ระบบ
          </h1>

          <form onSubmit={handleSubmit} className="space-y-5">
            {errorMessage && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {errorMessage}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2 text-[#263F5D] text-sm">
                <Mail size={14} />
                อีเมล
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="กรุณากรอกอีเมล"
                className="bg-white/50 border-2 border-[#223C55] text-[#263F5D] placeholder:text-[#263F5D]/40 text-sm"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="flex items-center gap-2 text-[#263F5D] text-sm">
                <Lock size={14} />
                รหัสผ่าน
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="กรุณากรอกรหัสผ่าน"
                  className="bg-white/50 border-2 border-[#223C55] text-[#263F5D] placeholder:text-[#263F5D]/40 text-sm pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#263F5D]/40 hover:text-[#263F5D]/60"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="text-right">
              <Link to="/forgot-password" className="text-xs text-[#213B54] hover:underline">
                ลืมรหัสผ่าน?
              </Link>
            </div>

            <Button
              type="submit"
              className="w-full bg-[#0F1F2F] hover:bg-[#1a2f44] text-[#C9A7E3] py-5 text-sm"
              disabled={isLoading}
            >
              {isLoading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </Button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t-2 border-[#223C55]/30"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#A6BFE3] px-3 text-[#263F5D]/60">
                หรือ
              </span>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full border-2 border-[#223C55] text-[#263F5D] bg-white/50 hover:bg-white/70 text-sm"
            type="button"
            onClick={async () => {
              setIsLoading(true);
              setErrorMessage(null);
              try {
                await loginWithGoogle();
              } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'เข้าสู่ระบบไม่สำเร็จ';
                setErrorMessage(message);
              } finally {
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
          >
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            เข้าสู่ระบบด้วย Google
          </Button>

          <p className="text-center mt-5 text-[#263F5D]/60 text-sm">
            ยังไม่มีบัญชี?{' '}
            <Link to="/register" className="text-[#213B54] font-medium hover:underline">
              สร้างบัญชี
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
