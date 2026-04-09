import { User, LogOut, Camera, Edit2, X, Check } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";

export default function ProfilePage() {
  const { user, loading, logout, updateProfile } = useAuth();
  const navigate = useNavigate();

  const displayName =
    (user?.user_metadata?.name as string | undefined) ||
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email?.split("@")[0] ||
    "";

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(displayName);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditName(displayName);
  }, [displayName]);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login");
    }
  }, [loading, user, navigate]);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const handleAvatarClick = () => {
    if (isEditing) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);

    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMessage("กรุณาเลือกไฟล์รูปภาพเท่านั้น");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage("รูปมีขนาดใหญ่เกินไป กรุณาเลือกไฟล์ไม่เกิน 2MB");
      return;
    }

    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      setPreviewAvatar(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setErrorMessage(null);

    if (!editName.trim()) {
      setErrorMessage("กรุณากรอกชื่อ");
      return;
    }

    try {
      setSaving(true);
      await updateProfile(editName, selectedFile);
      setIsEditing(false);
      setSelectedFile(null);
      setPreviewAvatar(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "อัปเดตโปรไฟล์ไม่สำเร็จ";
      setErrorMessage(message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditName(displayName);
    setSelectedFile(null);
    setPreviewAvatar(null);
    setErrorMessage(null);
    setIsEditing(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (loading) return null;
  if (!user) return null;

  const provider = user.app_metadata?.provider;
  const googleAvatar =
    provider === "google"
      ? ((user.user_metadata?.picture as string | undefined) ||
          (user.user_metadata?.avatar_url as string | undefined) ||
          null)
      : null;

  const savedAvatar =
    (user.user_metadata?.avatar_url as string | undefined) || null;

  const currentAvatar = previewAvatar || savedAvatar || googleAvatar || null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] py-8 md:py-12">
      <div className="container mx-auto px-4 max-w-sm">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-[#1a2f44] rounded-xl p-6 border-2 border-[#223C55] dark:border-[#213B54]"
        >
          <div className="relative w-24 h-24 mx-auto mb-4">
            <div
              className="w-24 h-24 rounded-full bg-[#213B54] flex items-center justify-center overflow-hidden cursor-pointer group relative"
              onClick={handleAvatarClick}
            >
              {currentAvatar ? (
                <img
                  src={currentAvatar}
                  alt={displayName || "ผู้ใช้"}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <User size={44} className="text-white" />
              )}

              {isEditing && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
                  <Camera size={24} className="text-white" />
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {isEditing ? (
            <div className="mb-6">
              {errorMessage && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 mb-3">
                  {errorMessage}
                </div>
              )}

              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-center text-xl font-bold bg-white dark:bg-[#213B54] border-[#223C55] dark:border-white/20 text-[#263F5D] dark:text-white mb-2"
                placeholder="ชื่อของคุณ"
              />

              <p className="text-gray-500 dark:text-white/60 text-sm text-center">
                {user.email}
              </p>

              <div className="flex gap-2 mt-4 justify-center">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-[#FEC530] text-[#0F1F2F] hover:bg-[#e5b02b]"
                >
                  <Check size={16} className="mr-1" />
                  {saving ? "กำลังบันทึก..." : "บันทึก"}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={saving}
                  className="border-[#223C55] dark:border-white/30 text-[#263F5D] dark:text-white"
                >
                  <X size={16} className="mr-1" />
                  ยกเลิก
                </Button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-[#263F5D] dark:text-white mb-1 text-center">
                {displayName || "ผู้ใช้"}
              </h1>
              <p className="text-gray-500 dark:text-white/60 text-sm mb-6 text-center">
                {user.email}
              </p>
            </>
          )}

          <div className="space-y-2">
            {!isEditing && (
              <Button
                variant="outline"
                className="w-full justify-start border-[#223C55] dark:border-white/10 text-[#263F5D] dark:text-white text-sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 size={16} className="mr-3" />
                แก้ไขโปรไฟล์
              </Button>
            )}

            <Button
              variant="outline"
              onClick={handleLogout}
              className="w-full justify-start border-[#223C55] dark:border-white/10 text-red-500 hover:text-red-600 text-sm"
            >
              <LogOut size={16} className="mr-3" />
              ออกจากระบบ
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}