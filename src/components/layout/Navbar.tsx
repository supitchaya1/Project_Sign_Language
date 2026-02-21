import { Link, useLocation } from "react-router-dom";
import { Sun, Moon, Menu, X, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";

export default function Navbar() {
  const { isAuthenticated, user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // ✅ profile avatar from DB
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);

  const location = useLocation();

  const displayName =
    user?.user_metadata?.name ||
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "ผู้ใช้";

  // ✅ Prefer profileAvatar (from DB) -> fallback to metadata (Google)
  const avatarUrl =
    profileAvatar ||
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    null;

  const navLinks = [
    { path: "/", label: "หน้าหลัก" },
    { path: "/translate", label: "แปลเสียง" },
    { path: "/history", label: "ประวัติ" },
  ];

  const isActive = (path: string) => location.pathname === path;

  // ✅ load avatar from profiles table
  useEffect(() => {
    const loadProfileAvatar = async () => {
      if (!user?.id) {
        setProfileAvatar(null);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", user.id)
        .single();

      if (error) {
        // ถ้า table/column ไม่ตรง จะ error ตรงนี้
        setProfileAvatar(null);
        return;
      }

      // กรณี avatar_url เป็น "URL" พร้อมใช้
      setProfileAvatar(data?.avatar_url ?? null);

      /**
       * ✅ ถ้าคุณเก็บ avatar_url เป็น "path ใน Storage" เช่น "avatars/xxx.png"
       * ให้คอมเมนต์บรรทัด setProfileAvatar(...) ด้านบน แล้วใช้โค้ดนี้แทน
       *
       * if (data?.avatar_url) {
       *   const { data: pub } = supabase.storage.from("avatars").getPublicUrl(data.avatar_url);
       *   setProfileAvatar(pub.publicUrl);
       * } else {
       *   setProfileAvatar(null);
       * }
       *
       * (เปลี่ยน "avatars" ให้ตรงชื่อ bucket ของคุณ)
       */
    };

    loadProfileAvatar();
  }, [user?.id]);

  return (
    <nav className="sticky top-0 z-[999] bg-[#0F1F2F] shadow-sm isolate">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Mobile Menu Button */}
          <button
            className="lg:hidden p-2 text-white"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          {/* Empty spacer for desktop to balance the layout */}
          <div className="hidden lg:block w-[200px]"></div>

          {/* Desktop Navigation - Centered */}
          <div className="hidden lg:flex items-center justify-center">
            <div className="flex items-center gap-8">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`font-medium text-sm transition-colors px-4 py-2 rounded-full ${
                    isActive(link.path)
                      ? "bg-white dark:bg-white/20 text-[#263F5D] dark:text-white shadow-sm"
                      : "text-[#C9A7E3] hover:text-[#263F5D] dark:hover:text-white"
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
                theme === "light"
                  ? "bg-[#FEC530] text-[#0F1F2F]"
                  : "bg-[#213B54] text-white border border-white/30"
              }`}
            >
              {theme === "light" ? (
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
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={displayName}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <User size={18} className="text-[#0F1F2F]" />
                    )}
                  </div>
                  <span className="hidden lg:inline text-white font-semibold text-sm bg-white/10 px-3 py-1 rounded-full">
                    {displayName}
                  </span>
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
                        <p className="font-medium text-[#263F5D] dark:text-white text-sm">
                          {displayName}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-white/70">
                          {user?.email}
                        </p>
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
                    className="border-[#223C55] dark:border-white/50 text-[#263F5D] dark:text-[#0F1F2F] bg-white hover:bg-gray-100 dark:bg-white dark:hover:bg-gray-100 rounded-full px-4"
                  >
                    เข้าสู่ระบบ
                  </Button>
                </Link>

                <Link to="/register">
                  <Button
                    size="sm"
                    className="bg-[#0F1F2F] dark:bg-[#D8C0D0] text-[#C9A7E3] dark:text-[#0F1F2F] hover:bg-[#1a2f44] dark:hover:bg-[#c9b0c1] rounded-full px-4"
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
            <>
              {/* Backdrop (click to close) */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 lg:hidden"
                onClick={() => setIsMenuOpen(false)}
              />

              {/* Menu Card */}
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
                className="fixed z-50 lg:hidden left-4 top-16 w-[260px] rounded-2xl border border-white/20 bg-[#0F1F2F] shadow-xl overflow-hidden"
                onClick={(e) => e.stopPropagation()} // กันคลิกในกล่องแล้วปิด
              >
                <div className="p-4 space-y-2">
                  {/* Links */}
                  <div className="space-y-1">
                    {navLinks.map((link) => (
                      <Link
                        key={link.path}
                        to={link.path}
                        onClick={() => setIsMenuOpen(false)}
                        className={`flex items-center px-3 py-2 rounded-xl font-medium text-sm ${
                          isActive(link.path)
                            ? "bg-white/10 text-white"
                            : "text-[#C9A7E3] hover:bg-white/5"
                        }`}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>

                  <div className="pt-3 border-t border-white/10 space-y-2">
                    {isAuthenticated ? (
                      <>
                        <Link
                          to="/profile"
                          onClick={() => setIsMenuOpen(false)}
                          className="block px-3 py-2 rounded-xl text-white text-sm hover:bg-white/5"
                        >
                          โปรไฟล์
                        </Link>
                        <button
                          onClick={() => {
                            logout();
                            setIsMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 rounded-xl text-red-400 text-sm hover:bg-white/5"
                        >
                          ออกจากระบบ
                        </button>
                      </>
                    ) : (
                      <>
                        <Link
                          to="/login"
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-center gap-2 py-2 rounded-full bg-white text-[#0F1F2F] font-medium text-sm hover:bg-gray-100"
                        >
                          เข้าสู่ระบบ
                        </Link>

                        <Link
                          to="/register"
                          onClick={() => setIsMenuOpen(false)}
                          className="flex items-center justify-center gap-2 py-2 rounded-full border border-white/70 text-white font-medium text-sm hover:bg-white/5"
                        >
                          สร้างบัญชีผู้ใช้
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </nav>
  );
}
