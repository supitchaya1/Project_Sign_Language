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

function normalizeText(s?: string | null) {
  return (s ?? "").trim();
}

function normalizeKeywords(s?: string | null) {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .join(", ");
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

  const cleanInput = normalizeText(input_text);
  const cleanTranslated = normalizeText(translated_result);
  const cleanSummary = normalizeText(summary_text);
  const cleanKeywords = normalizeKeywords(keywords);
  const cleanVideoUrl = normalizeText(video_url);

  if (!cleanInput || !cleanTranslated) {
    throw new Error("ข้อมูลประวัติไม่ครบ");
  }

  const { data: existingRaw, error: findError } = await supabase
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
    .eq("input_text", cleanInput)
    .eq("translated_result", cleanTranslated)
    .maybeSingle();

  if (findError) {
    console.error("saveHistory find existing error:", findError);
    throw new Error(findError.message);
  }

  const existing = existingRaw as HistoryRecord | null;

  if (existing) {
    const { data, error } = await supabase
      .from("translation_history")
      .update({
        summary_text: cleanSummary || null,
        keywords: cleanKeywords || null,
        video_url: cleanVideoUrl || existing.video_url || null,
        created_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) {
      console.error("saveHistory update error:", error);
      throw new Error(error.message);
    }

    return data as HistoryRecord;
  }

  const payload = {
    user_id: user.id,
    input_text: cleanInput,
    translated_result: cleanTranslated,
    summary_text: cleanSummary || null,
    keywords: cleanKeywords || null,
    video_url: cleanVideoUrl || null,
  };

  const { data, error } = await supabase
    .from("translation_history")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("saveHistory insert error:", error);
    throw new Error(error.message);
  }

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

  if (error) {
    console.error("fetchMyHistory error:", error);
    throw new Error(error.message);
  }

  return (data ?? []) as HistoryRecord[];
}

export async function deleteHistory(id: string) {
  const user = await requireUser();

  const { error } = await supabase
    .from("translation_history")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("deleteHistory error:", error);
    throw new Error(error.message);
  }
}