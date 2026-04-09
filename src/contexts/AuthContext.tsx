import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  userId: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  updateProfile: (name: string, avatarFile?: File | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AVATAR_BUCKET = "avatars";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;

      if (error) {
        console.error("getSession error:", error);
      }

      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = user?.id ?? null;

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  };

  const register = async (
    name: string,
    email: string,
    password: string
  ) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });
    if (error) throw error;
  };

  const logout = async () => {
    setSession(null);
    setUser(null);

    try {
      const { error } = await supabase.auth.signOut({
        scope: "global",
      });
      if (error) throw error;
    } catch (err) {
      console.warn("Global signOut failed → fallback to local", err);

      const { error: localError } = await supabase.auth.signOut({
        scope: "local",
      });

      if (localError) throw localError;
    }
  };

  const updateProfile = async (
    name: string,
    avatarFile?: File | null
  ): Promise<void> => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      throw new Error("กรุณากรอกชื่อ");
    }

    const {
      data: { user: currentUser },
      error: getUserError,
    } = await supabase.auth.getUser();

    if (getUserError) throw getUserError;
    if (!currentUser) throw new Error("ไม่พบผู้ใช้");

    let avatarUrl =
      (currentUser.user_metadata?.avatar_url as string | undefined) ||
      (currentUser.user_metadata?.picture as string | undefined) ||
      null;

    if (avatarFile) {
      if (!avatarFile.type.startsWith("image/")) {
        throw new Error("กรุณาเลือกไฟล์รูปภาพเท่านั้น");
      }

      if (avatarFile.size > 2 * 1024 * 1024) {
        throw new Error("รูปมีขนาดใหญ่เกินไป กรุณาเลือกไฟล์ไม่เกิน 2MB");
      }

      const ext = avatarFile.name.split(".").pop() || "jpg";
      const filePath = `${currentUser.id}/avatar-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(filePath, avatarFile, {
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`อัปโหลดรูปไม่สำเร็จ: ${uploadError.message}`);
      }

      const { data: publicUrlData } = supabase.storage
        .from(AVATAR_BUCKET)
        .getPublicUrl(filePath);

      avatarUrl = publicUrlData.publicUrl;
    }

    const { data, error } = await supabase.auth.updateUser({
      data: {
        ...currentUser.user_metadata,
        name: trimmedName,
        avatar_url: avatarUrl,
      },
    });

    if (error) throw error;

    setUser(data.user);
  };

  const isAuthenticated = useMemo(() => !!session?.user, [session]);

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        userId,
        loading,
        isAuthenticated,
        login,
        loginWithGoogle,
        register,
        logout,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}