/// <reference lib="deno.ns" />

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const typhoonApiKey = Deno.env.get("TYPHOON_API_KEY");

// ใช้โมเดลจาก secret ก่อน ถ้าไม่มีใช้ default
const TYPHOON_MODEL =
  Deno.env.get("TYPHOON_MODEL") ?? "typhoon-v2.5-30b-a3b-instruct";

// Supabase secrets
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// สร้าง client (service role เพื่ออ่านตาราง/ไม่ติด RLS)
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(resBody: unknown, status = 200) {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getWordCountTH(s: string) {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  return parts.length;
}

function isShortVery(text: string) {
  const t = (text ?? "").toString().trim();
  if (!t) return true;
  const charLen = t.length;
  const wc = getWordCountTH(t);
  // ถ้าข้อความไม่มีเว้นวรรค เช่น "พ่อกินข้าว" wc จะเป็น 1
  return charLen <= 12 || wc <= 2;
}

function extractJsonFromText(content: string) {
  const match = content.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : content;
  return JSON.parse(candidate);
}

// ===== DB MATCH =====
async function pickSentenceFromDB(inputText: string) {
  if (!supabase) {
    return {
      best: null as any,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    };
  }

  const { data, error } = await supabase.rpc("pick_thsl_sentence", {
    input_text: inputText,
  });

  if (error) return { best: null, error: error.message };

  const best = Array.isArray(data) ? data[0] : null;
  return { best, error: null };
}

// ===== KEYWORDS FROM THSL_FIXED =====
function normalizeToken(t: string) {
  return (t ?? "")
    .toString()
    .trim()
    // ตัดเครื่องหมายทั่วไป
    .replace(/[.,!?;:"'(){}\[\]<>]/g, "")
    // แทนหลายช่องว่างเป็นช่องเดียว
    .replace(/\s+/g, " ")
    .trim();
}

function keywordsFromThslFixed(thsl_fixed: string, max = 5) {
  const raw = (thsl_fixed ?? "").toString().trim();
  if (!raw) return [];

  const tokens = raw
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);

  // unique แบบรักษาลำดับ
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const tok of tokens) {
    if (!seen.has(tok)) {
      seen.add(tok);
      uniq.push(tok);
    }
  }

  // ต้องการ 3-5 คำ: ถ้าน้อยกว่า 3 ก็ส่งเท่าที่มี
  return uniq.slice(0, max);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    if (!typhoonApiKey) {
      return json({ error: "Missing TYPHOON_API_KEY" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const text = (body?.text ?? "").toString().trim();

    if (!text) {
      return json({ error: "No text provided" }, 400);
    }

    // ===== 1) ได้ candidateSummary (extractive) =====
    let candidateSummary = text;

    if (!isShortVery(text)) {
      const response = await fetch(
        "https://api.opentyphoon.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${typhoonApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: TYPHOON_MODEL,
            messages: [
              {
                role: "system",
                content: `คุณเป็นระบบ "ย่อข้อความแบบคัดลอกจากต้นฉบับ (extractive)" ภาษาไทย
กติกา:
1) ย่อโดย "ตัดออก" เท่านั้น
2) ห้ามสร้างคำใหม่ ห้ามเรียบเรียงใหม่
3) ตอบกลับเป็น JSON เท่านั้น:
{"summary":"..."}
`,
              },
              { role: "user", content: text },
            ],
            max_tokens: 300,
            temperature: 0,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return json(
          {
            error: "TYPHOON API error",
            status: response.status,
            detail: errorText,
            model: TYPHOON_MODEL,
          },
          response.status
        );
      }

      const data = await response.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;

      try {
        const result = content ? extractJsonFromText(content) : {};
        candidateSummary = (result?.summary ?? "").toString().trim() || text;
      } catch {
        candidateSummary = text;
      }
    }

    // ===== 2) บังคับ: summary ต้องเป็นประโยคที่มีใน DB เท่านั้น =====
    const THRESHOLD = 0.35;

    const first = await pickSentenceFromDB(candidateSummary);

    if (first.best && (first.best.score ?? 0) >= THRESHOLD) {
      const summary = first.best.thai;
      const thsl_fixed = first.best.thsl_fixed ?? "";
      const keywords = keywordsFromThslFixed(thsl_fixed, 5);

      return json({
        found: true,
        summary,           // ✅ ประโยคที่มีใน DB
        thsl_fixed,        // ✅ เอาไปใช้ลำดับท่าทางได้เลย
        keywords,          // ✅ มาจาก thsl_fixed (ชัวร์สุด)
        originalText: text,
        debug: {
          model: isShortVery(text) ? "short-circuit" : TYPHOON_MODEL,
          candidateSummary,
          score: first.best.score,
          used: "candidateSummary",
        },
      });
    }

    // fallback: ลองแมตช์จากข้อความต้นฉบับตรงๆ
    const second = await pickSentenceFromDB(text);

    if (second.best && (second.best.score ?? 0) >= THRESHOLD) {
      const summary = second.best.thai;
      const thsl_fixed = second.best.thsl_fixed ?? "";
      const keywords = keywordsFromThslFixed(thsl_fixed, 5);

      return json({
        found: true,
        summary,
        thsl_fixed,
        keywords,
        originalText: text,
        debug: {
          model: isShortVery(text) ? "short-circuit" : TYPHOON_MODEL,
          candidateSummary,
          score: second.best.score,
          used: "fallback(originalText)",
        },
      });
    }

    // ไม่พบใน DB
    return json({
      found: false,
      summary: null,
      thsl_fixed: null,
      keywords: [],
      originalText: text,
      debug: {
        model: isShortVery(text) ? "short-circuit" : TYPHOON_MODEL,
        candidateSummary,
        error: first.error ?? second.error ?? null,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return json({ error: errorMessage }, 500);
  }
});