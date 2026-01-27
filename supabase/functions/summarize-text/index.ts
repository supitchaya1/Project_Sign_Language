/// <reference lib="deno.ns" />

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const typhoonApiKey = Deno.env.get("TYPHOON_API_KEY");

// ✅ ใช้โมเดลจาก secret ก่อน ถ้าไม่มีใช้ default ที่ key ของคุณมีแน่ๆ
const TYPHOON_MODEL =
  Deno.env.get("TYPHOON_MODEL") ?? "typhoon-v2.5-30b-a3b-instruct";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!typhoonApiKey) {
      return new Response(JSON.stringify({ error: "Missing TYPHOON_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const text = (body?.text ?? "").toString().trim();

    if (!text) {
      return new Response(JSON.stringify({ error: "No text provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Processing text length:", text.length);
    console.log("Using model:", TYPHOON_MODEL);

    // Call TYPHOON API
    const response = await fetch("https://api.opentyphoon.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${typhoonApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TYPHOON_MODEL, // ✅ สำคัญ: ใช้ตัวแปร ไม่ hardcode
        messages: [
          {
            role: "system",
            content: `คุณเป็นผู้ช่วยสรุปข้อความภาษาไทย ให้ทำงานดังนี้:
1) สรุปข้อความให้สั้นกระชับ จับใจความสำคัญ ไม่เกิน 2-3 ประโยค
2) ดึงคำสำคัญออกมา 3-5 คำ
ตอบกลับเป็น JSON เท่านั้นตามรูปแบบ:
{"summary":"ข้อความสรุป","keywords":["คำ1","คำ2","คำ3"]}`,
          },
          {
            role: "user",
            content: `สรุปข้อความนี้และดึงคำสำคัญ:\n\n${text}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("TYPHOON API error:", response.status, errorText);

      // ส่ง error กลับแบบอ่านได้ ไม่ซ่อนเป็น 500 อย่างเดียว
      return new Response(
        JSON.stringify({
          error: "TYPHOON API error",
          status: response.status,
          detail: errorText,
          model: TYPHOON_MODEL,
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(JSON.stringify({ error: "No content in TYPHOON response" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse JSON from the response
    let result: { summary?: string; keywords?: string[] } = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (e) {
      console.error("Failed to parse TYPHOON response as JSON:", e);
      result = { summary: content.substring(0, 200), keywords: [] };
    }

    return new Response(
      JSON.stringify({
        summary: result.summary || "",
        keywords: result.keywords || [],
        originalText: text,
        debug: { model: TYPHOON_MODEL },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in summarize-text function:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
