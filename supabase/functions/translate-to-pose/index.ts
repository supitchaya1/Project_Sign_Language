import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// init supabase (ใช้ service role key)
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ----- category priority -----
const CATEGORY_PRIORITY: Record<string, number> = {
  "คำทั่วไป": 1,
  "กริยา": 2,
  "สถานที่": 3,
  "จำนวน": 4,
  "ตัวเลข": 5,
  "การเขียนสะกดนิ้วมือ": 6,
};

function isNumberToken(token: string) {
  return /^[0-9]+$/.test(token);
}

function pickBestRow(token: string, rows: any[]) {
  return rows
    .slice()
    .sort((a, b) => {
      const pa = CATEGORY_PRIORITY[a.category] ?? 999;
      const pb = CATEGORY_PRIORITY[b.category] ?? 999;

      const boostA =
        isNumberToken(token) && a.category === "ตัวเลข" ? -1000 : 0;
      const boostB =
        isNumberToken(token) && b.category === "ตัวเลข" ? -1000 : 0;

      return (pa + boostA) - (pb + boostB);
    })[0];
}

serve(async (req) => {
  const { tokens } = await req.json();

  const { data, error } = await supabase
    .from("SL_word")
    .select("word, category, pose_filename")
    .in("word", tokens);

  if (error) {
    return new Response(JSON.stringify({ error }), { status: 500 });
  }

  const grouped: Record<string, any[]> = {};
  for (const row of data ?? []) {
    grouped[row.word] ??= [];
    grouped[row.word].push(row);
  }

  const found: any[] = [];
  const missing: string[] = [];

  for (const token of tokens) {
    const candidates = grouped[token] ?? [];
    if (candidates.length === 0) {
      missing.push(token);
    } else if (candidates.length === 1) {
      found.push(candidates[0]);
    } else {
      found.push(pickBestRow(token, candidates));
    }
  }

  return new Response(
    JSON.stringify({ found, missing }),
    { headers: { "Content-Type": "application/json" } }
  );
});
