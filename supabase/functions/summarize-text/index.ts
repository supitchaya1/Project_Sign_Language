/// <reference lib="deno.ns" />

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const typhoonApiKey = Deno.env.get("TYPHOON_API_KEY");

// ✅ ใช้โมเดลจาก secret ก่อน ถ้าไม่มีใช้ default
const TYPHOON_MODEL =
  Deno.env.get("TYPHOON_MODEL") ?? "typhoon-v2.5-30b-a3b-instruct";

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
  // นับแบบหยาบ: แยกด้วยช่องว่าง
  const parts = s.trim().split(/\s+/).filter(Boolean);
  return parts.length;
}

function isShortVery(text: string) {
  const t = (text ?? "").toString().trim();
  if (!t) return true;
  // เงื่อนไข: <= 12 ตัวอักษร (ไม่รวมช่องว่างปลาย) หรือ <= 2 คำ
  const charLen = t.length;
  const wc = getWordCountTH(t);
  return charLen <= 12 || wc <= 2;
}

function extractJsonFromText(content: string) {
  // พยายามดึง JSON ก้อนแรก
  const match = content.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : content;
  return JSON.parse(candidate);
}

serve(async (req) => {
  // CORS preflight
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

    // ✅ เงื่อนไข: ถ้าสั้นมาก คืนคำนั้นเลย (ไม่ต้องเรียกโมเดล)
    if (isShortVery(text)) {
      return json({
        summary: text,
        keywords: [],
        originalText: text,
        debug: { model: "short-circuit" },
      });
    }

    console.log("Processing text length:", text.length);
    console.log("Using model:", TYPHOON_MODEL);

    // ✅ กติกาใหม่: ย่อแบบคัดลอกจากต้นฉบับเท่านั้น (extractive)
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
กติกา (ห้ามฝ่าฝืน):
1) ย่อโดย "ตัดออก" เท่านั้น: ตัดคำฟุ่มเฟือย/คำซ้ำ/รายละเอียดไม่จำเป็นออก
2) ห้ามสร้างคำใหม่ ห้ามแปลความหมาย ห้ามเรียบเรียงประโยคใหม่
   - summary ต้องประกอบด้วยคำ/วลีที่ "ปรากฏในต้นฉบับเท่านั้น" (copy/paste ได้)
   - ห้ามใส่คำเชื่อม/คำอธิบายเพิ่มเอง
3) keywords ต้องเป็นคำที่อยู่ในต้นฉบับเท่านั้น 3-5 คำ (ถ้าสั้นมากให้เป็น [])
4) ตอบกลับเป็น JSON เท่านั้น รูปแบบนี้เท่านั้น:
{"summary":"...","keywords":["...","..."]}

ตรวจทานก่อนส่ง:
- summary/keywords ทุกคำต้องหาเจอในต้นฉบับแบบตรงตัว
- ห้ามใส่ markdown ห้ามใส่ข้อความอื่นนอก JSON`,
            },
            {
              role: "user",
              content: text,
            },
          ],
          max_tokens: 300,
          temperature: 0,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("TYPHOON API error:", response.status, errorText);
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

    if (!content) {
      return json({ error: "No content in TYPHOON response" }, 500);
    }

    // Parse JSON from the response
    let result: { summary?: string; keywords?: string[] } = {};
    try {
      result = extractJsonFromText(content);
    } catch (e) {
      console.error("Failed to parse TYPHOON response as JSON:", e);
      // fallback: คืนข้อความต้นฉบับ (กันหลุดกติกา)
      result = { summary: text, keywords: [] };
    }

    // ✅ Guardrail: ถ้าโมเดลส่ง summary ว่าง ให้คืนต้นฉบับ
    const summary = (result.summary ?? "").toString().trim() || text;

    // ✅ Guardrail: ถ้าข้อความจริงๆสั้นมาก ให้คืนคำนั้นเลย
    if (isShortVery(text)) {
      return json({
        summary: text,
        keywords: [],
        originalText: text,
        debug: { model: "short-circuit" },
      });
    }

    // ✅ keywords: จำกัดเป็น array ของ string และไม่เกิน 5
    const keywords = Array.isArray(result.keywords)
      ? result.keywords
          .map((k) => (k ?? "").toString().trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];

    return json({
      summary,
      keywords,
      originalText: text,
      debug: { model: TYPHOON_MODEL },
    });
  } catch (error) {
    console.error("Error in summarize-text function:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return json({ error: errorMessage }, 500);
  }
});
