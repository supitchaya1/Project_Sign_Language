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
  updateProfile: (name: string, avatarUrl?: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // โหลด session ตอนเปิดเว็บ
    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;
      if (error) {
        console.error("getSession error:", error);
      }
      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    // ฟัง auth state change
    const { data } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const userId = user?.id ?? null;

  // ========================
  // LOGIN
  // ========================
  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
  };

  // ========================
  // LOGIN WITH GOOGLE
  // ========================
  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  };

  // ========================
  // REGISTER
  // ========================
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

  // ========================
  // LOGOUT (แก้ปัญหา ERR_CONNECTION_RESET)
  // ========================
  const logout = async () => {
    // ล้าง state ฝั่ง UI ทันที ป้องกันค้าง
    setSession(null);
    setUser(null);

    try {
      // พยายาม revoke ทุก device ก่อน
      const { error } = await supabase.auth.signOut({
        scope: "global",
      });
      if (error) throw error;
    } catch (err) {
      console.warn(
        "Global signOut failed → fallback to local",
        err
      );

      // ถ้า network ล้มเหลว ให้ล้างเฉพาะเครื่องนี้
      const { error: localError } =
        await supabase.auth.signOut({
          scope: "local",
        });

      if (localError) throw localError;
    }
  };

  // ========================
  // UPDATE PROFILE
  // ========================
  const updateProfile = async (
    name: string,
    avatarUrl?: string | null
  ) => {
    const { error, data } = await supabase.auth.updateUser({
      data: {
        name,
        avatar_url: avatarUrl ?? null,
      },
    });

    if (error) throw error;
    setUser(data.user);
  };

  const isAuthenticated = useMemo(
    () => !!session?.user,
    [session]
  );

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
