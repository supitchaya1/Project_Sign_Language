import { User, Settings, LogOut, Camera, Edit2, X, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';

export default function ProfilePage() {
  const { user, logout, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewAvatar(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = () => {
    if (updateProfile) {
      updateProfile(editName, previewAvatar || user?.avatar);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditName(user?.name || '');
    setPreviewAvatar(null);
    setIsEditing(false);
  };

  if (!user) {
    navigate('/login');
    return null;
  }

  const currentAvatar = previewAvatar || user.avatar;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#E8D5F0] to-[#FEFBF4] dark:from-[#1a2f44] dark:to-[#0F1F2F] py-8 md:py-12">
      <div className="container mx-auto px-4 max-w-sm">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-[#1a2f44] rounded-xl p-6 border-2 border-[#223C55] dark:border-[#213B54]"
        >
          {/* Avatar with edit button */}
          <div className="relative w-24 h-24 mx-auto mb-4">
            <div 
              className="w-24 h-24 rounded-full bg-[#213B54] flex items-center justify-center overflow-hidden cursor-pointer group"
              onClick={isEditing ? handleAvatarClick : undefined}
            >
              {currentAvatar ? (
                <img src={currentAvatar} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <User size={40} className="text-white" />
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

          {/* User Info */}
          {isEditing ? (
            <div className="mb-6">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-center text-xl font-bold bg-white dark:bg-[#213B54] border-[#223C55] dark:border-white/20 text-[#263F5D] dark:text-white mb-2"
                placeholder="ชื่อของคุณ"
              />
              <p className="text-gray-500 dark:text-white/60 text-sm text-center">{user.email}</p>
              <div className="flex gap-2 mt-4 justify-center">
                <Button
                  size="sm"
                  onClick={handleSave}
                  className="bg-[#FEC530] text-[#0F1F2F] hover:bg-[#e5b02b]"
                >
                  <Check size={16} className="mr-1" />
                  บันทึก
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCancel}
                  className="border-[#223C55] dark:border-white/30 text-[#263F5D] dark:text-white"
                >
                  <X size={16} className="mr-1" />
                  ยกเลิก
                </Button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-[#263F5D] dark:text-white mb-1 text-center">{user.name}</h1>
              <p className="text-gray-500 dark:text-white/60 text-sm mb-6 text-center">{user.email}</p>
            </>
          )}

          {/* Actions */}
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
            <Button variant="outline" className="w-full justify-start border-[#223C55] dark:border-white/10 text-[#263F5D] dark:text-white text-sm">
              <Settings size={16} className="mr-3" />
              จัดการบัญชี
            </Button>
            <Button variant="outline" className="w-full justify-start border-[#223C55] dark:border-white/10 text-[#263F5D] dark:text-white text-sm">
              <User size={16} className="mr-3" />
              สลับบัญชี
            </Button>
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