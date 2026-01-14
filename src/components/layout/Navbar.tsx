import { Link, useLocation } from 'react-router-dom';
import { Sun, Moon, Menu, X, User } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

export default function Navbar() {
  const { isAuthenticated, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const location = useLocation();

  const navLinks = [
    { path: '/', label: 'หน้าหลัก' },
    { path: '/translate', label: 'แปลเสียง' },
    { path: '/history', label: 'ประวัติ' },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="sticky top-0 z-50 bg-[#0F1F2F] shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Mobile Menu Button */}
          <button
            className="lg:hidden p-2 text-[#263F5D] dark:text-white"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          {/* Desktop Navigation - Centered */}
          <div className="hidden lg:flex items-center justify-center flex-1">
            <div className="flex items-center gap-8">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`font-medium text-sm transition-colors px-4 py-2 rounded-full ${
                    isActive(link.path) 
                      ? 'bg-white dark:bg-white/20 text-[#263F5D] dark:text-white shadow-sm' 
                      : 'text-[#C9A7E3] hover:text-[#263F5D] dark:hover:text-white'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Right Section: Theme Toggle + Profile/Auth */}
          <div className="flex items-center gap-3">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-full font-medium text-sm transition-all ${
                theme === 'light' 
                  ? 'bg-[#FEC530] text-[#0F1F2F]' 
                  : 'bg-[#213B54] text-white border border-white/30'
              }`}
            >
              {theme === 'light' ? (
                <>
                  <Sun size={16} />
                  <span className="hidden sm:inline">โหมดสว่าง</span>
                </>
              ) : (
                <>
                  <Moon size={16} />
                  <span className="hidden sm:inline">โหมดมืด</span>
                </>
              )}
            </button>

            {/* Profile Button (shown when logged in) */}
            {isAuthenticated && (
              <div className="relative">
                <button
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  className="flex items-center gap-2"
                >
                  <div className="w-9 h-9 rounded-full bg-[#C9A7E3] flex items-center justify-center overflow-hidden border-2 border-white dark:border-white/30">
                    {user?.avatar ? (
                      <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
                    ) : (
                      <User size={18} className="text-[#0F1F2F]" />
                    )}
                  </div>
                  <span className="hidden lg:inline text-[#263F5D] dark:text-white font-medium text-sm">{user?.name}</span>
                </button>

                <AnimatePresence>
                  {isProfileOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute right-0 mt-2 w-48 bg-white dark:bg-[#213B54] rounded-lg shadow-lg border border-[#223C55]/20 dark:border-white/20 overflow-hidden z-50"
                    >
                      <div className="p-3 border-b border-gray-200 dark:border-white/20">
                        <p className="font-medium text-[#263F5D] dark:text-white text-sm">{user?.name}</p>
                        <p className="text-xs text-gray-500 dark:text-white/70">{user?.email}</p>
                      </div>
                      <Link
                        to="/profile"
                        className="block px-3 py-2 text-[#263F5D] dark:text-white text-sm hover:bg-gray-100 dark:hover:bg-white/10"
                        onClick={() => setIsProfileOpen(false)}
                      >
                        จัดการบัญชี
                      </Link>
                      <button
                        onClick={() => {
                          logout();
                          setIsProfileOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-red-500 text-sm hover:bg-gray-100 dark:hover:bg-white/10"
                      >
                        ออกจากระบบ
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Auth Buttons (shown when not logged in) - Desktop only */}
            {!isAuthenticated && (
              <div className="hidden lg:flex items-center gap-2">
                <Link to="/login">
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="border-[#223C55] dark:border-white/50 text-[#263F5D] dark:text-white bg-white hover:bg-gray-100 dark:hover:bg-white/10 rounded-full px-4"
                  >
                    เข้าสู่ระบบ
                  </Button>
                </Link>
                <Link to="/register">
                  <Button 
                    size="sm"
                    className="bg-[#0F1F2F] text-[#C9A7E3] hover:bg-[#1a2f44] rounded-full px-4"
                  >
                    สร้างบัญชี
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="lg:hidden overflow-hidden"
            >
              <div className="py-4 space-y-2">
                {navLinks.map((link) => (
                  <Link
                    key={link.path}
                    to={link.path}
                    onClick={() => setIsMenuOpen(false)}
                    className={`block py-2 px-4 rounded-lg font-medium text-sm ${
                      isActive(link.path) 
                        ? 'bg-white text-[#263F5D] shadow-sm dark:bg-white/20 dark:text-white' 
                        : 'text-[#C9A7E3] hover:bg-gray-100 dark:hover:bg-white/10'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
                
                <div className="pt-4 border-t border-gray-200 dark:border-white/20 space-y-2">
                  {isAuthenticated ? (
                    <>
                      <Link
                        to="/profile"
                        onClick={() => setIsMenuOpen(false)}
                        className="block py-2 px-4 text-[#263F5D] dark:text-white text-sm"
                      >
                        โปรไฟล์
                      </Link>
                      <button
                        onClick={() => {
                          logout();
                          setIsMenuOpen(false);
                        }}
                        className="w-full text-left py-2 px-4 text-red-500 text-sm"
                      >
                        ออกจากระบบ
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        to="/login"
                        onClick={() => setIsMenuOpen(false)}
                        className="block py-2 px-4 text-center rounded-full border border-[#223C55] dark:border-white/30 text-[#003459] dark:text-white text-sm"
                      >
                        เข้าสู่ระบบ
                      </Link>
                      <Link
                        to="/register"
                        onClick={() => setIsMenuOpen(false)}
                        className="block py-2 px-4 text-center rounded-full bg-[#0F1F2F] text-[#C9A7E3] font-medium text-sm"
                      >
                        สร้างบัญชีผู้ใช้
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </nav>
  );
}