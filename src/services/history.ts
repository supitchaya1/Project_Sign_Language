import { supabase } from "@/lib/supabase";

export const NOT_LOGGED_IN = "NOT_LOGGED_IN";

export interface HistoryRecord {
  id: string;
  input_text: string;
  translated_result: string;
  created_at: string;
  user_id: string;
  summary_text?: string | null;
  keywords?: string | null;
  video_url?: string | null;
}

async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error(NOT_LOGGED_IN);
  return data.user;
}

export async function saveHistory({
  input_text,
  translated_result,
  summary_text,
  keywords,
  video_url,
}: {
  input_text: string;
  translated_result: string;
  summary_text?: string;
  keywords?: string;
  video_url?: string;
}) {
  const user = await requireUser();

  const { data, error } = await supabase
    .from("translation_history")
    .insert({
      user_id: user.id,
      input_text,
      translated_result,
      summary_text: summary_text ?? null,
      keywords: keywords ?? null,
      video_url: video_url ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as HistoryRecord;
}

export async function fetchMyHistory() {
  const user = await requireUser();

  const { data, error } = await supabase
    .from("translation_history")
    .select(`
      id,
      input_text,
      translated_result,
      created_at,
      user_id,
      summary_text,
      keywords,
      video_url
    `)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as HistoryRecord[];
}

/**
 * ลบประวัติ 1 รายการ (ลบได้เฉพาะของตัวเอง)
 */
export async function deleteHistory(id: string) {
  const user = await requireUser();

  const { error } = await supabase
    .from("translation_history")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
}