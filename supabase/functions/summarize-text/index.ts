import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const typhoonApiKey = Deno.env.get('TYPHOON_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text } = await req.json();

    if (!text || text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'No text provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing text for summarization, length:', text.length);

    // Call TYPHOON API for summarization and keyword extraction
    const response = await fetch('https://api.opentyphoon.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${typhoonApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'typhoon-v2.1-12b-instruct',
        messages: [
          {
            role: 'system',
            content: `คุณเป็นผู้ช่วยสรุปข้อความภาษาไทย ให้ทำงานดังนี้:
1. สรุปข้อความให้สั้นกระชับ จับใจความสำคัญ ไม่เกิน 2-3 ประโยค
2. ดึงคำสำคัญออกมา 3-5 คำ

ตอบในรูปแบบ JSON ดังนี้:
{
  "summary": "ข้อความสรุป",
  "keywords": ["คำสำคัญ1", "คำสำคัญ2", "คำสำคัญ3"]
}`
          },
          {
            role: 'user',
            content: `สรุปข้อความนี้และดึงคำสำคัญ:\n\n${text}`
          }
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('TYPHOON API error:', response.status, errorText);
      throw new Error(`TYPHOON API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('TYPHOON response:', JSON.stringify(data));

    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content in TYPHOON response');
    }

    // Parse JSON response from TYPHOON
    let result;
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse TYPHOON response as JSON:', parseError);
      // Fallback: use the raw content as summary
      result = {
        summary: content.substring(0, 200),
        keywords: []
      };
    }

    return new Response(
      JSON.stringify({
        summary: result.summary || '',
        keywords: result.keywords || [],
        originalText: text
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in summarize-text function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
